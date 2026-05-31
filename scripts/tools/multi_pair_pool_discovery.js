'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Multi-Pair Pool Discovery  v2.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/multi_pair_pool_discovery.js
//  STATUS:     CHAIN-AWARE (Wave 4 Commit 2/3 — Boss directive 2026-05-30)
//
//  v2.0 CHANGES vs v1.0:
//    • Loads TOKENS, VENUES, TARGET_PAIRS from config/ (per --chain flag)
//    • Default --chain is 'arbitrum' → existing call sites produce identical output
//    • --chain base supported (Wave 4 cross-chain framework)
//    • 'aerodrome_v2' venue type recognized but SKIPPED with warning
//      (V2 discovery + probe support arrives in Commit 3)
//    • New --config-test mode: load configs, print summary, exit 0 (no RPC)
//
//  PURPOSE
//  ───────
//  Discover pools for target pairs across compatible venues on a given chain.
//  Answers one question per pair:
//    "What pools exist for this pair on <chain>, and are they live enough
//     to add to the fetcher?"
//
//  CONFIG SOURCES (all loaded at startup):
//    config/chains.json                          → chain registry + venues + factories
//    config/tokens/<chain>.json                  → token registry for selected chain
//    config/target_pairs/<chain>.json            → pair-level scan configuration
//
//  DOES NOT:
//    - modify fetchers or configs
//    - simulate trades or execute anything
//    - write any files or Redis keys
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --chain base
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --chain arbitrum --pair ETH/USDT
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --json
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --verbose
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --venue uniswap_v3
//  node -r dotenv/config scripts/tools/multi_pair_pool_discovery.js --chain base --config-test
//
//  OUTPUT
//  ──────
//  Console table of all discovered pools with status, depth, and price.
//  --json emits machine-readable array suitable for direct review.
//  Confirmed kept pools include all fields needed for fetcher config (chain-aware).
// ═══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();

const fs                 = require('fs');
const path               = require('path');
const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─── CLI ──────────────────────────────────────────────────────────────────────
const ARGS        = process.argv.slice(2);
const JSON_OUT    = ARGS.includes('--json');
const VERBOSE     = ARGS.includes('--verbose');
const CONFIG_TEST = ARGS.includes('--config-test');

function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : def;
}
const CHAIN        = String(argVal('--chain', 'arbitrum')).toLowerCase();
const FILTER_PAIR  = argVal('--pair',  null);
const FILTER_VENUE = argVal('--venue', null);

// ─── CONFIG LOADING ───────────────────────────────────────────────────────────
const REPO         = path.resolve(__dirname, '..', '..');
const CHAINS_PATH  = path.join(REPO, 'config', 'chains.json');

function loadJson(p, what) {
  if (!fs.existsSync(p)) {
    console.error(`[discovery] FATAL: ${what} file missing at ${p}`);
    process.exit(2);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error(`[discovery] FATAL: ${what} parse error (${p}): ${e.message}`);
    process.exit(2);
  }
}

const chainsConfig = loadJson(CHAINS_PATH, 'chains.json');
if (!chainsConfig.chains || !chainsConfig.chains[CHAIN]) {
  console.error(`[discovery] FATAL: unknown chain "${CHAIN}". Available: ${Object.keys(chainsConfig.chains || {}).join(', ')}`);
  process.exit(2);
}
const chainCfg = chainsConfig.chains[CHAIN];

const TOKENS_PATH  = path.join(REPO, chainCfg.tokensFile);
const tokensFile   = loadJson(TOKENS_PATH, `tokens/${CHAIN}.json`);
const TOKENS       = tokensFile.tokens;

const PAIRS_PATH   = path.join(REPO, 'config', 'target_pairs', `${CHAIN}.json`);
const pairsFile    = loadJson(PAIRS_PATH, `target_pairs/${CHAIN}.json`);

// Lowercase address map for fast classification
const ADDR_MAP = Object.fromEntries(
  Object.entries(TOKENS).map(([k, v]) => [v.address.toLowerCase(), k])
);

// Resolve TARGET_PAIRS: each entry's tokenA/tokenB names → token objects
const TARGET_PAIRS = pairsFile.pairs.map(p => {
  const a = TOKENS[p.tokenA];
  const b = TOKENS[p.tokenB];
  if (!a) throw new Error(`Pair ${p.label}: tokenA="${p.tokenA}" not in tokens/${CHAIN}.json`);
  if (!b) throw new Error(`Pair ${p.label}: tokenB="${p.tokenB}" not in tokens/${CHAIN}.json`);
  return {
    label:        p.label,
    tokenA:       a,
    tokenB:       b,
    expectedDec0: p.expectedDec0,
    expectedDec1: p.expectedDec1,
    priceMode:    p.priceMode,
    sanityMin:    p.sanityMin,
    sanityMax:    p.sanityMax,
    feeTiersOnly: p.feeTiersOnly || null,
  };
});

