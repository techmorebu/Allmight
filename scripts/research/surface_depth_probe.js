#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Depth Probe (chain-aware, constitutional)
//  PLACEMENT: scripts/research/surface_depth_probe.js
//  STATUS:    v3.0 (Wave 4 Commit 3 — Boss directive 2026-05-30)
//
//  v3.0 CHANGES vs v2.0 (b883d61):
//    • Adds --chain CLI flag (default 'arbitrum'; reads config/chains.json
//      for RPC env-var resolution; falls back to public RPC if needed)
//    • Adds aerodrome_v2 pool type (V2 constant-product, getReserves)
//      → POOL_ABI dispatch + v2Reserves/v2Price/v2Depth pure math
//      → CLI: --stable-a / --stable-b for V2 pools that have stable/volatile variants
//    • Adds --out-dir CLI flag (default 'logs/research/wave2/' for backward compat)
//    • Self-test extended with V2 math + CLI parsing assertions
//
//  CONSTITUTIONAL ROLE (unchanged):
//      Discovery → DEPTH PROBE → Classification → Scoring → Behavioral → Archive
//                  ↑
//             required before any fetcher integration or registry change
//
//  READ-ONLY direct-RPC same-block probe. Validates active-tick depth
//  (L×sqrtP-derived USD) for V3 pools and total-reserves-derived USD for
//  V2 pools, alongside price tracking for ANY pair of pools BEFORE fetcher
//  integration. Bounded duration, parameterized via CLI.
//
//  USAGE
//    # V3 vs V3 (existing pattern; backward-compatible)
//    node -r dotenv/config scripts/research/surface_depth_probe.js \
//      --label eth_usdc_ramses_uni \
//      --pool-a 0xPOOLA --venue-a uniswap_v3 --type-a univ3 --fee-a 5 \
//      --pool-b 0xPOOLB --venue-b ramses_v2  --type-b univ3 --fee-b 5 \
//      --decimals0 18 --decimals1 6 \
//      --interval 30 --duration-min 30
//
//    # V3 vs V2 (Wave 4 — Base ETH/USDC: Uni V3 vs Aerodrome V2)
//    node -r dotenv/config scripts/research/surface_depth_probe.js \
//      --chain base \
//      --label base_eth_usdc_uni_aero \
//      --pool-a 0xUNI_V3_POOL  --venue-a uniswap_v3 --type-a univ3        --fee-a 5 \
//      --pool-b 0xAERO_V2_POOL --venue-b aerodrome  --type-b aerodrome_v2 \
//      --decimals0 18 --decimals1 6 \
//      --out-dir logs/research/wave4 \
//      --interval 30 --duration-min 30
//
//    # Smoke / self-test
//    node -r dotenv/config scripts/research/surface_depth_probe.js ... --max-samples 1
//    node scripts/research/surface_depth_probe.js --self-test    (math only, deps-free)
//
//  OUTPUT
//    <out-dir>/<label>_pool_probe.jsonl   (raw per-tick observations)
//
//    Observation schema (per-tick):
//      { ts, blockNumber, sameBlock, spreadBps,
//        a: { venue, pool, type, ... +V3-fields OR +V2-fields },
//        b: { ... } }
//
//      V3 fields: feeBps, sqrtPriceX96, tick, liquidity, price,
//                 activeTickDepthUsd, depthUsdToken0Side, depthUsdToken1Side,
//                 amount0Token, amount1Token, tickLower, tickUpper,
//                 depthSemantic='v3_active_tick_usd'
//      V2 fields: stable, reserve0Raw, reserve1Raw, reserve0Token,
//                 reserve1Token, price, activeTickDepthUsd (= reservesUsd),
//                 depthSemantic='v2_reserves_usd'
//
//      activeTickDepthUsd is the unified "executable depth" field so
//      downstream analyzers can compare V3 active-tick vs V2 reserves
//      apples-to-apples — but the depthSemantic tag preserves the
//      structural difference.
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
// NOTE: ethers + dotenv are deferred to main() so --self-test runs deps-free.

