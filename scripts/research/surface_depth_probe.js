#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Depth Probe (generalized, constitutional)
//  PLACEMENT: scripts/research/surface_depth_probe.js
//  REPLACES:  scripts/research/wave2_pool_probe.js (one-shot predecessor)
//  STATUS:    Boss Wave 2 ruling (2026-05-30) — first-class gate in the
//             constitutional research pipeline:
//
//      Discovery → DEPTH PROBE → Classification → Scoring → Behavioral → Archive
//                  ↑
//             required before any fetcher integration or registry change
//
//  READ-ONLY direct-RPC same-block probe. Validates active-tick depth
//  (L×sqrtP-derived USD) and price tracking for ANY pair of pools BEFORE
//  fetcher integration. Bounded duration, parameterized via CLI.
//
//  PRECEDENT: TVL has misled three times (ARB/USDC, WBTC/USDC, ETH/USDT-
//             camelot). Active-tick depth is the only valid liquidity metric.
//
//  USAGE
//    node -r dotenv/config scripts/research/surface_depth_probe.js \
//      --label eth_usdt_uni_sushi \
//      --pool-a 0x641C00A822e8b671738d32a431a4Fb6074E5c79d --venue-a uniswap_v3 --type-a univ3 --fee-a 5 \
//      --pool-b 0x96aDA81328abCe21939A51D971A63077e16db26E --venue-b sushiswap_v3 --type-b univ3 --fee-b 5 \
//      --decimals0 18 --decimals1 6 \
//      --interval 30 --duration-min 30
//
//    node -r dotenv/config scripts/research/surface_depth_probe.js --max-samples 1   (smoke)
//    node scripts/research/surface_depth_probe.js --self-test                         (math only, no RPC)
//
//  OUTPUT
//    logs/research/wave2/<label>_pool_probe.jsonl          (raw per-tick observations)
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
// NOTE: ethers + dotenv are deferred to main() so --self-test runs deps-free.

const REPO    = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(REPO, 'logs', 'research', 'wave2');

// ─── PURE MATH (testable, no RPC) ───────────────────────────────────────────

const Q96_NUM = Math.pow(2, 96);

// human price = (sqrtPriceX96 / 2^96)^2 × 10^(dec0 - dec1)
function priceFromSqrtX96(sqrtPriceX96, dec0, dec1) {
  const sx = Number(sqrtPriceX96.toString());
  const sqrtP = sx / Q96_NUM;
  return (sqrtP * sqrtP) * Math.pow(10, dec0 - dec1);
}

// sqrtPriceX96 at tick = 1.0001^(tick/2) × 2^96 (continuous approximation)
function sqrtPriceAtTick(tick) {
  return Math.pow(1.0001, Number(tick) / 2) * Q96_NUM;
}

// Active-tick depth (Uniswap V3 §6.2.2 in Q96 form)
function activeTickDepth({ sqrtPriceX96, tick, tickSpacing, liquidity, decimals0, decimals1 }) {
  const ts = Math.max(1, tickSpacing);
  const tickLower = Math.floor(Number(tick) / ts) * ts;
  const tickUpper = tickLower + ts;
  const sxF = Number(sqrtPriceX96.toString());
  const sxLower = sqrtPriceAtTick(tickLower);
  const sxUpper = sqrtPriceAtTick(tickUpper);
  const L = Number(liquidity.toString());
  const amount0Raw = L * (sxUpper - sxF) / (sxF * sxUpper) * Q96_NUM;
  const amount1Raw = L * (sxF - sxLower) / Q96_NUM;
  const amount0Token = amount0Raw / Math.pow(10, decimals0);
  const amount1Token = amount1Raw / Math.pow(10, decimals1);
  const tokenPriceUsd = priceFromSqrtX96(sqrtPriceX96, decimals0, decimals1);
  // Assumes token1 ≈ USD (USDC/USDT/DAI). Token0 valued at current price.
  const usd0 = amount0Token * tokenPriceUsd;
  const usd1 = amount1Token;
  return { tickLower, tickUpper, amount0Token, amount1Token, usd0, usd1, totalUsd: usd0 + usd1 };
}

function spreadBps(priceA, priceB) {
  if (!isFinite(priceA) || !isFinite(priceB) || priceA <= 0 || priceB <= 0) return null;
  const mid = (priceA + priceB) / 2;
  return mid <= 0 ? null : +(Math.abs(priceA - priceB) / mid * 10000).toFixed(6);
}

// ─── tickSpacing inference (UniV3 standard fee tiers + Algebra) ─────────────

