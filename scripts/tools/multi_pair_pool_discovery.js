'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Multi-Pair Pool Discovery  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/multi_pair_pool_discovery.js
//  STATUS:     CURRENT — Inventory Expansion Phase (Boss directive 2026-04-02)
//
//  PURPOSE
//  ───────
//  Discover pools for multiple target pairs across all compatible venues on
//  Arbitrum. Answers one question per pair:
//    "What pools exist for this pair, and are they live enough to add to fetcher?"
//
//  Replaces running individual per-pair discovery scripts sequentially.
//  Same probe logic as arb_usdc_pool_discovery.js — generalised across pairs.
//
//  TARGET PAIRS (Boss directive 2026-04-02 — inventory breadth expansion)
//  ─────────────────────────────────────────────────────────────────────
//  Priority 1 — pairs with counterpart venue gap (currently single-venue, score=0):
//    ETH/USDT   — UniV3 only today; find Camelot/Sushi counterpart → makes pairable
//    WBTC/USDT  — UniV3 only today; same
//    WBTC/USDC  — not in fetcher at all; native USDC preferred over USDT
//
//  Priority 2 — new major asset pairs (not in fetcher):
//    LINK/USDC  — widely traded on Arbitrum
//    GMX/USDC   — Arbitrum-native, high activity
//    UNI/USDC   — standard major pair
//    DAI/USDC   — native stable pair via Arbitrum bridge DAI
//
//  Priority 3 — additional fee tiers for existing pairs:
//    ETH/USDC 0.30%  — complement to existing 0.05% and 0.01% coverage
//    ARB/USDC  0.01% — lower-fee tier if it exists
//
//  DOES NOT:
//    - modify fetchers or configs
//    - simulate trades or execute anything
//    - write any files or Redis keys
//
//  FACTORY ADDRESSES (all confirmed from repo session history 2026-03-28)
//  ────────────────────────────────────────────────────────────────────
//  UniswapV3   : 0x1F98431c8aD98523631AE4a59f267346ea31F984  (canonical Arbitrum)
//  SushiSwapV3 : 0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e  (confirmed Arbiscan)
//  CamelotV3   : 0x1a3c9B1d2F92C84F37C2dE53AE52d6Ff8E5a0E6  (Algebra, poolByPair)
//  RamsesV2    : env var only — do not hardcode (address not confirmed)
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --pair ETH/USDT
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --json
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --verbose
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --venue uniswap_v3
//
//  OUTPUT
//  ──────
//  Console table of all discovered pools with status, depth, and price.
//  --json emits machine-readable array suitable for direct review.
//  Confirmed kept pools include all fields needed for arbitrumFetcher config.
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const ARGS     = process.argv.slice(2);
const JSON_OUT = ARGS.includes('--json');
const VERBOSE  = ARGS.includes('--verbose');

function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : def;
}

const FILTER_PAIR  = argVal('--pair',  null);   // e.g. "ETH/USDT"
const FILTER_VENUE = argVal('--venue', null);   // e.g. "uniswap_v3"

// ─── TOKEN REGISTRY ───────────────────────────────────────────────────────────
// All on Arbitrum mainnet. Addresses are checksummed; comparison uses toLowerCase().
// New tokens: verify address on Arbiscan before adding.