const REPO    = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO, 'logs', 'research', 'wave2');

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
function activeTickDepth({ sqrtPriceX96, tick, tickSpacing, liquidity, decimals0, decimals1, stableSide = 1 }) {
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
  // Stable-side aware: --stable-side CLI flag declares which token is USD-pegged.
  //   stableSide=1 (default): token1 = USD (Base/Arb pattern — USDC at higher address)
  //   stableSide=0:           token0 = USD (Optimism native USDC pattern)
  let usd0, usd1;
  if (stableSide === 0) {
    usd0 = amount0Token;
    usd1 = tokenPriceUsd > 0 ? amount1Token / tokenPriceUsd : 0;
  } else {
    usd0 = amount0Token * tokenPriceUsd;
    usd1 = amount1Token;
  }
  return { tickLower, tickUpper, amount0Token, amount1Token, usd0, usd1, totalUsd: usd0 + usd1 };
}

function spreadBps(priceA, priceB) {
  if (!isFinite(priceA) || !isFinite(priceB) || priceA <= 0 || priceB <= 0) return null;
  const mid = (priceA + priceB) / 2;
  return mid <= 0 ? null : +(Math.abs(priceA - priceB) / mid * 10000).toFixed(6);
}

// ─── V2 (constant-product) math — NEW in v3.0 ──────────────────────────────

// Convert raw reserves to human-readable token amounts (decimal-aware)
function v2Reserves(reserve0Raw, reserve1Raw, decimals0, decimals1) {
  const r0b = BigInt(reserve0Raw.toString());
  const r1b = BigInt(reserve1Raw.toString());
  const PREC = 1000000000n;
  const SCALE0 = BigInt('1' + '0'.repeat(decimals0));
  const SCALE1 = BigInt('1' + '0'.repeat(decimals1));
  const adj0 = Number((r0b * PREC) / SCALE0) / 1e9;
  const adj1 = Number((r1b * PREC) / SCALE1) / 1e9;
  return { reserve0Token: adj0, reserve1Token: adj1 };
}

// V2 spot price (matches xy=k constant-product semantics; assumes token1 = USD quote)
function v2Price(reserve0Token, reserve1Token) {
  if (reserve0Token <= 0) return null;
  return reserve1Token / reserve0Token;
}

// V2 "executable depth in USD" — the V2 analog of V3's active-tick depth.
//   For volatile pools (token1 ≈ USD): 2 × USDC reserve
//     (constant-product invariant means executable depth ≈ 2× one-sided notional)
//   For stable pools (both legs ≈ $1): r0 + r1
function v2Depth(reserve0Token, reserve1Token, isStable, stableSide = 1) {
  if (isStable) return reserve0Token + reserve1Token;
  // Stable-side aware: stableSide=1 (default) → 2×r1 (token1=USD, Base/Arb).
  // stableSide=0 → 2×r0 (token0=USD, Optimism native USDC pattern).
  return stableSide === 0 ? reserve0Token * 2 : reserve1Token * 2;
}

// ─── tickSpacing inference (UniV3 standard fee tiers + Algebra) ─────────────

function inferTickSpacing(type, feeBps) {
  if (type === 'algebra') return 1;
  if (type === 'aerodrome_v2') return null;  // V2 has no tick concept
  if (type === 'slipstream') return null;    // Slipstream tickSpacing is per-pool, decoupled from fee - read via pool.tickSpacing() if needed
  if (feeBps === 1)   return 1;
  if (feeBps === 5)   return 10;
  if (feeBps === 30)  return 60;
  if (feeBps === 100) return 200;
  if (feeBps === 25)  return 5;
  return null;
}

// ─── ABIs by pool type ───────────────────────────────────────────────────────

