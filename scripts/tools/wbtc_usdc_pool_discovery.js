'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — WBTC/USDC Pool Discovery  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/wbtc_usdc_pool_discovery.js
//  STATUS:     CURRENT — Surface pivot (Boss directive 2026-03-28)
//
//  PURPOSE
//  ───────
//  Discover direct WBTC / native USDC pools on Arbitrum across known venues.
//  Same architecture as arb_usdc_pool_discovery.js — token pair swapped.
//
//  DOES NOT modify fetchers, write configs, or simulate trades.
//
//  REQUIRED ENV VARS (same as ARB/USDC discovery — already set)
//    ARB_UNISWAP_V3_FACTORY   = 0x1F98431c8aD98523631AE4a59f267346ea31F984
//    ARB_SUSHISWAP_V3_FACTORY = 0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e  (unresolved)
//    ARB_RAMSES_V2_FACTORY    = 0xa67f82621540017a679153423CA0B8a1b4518B49  (unresolved)
//    ARB_CAMELOT_V3_FACTORY   = 0x1a3c9B1d2F92C84F37C2dE53AE52d6Ff8E5a0E6  (Algebra poolByPair)
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/wbtc_usdc_pool_discovery.js
//  node -r dotenv/config scripts/tools/wbtc_usdc_pool_discovery.js --json
//  node -r dotenv/config scripts/tools/wbtc_usdc_pool_discovery.js --verbose
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CHAIN = 'arbitrum';

const TOKENS = {
  WBTC: {
    symbol  : 'WBTC',
    address : '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    decimals: 8,
  },
  USDC_NATIVE: {
    symbol  : 'USDC',
    address : '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
  },
  USDCE: {
    symbol  : 'USDCe',
    address : '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    decimals: 6,
  },
};

const ADDR = {
  WBTC        : TOKENS.WBTC.address.toLowerCase(),
  USDC_NATIVE : TOKENS.USDC_NATIVE.address.toLowerCase(),
  USDCE       : TOKENS.USDCE.address.toLowerCase(),
};

// Standard V3 fee tiers
const FEE_TIERS = [100, 500, 3000, 10000];

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ─── VENUE REGISTRY ───────────────────────────────────────────────────────────

const VENUES = [
  {
    venue  : 'uniswap_v3',
    type   : 'v3_factory',
    factory: process.env.ARB_UNISWAP_V3_FACTORY   || '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    slotFn : 'slot0',
  },
  {
    venue  : 'camelot_v3',
    type   : 'algebra_factory',
    // Camelot V3 (Algebra) — uses poolByPair(tokenA, tokenB) not getPool(A,B,fee)
    // Factory confirmed: https://arbiscan.io/address/0x1a3c9B1d2F92C84F37C2dE53AE52d6Ff8E5a0E6
    // Fee is dynamic per pool via globalState()[2] not constructor
    factory: process.env.ARB_CAMELOT_V3_FACTORY   || '0x1a3c9B1d2F92C84F37C2dE53AE52d6Ff8E5a0E6',
    slotFn : 'globalState',  // Algebra: globalState() not slot0()
  },
  {
    venue  : 'sushiswap_v3',
    type   : 'v3_factory',
    factory: process.env.ARB_SUSHISWAP_V3_FACTORY || '0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e',
    slotFn : 'slot0',
    // Status: skip_venue_unresolved from ARB/USDC run — may behave differently for WBTC
  },
  {
    venue  : 'ramses_v2',
    type   : 'v3_factory',
    factory: process.env.ARB_RAMSES_V2_FACTORY    || '0xa67f82621540017a679153423CA0B8a1b4518B49',
    slotFn : 'slot0',
    // Status: skip_venue_unresolved from ARB/USDC run
  },
];

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const V3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];

// Algebra (Camelot V3) — single pool per pair, no fee parameter
const ALGEBRA_FACTORY_ABI = [
  'function poolByPair(address tokenA, address tokenB) view returns (address pool)',
];

const POOL_ABI_BASE = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
];

const POOL_FEE_ABI = [
  'function fee() view returns (uint24)',
];

const SLOT0_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];