const TOKENS = {
  WETH: { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
  USDC: { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6  },  // native Circle USDC
  USDT: { symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6  },
  WBTC: { symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8  },
  ARB:  { symbol: 'ARB',  address: '0x912CE59144191C1204E64559FE8253a0e49E6548', decimals: 18 },
  DAI:  { symbol: 'DAI',  address: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', decimals: 18 },
  LINK: { symbol: 'LINK', address: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', decimals: 18 },
  GMX:  { symbol: 'GMX',  address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a', decimals: 18 },
  UNI:  { symbol: 'UNI',  address: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0', decimals: 18 },
  USDCE:{ symbol: 'USDCe',address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', decimals: 6  },  // bridged — detect and reject
};

// Lowercase map for fast classification
const ADDR_MAP = Object.fromEntries(
  Object.entries(TOKENS).map(([k, v]) => [v.address.toLowerCase(), k])
);

// ─── TARGET PAIRS ─────────────────────────────────────────────────────────────
// Priority-ordered. base/quote match on-chain token0/token1 for the EXPECTED
// sort order on Arbitrum — but all combinations are checked regardless.
// decimals0/decimals1 and priceMode are included for direct copy into fetcher config.

const TARGET_PAIRS = [
  // ── Priority 1: Single-venue today → need counterpart for pairability ────────
  {
    label       : 'ETH/USDT',
    tokenA      : TOKENS.WETH,
    tokenB      : TOKENS.USDT,
    // Note: on Arbitrum WETH (0x82aF) < USDT (0xFd08) → token0=WETH, token1=USDT
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',    // sqrtP^2 × 10^(dec0-dec1) = USDT per WETH ~$2050
    sanityMin   : 500,
    sanityMax   : 20000,
  },
  {
    label       : 'WBTC/USDT',
    tokenA      : TOKENS.WBTC,
    tokenB      : TOKENS.USDT,
    // WBTC (0x2f2a) < USDT (0xFd08) → token0=WBTC, token1=USDT
    expectedDec0: 8,
    expectedDec1: 6,
    priceMode   : 'direct',    // USDT per WBTC ~$65k-$90k
    sanityMin   : 10000,
    sanityMax   : 200000,
  },
  {
    label       : 'WBTC/USDC',
    tokenA      : TOKENS.WBTC,
    tokenB      : TOKENS.USDC,
    // WBTC (0x2f2a) < USDC (0xaf88) → token0=WBTC, token1=USDC
    expectedDec0: 8,
    expectedDec1: 6,
    priceMode   : 'direct',    // USDC per WBTC ~$65k-$90k
    sanityMin   : 10000,
    sanityMax   : 200000,
  },
  // ── Priority 2: New major asset pairs not yet in fetcher ────────────────────
  {
    label       : 'LINK/USDC',
    tokenA      : TOKENS.LINK,
    tokenB      : TOKENS.USDC,
    // LINK (0xf97f) > USDC (0xaf88) → token0=USDC, token1=LINK — price inverted
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',    // USDC per LINK ~$10-$30
    sanityMin   : 1,
    sanityMax   : 200,
  },
  {
    label       : 'GMX/USDC',
    tokenA      : TOKENS.GMX,
    tokenB      : TOKENS.USDC,
    // GMX (0xfc5A) > USDC (0xaf88) → token0=USDC, token1=GMX
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',    // USDC per GMX ~$15-$50
    sanityMin   : 1,
    sanityMax   : 500,
  },
  {
    label       : 'UNI/USDC',
    tokenA      : TOKENS.UNI,
    tokenB      : TOKENS.USDC,
    // UNI (0xFa7F) > USDC (0xaf88) → token0=USDC, token1=UNI
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',
    sanityMin   : 1,
    sanityMax   : 100,
  },
  {
    label       : 'DAI/USDC',
    tokenA      : TOKENS.DAI,
    tokenB      : TOKENS.USDC,
    // DAI (0xDA10) > USDC (0xaf88) → token0=USDC, token1=DAI
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',    // USDC per DAI ~1.000
    sanityMin   : 0.9,
    sanityMax   : 1.1,
  },
  // ── Priority 3: Additional fee tiers for existing pairs ─────────────────────
  {
    label       : 'ETH/USDC (0.30%)',
    tokenA      : TOKENS.WETH,
    tokenB      : TOKENS.USDC,
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',
    sanityMin   : 500,
    sanityMax   : 20000,
    feeTiersOnly: [3000],      // only probe 0.30% — 0.05% and 0.01% already in fetcher
  },
  {
    label       : 'ARB/USDC (0.01%)',
    tokenA      : TOKENS.ARB,
    tokenB      : TOKENS.USDC,
    expectedDec0: 18,
    expectedDec1: 6,
    priceMode   : 'direct',
    sanityMin   : 0.01,
    sanityMax   : 20,
    feeTiersOnly: [100],       // only probe 0.01% — 0.05% already in fetcher
  },
];

// ─── VENUES ───────────────────────────────────────────────────────────────────

const STANDARD_FEE_TIERS = [100, 500, 3000, 10000];
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const VENUES = [
  {
    venue  : 'uniswap_v3',
    type   : 'v3_factory',     // uses getPool(A, B, fee)
    factory: process.env.ARB_UNISWAP_V3_FACTORY || '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    slotFn : 'slot0',
  },
  {
    venue  : 'sushiswap_v3',
    type   : 'v3_factory',     // uses getPool(A, B, fee) — same interface as UniV3
    factory: process.env.ARB_SUSHISWAP_V3_FACTORY || '0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e',
    slotFn : 'slot0',
  },
  {
    venue  : 'camelot_v3',
    type   : 'algebra_factory', // uses poolByPair(A, B) — no fee tier argument
    factory: process.env.ARB_CAMELOT_V3_FACTORY || '0x1a3c9B1d2F92C84F37C2dE53AE52d6Ff8E5a0E6',
    slotFn : 'globalState',
  },
  {
    venue  : 'ramses_v2',
    type   : 'v3_factory',     // Ramses V2 CL uses slot0, NOT globalState
    factory: process.env.ARB_RAMSES_V2_FACTORY || null,  // REQUIRES env var — address not confirmed
    slotFn : 'slot0',
  },
];

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];

const ALGEBRA_FACTORY_ABI = [
  'function poolByPair(address tokenA, address tokenB) view returns (address pool)',
];

const POOL_BASE_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
];

// slot0 has fee embedded; Algebra fee comes from globalState
const POOL_FEE_ABI = ['function fee() view returns (uint24)'];

const SLOT0_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];

const GLOBAL_STATE_ABI = [
  'function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function lower(v)  { return String(v || '').toLowerCase(); }

function classifyToken(addr) {
  return ADDR_MAP[lower(addr)] || 'UNKNOWN';
}

function sqrtPriceToHuman(sqrtPriceX96, tok0Symbol, tok1Symbol) {
  try {
    const t0 = TOKENS[tok0Symbol];
    const t1 = TOKENS[tok1Symbol];
    if (!t0 || !t1) return null;
    const sqrtP = Number(sqrtPriceX96) / (2 ** 96);
    return sqrtP * sqrtP * Math.pow(10, t0.decimals - t1.decimals);
  } catch { return null; }
}

function approxDepthUSD(liquidityRaw, sqrtPriceX96, tok0Symbol, tok1Symbol) {
  try {
    const t1 = TOKENS[tok1Symbol];
    if (!t1) return null;
    const liq  = Number(liquidityRaw);
    const sqrtP = Number(sqrtPriceX96) / (2 ** 96);
    const reserveQuote = (liq * sqrtP) / Math.pow(10, t1.decimals);
    return reserveQuote * 2;
  } catch { return null; }
}

// ─── POOL PROBE ───────────────────────────────────────────────────────────────

async function probePool(rpc, venue, poolAddress, pair, feeTierQueried, blockNumber) {
  const label = `disc.${venue.venue}.${poolAddress.slice(0, 10)}`;

  // Base read: token0, token1, liquidity
  let t0, t1, liquidityRaw;
  try {
    const { result } = await rpc.callDetailed(
      `${label}.base`,
      async (p) => {
        const pool = new ethers.Contract(poolAddress, POOL_BASE_ABI, p);
        const [_t0, _t1, _liq] = await Promise.all([
          pool.token0({ blockTag: blockNumber }),
          pool.token1({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { t0: _t0, t1: _t1, liq: _liq };
      },
      { timeoutMs: 4000, hedge: true }
    );
    t0           = result.t0;
    t1           = result.t1;
    liquidityRaw = result.liq.toString();
  } catch (e) {
    return { poolAddress, status: 'skip_base_read_error', rejectReason: e.message.slice(0, 100) };
  }

  const tok0Symbol = classifyToken(t0);
  const tok1Symbol = classifyToken(t1);

  // Reject bridged/deprecated tokens immediately
  if (tok0Symbol === 'USDCE' || tok1Symbol === 'USDCE') {
    return { poolAddress, tok0Symbol, tok1Symbol, status: 'reject_bridged_usdce', rejectReason: 'USDCe not native' };
  }

  // Verify the pool actually contains our target tokens
  const expectedA = lower(pair.tokenA.address);
  const expectedB = lower(pair.tokenB.address);
  const actual0   = lower(t0);
  const actual1   = lower(t1);
  const validPair = (actual0 === expectedA && actual1 === expectedB) ||
                    (actual0 === expectedB && actual1 === expectedA);
  if (!validPair) {
    return {
      poolAddress, tok0Symbol, tok1Symbol, feeTierQueried,
      status      : 'reject_token_mismatch',
      rejectReason: `expected ${pair.tokenA.symbol}/${pair.tokenB.symbol}, got ${tok0Symbol}/${tok1Symbol}`,
    };
  }

  if (BigInt(liquidityRaw) === 0n) {
    return { poolAddress, tok0Symbol, tok1Symbol, feeTierQueried, liquidityRaw, status: 'reject_zero_liquidity' };
  }

  // Price state read
  await sleep(80);
  let sqrtPriceX96 = null, tick = null, onChainFee = feeTierQueried;
  try {
    const priceAbi = venue.slotFn === 'globalState' ? GLOBAL_STATE_ABI : SLOT0_ABI;
    const { result: pr } = await rpc.callDetailed(
      `${label}.price`,
      async (p) => {
        const pool = new ethers.Contract(poolAddress, priceAbi, p);
        return venue.slotFn === 'globalState'
          ? pool.globalState({ blockTag: blockNumber })
          : pool.slot0({ blockTag: blockNumber });
      },
      { timeoutMs: 3000, hedge: true }
    );
    sqrtPriceX96 = pr[0].toString();
    tick         = Number(pr[1]);
    // Algebra: fee at index 2 (dynamic); slot0: fee comes from pool.fee()
    if (venue.slotFn === 'globalState') onChainFee = Number(pr[2]);
  } catch (e) {
    if (VERBOSE) console.warn(`  [disc] price read failed ${label}: ${e.message.slice(0, 60)}`);
  }

  const priceHuman  = sqrtPriceX96 ? sqrtPriceToHuman(sqrtPriceX96, tok0Symbol, tok1Symbol) : null;
  const approxDepth = sqrtPriceX96 ? approxDepthUSD(liquidityRaw, sqrtPriceX96, tok0Symbol, tok1Symbol) : null;

  // Sanity check price
  let sanityPassed = true;
  if (priceHuman && pair.sanityMin && pair.sanityMax) {
    sanityPassed = priceHuman >= pair.sanityMin && priceHuman <= pair.sanityMax;
  }

  return {
    venue        : venue.venue,
    pair         : pair.label,
    poolAddress,
    token0       : t0,
    token1       : t1,
    tok0Symbol,
    tok1Symbol,
    feeTierQueried,
    onChainFee,
    feePct       : `${(onChainFee / 10000).toFixed(4)}%`,
    liquidityRaw,
    sqrtPriceX96,
    tick,
    priceHuman   : priceHuman != null ? +priceHuman.toFixed(6) : null,
    approxDepthUSD: approxDepth != null ? +approxDepth.toFixed(2) : null,
    sanityPassed,
    blockNumber,
    status       : sanityPassed ? 'keep' : 'warn_sanity_fail',
    rejectReason : sanityPassed ? null : `price ${priceHuman?.toFixed(4)} outside [${pair.sanityMin}, ${pair.sanityMax}]`,
    // Fields ready for arbitrumFetcher config (present on keep)
    fetcherConfig: (sanityPassed && BigInt(liquidityRaw) > 0n && sqrtPriceX96) ? {
      outputPair    : pair.label.replace(' (0.30%)', '').replace(' (0.01%)', ''),
      pool          : poolAddress,
      decimals0     : TOKENS[tok0Symbol]?.decimals ?? null,
      decimals1     : TOKENS[tok1Symbol]?.decimals ?? null,
      fee           : onChainFee,
      priceMode     : pair.priceMode,
      sanityMin     : pair.sanityMin,
      sanityMax     : pair.sanityMax,
    } : null,
  };
}

// ─── VENUE SCANNER ────────────────────────────────────────────────────────────

async function scanVenueForPair(rpc, venue, pair, blockNumber) {
  const results = [];

  if (!venue.factory) {
    if (VERBOSE) console.log(`  [disc] SKIP ${venue.venue} — no factory (set env var)`);
    results.push({ venue: venue.venue, pair: pair.label, status: 'skip_missing_factory',
      rejectReason: `${venue.venue.toUpperCase()}_FACTORY env var not set` });
    return results;
  }

  const feeTiers = pair.feeTiersOnly
    ? pair.feeTiersOnly
    : (venue.type === 'algebra_factory' ? [null] : STANDARD_FEE_TIERS);

  for (const feeTier of feeTiers) {
    await sleep(200);

    let poolAddress;

    // ── Algebra: single pool per pair (no fee tier argument) ──
    if (venue.type === 'algebra_factory') {
      try {
        const { result } = await rpc.callDetailed(
          `disc.${venue.venue}.factory.${pair.label}`,
          async (p) => {
            const factory = new ethers.Contract(venue.factory, ALGEBRA_FACTORY_ABI, p);
            return factory.poolByPair(pair.tokenA.address, pair.tokenB.address, { blockTag: blockNumber });
          },
          { timeoutMs: 4000, hedge: false }
        );
        poolAddress = result;
      } catch (e) {
        results.push({ venue: venue.venue, pair: pair.label, feeTierQueried: 'dynamic',
          status: 'skip_factory_error', rejectReason: e.message.slice(0, 100) });
        if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} → factory error: ${e.message.slice(0, 60)}`);
        continue;
      }

      if (!poolAddress || poolAddress === ZERO_ADDR) {
        results.push({ venue: venue.venue, pair: pair.label, feeTierQueried: 'dynamic',
          status: 'reject_zero_address', rejectReason: 'pool_not_deployed' });
        if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} → no pool`);
        continue;
      }

      await sleep(100);
      const result = await probePool(rpc, venue, poolAddress, pair, 'dynamic', blockNumber);
      results.push(result);
      continue;
    }

    // ── Standard V3 factory: getPool(A, B, fee) ──
    try {
      const { result } = await rpc.callDetailed(
        `disc.${venue.venue}.factory.${pair.label}.${feeTier}`,
        async (p) => {
          const factory = new ethers.Contract(venue.factory, V3_FACTORY_ABI, p);
          return factory.getPool(pair.tokenA.address, pair.tokenB.address, feeTier, { blockTag: blockNumber });
        },
        { timeoutMs: 4000, hedge: false }
      );
      poolAddress = result;
    } catch (e) {
      results.push({ venue: venue.venue, pair: pair.label, feeTierQueried: feeTier,
        status: 'skip_factory_error', rejectReason: e.message.slice(0, 100) });
      if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} fee=${feeTier} → factory error`);
      continue;
    }

    if (!poolAddress || poolAddress === ZERO_ADDR) {
      if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} fee=${feeTier} → no pool`);
      results.push({ venue: venue.venue, pair: pair.label, feeTierQueried: feeTier,
        status: 'reject_zero_address', rejectReason: 'pool_not_deployed_for_fee_tier' });
      continue;
    }

    await sleep(100);
    const result = await probePool(rpc, venue, poolAddress, pair, feeTier, blockNumber);
    results.push(result);
  }

  return results;
}

// ─── DISPLAY ──────────────────────────────────────────────────────────────────

function printResults(allResults) {
  const kept   = allResults.filter(r => r.status === 'keep' || r.status === 'warn_sanity_fail');
  const failed = allResults.filter(r => r.status !== 'keep' && r.status !== 'warn_sanity_fail');

  const W = 130;
  console.log('\n' + '═'.repeat(W));
  console.log(' AllMight — Multi-Pair Pool Discovery v1.0  |  Arbitrum');
  console.log(' ' + nowIso());
  console.log('═'.repeat(W));
  console.log(' FOUND POOLS:');
  console.log('-'.repeat(W));
  console.log(
    ' pair'.padEnd(22) +
    'venue'.padEnd(16) +
    'fee'.padEnd(8) +
    'depth$'.padEnd(14) +
    'price'.padEnd(14) +
    'pool address'
  );
  console.log('-'.repeat(W));

  if (kept.length === 0) {
    console.log('  (none found)');
  }

  for (const r of kept) {
    const sanityMark = r.status === 'warn_sanity_fail' ? ' ⚠' : ' ✓';
    const depth = r.approxDepthUSD != null
      ? (r.approxDepthUSD >= 1000 ? `$${(r.approxDepthUSD / 1000).toFixed(1)}k` : `$${r.approxDepthUSD.toFixed(0)}`)
      : '—';
    const price = r.priceHuman != null ? `$${r.priceHuman}` : '—';
    console.log(
      ` ${(r.pair || '').padEnd(21)}` +
      `${(r.venue || '').padEnd(16)}` +
      `${(r.feePct || r.feeTierQueried || '?').padEnd(8)}` +
      `${depth.padEnd(14)}` +
      `${price.padEnd(14)}` +
      `${r.poolAddress || '—'}${sanityMark}`
    );
  }

  console.log('-'.repeat(W));
  console.log(` FILTERED OUT (${failed.length}): ` +
    Object.entries(
      failed.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})
    ).map(([k, v]) => `${k}=${v}`).join('  ')
  );
  console.log('═'.repeat(W));

  if (kept.length > 0) {
    console.log('\n FETCHER CONFIGS (ready to add to arbitrumFetcher.js):\n');
    for (const r of kept.filter(r => r.fetcherConfig)) {
      const cfg = r.fetcherConfig;
      console.log(`  // ${r.pair} — ${r.venue}  fee=${r.feePct}  depth≈${r.approxDepthUSD >= 1000 ? `$${(r.approxDepthUSD/1000).toFixed(1)}k` : `$${r.approxDepthUSD?.toFixed(0)}`}  price=$${r.priceHuman}`);
      console.log(`  {`);
      console.log(`    outputPair: '${cfg.outputPair}',`);
      console.log(`    pool:       '${cfg.pool}',`);
      console.log(`    decimals0:  ${cfg.decimals0},`);
      console.log(`    decimals1:  ${cfg.decimals1},`);
      console.log(`    fee:        ${cfg.fee},`);
      console.log(`    priceMode:  '${cfg.priceMode}',`);
      console.log(`    sanityMin:  ${cfg.sanityMin},`);
      console.log(`    sanityMax:  ${cfg.sanityMax},`);
      console.log(`  },`);
      console.log('');
    }
    console.log(' NEXT: verify depth > $5k, then add to appropriate pool array in arbitrumFetcher.js');
    console.log(' THEN: rerun master-fetcher → ranker → evaluator to confirm new surfaces');
  }

  console.log('═'.repeat(W) + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const rpc = createProvider('arbitrum');

  // Block anchor for same-block reads
  let blockNumber;
  try {
    const b = await rpc.getBlockNumber('disc.block', { timeoutMs: 3000, hedge: true });
    blockNumber = b.blockNumber;
    if (VERBOSE) console.log(`[discovery] block=${blockNumber}`);
  } catch (e) {
    console.error(`[discovery] FATAL: cannot get block: ${e.message}`);
    process.exit(1);
  }

  // Apply filters
  const pairsToScan  = FILTER_PAIR
    ? TARGET_PAIRS.filter(p => p.label.toLowerCase().includes(FILTER_PAIR.toLowerCase()))
    : TARGET_PAIRS;

  const venuesToScan = FILTER_VENUE
    ? VENUES.filter(v => v.venue.toLowerCase().includes(FILTER_VENUE.toLowerCase()))
    : VENUES;

  if (!JSON_OUT) {
    console.log(`\n[discovery] pairs=${pairsToScan.length}  venues=${venuesToScan.length}  block=${blockNumber}`);
    if (FILTER_PAIR)  console.log(`[discovery] pair filter: ${FILTER_PAIR}`);
    if (FILTER_VENUE) console.log(`[discovery] venue filter: ${FILTER_VENUE}`);
    console.log('[discovery] Running — serial probe with sleeps (anti-stampede)...\n');
  }

  const allResults = [];

  for (const pair of pairsToScan) {
    if (!JSON_OUT) process.stdout.write(`  ${pair.label.padEnd(22)}`);
    for (const venue of venuesToScan) {
      const results = await scanVenueForPair(rpc, venue, pair, blockNumber);
      allResults.push(...results);
    }
    if (!JSON_OUT) {
      const kept = allResults.filter(r => r.pair === pair.label && r.status === 'keep').length;
      console.log(`→ ${kept} pool(s) found`);
    }
    await sleep(300); // inter-pair pause
  }

  if (JSON_OUT) {
    const kept = allResults.filter(r => r.status === 'keep');
    process.stdout.write(JSON.stringify({
      generatedAt  : nowIso(),
      chain        : 'arbitrum',
      blockNumber,
      pairsScanned : pairsToScan.map(p => p.label),
      venuesScanned: venuesToScan.map(v => v.venue),
      totalProbed  : allResults.length,
      totalKept    : kept.length,
      results      : allResults,
    }, null, 2));
  } else {
    printResults(allResults);
  }
}

main().catch(err => {
  console.error(`[discovery] FATAL: ${err.message}`);
  process.exit(1);
});