const POOL_ABI = {
  univ3: [
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
    'function liquidity() view returns (uint128)',
  ],
  // Aerodrome Slipstream: V3-style CL but slot0() returns 6 fields (no feeProtocol).
  // See docs/lessons/dex_contract_discovery_pitfalls.md.
  slipstream: [
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, bool)',
    'function liquidity() view returns (uint128)',
  ],
  algebra: [
    'function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16, uint8, uint8, bool)',
    'function liquidity() view returns (uint128)',
  ],
  aerodrome_v2: [
    'function getReserves() view returns (uint256, uint256, uint256)',
  ],
};

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = {
    chain: 'arbitrum',
    label: null,
    outDir: null,
    poolA: null, venueA: null, typeA: 'univ3', feeA: null, tsA: null, stableA: false,
    poolB: null, venueB: null, typeB: 'univ3', feeB: null, tsB: null, stableB: false,
    decimals0: 18, decimals1: 6,
    intervalSec: 30, durationMin: 30, maxSamples: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--chain':         a.chain = String(v).toLowerCase(); i++; break;
      case '--label':         a.label = v; i++; break;
      case '--out-dir':       a.outDir = v; i++; break;
      case '--pool-a':        a.poolA = v; i++; break;
      case '--venue-a':       a.venueA = v; i++; break;
      case '--type-a':        a.typeA = v; i++; break;
      case '--fee-a':         a.feeA = parseFloat(v); i++; break;
      case '--ts-a':          a.tsA = parseInt(v, 10); i++; break;
      case '--stable-a':      a.stableA = (v === 'true' || v === '1'); i++; break;
      case '--pool-b':        a.poolB = v; i++; break;
      case '--venue-b':       a.venueB = v; i++; break;
      case '--type-b':        a.typeB = v; i++; break;
      case '--fee-b':         a.feeB = parseFloat(v); i++; break;
      case '--ts-b':          a.tsB = parseInt(v, 10); i++; break;
      case '--stable-b':      a.stableB = (v === 'true' || v === '1'); i++; break;
      case '--decimals0':     a.decimals0 = parseInt(v, 10); i++; break;
      case '--decimals1':     a.decimals1 = parseInt(v, 10); i++; break;
      case '--stable-side':   a.stableSide = parseInt(v, 10); i++; break;
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
  if (!POOL_ABI[args.typeA] || !POOL_ABI[args.typeB])
    throw new Error(`pool type must be one of: ${Object.keys(POOL_ABI).join(', ')}`);

  const isV2 = (t) => t === 'aerodrome_v2';

  // V3 types require feeBps; V2 doesn't use it
  if (!isV2(args.typeA) && args.feeA == null) throw new Error('--fee-a required (bps) for V3 types');
  if (!isV2(args.typeB) && args.feeB == null) throw new Error('--fee-b required (bps) for V3 types');

  const tsA = isV2(args.typeA) ? null : (args.tsA != null ? args.tsA : inferTickSpacing(args.typeA, args.feeA));
  const tsB = isV2(args.typeB) ? null : (args.tsB != null ? args.tsB : inferTickSpacing(args.typeB, args.feeB));
  if (!isV2(args.typeA) && tsA == null) throw new Error(`tickSpacing could not be inferred for type=${args.typeA} fee=${args.feeA}; pass --ts-a explicitly`);
  if (!isV2(args.typeB) && tsB == null) throw new Error(`tickSpacing could not be inferred for type=${args.typeB} fee=${args.feeB}; pass --ts-b explicitly`);

  return [
    { label: 'a', name: args.venueA, address: args.poolA, type: args.typeA, feeBps: args.feeA, tickSpacing: tsA,
      decimals0: args.decimals0, decimals1: args.decimals1, abi: POOL_ABI[args.typeA], stable: args.stableA, stableSide: args.stableSide },
    { label: 'b', name: args.venueB, address: args.poolB, type: args.typeB, feeBps: args.feeB, tickSpacing: tsB,
      decimals0: args.decimals0, decimals1: args.decimals1, abi: POOL_ABI[args.typeB], stable: args.stableB, stableSide: args.stableSide },
  ];
}

// ─── RPC URL resolution (chain-aware via chains.json) ───────────────────────

function resolveRpcUrl(chain, chainCfg) {
  if (process.env[chainCfg.rpcEnv]) return process.env[chainCfg.rpcEnv];
  const altsByChain = {
    arbitrum: ['ARBITRUM_RPC_URL', 'RPC_URL_ARBITRUM', 'ALCHEMY_ARBITRUM_URL'],
    base:     ['BASE_MAINNET_RPC_URL', 'BASE_RPC_URL',  'ALCHEMY_BASE_URL'],
  };
  for (const e of (altsByChain[chain] || [])) if (process.env[e]) return process.env[e];
  const fallbacks = {
    arbitrum: 'https://arb1.arbitrum.io/rpc',
    base:     'https://mainnet.base.org',
  };
  return fallbacks[chain] || null;
}