function inferTickSpacing(type, feeBps) {
  if (type === 'algebra') return 1;        // Camelot Algebra: tick spacing 1 (dynamic fee)
  // UniV3 / SushiV3 standard fee tiers
  if (feeBps === 1)   return 1;            // 0.01%
  if (feeBps === 5)   return 10;           // 0.05%
  if (feeBps === 30)  return 60;           // 0.30%
  if (feeBps === 100) return 200;          // 1.0%
  if (feeBps === 25)  return 5;            // 0.025% (rare; Algebra-style 25bp pools)
  return null;
}

// ─── ABIs by pool type ───────────────────────────────────────────────────────

const POOL_ABI = {
  univ3: [
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
    'function liquidity() view returns (uint128)',
  ],
  algebra: [
    'function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16, uint8, uint8, bool)',
    'function liquidity() view returns (uint128)',
  ],
};

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {
    label: null,
    poolA: null, venueA: null, typeA: 'univ3', feeA: null, tsA: null,
    poolB: null, venueB: null, typeB: 'univ3', feeB: null, tsB: null,
    decimals0: 18, decimals1: 6,
    intervalSec: 30, durationMin: 30, maxSamples: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--label':         a.label = v; i++; break;
      case '--pool-a':        a.poolA = v; i++; break;
      case '--venue-a':       a.venueA = v; i++; break;
      case '--type-a':        a.typeA = v; i++; break;
      case '--fee-a':         a.feeA = parseFloat(v); i++; break;
      case '--ts-a':          a.tsA = parseInt(v, 10); i++; break;
      case '--pool-b':        a.poolB = v; i++; break;
      case '--venue-b':       a.venueB = v; i++; break;
      case '--type-b':        a.typeB = v; i++; break;
      case '--fee-b':         a.feeB = parseFloat(v); i++; break;
      case '--ts-b':          a.tsB = parseInt(v, 10); i++; break;
      case '--decimals0':     a.decimals0 = parseInt(v, 10); i++; break;
      case '--decimals1':     a.decimals1 = parseInt(v, 10); i++; break;
      case '--interval':      a.intervalSec = parseInt(v, 10) || 30; i++; break;
      case '--duration-min':  a.durationMin = parseFloat(v) || null; i++; break;
      case '--max-samples':   a.maxSamples  = parseInt(v, 10) || null; i++; break;
    }
  }
  return a;
}

function buildPools(args) {
  if (!args.label)  throw new Error('--label is required (used for output filename prefix)');
  if (!args.poolA || !args.poolB) throw new Error('--pool-a and --pool-b are required');
  if (!args.venueA || !args.venueB) throw new Error('--venue-a and --venue-b are required');
  if (args.feeA == null || args.feeB == null) throw new Error('--fee-a and --fee-b are required (in bps)');
  if (!POOL_ABI[args.typeA] || !POOL_ABI[args.typeB])
    throw new Error(`pool type must be one of: ${Object.keys(POOL_ABI).join(', ')}`);
  const tsA = args.tsA != null ? args.tsA : inferTickSpacing(args.typeA, args.feeA);
  const tsB = args.tsB != null ? args.tsB : inferTickSpacing(args.typeB, args.feeB);
  if (tsA == null) throw new Error(`tickSpacing could not be inferred for type=${args.typeA} fee=${args.feeA}; pass --ts-a explicitly`);
  if (tsB == null) throw new Error(`tickSpacing could not be inferred for type=${args.typeB} fee=${args.feeB}; pass --ts-b explicitly`);
  return [
    { label: 'a', name: args.venueA, address: args.poolA, type: args.typeA, feeBps: args.feeA, tickSpacing: tsA,
      decimals0: args.decimals0, decimals1: args.decimals1, abi: POOL_ABI[args.typeA] },
    { label: 'b', name: args.venueB, address: args.poolB, type: args.typeB, feeBps: args.feeB, tickSpacing: tsB,
      decimals0: args.decimals0, decimals1: args.decimals1, abi: POOL_ABI[args.typeB] },
  ];
}

// ─── RPC reads (lazy ethers import) ──────────────────────────────────────────

async function readPool(ethers, provider, pool, blockNumber) {
  const c = new ethers.Contract(pool.address, pool.abi, provider);
  let sqrtPriceX96, tick;
  if (pool.type === 'univ3') {
    const r = await c.slot0({ blockTag: blockNumber });
    sqrtPriceX96 = r[0]; tick = r[1];
  } else if (pool.type === 'algebra') {
    const r = await c.globalState({ blockTag: blockNumber });
    sqrtPriceX96 = r[0]; tick = r[1];
  } else throw new Error(`unknown pool type ${pool.type}`);
  const liquidity = await c.liquidity({ blockTag: blockNumber });
  return { sqrtPriceX96, tick, liquidity, blockNumber };
}

