'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — ARB/USDC Pool Discovery  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/arb_usdc_pool_discovery.js
//  STATUS:     CURRENT — Surface Discovery phase (Boss directive 2026-03-27)
//
//  PURPOSE
//  ───────
//  Discover direct ARB / native USDC pools on Arbitrum across a small explicit
//  set of venues. Answers one question:
//    "What direct ARB/native-USDC pools exist, and are they live enough to test?"
//
//  DOES NOT:
//    - modify fetchers or configs
//    - simulate trades or rank spreads
//    - scan all pairs
//    - write any files
//
//  REQUIRED ENV VARS (add to .env if you want to override hardcoded fallbacks)
//
//  UniSwap V3 — hardcoded fallback already correct, env var optional:
//    ARB_UNISWAP_V3_FACTORY   = 0x1F98431c8aD98523631AE4a59f267346ea31F984
//
//  SushiSwap V3 — hardcoded fallback confirmed via Arbiscan label (2026-03-28), env var optional:
//    ARB_SUSHISWAP_V3_FACTORY = 0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e
//    Status: skip_venue_unresolved — factory exists (4 txns) but all getPool() calls fail.
//    Requires on-chain pool trace to confirm. Do not mark as dead yet.
//
//  Ramses V2 CL — confirmed via IRamsesV2Factory source on Arbiscan (2026-03-28):
//    ARB_RAMSES_V2_FACTORY    = 0xa67f82621540017a679153423CA0B8a1b4518B49
//    getPool(tokenA, tokenB, fee) ABI confirmed — compatible with v3_factory type.
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/arb_usdc_pool_discovery.js
//  node -r dotenv/config scripts/tools/arb_usdc_pool_discovery.js --json
//  node -r dotenv/config scripts/tools/arb_usdc_pool_discovery.js --verbose
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CHAIN = 'arbitrum';

const TOKENS = {
  ARB: {
    symbol  : 'ARB',
    address : '0x912CE59144191C1204E64559FE8253a0e49E6548',
    decimals: 18,
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

// Normalised lowercase for comparison
const ADDR = {
  ARB         : TOKENS.ARB.address.toLowerCase(),
  USDC_NATIVE : TOKENS.USDC_NATIVE.address.toLowerCase(),
  USDCE       : TOKENS.USDCE.address.toLowerCase(),
};

const FEE_TIERS = [100, 500, 3000, 10000];

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

// ─── VENUE REGISTRY ───────────────────────────────────────────────────────────
// Factory addresses sourced from canonical Arbitrum deployments.
// Env vars take precedence — hardcoded fallbacks are the known canonical addresses.
// If env var AND hardcoded fallback are both missing, venue is skipped cleanly.

const VENUES = [
  {
    venue  : 'uniswap_v3',
    type   : 'v3_factory',
    // Canonical UniV3 factory on Arbitrum — confirmed in repo and Uniswap docs
    factory: process.env.ARB_UNISWAP_V3_FACTORY   || '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    slotFn : 'slot0',   // 'slot0' | 'globalState'
  },
  {
    venue  : 'sushiswap_v3',
    type   : 'v3_factory',
    // SushiSwap V3 factory on Arbitrum — confirmed via Arbiscan label "SushiSwap V3: Factory"
    // Previous address ended in ...231b (typo) → caused RPC exhausted. Correct: ...231e
    factory: process.env.ARB_SUSHISWAP_V3_FACTORY || '0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e',
    slotFn : 'slot0',
  },
  {
    venue  : 'ramses_v2',
    type   : 'v3_factory',
    // Ramses V2 CL factory on Arbitrum.
    // Address confirmed via Arbiscan (2026-03-28): IRamsesV2Factory source shows
    // getPool(tokenA, tokenB, fee) — same ABI as UniV3 factory. Compatible.
    // Ramses CL pools use slot0(), NOT globalState() (that is Algebra/Camelot V3).
    // Env var takes precedence if set; canonical fallback used otherwise.
    factory: process.env.ARB_RAMSES_V2_FACTORY    || '0xa67f82621540017a679153423CA0B8a1b4518B49',
    slotFn : 'slot0',
  },
];

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
];

const POOL_ABI_BASE = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
  'function liquidity() view returns (uint128)',
];

// slot0 — standard UniV3
const SLOT0_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
];

// globalState — Algebra (Ramses, Camelot V3)
const GLOBAL_STATE_ABI = [
  'function globalState() view returns (uint160 price, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normaliseAddr(addr) {
  return typeof addr === 'string' ? addr.toLowerCase() : '';
}