// ─── RPC reads (lazy ethers import) ──────────────────────────────────────────

async function readPool(ethers, provider, pool, blockNumber) {
  const c = new ethers.Contract(pool.address, pool.abi, provider);
  if (pool.type === 'univ3' || pool.type === 'slipstream') {  // Slipstream is V3-style (slot0 + liquidity); see docs/lessons/dex_contract_discovery_pitfalls.md
    const [r, liquidity] = await Promise.all([
      c.slot0({ blockTag: blockNumber }),
      c.liquidity({ blockTag: blockNumber }),
    ]);
    return { kind: 'v3', sqrtPriceX96: r[0], tick: r[1], liquidity, blockNumber };
  }
  if (pool.type === 'algebra') {
    const [r, liquidity] = await Promise.all([
      c.globalState({ blockTag: blockNumber }),
      c.liquidity({ blockTag: blockNumber }),
    ]);
    return { kind: 'v3', sqrtPriceX96: r[0], tick: r[1], liquidity, blockNumber };
  }
  if (pool.type === 'aerodrome_v2') {
    const reserves = await c.getReserves({ blockTag: blockNumber });
    return { kind: 'v2', reserve0Raw: reserves[0], reserve1Raw: reserves[1], blockNumber };
  }
  throw new Error(`unknown pool type ${pool.type}`);
}

async function probeTick(ethers, provider, POOLS, sink, stats) {
  try {
    const blockNumber = await provider.getBlockNumber();
    const reads = await Promise.all(POOLS.map(p => readPool(ethers, provider, p, blockNumber)));
    const obs = { ts: new Date().toISOString(), blockNumber, sameBlock: true };
    const prices = [];

    POOLS.forEach((p, i) => {
      const r = reads[i];
      let obsForPool;

      if (r.kind === 'v2') {
        const { reserve0Token, reserve1Token } = v2Reserves(r.reserve0Raw, r.reserve1Raw, p.decimals0, p.decimals1);
        const price = v2Price(reserve0Token, reserve1Token);
        const depth = v2Depth(reserve0Token, reserve1Token, p.stable, p.stableSide);
        obsForPool = {
          venue:                p.name,
          pool:                 p.address,
          type:                 p.type,
          stable:               p.stable,
          reserve0Raw:          r.reserve0Raw.toString(),
          reserve1Raw:          r.reserve1Raw.toString(),
          reserve0Token:        +reserve0Token.toFixed(6),
          reserve1Token:        +reserve1Token.toFixed(2),
          price:                price != null ? +price.toFixed(8) : null,
          activeTickDepthUsd:   +depth.toFixed(2),
          depthSemantic:        'v2_reserves_usd',
        };
      } else {
        // V3 (univ3 or algebra)
        const price = priceFromSqrtX96(r.sqrtPriceX96, p.decimals0, p.decimals1);
        const depth = activeTickDepth({
          sqrtPriceX96: r.sqrtPriceX96, tick: r.tick, tickSpacing: p.tickSpacing,
          liquidity: r.liquidity, decimals0: p.decimals0, decimals1: p.decimals1, stableSide: p.stableSide,
        });
        obsForPool = {
          venue:                p.name,
          pool:                 p.address,
          type:                 p.type,
          feeBps:               p.feeBps,
          sqrtPriceX96:         r.sqrtPriceX96.toString(),
          tick:                 Number(r.tick),
          liquidity:            r.liquidity.toString(),
          price:                +price.toFixed(8),
          activeTickDepthUsd:   +depth.totalUsd.toFixed(2),
          depthUsdToken0Side:   +depth.usd0.toFixed(2),
          depthUsdToken1Side:   +depth.usd1.toFixed(2),
          amount0Token:         +depth.amount0Token.toFixed(6),
          amount1Token:         +depth.amount1Token.toFixed(2),
          tickLower:            depth.tickLower,
          tickUpper:            depth.tickUpper,
          depthSemantic:        'v3_active_tick_usd',
        };
      }

      obs[p.label] = obsForPool;
      prices.push(obsForPool.price);
    });

    obs.spreadBps = spreadBps(prices[0], prices[1]);
    sink.write(JSON.stringify(obs) + '\n');
    stats.recorded++;

    const pa = obs.a, pb = obs.b;
    const paStr = pa.price != null ? pa.price.toFixed(2) : 'n/a';
    const pbStr = pb.price != null ? pb.price.toFixed(2) : 'n/a';
    console.error(`[probe] #${stats.recorded} block=${blockNumber} ${pa.venue}=$${paStr} ${pb.venue}=$${pbStr} spread=${obs.spreadBps}bp | depthA=$${(pa.activeTickDepthUsd/1000).toFixed(1)}k depthB=$${(pb.activeTickDepthUsd/1000).toFixed(1)}k`);
  } catch (e) {
    stats.errors++;
    console.error(`[probe] tick error: ${e.message}`);
  }
}