async function probeTick(ethers, provider, POOLS, sink, stats) {
  try {
    const blockNumber = await provider.getBlockNumber();
    const reads = await Promise.all(POOLS.map(p => readPool(ethers, provider, p, blockNumber)));
    const obs = { ts: new Date().toISOString(), blockNumber, sameBlock: true };
    const prices = [];
    POOLS.forEach((p, i) => {
      const r = reads[i];
      const price = priceFromSqrtX96(r.sqrtPriceX96, p.decimals0, p.decimals1);
      const depth = activeTickDepth({
        sqrtPriceX96: r.sqrtPriceX96, tick: r.tick, tickSpacing: p.tickSpacing,
        liquidity: r.liquidity, decimals0: p.decimals0, decimals1: p.decimals1,
      });
      obs[p.label] = {
        venue: p.name, pool: p.address, type: p.type, feeBps: p.feeBps,
        sqrtPriceX96: r.sqrtPriceX96.toString(),
        tick: Number(r.tick),
        liquidity: r.liquidity.toString(),
        price: +price.toFixed(8),
        activeTickDepthUsd: +depth.totalUsd.toFixed(2),
        depthUsdToken0Side: +depth.usd0.toFixed(2),
        depthUsdToken1Side: +depth.usd1.toFixed(2),
        amount0Token: +depth.amount0Token.toFixed(6),
        amount1Token: +depth.amount1Token.toFixed(2),
        tickLower: depth.tickLower, tickUpper: depth.tickUpper,
      };
      prices.push(price);
    });
    obs.spreadBps = spreadBps(prices[0], prices[1]);
    sink.write(JSON.stringify(obs) + '\n');
    stats.recorded++;
    const pa = obs.a, pb = obs.b;
    console.error(`[probe] #${stats.recorded} block=${blockNumber} ${pa.venue}=$${pa.price.toFixed(2)} ${pb.venue}=$${pb.price.toFixed(2)} spread=${obs.spreadBps}bp | depthA=$${(pa.activeTickDepthUsd/1000).toFixed(1)}k depthB=$${(pb.activeTickDepthUsd/1000).toFixed(1)}k`);
  } catch (e) {
    stats.errors++;
    console.error(`[probe] tick error: ${e.message}`);
  }
}

async function main() {
  require('dotenv').config();
  const { ethers } = require('ethers');
  const args = parseArgs(process.argv.slice(2));
  let POOLS;
  try { POOLS = buildPools(args); }
  catch (e) { console.error(`[probe] ${e.message}`); process.exit(1); }

  const RPC_URL = process.env.ARBITRUM_RPC_URL || process.env.RPC_URL_ARBITRUM ||
                  process.env.ALCHEMY_ARBITRUM_URL || 'https://arb1.arbitrum.io/rpc';
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outJsonl = path.join(OUT_DIR, `${args.label}_pool_probe.jsonl`);
  const sink = fs.createWriteStream(outJsonl, { flags: 'a' });
  const stats = { recorded: 0, errors: 0 };
  const startedAt = Date.now();
  const deadline = args.durationMin ? startedAt + args.durationMin * 60000 : null;

  console.error(`[probe] Surface Depth Probe (generalized, constitutional) — READ-ONLY`);
  console.error(`[probe] label: ${args.label}`);
  console.error(`[probe] RPC: ${RPC_URL.split('?')[0]}`);
  console.error(`[probe] A: ${POOLS[0].name} ${POOLS[0].address.slice(0,12)}… (${POOLS[0].type}, ${POOLS[0].feeBps}bp, ts=${POOLS[0].tickSpacing})`);
  console.error(`[probe] B: ${POOLS[1].name} ${POOLS[1].address.slice(0,12)}… (${POOLS[1].type}, ${POOLS[1].feeBps}bp, ts=${POOLS[1].tickSpacing})`);
  console.error(`[probe] interval=${args.intervalSec}s duration=${args.durationMin || '∞'}min → ${path.relative(REPO, outJsonl)}`);

  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true;
    console.error(`\n[probe] ${sig} — recorded=${stats.recorded} errors=${stats.errors}`);
    sink.end(() => process.exit(0));
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  await probeTick(ethers, provider, POOLS, sink, stats);
  if (args.maxSamples && stats.recorded >= args.maxSamples) return stop('max-samples');

  const timer = setInterval(async () => {
    if (deadline && Date.now() >= deadline) { clearInterval(timer); return stop('duration-reached'); }
    await probeTick(ethers, provider, POOLS, sink, stats);
    if (args.maxSamples && stats.recorded >= args.maxSamples) { clearInterval(timer); return stop('max-samples'); }
  }, args.intervalSec * 1000);
}

