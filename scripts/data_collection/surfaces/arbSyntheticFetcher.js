'use strict';
/**
 * scripts/data_collection/surfaces/arbSyntheticFetcher.js
 *
 * PURPOSE:
 *   Compare ARB/USDC direct price vs ARB→WETH→USDC synthetic route price.
 *   Surface #2 in multi-surface expansion (ARB/USDT was rejected at discovery).
 *
 *   Direct:    ARB/USDC via Camelot V3  (existing proven anchor)
 *   Synthetic: ARB/WETH (UniV3) × WETH/USDC (UniV3)
 *
 *   If the synthetic price diverges from the direct price after fees,
 *   a route arbitrage opportunity exists.
 *
 * WHY THIS SURFACE:
 *   - Removes reliance on a thin UniV3 ARB/USDC mirror
 *   - Uses deep WETH markets ($1.3M ARB/WETH, deep WETH/USDC)
 *   - Route arb is structurally different from mirror arb
 *   - Fully compatible with existing pipeline schema
 *
 * INPUTS:
 *   - Arbitrum mainnet via createProvider('arbitrum')
 *   - Camelot V3 ARB/USDC:  0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1  (Algebra)
 *   - UniV3 ARB/WETH 0.05%: 0xc6f780497a95e246eb9449f5e4770916dcd6396a
 *   - UniV3 WETH/USDC 0.05%: 0xC6962004f452bE9203591991D15f6b388e09E8D0
 *
 * OUTPUTS:
 *   direct_price:    ARB/USDC from Camelot V3
 *   synthetic_price: ARB/USDC computed as (ARB→WETH price) × (WETH→USDC price)
 *   spread:          direct vs synthetic spread %
 *   depthUsd:        min(arbWethDepthUsd, wethUsdcDepthUsd) — weakest leg governs
 *   direction:       which side to buy/sell
 *
 * POOL MATH NOTES:
 *   ARB/WETH pool:   token0=ARB (0x912... < 0x82af... by address sort)
 *     wethPerArb = sqrtP^2  (both 18-dec, no decimal adjustment)
 *
 *   WETH/USDC pool:  token0 is determined dynamically via token0() call.
 *     Address sort: WETH=0x82af... < USDC=0xaf88... → token0=WETH, token1=USDC
 *     wethPriceUsdc = sqrtP^2 × 10^(18-6)  (USDC per WETH, token0=WETH orientation)
 *     The code reads token0() at runtime to confirm — never assumes orientation.
 *
 *   Synthetic ARB/USDC = wethPerArb × wethPriceUsdc
 *
 * IN SCOPE:
 *   - Read three pools serially, block-anchored
 *   - Compute synthetic price via two-leg multiplication
 *   - Emit direct, synthetic, spread records
 *
 * OUT OF SCOPE:
 *   - No execution logic
 *   - No modification of existing fetchers or activator
 *   - No Redis
 *   - No new chains
 *   - No Promise.all across different pools
 *
 * USAGE:
 *   node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js
 *   node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js --json
 *   node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js --watch --log=./logs/arb_synthetic.jsonl
 *   node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js --help
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL ADDRESSES — confirmed on Arbitrum mainnet
// ─────────────────────────────────────────────────────────────────────────────
const POOL_CAM_ARB_USDC   = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';  // confirmed_default: Camelot V3 ARB/USDC (Algebra)
const POOL_UNI_ARB_WETH   = '0xc6f780497a95e246eb9449f5e4770916dcd6396a';  // confirmed_default: UniV3 ARB/WETH 0.05%  $1.3M depth
const POOL_UNI_WETH_USDC  = '0xC6962004f452bE9203591991D15f6b388e09E8D0';  // confirmed_default: UniV3 WETH/USDC 0.05% (already in repo arbitrumFetcher)

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────
const ARB_TOKEN  = '0x912CE59144191C1204E64559FE8253a0e49E6548';  // confirmed_default: 18 dec
const WETH_TOKEN = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';  // confirmed_default: 18 dec
const USDC_TOKEN = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';  // confirmed_default: native USDC, 6 dec

// ─────────────────────────────────────────────────────────────────────────────
// FEES
// ─────────────────────────────────────────────────────────────────────────────
const FEE_CAMELOT_V3  = 0.000249;   // confirmed_default: measured dynamic Camelot V3
const FEE_UNI_ARB_WETH  = 0.0005;  // confirmed_default: UniV3 0.05% tier
const FEE_UNI_WETH_USDC = 0.0005;  // confirmed_default: UniV3 0.05% tier
// Two-leg synthetic fee burden: sell ARB→WETH + sell WETH→USDC
const FEE_SYNTHETIC_TOTAL = FEE_UNI_ARB_WETH + FEE_UNI_WETH_USDC;  // 0.10%
// Direct fee burden: buy/sell on Camelot V3 + cross-venue leg
const FEE_DIRECT_TOTAL = FEE_CAMELOT_V3;  // 0.025% (one leg)

// ─────────────────────────────────────────────────────────────────────────────
// LOG ENVELOPE
// ─────────────────────────────────────────────────────────────────────────────
const LOG_SOURCE = 'arb_synthetic_fetcher';
const LOG_CHAIN  = 'arbitrum';
const LOG_PAIR   = 'ARB/USDC';

// ─────────────────────────────────────────────────────────────────────────────
// ABIs — minimal read-only
// ─────────────────────────────────────────────────────────────────────────────
const ALGEBRA_ABI = [
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
];
const UNIV3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToRaw(sqrtPriceX96) {
  // Returns token1/token0 in raw (no decimal adjustment)
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP;
}

function activeTickDepthUsd(liquidityRaw, sqrtPriceX96, dec0, dec1, token0IsQuote) {
  // Depth in USD (quote token terms)
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  if (token0IsQuote) {
    // token0 is the USD token — depth = L / sqrtP / 10^dec0
    return sqrtP > 0 ? (Number(liquidityRaw) / sqrtP) / Math.pow(10, dec0) : 0;
  } else {
    // token1 is the USD token — depth = L * sqrtP / 10^dec1
    return (Number(liquidityRaw) * sqrtP) / Math.pow(10, dec1);
  }
}

function spreadPct(a, b) {
  return Math.abs(a - b) / Math.min(a, b) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL READS — all serial, all block-anchored
// ─────────────────────────────────────────────────────────────────────────────

// Leg 1: Camelot V3 ARB/USDC (Algebra) — direct price
async function readCamArbUsdc(rpc) {
  const res = await rpc.callDetailed(
    'syn.cam.arb_usdc',
    async (provider) => {
      const pool = new ethers.Contract(POOL_CAM_ARB_USDC, ALGEBRA_ABI, provider);
      const blockNum = await provider.getBlockNumber();
      const t0       = await pool.token0({ blockTag: blockNum });
      const gs       = await pool.globalState({ blockTag: blockNum });
      const liq      = await pool.liquidity({ blockTag: blockNum });
      return { gs, liq, t0, blockNum };
    },
    { timeoutMs: 6000, hedge: true }
  );
  const { gs, liq, t0, blockNum } = res.result;
  const sqrtP96     = gs[0];
  const camFeeRaw   = Number(gs[2]);
  const feeFrac     = camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : FEE_CAMELOT_V3;

  // ARB=0x912... < USDC=0xaf88... by address → token0=ARB, token1=USDC
  const token0IsArb = t0.toLowerCase() === ARB_TOKEN.toLowerCase();
  const rawPrice    = sqrtPriceToRaw(sqrtP96) * Math.pow(10, 18 - 6); // adjust 18-dec/6-dec
  const price       = token0IsArb ? rawPrice : 1 / rawPrice;
  const depthUsd    = activeTickDepthUsd(liq, sqrtP96, 18, 6, !token0IsArb);

  return {
    ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
    pair: LOG_PAIR, type: 'direct', protocol: 'camelot_v3',
    pool: POOL_CAM_ARB_USDC,
    price: +price.toFixed(8), depthUsd: +depthUsd.toFixed(2),
    feePct: +(feeFrac * 100).toFixed(4),
    token0IsArb, block: blockNum, status: 'success',
  };
}

// Leg 2: UniV3 ARB/WETH — ARB price in WETH
async function readUniArbWeth(rpc) {
  const res = await rpc.callDetailed(
    'syn.uni.arb_weth',
    async (provider) => {
      const pool = new ethers.Contract(POOL_UNI_ARB_WETH, UNIV3_ABI, provider);
      const blockNum = await provider.getBlockNumber();
      const t0       = await pool.token0({ blockTag: blockNum });
      const s0       = await pool.slot0({ blockTag: blockNum });
      const liq      = await pool.liquidity({ blockTag: blockNum });
      return { s0, liq, t0, blockNum };
    },
    { timeoutMs: 6000, hedge: true }
  );
  const { s0, liq, t0, blockNum } = res.result;
  const sqrtP96     = s0[0];

  // ARB=0x912... < WETH=0x82af... by address → token0=ARB, token1=WETH
  const token0IsArb = t0.toLowerCase() === ARB_TOKEN.toLowerCase();
  // Both 18-dec, no decimal adjustment
  const rawPrice    = sqrtPriceToRaw(sqrtP96);
  // wethPerArb: how many WETH you get per 1 ARB (WETH per ARB, not ARB per WETH)
  const wethPerArb  = token0IsArb ? rawPrice : 1 / rawPrice;
  // Depth in WETH terms, converted to USD by caller using wethPriceUsdc
  const depthWeth   = (Number(liq) * (Number(sqrtP96) / Number(2n ** 96n))) / 1e18;

  return {
    sqrtP96, liq, token0IsArb,
    wethPerArb:  +wethPerArb.toFixed(10),  // WETH per ARB (e.g. 0.00005 WETH/ARB)
    depthWeth:   +depthWeth.toFixed(4),
    block:       blockNum,
    feePct:      +(FEE_UNI_ARB_WETH * 100).toFixed(4),
    status:      'success',
  };
}

// Leg 3: UniV3 WETH/USDC — WETH price in USDC
async function readUniWethUsdc(rpc) {
  const res = await rpc.callDetailed(
    'syn.uni.weth_usdc',
    async (provider) => {
      const pool = new ethers.Contract(POOL_UNI_WETH_USDC, UNIV3_ABI, provider);
      const blockNum = await provider.getBlockNumber();
      const t0       = await pool.token0({ blockTag: blockNum });
      const s0       = await pool.slot0({ blockTag: blockNum });
      const liq      = await pool.liquidity({ blockTag: blockNum });
      return { s0, liq, t0, blockNum };
    },
    { timeoutMs: 6000, hedge: true }
  );
  const { s0, liq, t0, blockNum } = res.result;
  const sqrtP96 = s0[0];

  // USDC=0xaf88... < WETH=0x82af... by address? Let's check dynamically
  // USDC (0xaf88...) vs WETH (0x82af...) — 0x82 < 0xaf → token0=WETH, token1=USDC
  const token0IsWeth = t0.toLowerCase() === WETH_TOKEN.toLowerCase();
  const rawPrice     = sqrtPriceToRaw(sqrtP96) * Math.pow(10, 18 - 6); // 18-dec/6-dec
  // price = USDC per WETH (if token0=WETH) or inverse
  const wethPriceUsdc = token0IsWeth ? rawPrice : 1 / rawPrice;
  // Depth in USDC terms
  const depthUsd = activeTickDepthUsd(liq, sqrtP96, 18, 6, !token0IsWeth);

  return {
    sqrtP96, liq, token0IsWeth,
    wethPriceUsdc: +wethPriceUsdc.toFixed(4),  // USDC per WETH
    depthUsd:      +depthUsd.toFixed(2),
    block:         blockNum,
    feePct:        +(FEE_UNI_WETH_USDC * 100).toFixed(4),
    status:        'success',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE READ WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
async function safeRead(fn, label) {
  try   { return await fn(); }
  catch (e) { return { status: 'failed', label, failures: [e.message] }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH ALL THREE (strictly serial, anti-stampede)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAll(rpc) {
  const camResult  = await safeRead(() => readCamArbUsdc(rpc), 'camelot_v3_arb_usdc');
  await sleep(300);
  const arbWeth    = await safeRead(() => readUniArbWeth(rpc), 'uni_arb_weth');
  await sleep(300);
  const wethUsdc   = await safeRead(() => readUniWethUsdc(rpc), 'uni_weth_usdc');

  // Only compute synthetic if both legs succeeded
  let synthResult  = null;
  let spreadRecord = null;

  if (arbWeth.status === 'success' && wethUsdc.status === 'success') {
    // synthetic ARB/USDC = (WETH per ARB) × (USDC per WETH)
    const synthPrice  = arbWeth.wethPerArb * wethUsdc.wethPriceUsdc;
    // Depth is governed by the weakest leg converted to USD
    const arbWethDepthUsd = arbWeth.depthWeth * wethUsdc.wethPriceUsdc;
    const depthUsd    = Math.min(arbWethDepthUsd, wethUsdc.depthUsd);

    synthResult = {
      ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
      pair: LOG_PAIR, type: 'synthetic', protocol: 'uniswap_v3_route',
      route: 'ARB→WETH→USDC',
      pools: [POOL_UNI_ARB_WETH, POOL_UNI_WETH_USDC],
      price:          +synthPrice.toFixed(8),
      depthUsd:       +depthUsd.toFixed(2),
      arbWethDepthUsd: +arbWethDepthUsd.toFixed(2),
      wethUsdcDepthUsd: +wethUsdc.depthUsd.toFixed(2),
      wethPerArb:     arbWeth.wethPerArb,   // WETH per ARB (e.g. 0.00005)
      priceWethUsdc:  wethUsdc.wethPriceUsdc,
      feePct:         +(FEE_SYNTHETIC_TOTAL * 100).toFixed(4),
      arbWethBlock:   arbWeth.block,
      wethUsdcBlock:  wethUsdc.block,
      status:         'success',
    };

    // Spread record when we also have the direct leg
    if (camResult.status === 'success') {
      const spread     = spreadPct(camResult.price, synthPrice);
      const direction  = camResult.price > synthPrice
        ? 'sell_direct_buy_synthetic' : 'buy_direct_sell_synthetic';
      // Net edge after fees: spread minus total friction of the arb round-trip
      // Round-trip: sell on direct leg (Cam fee) + sell on synth legs (2×UniV3 fee)
      const totalFeeBurden = (FEE_CAMELOT_V3 + FEE_SYNTHETIC_TOTAL) * 100;
      const netEdge    = spread - totalFeeBurden;

      spreadRecord = {
        ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
        pair: LOG_PAIR, type: 'spread',
        directPrice:   camResult.price,
        synthPrice:    +synthPrice.toFixed(8),
        spread:        +spread.toFixed(5),
        direction,
        // NOTE: netEdge reflects swap fees only — pre-slippage, pre-gas.
        // Do not treat as final executable edge without friction simulation.
        netEdgeAfterSwapFees: +netEdge.toFixed(5),
        netEdge:       +netEdge.toFixed(5),  // alias kept for analyzer compatibility
        feeBurdenPct:  +totalFeeBurden.toFixed(4),
        depthUsd:      +Math.min(camResult.depthUsd, depthUsd).toFixed(2),
        camBlock:      camResult.block,
        arbWethBlock:  arbWeth.block,
        wethUsdcBlock: wethUsdc.block,
        sameBlock:     (camResult.block === arbWeth.block && arbWeth.block === wethUsdc.block),
        status:        'success',
      };
    }
  }

  return { camResult, arbWeth, wethUsdc, synthResult, spreadRecord };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────────────────────────────────────
function appendLog(logPath, record) {
  if (!logPath) return;
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (e) {
    process.stderr.write(`  [log] ${e.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY
// ─────────────────────────────────────────────────────────────────────────────
function printResults({ camResult, synthResult, spreadRecord }) {
  const LINE = '═'.repeat(86);
  const DIV  = '─'.repeat(86);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — Direct (Camelot V3) vs Synthetic (ARB→WETH→USDC)');
  console.log(LINE);

  if (camResult.status === 'success') {
    console.log(`  Direct      Camelot V3  price=$${camResult.price.toFixed(8)}  depthUsd=$${camResult.depthUsd.toLocaleString()}  fee=${camResult.feePct}%`);
  } else {
    console.log(`  Direct      FAILED: ${camResult.failures?.[0]}`);
  }

  if (synthResult?.status === 'success') {
    console.log(`  Synthetic   ARB→WETH→USDC  price=$${synthResult.price.toFixed(8)}  depthUsd=$${synthResult.depthUsd.toLocaleString()}  fee=${synthResult.feePct}%`);
    console.log(`              wethPerArb=$${synthResult.wethPerArb.toFixed(8)} WETH  ×  WETH/USDC=$${synthResult.priceWethUsdc.toFixed(2)}`);
    console.log(`              arbWeth depth=$${synthResult.arbWethDepthUsd.toLocaleString()}  wethUsdc depth=$${synthResult.wethUsdcDepthUsd.toLocaleString()}`);
  } else {
    console.log(`  Synthetic   FAILED`);
  }

  if (spreadRecord) {
    console.log('  ' + DIV);
    const edgeColor = spreadRecord.netEdge > 0 ? '← positive (swap fees only — pre-slippage/gas)' : '← fee blocked';
    console.log(`  Spread:    ${spreadRecord.spread.toFixed(5)}%   direction=${spreadRecord.direction}`);
    console.log(`  Net edge:  ${spreadRecord.netEdge >= 0 ? '+' : ''}${spreadRecord.netEdge.toFixed(5)}%  (swap fee burden ${spreadRecord.feeBurdenPct}%)  ${edgeColor}`);
    console.log(`  Blocks:    cam=${spreadRecord.camBlock}  arbWeth=${spreadRecord.arbWethBlock}  wethUsdc=${spreadRecord.wethUsdcBlock}  sameBlock=${spreadRecord.sameBlock}`);
  }
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
arbSyntheticFetcher.js — ARB/USDC direct vs ARB→WETH→USDC synthetic route

PURPOSE:
  Compare direct Camelot V3 ARB/USDC price against synthetic price computed
  from ARB/WETH × WETH/USDC UniV3 pools. Detects route-arb opportunities.
  Surface #2 in multi-surface expansion (replaces ARB/USDT — no Camelot pool exists).

ROUTE:
  Direct:    ARB/USDC via Camelot V3         fee=~0.025%
  Synthetic: ARB→WETH (UniV3) + WETH→USDC   fee=0.10% total (2×0.05%)

POOLS (confirmed):
  Camelot V3 ARB/USDC:  0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1
  UniV3 ARB/WETH 0.05%: 0xc6f780497a95e246eb9449f5e4770916dcd6396a  ($1.3M depth)
  UniV3 WETH/USDC 0.05%: 0xC6962004f452bE9203591991D15f6b388e09E8D0

FLAGS:
  --json           Emit clean JSON only
  --watch          Continuous mode
  --interval=N     Poll interval ms  (default: 5000)
  --duration=N     Max run time seconds  (default: 3600)
  --log=PATH       Append JSONL records to file
  --help           Show this message

EXAMPLES:
  node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js
  node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js --watch --log=./logs/arb_synthetic.jsonl
  node -r dotenv/config scripts/data_collection/surfaces/arbSyntheticFetcher.js --json
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { printHelp(); process.exit(0); }
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=').slice(1).join('=') : d; };
  return {
    json:     args.includes('--json'),
    watch:    args.includes('--watch'),
    interval: getN('--interval', 5_000),
    duration: getN('--duration', 3_600),
    logPath:  getS('--log', null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { json, watch, interval, duration, logPath } = parseArgs();
  const rpc = createProvider('arbitrum');

  if (!json) {
    console.log('\n[arbSyntheticFetcher]', new Date().toISOString());
    console.log('  Direct:    Camelot V3 ARB/USDC');
    console.log('  Synthetic: UniV3 ARB/WETH × UniV3 WETH/USDC\n');
  }

  const runFetch = async () => {
    const results = await fetchAll(rpc);
    const { camResult, synthResult, spreadRecord } = results;

    if (json) {
      if (camResult.status === 'success')   console.log(JSON.stringify(camResult));
      if (synthResult?.status === 'success') console.log(JSON.stringify(synthResult));
      if (spreadRecord)                      console.log(JSON.stringify(spreadRecord));
    } else {
      printResults(results);
    }

    // Log all three records
    if (camResult.status   === 'success')   appendLog(logPath, camResult);
    if (synthResult?.status === 'success')  appendLog(logPath, synthResult);
    if (spreadRecord)                       appendLog(logPath, spreadRecord);

    return results;
  };

  if (!watch) {
    const { camResult, synthResult } = await runFetch();
    const bothOk = camResult.status === 'success' && synthResult?.status === 'success';
    process.exit(bothOk ? 0 : 1);
  }

  const endMs = Date.now() + duration * 1000;
  let count   = 0;
  while (Date.now() < endMs) {
    const t0 = Date.now();
    await runFetch();
    count++;
    await sleep(Math.max(0, interval - (Date.now() - t0)));
  }
  if (!json) console.log(`\n  Done. ${count} fetch cycles.\n`);
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