async function main() {
  require('dotenv').config();
  const { ethers } = require('ethers');
  const args = parseArgs(process.argv.slice(2));

  // Chain-aware RPC URL resolution via chains.json
  const chainsPath = path.join(REPO, 'config', 'chains.json');
  let chainsConfig;
  try {
    chainsConfig = JSON.parse(fs.readFileSync(chainsPath, 'utf-8'));
  } catch (e) {
    console.error(`[probe] FATAL: cannot read chains.json: ${e.message}`);
    process.exit(2);
  }
  const chainCfg = chainsConfig.chains && chainsConfig.chains[args.chain];
  if (!chainCfg) {
    console.error(`[probe] FATAL: unknown chain "${args.chain}". Available: ${Object.keys(chainsConfig.chains || {}).join(', ')}`);
    process.exit(2);
  }
  const RPC_URL = resolveRpcUrl(args.chain, chainCfg);
  if (!RPC_URL) {
    console.error(`[probe] FATAL: no RPC URL for chain "${args.chain}". Set ${chainCfg.rpcEnv} env var.`);
    process.exit(2);
  }

  let POOLS;
  try { POOLS = buildPools(args); }
  catch (e) { console.error(`[probe] ${e.message}`); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const outDir = args.outDir ? path.resolve(REPO, args.outDir) : DEFAULT_OUT_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  const outJsonl = path.join(outDir, `${args.label}_pool_probe.jsonl`);
  const sink = fs.createWriteStream(outJsonl, { flags: 'a' });

  const stats = { recorded: 0, errors: 0 };
  const startedAt = Date.now();
  const deadline = args.durationMin ? startedAt + args.durationMin * 60000 : null;

  console.error(`[probe] Surface Depth Probe v3.0 (chain-aware, constitutional) — READ-ONLY`);
  console.error(`[probe] chain: ${args.chain}`);
  console.error(`[probe] label: ${args.label}`);
  console.error(`[probe] RPC: ${RPC_URL.split('?')[0]}`);
  const tsAStr = POOLS[0].type === 'aerodrome_v2' ? 'v2' : `ts=${POOLS[0].tickSpacing}`;
  const tsBStr = POOLS[1].type === 'aerodrome_v2' ? 'v2' : `ts=${POOLS[1].tickSpacing}`;
  console.error(`[probe] A: ${POOLS[0].name} ${POOLS[0].address.slice(0,12)}… (${POOLS[0].type}, ${POOLS[0].feeBps || 'v2'}bp, ${tsAStr})`);
  console.error(`[probe] B: ${POOLS[1].name} ${POOLS[1].address.slice(0,12)}… (${POOLS[1].type}, ${POOLS[1].feeBps || 'v2'}bp, ${tsBStr})`);
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

  // V3 math (preserved from v2.0)
  const p1 = priceFromSqrtX96('3555783136642337927135548', 18, 6);
  cases.push([`price: uni-1bp snapshot ≈ 2014.24 (got ${p1.toFixed(2)})`, approx(p1, 2014.24, 1e-3)]);
  cases.push(['sqrtPriceAtTick(0) ≈ Q96', approx(sqrtPriceAtTick(0), Q96_NUM, 1e-9)]);
  cases.push(['sqrtPriceAtTick monotonic +', sqrtPriceAtTick(100) > sqrtPriceAtTick(0)]);

  const d = activeTickDepth({
    sqrtPriceX96: BigInt(Math.floor(sqrtPriceAtTick(5))),
    tick: 5, tickSpacing: 10, liquidity: BigInt('1000000000000000'),
    decimals0: 18, decimals1: 6,
  });
  cases.push(['v3 depth: totalUsd = usd0 + usd1', approx(d.totalUsd, d.usd0 + d.usd1, 1e-9)]);
  cases.push(['v3 depth: both sides > 0 mid-range', d.usd0 > 0 && d.usd1 > 0]);

  // V3 stable-side=0 (Optimism native USDC pattern: USDC=token0, WETH=token1)
  const d_s0 = activeTickDepth({
    sqrtPriceX96: BigInt(Math.floor(sqrtPriceAtTick(5))),
    tick: 5, tickSpacing: 10, liquidity: BigInt('1000000000000000'),
    decimals0: 6, decimals1: 18, stableSide: 0,
  });
  cases.push(['v3 (stableSide=0): totalUsd = usd0 + usd1', approx(d_s0.totalUsd, d_s0.usd0 + d_s0.usd1, 1e-9)]);
  cases.push(['v3 (stableSide=0): both sides > 0',         d_s0.usd0 > 0 && d_s0.usd1 > 0]);
  cases.push(['spread(2014, 2015) ≈ 4.96bp', approx(spreadBps(2014, 2015), 4.962, 1e-2)]);
  cases.push(['spread(0, 1) → null', spreadBps(0, 1) === null]);

  // V2 math — NEW in v3.0
  // For ETH/USDC pool with 1000 WETH + 3,000,000 USDC: price should be 3000, depth (volatile) = 6M
  const v2r = v2Reserves(
    '1000000000000000000000',    // 1000 WETH (18 decimals)
    '3000000000000',             // 3,000,000 USDC (6 decimals)
    18, 6
  );
  cases.push(['v2: reserve0 = 1000 WETH (got ' + v2r.reserve0Token + ')',  approx(v2r.reserve0Token, 1000,    1e-6)]);
  cases.push(['v2: reserve1 = 3M USDC (got ' + v2r.reserve1Token + ')',    approx(v2r.reserve1Token, 3000000, 1e-6)]);
  cases.push(['v2: price = 3000',          approx(v2Price(v2r.reserve0Token, v2r.reserve1Token), 3000, 1e-6)]);
  cases.push(['v2: depth volatile = 6M USD', approx(v2Depth(v2r.reserve0Token, v2r.reserve1Token, false), 6000000, 1e-6)]);

  // V2 stable-side=0 (Optimism native USDC pattern: USDC at reserve0)
  const v2r_s0 = v2Reserves(
    '3000000000000',             // 3,000,000 USDC at reserve0 (6 decimals)
    '1000000000000000000000',    // 1000 WETH at reserve1 (18 decimals)
    6, 18
  );
  cases.push(['v2 (stableSide=0): depth = 2×r0 = 6M USD', approx(v2Depth(v2r_s0.reserve0Token, v2r_s0.reserve1Token, false, 0), 6000000, 1e-6)]);
  cases.push(['v2 (stableSide=1 default): unchanged 6M',  approx(v2Depth(v2r.reserve0Token, v2r.reserve1Token, false), 6000000, 1e-6)]);
  cases.push(['v2: depth stable = r0+r1',   approx(v2Depth(v2r.reserve0Token, v2r.reserve1Token, true),  3001000, 1e-6)]);
  cases.push(['v2: zero r0 → price null',  v2Price(0, 1000) === null]);

  // tickSpacing inference
  cases.push(['inferTickSpacing(univ3, 5) = 10',           inferTickSpacing('univ3', 5) === 10]);
  cases.push(['inferTickSpacing(univ3, 1) = 1',            inferTickSpacing('univ3', 1) === 1]);
  cases.push(['inferTickSpacing(univ3, 30) = 60',          inferTickSpacing('univ3', 30) === 60]);
  cases.push(['inferTickSpacing(univ3, 100) = 200',        inferTickSpacing('univ3', 100) === 200]);
  cases.push(['inferTickSpacing(algebra, *) = 1',          inferTickSpacing('algebra', 1) === 1 && inferTickSpacing('algebra', 5) === 1]);
  cases.push(['inferTickSpacing(aerodrome_v2, *) = null',  inferTickSpacing('aerodrome_v2', 30) === null]);
  cases.push(['inferTickSpacing(slipstream, 5) = null',    inferTickSpacing('slipstream', 5) === null]);
  cases.push(['inferTickSpacing(slipstream, 1) = null',    inferTickSpacing('slipstream', 1) === null]);
  cases.push(['inferTickSpacing(slipstream, 100) = null',  inferTickSpacing('slipstream', 100) === null]);
  cases.push(['POOL_ABI.slipstream exists',                  POOL_ABI.slipstream !== undefined]);
  cases.push(['POOL_ABI.slipstream.slot0 has 6 fields',     POOL_ABI.slipstream[0].includes('uint16, bool)')]);
  cases.push(['inferTickSpacing(univ3, 7) → null',         inferTickSpacing('univ3', 7) === null]);

  // CLI parsing — basic + NEW v3 fields
  const a = parseArgs(['--chain', 'base', '--label', 'test',
                       '--pool-a', '0xAAA', '--venue-a', 'uniswap_v3', '--type-a', 'univ3', '--fee-a', '5',
                       '--pool-b', '0xBBB', '--venue-b', 'aerodrome', '--type-b', 'aerodrome_v2',
                       '--stable-b', 'false', '--out-dir', 'logs/research/wave4']);
  cases.push(['parseArgs: chain captured (base)',  a.chain === 'base']);
  cases.push(['parseArgs: out-dir captured',       a.outDir === 'logs/research/wave4']);
  cases.push(['parseArgs: type-b aerodrome_v2',    a.typeB === 'aerodrome_v2']);
  cases.push(['parseArgs: stable-b false',         a.stableB === false]);
  cases.push(['parseArgs: default chain arbitrum', parseArgs([]).chain === 'arbitrum']);

  // buildPools — V3+V2 mix
  const builtMix = buildPools(parseArgs([
    '--label','base_eth_usdc',
    '--pool-a','0xUNI','--venue-a','uniswap_v3','--type-a','univ3','--fee-a','5',
    '--pool-b','0xAERO','--venue-b','aerodrome','--type-b','aerodrome_v2','--stable-b','false'
  ]));
  cases.push(['buildPools mix: 2 entries',                      builtMix.length === 2]);
  cases.push(['buildPools mix: A tickSpacing 10',               builtMix[0].tickSpacing === 10]);
  cases.push(['buildPools mix: B tickSpacing null (v2)',        builtMix[1].tickSpacing === null]);
  cases.push(['buildPools mix: A v3 ABI has slot0 + liquidity', builtMix[0].abi.length === 2]);
  cases.push(['buildPools mix: B v2 ABI has getReserves',       builtMix[1].abi.length === 1]);
  cases.push(['buildPools mix: B stable flag preserved',        builtMix[1].stable === false]);

  // buildPools rejection
  cases.push(['buildPools rejects no label', (() => { try { buildPools(parseArgs(['--pool-a','0xA','--pool-b','0xB','--venue-a','x','--venue-b','y','--fee-a','5','--fee-b','5'])); return false; } catch (e) { return /label/.test(e.message); } })()]);
  cases.push(['buildPools rejects bad type', (() => { try { buildPools(parseArgs(['--label','t','--pool-a','0xA','--pool-b','0xB','--venue-a','x','--venue-b','y','--type-a','zzz','--fee-a','5','--fee-b','5'])); return false; } catch (e) { return /type must be/.test(e.message); } })()]);

  // resolveRpcUrl
  const fakeChainCfg = { rpcEnv: 'NONEXISTENT_ENV_VAR_FOR_TEST_XYZ' };
  cases.push(['resolveRpcUrl(arbitrum) falls back to public', resolveRpcUrl('arbitrum', fakeChainCfg) === 'https://arb1.arbitrum.io/rpc']);
  cases.push(['resolveRpcUrl(base) falls back to public',     resolveRpcUrl('base',     fakeChainCfg) === 'https://mainnet.base.org']);
  cases.push(['resolveRpcUrl(unknown) → null',                resolveRpcUrl('zksync',   fakeChainCfg) === null]);

  let pass = 0;
  console.log('── surface_depth_probe.js v3.0 SELF-TEST (chain-aware, constitutional gate) ──\n');
  for (const [label, ok] of cases) {
    console.log(`  ${ok ? '✅ ' : '❌ '}  ${label}`);
    if (ok) pass++;
  }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
