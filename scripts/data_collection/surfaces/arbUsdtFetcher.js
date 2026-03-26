'use strict';
/**
 * scripts/data_collection/surfaces/arbUsdtFetcher.js
 *
 * PURPOSE:
 *   Fetch ARB/USDT price + liquidity from both Camelot V3 (Algebra) and
 *   UniV3 on Arbitrum. Surface #2 in multi-surface expansion.
 *   Plugs directly into existing tick map / activator / simulator / analyzer.
 *
 * INPUTS:
 *   - Arbitrum mainnet via createProvider('arbitrum')
 *   - Camelot V3 (Algebra) factory: 0xBefC4b405041c5833f53412fF997ed2f697a2f37
 *   - UniV3 factory:                0x1F98431c8aD98523631AE4a59f267346ea31F984
 *   - ARB  (0x912CE59144191C1204E64559FE8253a0e49E6548, 18 dec)
 *   - USDT (0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9,  6 dec)
 *
 * OUTPUTS:
 *   Dual structured JSON per run — one record per venue:
 *   {
 *     ts, source, chain, pair, protocol, pool, price, depth,
 *     spread (when both venues live), block, status
 *   }
 *   Also emits a combined spread record when both venues respond.
 *
 * IN SCOPE:
 *   - Pool discovery via factory calls (no hardcoded pool addresses)
 *   - sqrtPriceX96 → price conversion (Algebra + UniV3 use same math)
 *   - Active-tick depth calculation
 *   - Spread between the two venues
 *
 * OUT OF SCOPE:
 *   - No execution logic
 *   - No modification of existing fetchers
 *   - No Redis
 *   - No other chains
 *   - No Promise.all across different contracts
 *
 * USAGE:
 *   node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js
 *   node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js --watch
 *   node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js --json
 *   node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js --log=./logs/arb_usdt.jsonl
 *   node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js --help
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN ADDRESSES — Arbitrum mainnet
// ─────────────────────────────────────────────────────────────────────────────
const ARB_TOKEN  = '0x912CE59144191C1204E64559FE8253a0e49E6548';  // confirmed_default
const USDT_TOKEN = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9';  // confirmed_default: USDT on Arbitrum
const ARB_DEC    = 18;   // confirmed_default
const USDT_DEC   = 6;    // confirmed_default

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY ADDRESSES
// ─────────────────────────────────────────────────────────────────────────────
const CAMELOT_V3_ALGEBRA_FACTORY = '0xBefC4b405041c5833f53412fF997ed2f697a2f37';  // confirmed_default
const UNIV3_FACTORY              = '0x1F98431c8aD98523631AE4a59f267346ea31F984';  // confirmed_default

// UniV3 fee tiers to try in order (most likely first for ARB pairs)
const UNIV3_FEE_TIERS = [500, 3000, 10000];  // 0.05%, 0.30%, 1.00%

// ─────────────────────────────────────────────────────────────────────────────
// FEES
// ─────────────────────────────────────────────────────────────────────────────
const CAMELOT_V3_FEE_DEFAULT = 0.000249;  // confirmed_default: dynamic, measured on ARB/USDC
const UNIV3_FEE_DEFAULT      = 0.0005;    // confirmed_default: 0.05% tier (most common for ARB)

// ─────────────────────────────────────────────────────────────────────────────
// LOG ENVELOPE
// ─────────────────────────────────────────────────────────────────────────────
const LOG_SOURCE = 'arb_usdt_fetcher';
const LOG_CHAIN  = 'arbitrum';
const LOG_PAIR   = 'ARB/USDT';

// ─────────────────────────────────────────────────────────────────────────────
// ABIs — minimal read-only
// ─────────────────────────────────────────────────────────────────────────────
const ALGEBRA_FACTORY_ABI = [
  'function poolByPair(address tokenA, address tokenB) external view returns (address pool)',
];
const UNIV3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];
const ALGEBRA_POOL_ABI = [
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];
const UNIV3_POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH — identical to existing pipeline (ARB=token0 orientation by address sort)
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToQuote(sqrtPriceX96, token0IsArb) {
  // sqrtPriceX96 = sqrt(token1/token0) * 2^96
  // price in token1 per token0 = (sqrtPriceX96 / 2^96)^2 * 10^(dec0-dec1)
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  const rawPrice = sqrtP * sqrtP * Math.pow(10, ARB_DEC - USDT_DEC);
  // rawPrice = USDT per ARB if token0=ARB, else ARB per USDT
  return token0IsArb ? rawPrice : 1 / rawPrice;
}

function activeTickDepthUsd(liquidityRaw, sqrtPriceX96, token0IsArb) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  // depth in USDT terms: L * sqrtP / 10^USDT_DEC  (when token1=USDT)
  if (token0IsArb) {
    return (Number(liquidityRaw) * sqrtP) / Math.pow(10, USDT_DEC);
  } else {
    // token0=USDT, token1=ARB — depth in USDT: L / sqrtP / 10^USDT_DEC
    return sqrtP > 0 ? (Number(liquidityRaw) / sqrtP) / Math.pow(10, USDT_DEC) : 0;
  }
}

function spreadPct(priceA, priceB) {
  return Math.abs(priceA - priceB) / Math.min(priceA, priceB) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL DISCOVERY
// ─────────────────────────────────────────────────────────────────────────────
async function discoverCamelotV3Pool(rpc) {
  const res = await rpc.callDetailed(
    'usdt.cam.discover',
    async (provider) => {
      const factory = new ethers.Contract(CAMELOT_V3_ALGEBRA_FACTORY, ALGEBRA_FACTORY_ABI, provider);
      return factory.poolByPair(ARB_TOKEN, USDT_TOKEN);
    },
    { timeoutMs: 5000, hedge: true }
  );
  const addr = res.result;
  if (!addr || addr === ethers.ZeroAddress) throw new Error('Camelot V3 ARB/USDT pool not found');
  return addr;
}

async function discoverUniV3Pool(rpc) {
  // Try fee tiers in order, return first live pool
  for (const fee of UNIV3_FEE_TIERS) {
    try {
      const res = await rpc.callDetailed(
        `usdt.uni.discover.${fee}`,
        async (provider) => {
          const factory = new ethers.Contract(UNIV3_FACTORY, UNIV3_FACTORY_ABI, provider);
          return factory.getPool(ARB_TOKEN, USDT_TOKEN, fee);
        },
        { timeoutMs: 5000, hedge: true }
      );
      const addr = res.result;
      if (addr && addr !== ethers.ZeroAddress) return { addr, fee };
    } catch { /* try next tier */ }
    await sleep(200);
  }
  throw new Error('No UniV3 ARB/USDT pool found for any fee tier');
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL READS
// ─────────────────────────────────────────────────────────────────────────────
async function readCamelotV3(poolAddr, rpc) {
  const res = await rpc.callDetailed(
    'usdt.cam.read',
    async (provider) => {
      const pool = new ethers.Contract(poolAddr, ALGEBRA_POOL_ABI, provider);
      // Serial reads — block anchored: get block first, then read state against it
      const blockNum = await provider.getBlockNumber();
      const t0       = await pool.token0({ blockTag: blockNum });
      const gs       = await pool.globalState({ blockTag: blockNum });
      const liq      = await pool.liquidity({ blockTag: blockNum });
      return { gs, liq, t0, blockNum };
    },
    { timeoutMs: 6000, hedge: true }
  );
  const { gs, liq, t0, blockNum } = res.result;
  const sqrtP       = gs[0];
  const camFeeRaw   = Number(gs[2]);
  const token0IsArb = t0.toLowerCase() === ARB_TOKEN.toLowerCase();
  const price       = sqrtPriceToQuote(sqrtP, token0IsArb);
  const depthUsd    = activeTickDepthUsd(liq, sqrtP, token0IsArb);
  const feeFrac     = camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_V3_FEE_DEFAULT;

  return {
    ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
    pair: LOG_PAIR, protocol: 'camelot_v3', pool: poolAddr,
    price: +price.toFixed(8), depthUsd: +depthUsd.toFixed(2),
    feePct: +(feeFrac * 100).toFixed(4),
    token0IsArb, block: blockNum, status: 'success',
  };
}