const GLOBAL_STATE_ABI = [
  'function globalState() view returns (uint160 price, int24 tick, uint16 feeZto, uint16, uint8, uint8, bool)',
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso()              { return new Date().toISOString(); }
function sleep(ms)             { return new Promise(r => setTimeout(r, ms)); }
function normalise(addr)       { return typeof addr === 'string' ? addr.toLowerCase() : ''; }

function classifyToken(addr) {
  const a = normalise(addr);
  if (a === ADDR.WBTC)         return 'WBTC';
  if (a === ADDR.USDC_NATIVE)  return 'USDC_NATIVE';
  if (a === ADDR.USDCE)        return 'USDCE';
  return 'UNKNOWN';
}

function feePct(feeTier) {
  return (feeTier / 10_000).toFixed(4) + '%';
}

function activeTickUsd(liquidityRaw, sqrtPriceX96str, dec0, dec1) {
  // depth in token1 (USDC) terms: L × sqrtP / 10^dec1 × 2
  // sqrtP = sqrtPriceX96 / 2^96, price is token1/token0
  const L     = Number(liquidityRaw);
  const sqrtP = Number(sqrtPriceX96str) / (2 ** 96);
  const raw   = (L * sqrtP / Math.pow(10, dec1)) * 2;
  return raw;
}

// ─── POOL INSPECTOR ───────────────────────────────────────────────────────────

async function inspectPool(rpc, venue, poolAddress, feeTierOverride, blockNumber, verbose) {
  const label = `${venue.venue}.${poolAddress.slice(0, 10)}`;
  const base  = { venue: venue.venue, poolAddress, blockNumber };

  // Base reads: token0, token1, liquidity
  let t0, t1, liquidityRaw;
  try {
    const { result } = await rpc.callDetailed(
      `disc.base.${label}`,
      async (provider) => {
        const pool = new ethers.Contract(poolAddress, POOL_ABI_BASE, provider);
        const [_t0, _t1, _liq] = await Promise.all([
          pool.token0({ blockTag: blockNumber }),
          pool.token1({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { t0: _t0, t1: _t1, liq: _liq };
      },
      { timeoutMs: 5000 }
    );
    t0           = result.t0;
    t1           = result.t1;
    liquidityRaw = result.liq.toString();
  } catch (e) {
    return { ...base, feeTierQueried: feeTierOverride, status: 'skip_query_error',
             rejectReason: `base_read: ${e.message.slice(0, 80)}` };
  }

  const tok0 = classifyToken(t0);
  const tok1 = classifyToken(t1);

  if (tok0 === 'USDCE' || tok1 === 'USDCE') {
    return { ...base, feeTierQueried: feeTierOverride, token0: t0, token1: t1,
             token0Symbol: tok0, token1Symbol: tok1, liquidityRaw,
             status: 'reject_wrong_usdc_variant', rejectReason: 'usdc_e_not_native' };
  }

  const isDirectPair = (tok0 === 'WBTC' && tok1 === 'USDC_NATIVE') ||
                       (tok0 === 'USDC_NATIVE' && tok1 === 'WBTC');
  if (!isDirectPair) {
    return { ...base, feeTierQueried: feeTierOverride, token0: t0, token1: t1,
             token0Symbol: tok0, token1Symbol: tok1, liquidityRaw,
             status: 'reject_token_mismatch', rejectReason: `pair: ${tok0}/${tok1}` };
  }

  if (BigInt(liquidityRaw) === 0n) {
    return { ...base, feeTierQueried: feeTierOverride, token0: t0, token1: t1,
             token0Symbol: tok0, token1Symbol: tok1, tokenMatch: 'direct_native_usdc',
             liquidityRaw, status: 'reject_zero_liquidity', rejectReason: 'liquidity_is_zero' };
  }

  // Fee read — on-chain (Algebra has no `fee()` view; use override)
  let onChainFee = feeTierOverride;
  if (venue.type === 'v3_factory') {
    try {
      const { result } = await rpc.callDetailed(`disc.fee.${label}`,
        async (p) => new ethers.Contract(poolAddress, POOL_FEE_ABI, p).fee({ blockTag: blockNumber }),
        { timeoutMs: 3000 });
      onChainFee = Number(result);
    } catch { /* use override */ }
  }

  // Price state
  let sqrtPriceX96 = null, tick = null, dynamicFee = null;
  try {
    const priceAbi = venue.slotFn === 'globalState' ? GLOBAL_STATE_ABI : SLOT0_ABI;
    const { result } = await rpc.callDetailed(`disc.price.${label}`,
      async (p) => {
        const c = new ethers.Contract(poolAddress, priceAbi, p);
        return venue.slotFn === 'globalState'
          ? c.globalState({ blockTag: blockNumber })
          : c.slot0({ blockTag: blockNumber });
      },
      { timeoutMs: 3000 });
    sqrtPriceX96 = result[0].toString();
    tick         = Number(result[1]);
    if (venue.slotFn === 'globalState') dynamicFee = Number(result[2]);
  } catch (e) {
    if (verbose) console.warn(`  [disc] price read failed ${label}: ${e.message.slice(0, 60)}`);
  }

  // Use dynamic fee for Algebra if available
  if (venue.type === 'algebra_factory' && dynamicFee != null) onChainFee = dynamicFee;

  // Indicative price (WBTC in USDC terms)
  let indicativePrice = null, depthUsd = null;
  if (sqrtPriceX96) {
    try {
      const sqrtP = Number(sqrtPriceX96) / (2 ** 96);
      const dec0  = tok0 === 'WBTC' ? 8 : 6;
      const dec1  = tok0 === 'WBTC' ? 6 : 8;
      const raw   = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
      indicativePrice = tok0 === 'WBTC' ? raw : 1 / raw;  // always WBTC in USDC
      depthUsd = activeTickUsd(liquidityRaw, sqrtPriceX96, dec0, dec1);
      if (tok0 !== 'WBTC') depthUsd = activeTickUsd(liquidityRaw, sqrtPriceX96, 6, 8);
    } catch {}
  }

  return {
    venue        : venue.venue,
    poolAddress,
    token0       : t0, token1: t1,
    token0Symbol : tok0, token1Symbol: tok1,
    tokenMatch   : 'direct_native_usdc',
    feeTierQueried: feeTierOverride,
    onChainFee,
    feePct       : feePct(onChainFee),
    liquidityRaw,
    hasLiquidity : true,
    sqrtPriceX96, tick,
    indicativePrice: indicativePrice != null ? +indicativePrice.toFixed(2) : null,
    depthUsd       : depthUsd != null ? +depthUsd.toFixed(2) : null,
    blockNumber,
    status       : 'keep',
    rejectReason : null,
  };
}

// ─── VENUE SCANNER ────────────────────────────────────────────────────────────

async function scanVenue(rpc, venue, blockNumber, verbose) {
  const results = { kept: [], rejected: [], skipped: [] };

  if (!venue.factory) {
    results.skipped.push({ venue: venue.venue, status: 'skip_missing_factory',
      rejectReason: `no factory address for ${venue.venue}` });
    return results;
  }

  if (verbose) console.log(`  [disc] ${venue.venue} type=${venue.type} factory=${venue.factory.slice(0,12)}...`);

  // ── Algebra (Camelot V3) — single pool per pair ────────────────────────────
  if (venue.type === 'algebra_factory') {
    await sleep(200);
    let poolAddress;
    try {
      const { result } = await rpc.callDetailed(
        `disc.factory.${venue.venue}`,
        async (provider) => {
          const factory = new ethers.Contract(venue.factory, ALGEBRA_FACTORY_ABI, provider);
          return factory.poolByPair(TOKENS.WBTC.address, TOKENS.USDC_NATIVE.address, { blockTag: blockNumber });
        },
        { timeoutMs: 5000 }
      );
      poolAddress = result;
    } catch (e) {
      results.skipped.push({ venue: venue.venue, status: 'skip_venue_unresolved',
        rejectReason: `poolByPair failed: ${e.message.slice(0, 80)}` });
      return results;
    }

    if (!poolAddress || poolAddress === ZERO_ADDR) {
      results.rejected.push({ venue: venue.venue, status: 'reject_zero_address',
        rejectReason: 'no pool for WBTC/USDC on this algebra factory' });
      return results;
    }

    if (verbose) console.log(`  [disc]   ${venue.venue} → pool=${poolAddress} — inspecting...`);
    await sleep(300);
    const inspection = await inspectPool(rpc, venue, poolAddress, null, blockNumber, verbose);
    inspection.status === 'keep' ? results.kept.push(inspection) : results.rejected.push(inspection);
    return results;
  }

  // ── Standard V3 factory — probe all fee tiers ─────────────────────────────
  const factoryErrors = [];

  for (const feeTier of FEE_TIERS) {
    await sleep(200);
    let poolAddress;
    try {
      const { result } = await rpc.callDetailed(
        `disc.factory.${venue.venue}.${feeTier}`,
        async (provider) => {
          const factory = new ethers.Contract(venue.factory, V3_FACTORY_ABI, provider);
          return factory.getPool(TOKENS.WBTC.address, TOKENS.USDC_NATIVE.address, feeTier, { blockTag: blockNumber });
        },
        { timeoutMs: 5000 }
      );
      poolAddress = result;
    } catch (e) {
      factoryErrors.push({ feeTier, error: e.message.slice(0, 80) });
      if (verbose) console.log(`  [disc]   ${venue.venue} fee=${feeTier} → factory error`);
      continue;
    }

    if (!poolAddress || poolAddress === ZERO_ADDR) {
      results.rejected.push({ venue: venue.venue, feeTierQueried: feeTier,
        status: 'reject_zero_address', rejectReason: 'pool_not_deployed' });
      if (verbose) console.log(`  [disc]   ${venue.venue} fee=${feeTier} → no pool`);
      continue;
    }

    if (verbose) console.log(`  [disc]   ${venue.venue} fee=${feeTier} → ${poolAddress} — inspecting...`);
    await sleep(300);
    const inspection = await inspectPool(rpc, venue, poolAddress, feeTier, blockNumber, verbose);
    inspection.status === 'keep' ? results.kept.push(inspection) : results.rejected.push(inspection);
  }

  if (factoryErrors.length === FEE_TIERS.length && !results.kept.length && !results.rejected.length) {
    results.skipped.push({ venue: venue.venue, status: 'skip_venue_unresolved',
      rejectReason: `all ${FEE_TIERS.length} fee-tier factory calls failed`,
      factoryErrors: factoryErrors.map(e => `fee=${e.feeTier}: ${e.error.slice(0, 50)}`),
    });
  }

  return results;
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function printReport(output) {
  const W = 110, LINE = '─'.repeat(W), DBLE = '═'.repeat(W);
  console.log('\n' + DBLE);
  console.log(` ALLMIGHT — WBTC/USDC POOL DISCOVERY`);
  console.log(` Chain: ${output.chain}  |  Block: ${output.blockNumber}  |  ${output.ts}`);
  console.log(` Venues: ${output.venuesChecked}  |  Kept: ${output.kept.length}  |  Rejected: ${output.rejected.length}  |  Skipped: ${output.skipped.length}`);
  console.log(LINE);

  if (output.kept.length === 0) {
    console.log(' No direct WBTC/native-USDC pools found with live liquidity.');
  } else {
    console.log(' KEPT POOLS:');
    console.log(LINE);
    console.log(' VENUE           POOL                                       FEE       PRICE~       DEPTH_USD   LIQUIDITY_RAW');
    console.log(LINE);
    for (const p of output.kept) {
      console.log(
        ` ${p.venue.padEnd(16)} ${p.poolAddress.padEnd(44)}` +
        ` ${p.feePct.padStart(8)}` +
        ` $${String(p.indicativePrice ?? '—').padStart(10)}` +
        ` $${String(p.depthUsd ?? '—').padStart(11)}` +
        `  ${p.liquidityRaw}`
      );
    }
  }

  if (output.skipped.length) {
    console.log(LINE);
    console.log(' SKIPPED:');
    for (const s of output.skipped)
      console.log(`   ${s.venue}  ${s.status}  — ${s.rejectReason?.slice(0, 80)}`);
  }
  console.log(DBLE + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const useJson    = process.argv.includes('--json');
  const useVerbose = process.argv.includes('--verbose');

  const rpc = createProvider(CHAIN);
  const { blockNumber } = await rpc.getBlockNumber('disc.block', { timeoutMs: 2000 });

  if (useVerbose) console.log(`[disc] block ${blockNumber}  pair: WBTC/native-USDC  venues: ${VENUES.length}`);

  const output = {
    ts: nowIso(), chain: CHAIN, pair: 'WBTC/USDC', blockNumber,
    venuesChecked: VENUES.length,
    kept: [], rejected: [], skipped: [],
  };

  for (const venue of VENUES) {
    const r = await scanVenue(rpc, venue, blockNumber, useVerbose);
    output.kept.push(...r.kept);
    output.rejected.push(...r.rejected);
    output.skipped.push(...r.skipped);
    await sleep(400);
  }

  // Deterministic sort: venue asc, fee asc
  output.kept.sort((a, b) =>
    a.venue.localeCompare(b.venue) || (a.onChainFee || 0) - (b.onChainFee || 0));

  if (useJson) { console.log(JSON.stringify(output, null, 2)); return; }
  printReport(output);
}

main().catch(err => {
  console.error('[disc] FATAL:', err.message || err);
  process.exit(1);
});