// Map chains.json venue types → script's internal types
const VENUE_TYPE_MAP = {
  'uniswap_v3':   { factoryType: 'v3_factory',         slotFn: 'slot0' },
  'algebra':      { factoryType: 'algebra_factory',    slotFn: 'globalState' },
  'aerodrome_v2': { factoryType: 'v2_factory',         slotFn: 'getReserves' },
  'slipstream':   { factoryType: 'slipstream_factory', slotFn: 'slot0_slipstream' },
};

// Resolve VENUES from chain config (skip null factories with verbose log)
const VENUES = [];
for (const [name, v] of Object.entries(chainCfg.venues || {})) {
  if (v.factory === null) {
    if (VERBOSE) console.log(`[discovery] SKIP ${name} — factory null (pending verification)`);
    continue;
  }
  const typeInfo = VENUE_TYPE_MAP[v.type];
  if (!typeInfo) {
    console.error(`[discovery] FATAL: unknown venue type "${v.type}" for ${CHAIN}.${name}`);
    process.exit(2);
  }
  // v2_factory (e.g. aerodrome_v2): no skip — discovery supported in Commit 3
  VENUES.push({
    venue:    name,
    type:     typeInfo.factoryType,
    factory:  v.factory,
    slotFn:   typeInfo.slotFn,
    feeTiers: (Array.isArray(v.feeTiers) && v.feeTiers[0] !== null) ? v.feeTiers : null,
  });
}

// ─── CONFIG-TEST MODE: print loaded config + exit ────────────────────────────
if (CONFIG_TEST) {
  console.log(`[discovery] CONFIG TEST — chain: ${CHAIN}`);
  console.log(`  rpcEnv:           ${chainCfg.rpcEnv}`);
  console.log(`  tokens loaded:    ${Object.keys(TOKENS).length} (${Object.keys(TOKENS).join(', ')})`);
  console.log(`  target pairs:     ${TARGET_PAIRS.length}`);
  for (const p of TARGET_PAIRS) {
    const ft = p.feeTiersOnly ? ` fee:${p.feeTiersOnly.join(',')}` : '';
    console.log(`    - ${p.label.padEnd(22)} ${p.tokenA.symbol}/${p.tokenB.symbol}${ft}`);
  }
  console.log(`  venues active:    ${VENUES.length}`);
  for (const v of VENUES) {
    const ft = v.feeTiers ? ` tiers:${v.feeTiers.join(',')}` : '';
    console.log(`    - ${v.venue.padEnd(22)} ${v.type.padEnd(18)} ${v.factory}${ft}`);
  }
  console.log(`\n[discovery] config OK; exit 0`);
  process.exit(0);
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STANDARD_FEE_TIERS = [100, 500, 3000, 10000];
const ZERO_ADDR          = '0x0000000000000000000000000000000000000000';

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
const POOL_FEE_ABI = ['function fee() view returns (uint24)'];
const SLOT0_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];
const SLIPSTREAM_SLOT0_ABI = [
  // Aerodrome Slipstream CLPool slot0 returns 6 fields (no feeProtocol).
  // Different from UniswapV3 which returns 7 fields - the Aerodrome fork
  // dropped feeProtocol. Without this ABI, ethers fails to decode the
  // response and provider_factory reports "RPC exhausted" after retries.
  // Confirmed via direct ABI test against pool 0xdbc69982... (Base mainnet).
  // See docs/lessons/dex_contract_discovery_pitfalls.md.
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, bool)',
];

const GLOBAL_STATE_ABI = [
  'function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
];
const V2_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) view returns (address pool)',
];