async function readUniV3(poolAddr, feeTier, rpc) {
  const res = await rpc.callDetailed(
    'usdt.uni.read',
    async (provider) => {
      const pool = new ethers.Contract(poolAddr, UNIV3_POOL_ABI, provider);
      // Serial reads — block anchored
      const blockNum = await provider.getBlockNumber();
      const t0       = await pool.token0({ blockTag: blockNum });
      const s0       = await pool.slot0({ blockTag: blockNum });
      const liq      = await pool.liquidity({ blockTag: blockNum });
      return { s0, liq, t0, blockNum };
    },
    { timeoutMs: 6000, hedge: true }
  );
  const { s0, liq, t0, blockNum } = res.result;
  const sqrtP       = s0[0];
  const token0IsArb = t0.toLowerCase() === ARB_TOKEN.toLowerCase();
  const price       = sqrtPriceToQuote(sqrtP, token0IsArb);
  const depthUsd    = activeTickDepthUsd(liq, sqrtP, token0IsArb);
  const feeFrac     = feeTier / 1_000_000;

  return {
    ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
    pair: LOG_PAIR, protocol: 'uniswap_v3', pool: poolAddr,
    price: +price.toFixed(8), depthUsd: +depthUsd.toFixed(2),
    feePct: +(feeFrac * 100).toFixed(4),
    feeTier, token0IsArb, block: blockNum, status: 'success',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE READ WRAPPERS
// ─────────────────────────────────────────────────────────────────────────────
async function safeRead(fn, protocol, poolAddr) {
  try { return await fn(); }
  catch (e) {
    return {
      ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
      pair: LOG_PAIR, protocol, pool: poolAddr ?? 'unknown',
      status: 'failed', failures: [e.message],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH BOTH (serial — anti-stampede rule)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchBoth(pools, rpc) {
  const camResult = await safeRead(
    () => readCamelotV3(pools.camelot, rpc), 'camelot_v3', pools.camelot
  );
  await sleep(300);
  const uniResult = await safeRead(
    () => readUniV3(pools.uni.addr, pools.uni.fee, rpc), 'uniswap_v3', pools.uni.addr
  );

  // Compute spread if both succeeded
  let spreadRecord = null;
  if (camResult.status === 'success' && uniResult.status === 'success') {
    const spread    = spreadPct(camResult.price, uniResult.price);
    const direction = camResult.price > uniResult.price
      ? 'sell_camelot_buy_uni' : 'buy_camelot_sell_uni';
    spreadRecord = {
      ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN,
      pair: LOG_PAIR, type: 'spread',
      camPrice: camResult.price, uniPrice: uniResult.price,
      spread: +spread.toFixed(5), direction,
      camDepthUsd: camResult.depthUsd, uniDepthUsd: uniResult.depthUsd,
      camFeePct: camResult.feePct, uniFeePct: uniResult.feePct,
      // Block alignment fields (Boss ruling 2026-03-26)
      camBlock: camResult.block, uniBlock: uniResult.block,
      sameBlock: camResult.block === uniResult.block,
      status: 'success',
    };
  }

  return { camResult, uniResult, spreadRecord };
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
function printResults(camResult, uniResult, spreadRecord) {
  const LINE = '═'.repeat(82);
  const DIV  = '─'.repeat(82);
  console.log('\n' + LINE);
  console.log('  ARB/USDT — Camelot V3 vs UniV3');
  console.log(LINE);

  for (const r of [camResult, uniResult]) {
    const label = r.protocol === 'camelot_v3' ? 'Camelot V3' : `UniV3 (${r.feeTier ? r.feeTier/10000 + 'bps' : '?'})`;
    if (r.status === 'success') {
      console.log(`  ${label.padEnd(18)} pool=${r.pool.slice(0,10)}...  price=$${r.price.toFixed(8)}  depthUsd=$${r.depthUsd.toLocaleString()}  fee=${r.feePct}%`);
    } else {
      console.log(`  ${label.padEnd(18)} FAILED: ${r.failures?.[0]}`);
    }
  }

  if (spreadRecord) {
    console.log('  ' + DIV);
    console.log(`  Spread:  ${spreadRecord.spread.toFixed(5)}%  direction=${spreadRecord.direction}`);
    const feeBurden = (camResult.feePct + uniResult.feePct);
    const net = spreadRecord.spread - feeBurden;
    console.log(`  Fee burden: ${feeBurden.toFixed(4)}%  Net: ${net >= 0 ? '+' : ''}${net.toFixed(5)}%  ${net > 0 ? '← potential edge' : '← fee blocked'}`);
  }
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
arbUsdtFetcher.js — ARB/USDT Camelot V3 vs UniV3 price + spread fetcher

PURPOSE:
  Surface #2 in multi-surface expansion. Reads ARB/USDT from both Camelot V3
  and UniV3 to detect spread opportunities between these venues.
  Plugs into existing tick map / activator / simulator / analyzer pipeline.

USAGE:
  node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js [flags]

FLAGS:
  --json           Emit clean JSON only (no console table)
  --watch          Continuous mode
  --interval=N     Poll interval ms in watch mode  (default: 5000)
  --duration=N     Max run time in watch mode (default: 3600)
  --log=PATH       Append JSONL records to file
  --help           Show this message

EXAMPLES:
  node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js
  node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js --watch --log=./logs/arb_usdt.jsonl
  node -r dotenv/config scripts/data_collection/surfaces/arbUsdtFetcher.js --json
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

  // Discover pools once
  if (!json) process.stdout.write('\n[arbUsdtFetcher] Discovering ARB/USDT pools...\n');

  let pools;
  try {
    // Serial discovery — no Promise.all across different factories (anti-stampede rule)
    const camelot = await discoverCamelotV3Pool(rpc);
    await sleep(300);
    const uni     = await discoverUniV3Pool(rpc);
    pools = { camelot, uni };
    if (!json) {
      console.log(`  Camelot V3: ${camelot}`);
      console.log(`  UniV3:      ${uni.addr}  (fee=${uni.fee/10000}bps)\n`);
    }
  } catch (e) {
    console.error(`[FATAL] Pool discovery failed: ${e.message}`);
    process.exit(1);
  }

  const runFetch = async () => {
    const { camResult, uniResult, spreadRecord } = await fetchBoth(pools, rpc);
    if (json) {
      console.log(JSON.stringify(camResult));
      console.log(JSON.stringify(uniResult));
      if (spreadRecord) console.log(JSON.stringify(spreadRecord));
    } else {
      printResults(camResult, uniResult, spreadRecord);
    }
    appendLog(logPath, camResult);
    appendLog(logPath, uniResult);
    if (spreadRecord) appendLog(logPath, spreadRecord);
    return { camResult, uniResult, spreadRecord };
  };

  if (!watch) {
    const { camResult, uniResult } = await runFetch();
    const bothOk = camResult.status === 'success' && uniResult.status === 'success';
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