// ─── SELF-TEST (pure math + arg parsing; no RPC) ─────────────────────────────
function approx(a, b, rel = 1e-3) { return Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1); }

function selfTest() {
  const cases = [];

  // math preserved from predecessor (wave2_pool_probe.js)
  const p1 = priceFromSqrtX96('3555783136642337927135548', 18, 6);
  cases.push([`price: uni-1bp snapshot ≈ 2014.24 (got ${p1.toFixed(2)})`, approx(p1, 2014.24, 1e-3)]);
  cases.push(['sqrtPriceAtTick(0) ≈ Q96', approx(sqrtPriceAtTick(0), Q96_NUM, 1e-9)]);
  cases.push(['sqrtPriceAtTick monotonic +', sqrtPriceAtTick(100) > sqrtPriceAtTick(0)]);

  const d = activeTickDepth({
    sqrtPriceX96: BigInt(Math.floor(sqrtPriceAtTick(5))),
    tick: 5, tickSpacing: 10, liquidity: BigInt('1000000000000000'),
    decimals0: 18, decimals1: 6,
  });
  cases.push(['depth: totalUsd = usd0 + usd1', approx(d.totalUsd, d.usd0 + d.usd1, 1e-9)]);
  cases.push(['depth: both sides > 0 mid-range', d.usd0 > 0 && d.usd1 > 0]);
  cases.push(['spread(2014, 2015) ≈ 4.96bp', approx(spreadBps(2014, 2015), 4.962, 1e-2)]);
  cases.push(['spread(0, 1) → null', spreadBps(0, 1) === null]);

  // NEW: tickSpacing inference
  cases.push(['inferTickSpacing(univ3, 5) = 10',  inferTickSpacing('univ3', 5) === 10]);
  cases.push(['inferTickSpacing(univ3, 1) = 1',   inferTickSpacing('univ3', 1) === 1]);
  cases.push(['inferTickSpacing(univ3, 30) = 60', inferTickSpacing('univ3', 30) === 60]);
  cases.push(['inferTickSpacing(univ3, 100) = 200', inferTickSpacing('univ3', 100) === 200]);
  cases.push(['inferTickSpacing(algebra, *) = 1', inferTickSpacing('algebra', 1) === 1 && inferTickSpacing('algebra', 5) === 1]);
  cases.push(['inferTickSpacing(univ3, 7) → null (non-standard)', inferTickSpacing('univ3', 7) === null]);

  // NEW: CLI parsing
  const a = parseArgs(['--label', 'test', '--pool-a', '0xAAA', '--venue-a', 'uniswap_v3', '--type-a', 'univ3', '--fee-a', '5',
                       '--pool-b', '0xBBB', '--venue-b', 'camelot_v3', '--type-b', 'algebra', '--fee-b', '1']);
  cases.push(['parseArgs: label captured',     a.label === 'test']);
  cases.push(['parseArgs: pool-a captured',    a.poolA === '0xAAA']);
  cases.push(['parseArgs: type defaults present',  a.typeA === 'univ3' && a.typeB === 'algebra']);
  cases.push(['parseArgs: decimals default 18/6',  a.decimals0 === 18 && a.decimals1 === 6]);

  // NEW: buildPools validation
  cases.push(['buildPools rejects no label', (() => { try { buildPools(parseArgs(['--pool-a','0xA','--pool-b','0xB','--venue-a','x','--venue-b','y','--fee-a','5','--fee-b','5'])); return false; } catch (e) { return /label/.test(e.message); } })()]);
  cases.push(['buildPools rejects bad type', (() => { try { buildPools(parseArgs(['--label','t','--pool-a','0xA','--pool-b','0xB','--venue-a','x','--venue-b','y','--type-a','zzz','--fee-a','5','--fee-b','5'])); return false; } catch (e) { return /type must be/.test(e.message); } })()]);

  // NEW: buildPools full success path
  const built = buildPools(parseArgs(['--label','etu','--pool-a','0xAAA','--pool-b','0xBBB',
                                     '--venue-a','uniswap_v3','--venue-b','sushiswap_v3',
                                     '--type-a','univ3','--type-b','univ3',
                                     '--fee-a','5','--fee-b','5']));
  cases.push(['buildPools: 2 entries',         built.length === 2]);
  cases.push(['buildPools: tickSpacing inferred 10', built[0].tickSpacing === 10 && built[1].tickSpacing === 10]);
  cases.push(['buildPools: ABI assigned',      built[0].abi.length === 2]);

  let pass = 0;
  console.log('── surface_depth_probe.js SELF-TEST (generalized, constitutional gate) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