const SLIPSTREAM_FACTORY_ABI = [
  // Aerodrome Slipstream CLFactory: getPool(A, B, int24 tickSpacing).
  // CRITICAL: REVERTS (not returns 0x0) when pool not deployed at the requested
  // tickSpacing - different from UniV3. The slipstream_factory branch in
  // scanVenueForPair catches and classifies the revert as informational.
  // See docs/lessons/dex_contract_discovery_pitfalls.md.
  'function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address pool)',
];
const V2_POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)',
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

  // Reject bridged/deprecated tokens (USDCE on arbitrum, USDbC on base when native USDC exists)
  if (tok0Symbol === 'USDCE' || tok1Symbol === 'USDCE') {
    return { poolAddress, tok0Symbol, tok1Symbol, status: 'reject_bridged_usdce', rejectReason: 'USDCe not native — prefer native USDC' };
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
    const priceAbi = venue.slotFn === 'globalState' ? GLOBAL_STATE_ABI
                  : venue.slotFn === 'slot0_slipstream' ? SLIPSTREAM_SLOT0_ABI
                  : SLOT0_ABI;
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
    chain        : CHAIN,
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
    // Fields ready for fetcher config (present on keep)
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

// ─── V2 POOL PROBE (constant-product / Aerodrome V2) ─────────────────────────
async function probeV2Pool(rpc, venue, poolAddress, pair, stable, blockNumber) {
  const label = `disc.${venue.venue}.${poolAddress.slice(0, 10)}.v2`;

  // Read token0, token1, getReserves
  let t0, t1, r0Raw, r1Raw;
  try {
    const { result } = await rpc.callDetailed(
      `${label}.base`,
      async (p) => {
        const pool = new ethers.Contract(poolAddress, V2_POOL_ABI, p);
        const [_t0, _t1, _res] = await Promise.all([
          pool.token0({ blockTag: blockNumber }),
          pool.token1({ blockTag: blockNumber }),
          pool.getReserves({ blockTag: blockNumber }),
        ]);
        return { t0: _t0, t1: _t1, reserves: _res };
      },
      { timeoutMs: 4000, hedge: true }
    );
    t0    = result.t0;
    t1    = result.t1;
    r0Raw = result.reserves[0].toString();
    r1Raw = result.reserves[1].toString();
  } catch (e) {
    return { chain: CHAIN, venue: venue.venue, pair: pair.label, status: 'skip_base_read_error',
      stable, rejectReason: e.message.slice(0, 100) };
  }

  const tok0Symbol = classifyToken(t0);
  const tok1Symbol = classifyToken(t1);

  // Verify the pool actually contains our target tokens
  const expectedA = lower(pair.tokenA.address);
  const expectedB = lower(pair.tokenB.address);
  const actual0   = lower(t0);
  const actual1   = lower(t1);
  const validPair = (actual0 === expectedA && actual1 === expectedB) ||
                    (actual0 === expectedB && actual1 === expectedA);

  if (!validPair) {
    return {
      chain: CHAIN, venue: venue.venue, pair: pair.label, poolAddress, tok0Symbol, tok1Symbol, stable,
      status: 'reject_token_mismatch',
      rejectReason: `expected ${pair.tokenA.symbol}/${pair.tokenB.symbol}, got ${tok0Symbol}/${tok1Symbol}`,
    };
  }

  if (BigInt(r0Raw) === 0n || BigInt(r1Raw) === 0n) {
    return { chain: CHAIN, venue: venue.venue, pair: pair.label, poolAddress, tok0Symbol, tok1Symbol, stable,
      status: 'reject_zero_liquidity', reserve0Raw: r0Raw, reserve1Raw: r1Raw };
  }

  // Decimal-aware reserves (math lifted from baseFetcher.js — battle-tested)
  const t0Info = TOKENS[tok0Symbol];
  const t1Info = TOKENS[tok1Symbol];
  if (!t0Info || !t1Info) {
    return { chain: CHAIN, venue: venue.venue, pair: pair.label, poolAddress, tok0Symbol, tok1Symbol, stable,
      status: 'reject_unknown_decimals', rejectReason: 'token not in registry' };
  }

  const PREC = 1000000000n;
  const SCALE0 = BigInt('1' + '0'.repeat(t0Info.decimals));
  const SCALE1 = BigInt('1' + '0'.repeat(t1Info.decimals));
  const adj0 = Number((BigInt(r0Raw) * PREC) / SCALE0) / 1e9;
  const adj1 = Number((BigInt(r1Raw) * PREC) / SCALE1) / 1e9;
  const rawPrice = adj1 / adj0;
  const price = pair.priceMode === 'invert' ? 1 / rawPrice : rawPrice;

  // Executable depth in USD:
  //   volatile: 2 × USD-leg reserve (assumes token1 ≈ USD)
  //   stable:   r0 + r1 (both legs ≈ $1)
  const reservesUsd = stable ? (adj0 + adj1) : (adj1 * 2);

  // Sanity check price
  let sanityPassed = true;
  if (price && pair.sanityMin && pair.sanityMax) {
    sanityPassed = price >= pair.sanityMin && price <= pair.sanityMax;
  }

  return {
    chain          : CHAIN,
    venue          : venue.venue,
    pair           : pair.label,
    poolAddress,
    token0         : t0,
    token1         : t1,
    tok0Symbol,
    tok1Symbol,
    type           : 'aerodrome_v2',
    stable,
    feeTierQueried : stable ? 'stable' : 'volatile',
    onChainFee     : null,
    feePct         : 'v2',
    liquidityRaw   : null,    // V2 has no concentrated liquidity concept
    reserve0Raw    : r0Raw,
    reserve1Raw    : r1Raw,
    reserve0Token  : +adj0.toFixed(6),
    reserve1Token  : +adj1.toFixed(2),
    priceHuman     : +price.toFixed(6),
    approxDepthUSD : +reservesUsd.toFixed(2),
    depthSemantic  : 'v2_reserves_usd',
    sanityPassed,
    blockNumber,
    status         : sanityPassed ? 'keep' : 'warn_sanity_fail',
    rejectReason   : sanityPassed ? null : `price ${price?.toFixed(4)} outside [${pair.sanityMin}, ${pair.sanityMax}]`,
    fetcherConfig  : null,    // V2 fetcher config differs from V3; hand-wired if/when needed
  };
}

// ─── VENUE SCANNER ────────────────────────────────────────────────────────────
async function scanVenueForPair(rpc, venue, pair, blockNumber) {
  const results = [];

  if (!venue.factory) {
    if (VERBOSE) console.log(`  [disc] SKIP ${venue.venue} — no factory (set env var)`);
    results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, status: 'skip_missing_factory',
      rejectReason: `${venue.venue.toUpperCase()}_FACTORY env var not set` });
    return results;
  }

  const feeTiers = pair.feeTiersOnly
    ? pair.feeTiersOnly
    : venue.type === 'algebra_factory' ? [null]
    : venue.feeTiers                   ? venue.feeTiers   // per-venue override (e.g. Ramses non-standard tiers)
    : STANDARD_FEE_TIERS;

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
        results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: 'dynamic',
          status: 'skip_factory_error', rejectReason: e.message.slice(0, 100) });
        if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} → factory error: ${e.message.slice(0, 60)}`);
        continue;
      }
      if (!poolAddress || poolAddress === ZERO_ADDR) {
        results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: 'dynamic',
          status: 'reject_zero_address', rejectReason: 'pool_not_deployed' });
        if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} → no pool`);
        continue;
      }
      await sleep(100);
      const result = await probePool(rpc, venue, poolAddress, pair, 'dynamic', blockNumber);
      results.push(result);
      continue;
    }

    // ── V2 factory (Aerodrome): getPool(A, B, stable) — scan both volatile + stable ──
    if (venue.type === 'v2_factory') {
      // Iterate stable=false (volatile) then stable=true.
      // feeTier is meaningless for V2; we still loop the outer feeTier list once.
      for (const stable of [false, true]) {
        await sleep(150);
        let poolAddress;
        try {
          const { result } = await rpc.callDetailed(
            `disc.${venue.venue}.factory.${pair.label}.${stable ? 'stable' : 'volatile'}`,
            async (p) => {
              const factory = new ethers.Contract(venue.factory, V2_FACTORY_ABI, p);
              return factory.getPool(pair.tokenA.address, pair.tokenB.address, stable, { blockTag: blockNumber });
            },
            { timeoutMs: 4000, hedge: false }
          );
          poolAddress = result;
        } catch (e) {
          results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: stable ? 'stable' : 'volatile',
            status: 'skip_factory_error', rejectReason: e.message.slice(0, 100) });
          if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} ${stable ? 'stable' : 'volatile'} → factory error`);
          continue;
        }
        if (!poolAddress || poolAddress === ZERO_ADDR) {
          if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} ${stable ? 'stable' : 'volatile'} → no pool`);
          results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: stable ? 'stable' : 'volatile',
            status: 'reject_zero_address', rejectReason: 'pool_not_deployed' });
          continue;
        }
        await sleep(100);
        const result = await probeV2Pool(rpc, venue, poolAddress, pair, stable, blockNumber);
        results.push(result);
      }
      // V2 loop covers both stable variants; break out of the fee-tier outer loop
      // (V2 doesn't iterate fee tiers — they're not a thing for constant-product).
      break;
    }

    // ── Slipstream factory (Aerodrome CL): getPool(A, B, int24 tickSpacing) ──
    //   Slipstream uses tickSpacing (NOT fee tier) as the pool discriminator.
    //   feeTiers in chains.json semantically holds tickSpacings for this venue.
    //   CRITICAL: factory REVERTS for non-existent pools - we catch and classify
    //   as reject_no_pool_at_tickspacing (informational, not factory error).
    //   Pools themselves are V3-style (slot0, liquidity, fee) so probePool's
    //   standard V3 path applies after lookup.
    //   See docs/lessons/dex_contract_discovery_pitfalls.md.
    if (venue.type === 'slipstream_factory') {
      let poolAddress;
      try {
        const { result } = await rpc.callDetailed(
          `disc.${venue.venue}.factory.${pair.label}.${feeTier}`,
          async (p) => {
            const factory = new ethers.Contract(venue.factory, SLIPSTREAM_FACTORY_ABI, p);
            return factory.getPool(pair.tokenA.address, pair.tokenB.address, feeTier, { blockTag: blockNumber });
          },
          { timeoutMs: 4000, hedge: false }
        );
        poolAddress = result;
      } catch (e) {
        // Slipstream reverts when no pool exists at this tickSpacing - informational, not factory error.
        results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: feeTier,
          status: 'reject_no_pool_at_tickspacing', rejectReason: 'slipstream factory reverts when pool not deployed at this tickSpacing' });
        if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} ts=${feeTier} -> no pool (factory revert)`);
        continue;
      }
      if (!poolAddress || poolAddress === ZERO_ADDR) {
        results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: feeTier,
          status: 'reject_zero_address', rejectReason: 'pool_not_deployed_for_tick_spacing' });
        if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} ts=${feeTier} -> no pool (zero addr)`);
        continue;
      }
      await sleep(100);
      const result = await probePool(rpc, venue, poolAddress, pair, feeTier, blockNumber);
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
      results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: feeTier,
        status: 'skip_factory_error', rejectReason: e.message.slice(0, 100) });
      if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} fee=${feeTier} → factory error`);
      continue;
    }
    if (!poolAddress || poolAddress === ZERO_ADDR) {
      if (VERBOSE) console.log(`  [disc] ${venue.venue} ${pair.label} fee=${feeTier} → no pool`);
      results.push({ chain: CHAIN, venue: venue.venue, pair: pair.label, feeTierQueried: feeTier,
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
  const chainLabel = CHAIN.charAt(0).toUpperCase() + CHAIN.slice(1);

  console.log('\n' + '═'.repeat(W));
  console.log(` AllMight — Multi-Pair Pool Discovery v2.0  |  ${chainLabel}`);
  console.log(' ' + nowIso());
  console.log('═'.repeat(W));
  console.log(' FOUND POOLS:');
  console.log('-'.repeat(W));
  console.log(
    ' pair'.padEnd(22) +
    'venue'.padEnd(22) +
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
      `${(r.venue || '').padEnd(22)}` +
      `${(r.feePct || r.feeTierQueried || '?').toString().padEnd(8)}` +
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
    console.log(`\n FETCHER CONFIGS (ready to add to ${CHAIN}Fetcher.js):\n`);
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
    console.log(' NEXT: verify depth > $5k, then add to appropriate pool array in the chain fetcher');
    console.log(' THEN: rerun master-fetcher → ranker → evaluator to confirm new surfaces');
  }
  console.log('═'.repeat(W) + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const rpc = createProvider(CHAIN);

  // Block anchor for same-block reads
  let blockNumber;
  try {
    const b = await rpc.getBlockNumber('disc.block', { timeoutMs: 3000, hedge: true });
    blockNumber = b.blockNumber;
    if (VERBOSE) console.log(`[discovery] chain=${CHAIN} block=${blockNumber}`);
  } catch (e) {
    console.error(`[discovery] FATAL: cannot get block on ${CHAIN}: ${e.message}`);
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
    console.log(`\n[discovery] chain=${CHAIN}  pairs=${pairsToScan.length}  venues=${venuesToScan.length}  block=${blockNumber}`);
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
    await sleep(300);
  }

  if (JSON_OUT) {
    const kept = allResults.filter(r => r.status === 'keep');
    process.stdout.write(JSON.stringify({
      generatedAt  : nowIso(),
      chain        : CHAIN,
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