function classifyToken(addr) {
  const a = normaliseAddr(addr);
  if (a === ADDR.ARB)          return 'ARB';
  if (a === ADDR.USDC_NATIVE)  return 'USDC_NATIVE';
  if (a === ADDR.USDCE)        return 'USDCE';
  return 'UNKNOWN';
}

function feePct(feeTier) {
  return (feeTier / 10_000).toFixed(4) + '%';
}

// ─── POOL INSPECTOR ───────────────────────────────────────────────────────────

async function inspectPool(rpc, venue, poolAddress, feeTierQueried, blockNumber, verbose) {
  const label = `${venue.venue}.${poolAddress.slice(0, 10)}.fee${feeTierQueried}`;

  const base = {
    venue        : venue.venue,
    poolAddress,
    feeTierQueried,
    blockNumber,
  };

  // Read token0, token1, on-chain fee, liquidity in one call
  let t0, t1, onChainFee, liquidityRaw;
  try {
    const { result } = await rpc.callDetailed(
      `disc.base.${label}`,
      async (provider) => {
        const pool = new ethers.Contract(poolAddress, POOL_ABI_BASE, provider);
        const [_t0, _t1, _fee, _liq] = await Promise.all([
          pool.token0({ blockTag: blockNumber }),
          pool.token1({ blockTag: blockNumber }),
          pool.fee({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { t0: _t0, t1: _t1, fee: _fee, liq: _liq };
      },
      { timeoutMs: 4000, hedge: true }
    );
    t0           = result.t0;
    t1           = result.t1;
    onChainFee   = Number(result.fee);
    liquidityRaw = result.liq.toString();
  } catch (e) {
    return {
      ...base,
      status      : 'skip_query_error',
      rejectReason: `base_read_failed: ${e.message.slice(0, 100)}`,
    };
  }

  // Classify tokens
  const tok0 = classifyToken(t0);
  const tok1 = classifyToken(t1);

  // Check for USDC.e — reject immediately, separate bucket
  if (tok0 === 'USDCE' || tok1 === 'USDCE') {
    return {
      ...base,
      token0: t0, token1: t1,
      token0Symbol: tok0, token1Symbol: tok1,
      onChainFee, liquidityRaw,
      status      : 'reject_wrong_usdc_variant',
      rejectReason: 'usdc_e_not_native',
    };
  }

  // Verify direct ARB / native USDC pair
  const isDirectPair = (tok0 === 'ARB' && tok1 === 'USDC_NATIVE') ||
                       (tok0 === 'USDC_NATIVE' && tok1 === 'ARB');

  if (!isDirectPair) {
    return {
      ...base,
      token0: t0, token1: t1,
      token0Symbol: tok0, token1Symbol: tok1,
      onChainFee, liquidityRaw,
      status      : 'reject_token_mismatch',
      rejectReason: `unexpected_pair: ${tok0}/${tok1}`,
    };
  }

  // Check liquidity
  const hasLiquidity = BigInt(liquidityRaw) > 0n;
  if (!hasLiquidity) {
    return {
      ...base,
      token0: t0, token1: t1,
      token0Symbol: tok0, token1Symbol: tok1,
      tokenMatch  : 'direct_native_usdc',
      onChainFee, liquidityRaw,
      status      : 'reject_zero_liquidity',
      rejectReason: 'liquidity_is_zero',
    };
  }

  // Read price state (slot0 or globalState)
  let sqrtPriceX96 = null, tick = null;
  try {
    const priceAbi = venue.slotFn === 'globalState' ? GLOBAL_STATE_ABI : SLOT0_ABI;
    const { result: priceResult } = await rpc.callDetailed(
      `disc.price.${label}`,
      async (provider) => {
        const pool = new ethers.Contract(poolAddress, priceAbi, provider);
        return venue.slotFn === 'globalState'
          ? pool.globalState({ blockTag: blockNumber })
          : pool.slot0({ blockTag: blockNumber });
      },
      { timeoutMs: 3000, hedge: true }
    );
    sqrtPriceX96 = priceResult[0].toString();
    tick         = Number(priceResult[1]);
  } catch (e) {
    if (verbose) console.warn(`  [disc] price read failed for ${label}: ${e.message.slice(0, 80)}`);
    // Price read failure is non-fatal — pool still keeps if liquidity present
  }

  // Compute indicative price (token1/token0 in decimal-adjusted terms)
  let indicativePrice = null;
  if (sqrtPriceX96) {
    try {
      const sqrtP = Number(sqrtPriceX96) / (2 ** 96);
      // Normalise by decimals: price of token0 in token1
      const dec0 = tok0 === 'ARB' ? 18 : 6;
      const dec1 = tok0 === 'ARB' ? 6  : 18;
      const raw  = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
      indicativePrice = tok0 === 'ARB' ? raw : 1 / raw;  // always ARB price in USDC
    } catch {}
  }

  return {
    venue        : venue.venue,
    poolAddress,
    token0       : t0,
    token1       : t1,
    token0Symbol : tok0,
    token1Symbol : tok1,
    tokenMatch   : 'direct_native_usdc',
    feeTierQueried,
    onChainFee,
    feePct       : feePct(onChainFee),
    liquidityRaw,
    hasLiquidity : true,
    sqrtPriceX96,
    tick,
    indicativePrice: indicativePrice != null ? +indicativePrice.toFixed(6) : null,
    blockNumber,
    status       : 'keep',
    rejectReason : null,
  };
}

// ─── VENUE SCANNER ────────────────────────────────────────────────────────────

async function scanVenue(rpc, venue, blockNumber, verbose) {
  const results = { kept: [], rejected: [], skipped: [] };

  // Skip if factory address missing
  if (!venue.factory) {
    const rec = {
      venue      : venue.venue,
      status     : 'skip_missing_factory',
      rejectReason: `env var not set and no canonical fallback for ${venue.venue}`,
    };
    results.skipped.push(rec);
    if (verbose) console.log(`  [disc] skipped ${venue.venue}: no factory address`);
    return results;
  }

  if (verbose) console.log(`  [disc] scanning ${venue.venue}  factory=${venue.factory.slice(0, 12)}...`);

  // Track factory errors across all fee tiers for this venue.
  // If ALL fee tiers fail with the same error class, we emit skip_venue_unresolved
  // instead of individual skip_query_error per tier — per Boss ruling 2026-03-28.
  const factoryErrors = [];

  // Probe each fee tier — serial with sleep (anti-stampede, per project rules)
  for (const feeTier of FEE_TIERS) {
    await sleep(200);  // 200ms between factory calls

    let poolAddress;
    try {
      const { result } = await rpc.callDetailed(
        `disc.factory.${venue.venue}.${feeTier}`,
        async (provider) => {
          const factory = new ethers.Contract(venue.factory, FACTORY_ABI, provider);
          return factory.getPool(TOKENS.ARB.address, TOKENS.USDC_NATIVE.address, feeTier, { blockTag: blockNumber });
        },
        { timeoutMs: 4000, hedge: false }
      );
      poolAddress = result;
    } catch (e) {
      factoryErrors.push({ feeTier, error: e.message.slice(0, 100) });
      if (verbose) console.log(`  [disc]   ${venue.venue} fee=${feeTier} → factory error: ${e.message.slice(0, 60)}`);
      continue;
    }

    // Zero address = pool doesn't exist for this fee tier
    if (!poolAddress || poolAddress === ZERO_ADDR) {
      const rec = {
        venue         : venue.venue,
        feeTierQueried: feeTier,
        status        : 'reject_zero_address',
        rejectReason  : 'pool_not_deployed_for_fee_tier',
      };
      results.rejected.push(rec);
      if (verbose) console.log(`  [disc]   ${venue.venue} fee=${feeTier} → no pool`);
      continue;
    }

    if (verbose) console.log(`  [disc]   ${venue.venue} fee=${feeTier} → pool=${poolAddress} — inspecting...`);

    await sleep(300);  // pause before pool inspection calls

    const inspection = await inspectPool(rpc, venue, poolAddress, feeTier, blockNumber, verbose);

    if (inspection.status === 'keep') {
      results.kept.push(inspection);
      if (verbose) console.log(`  [disc]   ✓ KEEP  depth=${BigInt(inspection.liquidityRaw).toLocaleString()}  price~$${inspection.indicativePrice}`);
    } else {
      results.rejected.push(inspection);
      if (verbose) console.log(`  [disc]   ✗ ${inspection.status}  reason=${inspection.rejectReason}`);
    }
  }

  // Post-loop: if ALL fee tiers for this venue failed with factory errors and we got
  // zero kept/rejected results, classify as skip_venue_unresolved (Boss ruling 2026-03-28).
  // Rationale: all-fail could mean wrong factory, uninitialised factory, or no ARB/USDC CL
  // pool — these are distinct conclusions that require on-chain pool tracing to disambiguate.
  if (factoryErrors.length === FEE_TIERS.length &&
      results.kept.length === 0 &&
      results.rejected.length === 0) {
    results.skipped.push({
      venue        : venue.venue,
      status       : 'skip_venue_unresolved',
      rejectReason : `all ${FEE_TIERS.length} fee-tier factory calls failed — factory may exist but be uninitialised, ` +
                     `or no ARB/USDC CL pool deployed — requires on-chain pool trace to confirm`,
      factoryErrors: factoryErrors.map(e => `fee=${e.feeTier}: ${e.error.slice(0, 60)}`),
    });
    if (verbose) console.log(`  [disc]   ${venue.venue} → skip_venue_unresolved (all ${FEE_TIERS.length} tiers failed)`);
  }

  return results;
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(output) {
  const W    = 110;
  const LINE = '─'.repeat(W);
  const DBLE = '═'.repeat(W);

  console.log('\n' + DBLE);
  console.log(` ALLMIGHT — ARB/USDC POOL DISCOVERY`);
  console.log(` Chain: ${output.chain}  |  Block: ${output.blockNumber}  |  ${output.ts}`);
  console.log(` Venues checked: ${output.venuesChecked}  |  Kept: ${output.kept.length}  |  Rejected: ${output.rejected.length}  |  Skipped: ${output.skipped.length}`);
  console.log(LINE);

  if (output.kept.length === 0) {
    console.log(' No direct ARB/native-USDC pools found with live liquidity.');
  } else {
    console.log(' KEPT POOLS (candidates for fetcher admission):');
    console.log(LINE);
    console.log(
      ' VENUE           POOL ADDRESS                               FEE       PRICE~    LIQUIDITY_RAW         MATCH'
    );
    console.log(LINE);
    for (const p of output.kept) {
      console.log(
        ` ${p.venue.padEnd(16)} ${p.poolAddress.padEnd(44)} ` +
        `${p.feePct.padStart(8)}  ` +
        `$${String(p.indicativePrice ?? '—').padStart(8)}  ` +
        `${p.liquidityRaw.padStart(22)}  ` +
        `${p.tokenMatch}`
      );
    }
  }

  if (output.rejected.length > 0) {
    console.log(LINE);
    console.log(' REJECTED:');
    const rejGroups = {};
    for (const r of output.rejected) {
      const key = r.status;
      if (!rejGroups[key]) rejGroups[key] = 0;
      rejGroups[key]++;
    }
    for (const [status, count] of Object.entries(rejGroups)) {
      console.log(`   ${status}: ${count}`);
    }
  }

  if (output.skipped.length > 0) {
    console.log(LINE);
    console.log(' SKIPPED:');
    for (const s of output.skipped) {
      console.log(`   ${s.venue}  ${s.status}  — ${s.rejectReason}`);
    }
  }

  if (output.kept.length > 0) {
    console.log(LINE);
    console.log(' NEXT STEPS:');
    console.log(' 1. Report shortlist to Boss');
    console.log(' 2. Await Boss ruling on which pool to admit into arbitrumFetcher.js');
    console.log(' 3. Add chosen pool with TOKEN-ORDER-GUARD (see VALIDATION_PIPELINE.md step 2)');
    console.log(' 4. Run full 8-step validation sequence before classifying surface');
  }

  console.log(DBLE + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const useJson    = process.argv.includes('--json');
  const useVerbose = process.argv.includes('--verbose');

  const rpc = createProvider(CHAIN);

  // Anchor block
  const { blockNumber } = await rpc.getBlockNumber('disc.block', { timeoutMs: 2000, hedge: true });

  if (useVerbose) console.log(`[disc] block ${blockNumber}  pair: ARB/native-USDC  venues: ${VENUES.length}`);

  const output = {
    ts           : nowIso(),
    chain        : CHAIN,
    pair         : 'ARB/USDC',
    blockNumber,
    venuesChecked: VENUES.length,
    kept         : [],
    rejected     : [],
    skipped      : [],
  };

  // Scan venues serially — no stampede
  for (const venue of VENUES) {
    const results = await scanVenue(rpc, venue, blockNumber, useVerbose);
    output.kept.push(...results.kept);
    output.rejected.push(...results.rejected);
    output.skipped.push(...results.skipped);
    await sleep(400);  // pause between venues
  }

  // Deterministic sort: venue asc, fee asc, poolAddress asc
  output.kept.sort((a, b) => {
    if (a.venue !== b.venue)       return a.venue.localeCompare(b.venue);
    if (a.onChainFee !== b.onChainFee) return a.onChainFee - b.onChainFee;
    return a.poolAddress.localeCompare(b.poolAddress);
  });

  output.rejected.sort((a, b) =>
    (a.venue || '').localeCompare(b.venue || '') ||
    (a.feeTierQueried || 0) - (b.feeTierQueried || 0)
  );

  if (useJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  printReport(output);
}

main().catch(err => {
  console.error('[disc] FATAL:', err.message || err);
  process.exit(1);
});
