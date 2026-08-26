#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Class D (Stablecoin Basis) scanner — v1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AllMight Wave 10B, commit 4.  Implements Boss C9 ruling.
 *
 * PURPOSE
 *   Identify economically exploitable divergence between assets intended to
 *   represent approximately the same unit of value (stablecoins), while
 *   distinguishing genuine basis from migration, liquidity failure, stale
 *   pricing, and broken pools.
 *
 * DESIGN CONSTRAINTS (Boss C9)
 *   1. Declarative pair fixtures (not automatic enumeration).
 *   2. Price sanity BEFORE profitability (Chronos $4757 ETH lesson).
 *   3. Persistence separate from instantaneous economics
 *      (persistenceKnown: false in v1).
 *   4. basisType enum with 6 classifications.
 *   5. Migration-sensitive flag on USDC/USDC.e; not on USDC/USDT.
 *   6. Reuse c2/c3 size ladder + constitutional block + Class B composition.
 *   7. Add Class-D-specific fields: basisType, basisBps, priceSanity,
 *      migrationSensitive, persistenceKnown, buyAsset, sellAsset,
 *      bindingVenue.
 *   8. Analytics only — executionAuthorized: false hardcoded.
 *
 * PIPELINE (Boss C9)
 *   POOL EXISTS → DEPTH > 0 → PRICE SANE? (NO → classify anomaly)
 *     → BASIS EXISTS? → FEES + SLIPPAGE + GAS → NET POSITIVE?
 *     → CAPACITY → basisType + persistenceKnown: false
 *
 * NON-GOALS FOR v1
 *   - Live per-venue price fetching (uses fixture data)
 *   - Persistence tracking (v1 emits persistenceKnown: false)
 *   - Class B financing math inside D (composition hook only)
 *   - Curve-specific slippage model (uses c2/c3 linear-in-ratio)
 *   - Multi-hop stable routes (only direct two-venue)
 *   - Automatic pair enumeration
 *
 * OUTPUT
 *   stdout: canonical JSON (schema class_d_stablecoin_basis_scan_v1)
 *   stderr: human-readable summary
 *
 * CAPITAL LOCKED. EXECUTION LOCKED. BROADCAST LOCKED.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants (reused from c2/c3 where possible)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 'class_d_stablecoin_basis_scan_v1';

const SIZE_LADDER_USD = [
  100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000,
  100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000,
];

const GAS_PER_SWAP_USD = 0.50;
const SAFETY_BUFFER_BPS = 1;
const INVENTORY_THRESHOLD_USD = 100000;
const SLIPPAGE_MODEL_COEFFICIENT = 5000;

// Sanity bands: how far from 1.0 parity is still "SANE" for stable-stable pairs
// Default bands; individual fixtures may override for tighter stable pairs.
const DEFAULT_SANITY_BOUND_BPS = 200;   // ±2% from parity = SANE
const DEFAULT_BROKEN_BOUND_BPS = 1000;  // ±10% from parity = BROKEN

// Basis-type classification thresholds
const STALE_POOL_MAX_BASIS_BPS = 2;     // < 2 bps basis on stables = likely stale
const MIGRATION_MIN_BASIS_BPS = 5;      // ≥ 5 bps basis on migration-sensitive pair
const LIQUIDITY_FAILURE_MIN_DEPTH_USD = 10000;  // depth < $10K = economically dead

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

const BASIS_TYPE = {
  TEMPORARY_BASIS:   'TEMPORARY_BASIS',
  MIGRATION_BASIS:   'MIGRATION_BASIS',
  LIQUIDITY_FAILURE: 'LIQUIDITY_FAILURE',
  STALE_POOL:        'STALE_POOL',
  BROKEN_CURVE:      'BROKEN_CURVE',
  REAL_DEPEG_RISK:   'REAL_DEPEG_RISK',
};

const PRICE_SANITY = {
  SANE:          'SANE',
  ANOMALY_DEPEG: 'ANOMALY_DEPEG',
  BROKEN:        'BROKEN',
};

const BINDING_ENUM = {
  NO_BASIS_EDGE:    'NO_BASIS_EDGE',
  VENUE_DEPTH:      'VENUE_DEPTH',
  VENUE_SLIPPAGE:   'VENUE_SLIPPAGE',
  SWAP_FEES:        'SWAP_FEES',
  GAS:              'GAS',
  POLICY_CAP:       'POLICY_CAP',
  PRICE_SANITY:     'PRICE_SANITY',    // pair rejected on sanity gate
  LIQUIDITY_DEAD:   'LIQUIDITY_DEAD',  // depth too low to trade
  TOKEN_UNSUPPORTED:'TOKEN_UNSUPPORTED',
  VENUE_UNSUPPORTED:'VENUE_UNSUPPORTED',
};

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — Boss C9 approved
// ─────────────────────────────────────────────────────────────────────────────
//
// Fixture prices are illustrative — real values must come from live per-venue
// quoter reads before any execution decision.  Venue depths are approximated
// from typical Arbitrum on-chain observations.  Pool addresses are placeholders
// unless explicitly marked otherwise.
//
// Convention: spot_price_ba = units of assetA per unit of assetB.
//   For USDC/USDT with assetA=USDC, assetB=USDT:
//     spot_price_ba = 1.0020 means 1 USDT → 1.0020 USDC (USDC cheap here)
// ─────────────────────────────────────────────────────────────────────────────

// FIXTURE #1 — clean control (no migration confounder)
const FIXTURE_USDC_USDT = {
  pairId: 'arbitrum:USDC/USDT',
  chain: 'arbitrum',
  chainId: 42161,
  assetA: {
    symbol: 'USDC',
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC on Arbitrum
    decimals: 6,
  },
  assetB: {
    symbol: 'USDT',
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT on Arbitrum
    decimals: 6,
  },
  startAsset: 'USDC',           // arbitrary v1 convention: arb starts with assetA
  migrationSensitive: false,    // pure stable-stable, no migration confounder
  sanityBoundBps:  200,
  brokenBoundBps: 1000,
  venues: [
    {
      venueId: 'univ3_100bp_usdc_usdt',
      pool_address: '0x0000000000000000000000000000000000000000',  // FIXTURE placeholder
      spot_price_ba: 1.0020,   // 1 USDT → 1.0020 USDC (USDC cheap here)
      fee_bps: 1,              // Uniswap V3 100 = 1 bp
      depth_usd: 5000000,      // FIXTURE
    },
    {
      venueId: 'curve_stables_usdc_usdt',
      pool_address: '0x0000000000000000000000000000000000000000',  // FIXTURE placeholder
      spot_price_ba: 0.9980,   // 1 USDT → 0.9980 USDC (USDT cheap here)
      fee_bps: 4,              // Curve stable pool typical
      depth_usd: 3000000,      // FIXTURE
    },
  ],
  observed_at: '2026-06-05T00:00:00Z',
  fixture_note: 'Illustrative USDC/USDT clean control. Pool addresses '
    + 'are placeholders. Live decision requires per-venue quoter reads. '
    + 'Cross-venue basis ~40 bps is realistic during volatility episodes '
    + '(e.g. USDT depeg risk, USDC banking events).',
};

// FIXTURE #2 — migration-sensitive (native USDC vs bridged USDC.e)
const FIXTURE_USDC_USDCE = {
  pairId: 'arbitrum:USDC/USDC.e',
  chain: 'arbitrum',
  chainId: 42161,
  assetA: {
    symbol: 'USDC',
    address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    decimals: 6,
  },
  assetB: {
    symbol: 'USDC.e',
    address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    decimals: 6,
  },
  startAsset: 'USDC',
  migrationSensitive: true,     // BRIDGED vs NATIVE — migration confounder
  sanityBoundBps:  200,
  brokenBoundBps: 1000,
  venues: [
    {
      venueId: 'univ3_100bp_usdc_usdce',
      pool_address: '0x0000000000000000000000000000000000000000',  // FIXTURE
      spot_price_ba: 0.9998,   // 1 USDC.e → 0.9998 USDC (small discount)
      fee_bps: 1,
      depth_usd: 5000000,      // FIXTURE
    },
    {
      venueId: 'univ3_500bp_usdc_usdce',
      pool_address: '0x0000000000000000000000000000000000000000',  // FIXTURE
      spot_price_ba: 0.9950,   // 1 USDC.e → 0.9950 USDC (larger discount)
      fee_bps: 1,              // (both venues 1 bp for clarity)
      depth_usd: 3000000,      // FIXTURE
    },
  ],
  observed_at: '2026-06-05T00:00:00Z',
  fixture_note: 'Illustrative USDC/USDC.e migration-sensitive pair. Both '
    + 'venues show USDC.e trading at a discount to native USDC — this is '
    + 'the migration confounder we called out in Wave 10A Chronos work. '
    + 'Fixture basis ~48 bps is larger than typical steady state; realistic '
    + 'during migration transitions.',
};

// ─────────────────────────────────────────────────────────────────────────────
// Sanity gate — Boss C9: "Price sanity BEFORE profitability"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a venue's observed price is within reasonable bounds for a
 * pair intended to be near-parity.
 */
function checkVenueSanity(venue, sanityBoundBps, brokenBoundBps) {
  // Deviation from parity (1.0) in bps
  const deviationBps = Math.abs(venue.spot_price_ba - 1.0) * 10000;

  if (deviationBps > brokenBoundBps) {
    return {
      sanity: PRICE_SANITY.BROKEN,
      deviationBps,
      reason: `price deviation ${deviationBps.toFixed(1)} bps exceeds broken bound ${brokenBoundBps}`,
    };
  }
  if (deviationBps > sanityBoundBps) {
    return {
      sanity: PRICE_SANITY.ANOMALY_DEPEG,
      deviationBps,
      reason: `price deviation ${deviationBps.toFixed(1)} bps exceeds sanity bound ${sanityBoundBps}`,
    };
  }
  return {
    sanity: PRICE_SANITY.SANE,
    deviationBps,
    reason: 'within sanity bound',
  };
}

/**
 * Aggregate pair-level sanity as the worst of any venue's sanity.
 * Boss C9: reject anomalies BEFORE computing profitability.
 */
function aggregatePairSanity(venueSanities) {
  if (venueSanities.some(v => v.sanity === PRICE_SANITY.BROKEN))   return PRICE_SANITY.BROKEN;
  if (venueSanities.some(v => v.sanity === PRICE_SANITY.ANOMALY_DEPEG)) return PRICE_SANITY.ANOMALY_DEPEG;
  return PRICE_SANITY.SANE;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-venue basis detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find optimal buy/sell venue pair for a basis arb.
 *
 * Convention:  spot_price_ba = units of A per unit of B.
 *   Buying assetA:  the venue with the HIGHEST spot_price_ba gives most
 *                   assetA per assetB. → cheapest assetA.
 *   Selling assetA: the venue with the LOWEST spot_price_ba gives most
 *                   assetB per assetA (i.e. 1/spot_price_ba is highest).
 *                   → most expensive assetA.
 *
 * For a two-venue basis arb starting with startAsset = assetB:
 *   Buy assetA at highest-price venue (buyVenue)
 *   Sell assetA at lowest-price venue  (sellVenue)
 *   Round-trip: B → A (buyVenue) → B (sellVenue) with more B at end.
 *
 * If startAsset = assetA, the direction reverses accordingly.
 */
function findArbDirection(pair) {
  const venues = pair.venues;
  if (venues.length < 2) {
    return { valid: false, reason: 'fewer than 2 venues' };
  }

  // Sort by spot_price_ba
  const sorted = [...venues].sort((x, y) => x.spot_price_ba - y.spot_price_ba);
  const lowVenue  = sorted[0];               // lowest A-per-B (A expensive)
  const highVenue = sorted[sorted.length - 1]; // highest A-per-B (A cheap)

  // Basis: how much price spread across venues, expressed in bps
  const basisBps = ((highVenue.spot_price_ba / lowVenue.spot_price_ba) - 1) * 10000;

  // Direction determined by startAsset
  let buyVenue, sellVenue, buyAsset, sellAsset;
  if (pair.startAsset === pair.assetB.symbol) {
    // Start with B, buy A at cheap venue (highest B-per-A price... wait, high A-per-B = low B-per-A)
    // Let me re-derive: high A-per-B means you get lots of A for each B → A is cheap in B-terms
    buyVenue  = highVenue;   // buy A cheap
    sellVenue = lowVenue;    // sell A expensive (A → B at low A-per-B = high B-per-A)
    buyAsset  = pair.assetA.symbol;
    sellAsset = pair.assetB.symbol;
  } else {
    // Start with A, buy B at cheap venue
    // B is cheap where price A-per-B is low (you spend few A to get 1 B)
    buyVenue  = lowVenue;    // buy B cheap
    sellVenue = highVenue;   // sell B expensive (B → A at high A-per-B)
    buyAsset  = pair.assetB.symbol;
    sellAsset = pair.assetA.symbol;
  }

  return {
    valid: true,
    basisBps,
    buyVenue,
    sellVenue,
    buyAsset,
    sellAsset,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Two-venue arbitrage execution model
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simulate a two-venue basis arb at a given USD trade size.
 *
 * Path:  startAsset (at buyVenue) → intermediateAsset (at sellVenue) → startAsset
 *
 * Both stables are treated as ~$1 for slippage math; the arb is measured in
 * units of the starting asset.
 */
function simulateTwoVenueArb(pair, direction, sizeUsd) {
  // Start with sizeUsd worth of startAsset.  For stables, 1 unit ~ 1 USD.
  const startAmount = sizeUsd;  // in units of startAsset (~= USD)

  // Leg 1: buyVenue swap: startAsset → intermediateAsset
  const feeMultiplier1 = 1 - (direction.buyVenue.fee_bps / 10000);
  const slippageBps1 = SLIPPAGE_MODEL_COEFFICIENT * (sizeUsd / direction.buyVenue.depth_usd);
  const slippageMult1 = Math.max(0, 1 - (slippageBps1 / 10000));

  // Rate depends on direction.  If startAsset is assetB, we're swapping B → A.
  //   output = input × spot_price_ba × (1-fee) × (1-slip)
  // If startAsset is assetA, we're swapping A → B.
  //   output = input / spot_price_ba × (1-fee) × (1-slip)
  let rate1;
  if (pair.startAsset === pair.assetB.symbol) {
    rate1 = direction.buyVenue.spot_price_ba;             // B → A
  } else {
    rate1 = 1 / direction.buyVenue.spot_price_ba;         // A → B
  }
  const intermediateAmount = startAmount * feeMultiplier1 * rate1 * slippageMult1;

  // Leg 2: sellVenue swap: intermediateAsset → startAsset (reverse)
  const feeMultiplier2 = 1 - (direction.sellVenue.fee_bps / 10000);
  // Approximate size in USD for slippage: intermediate amount ~ USD value ~ startAmount × 1
  const intermediateUsdApprox = intermediateAmount;  // stable ~ $1
  const slippageBps2 = SLIPPAGE_MODEL_COEFFICIENT * (intermediateUsdApprox / direction.sellVenue.depth_usd);
  const slippageMult2 = Math.max(0, 1 - (slippageBps2 / 10000));

  let rate2;
  if (pair.startAsset === pair.assetB.symbol) {
    // We now hold A, converting back to B
    rate2 = 1 / direction.sellVenue.spot_price_ba;        // A → B
  } else {
    // We now hold B, converting back to A
    rate2 = direction.sellVenue.spot_price_ba;            // B → A
  }
  const finalAmount = intermediateAmount * feeMultiplier2 * rate2 * slippageMult2;

  return {
    startAmount,
    intermediateAmount,
    finalAmount,
    grossReturn: finalAmount / startAmount,
    grossProfitUsd: finalAmount - startAmount,  // stable, so units ≈ USD
    leg1: {
      venue: direction.buyVenue.venueId,
      feeBps: direction.buyVenue.fee_bps,
      slippageBps: slippageBps1,
      inputAmount: startAmount,
      outputAmount: intermediateAmount,
    },
    leg2: {
      venue: direction.sellVenue.venueId,
      feeBps: direction.sellVenue.fee_bps,
      slippageBps: slippageBps2,
      inputAmount: intermediateAmount,
      outputAmount: finalAmount,
    },
  };
}

/**
 * Evaluate arb at a specific size, including gas and safety buffer.
 */
function evaluateSizeUsd(pair, direction, sizeUsd) {
  const sim = simulateTwoVenueArb(pair, direction, sizeUsd);
  const gasUsd = 2 * GAS_PER_SWAP_USD;
  const safetyBufferUsd = sizeUsd * (SAFETY_BUFFER_BPS / 10000);
  const totalCostsUsd = (sim.startAmount - sim.finalAmount) + gasUsd + safetyBufferUsd;
  const netProfitUsd = sim.grossProfitUsd - gasUsd - safetyBufferUsd;
  const roiPct = sizeUsd > 0 ? (netProfitUsd / sizeUsd) * 100 : 0;

  return {
    sizeUsd,
    grossReturn: sim.grossReturn,
    grossProfitUsd: sim.grossProfitUsd,
    gasUsd,
    safetyBufferUsd,
    totalCostsUsd,
    netProfitUsd,
    roiPct,
    profitable: netProfitUsd > 0,
    leg1: sim.leg1,
    leg2: sim.leg2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding constraint identifier
// ─────────────────────────────────────────────────────────────────────────────

function identifyBindingConstraint(pair, direction, ladder, bestByProfit) {
  if (!bestByProfit) {
    // Which leg dominated the cost at smallest size?
    const smallest = ladder[0];
    if (!smallest) {
      return { bindingConstraint: BINDING_ENUM.NO_BASIS_EDGE, bindingVenue: null };
    }
    const gasKillsSmall = smallest.gasUsd > smallest.grossProfitUsd;
    if (gasKillsSmall && smallest.grossProfitUsd > 0) {
      return { bindingConstraint: BINDING_ENUM.GAS, bindingVenue: null };
    }
    if (smallest.grossProfitUsd <= 0) {
      // basis + fees don't work at any size
      return { bindingConstraint: BINDING_ENUM.NO_BASIS_EDGE, bindingVenue: null };
    }
    // Slippage at largest size dominates — identify which venue
    const largest = ladder[ladder.length - 1];
    const worstVenue = largest.leg1.slippageBps >= largest.leg2.slippageBps
      ? direction.buyVenue.venueId
      : direction.sellVenue.venueId;
    return { bindingConstraint: BINDING_ENUM.VENUE_SLIPPAGE, bindingVenue: worstVenue };
  }

  // Profitable — what limits scaling?
  const nextUnprofitable = ladder.find(r => r.sizeUsd > bestByProfit.sizeUsd && !r.profitable);
  if (nextUnprofitable) {
    const worstVenue = nextUnprofitable.leg1.slippageBps >= nextUnprofitable.leg2.slippageBps
      ? direction.buyVenue.venueId
      : direction.sellVenue.venueId;
    return { bindingConstraint: BINDING_ENUM.VENUE_SLIPPAGE, bindingVenue: worstVenue };
  }

  // Ladder max hit while still profitable — depth caps
  const shallowVenue = direction.buyVenue.depth_usd <= direction.sellVenue.depth_usd
    ? direction.buyVenue.venueId
    : direction.sellVenue.venueId;
  return { bindingConstraint: BINDING_ENUM.VENUE_DEPTH, bindingVenue: shallowVenue };
}

// ─────────────────────────────────────────────────────────────────────────────
// basisType classifier
// ─────────────────────────────────────────────────────────────────────────────

function classifyBasisType(pair, pairSanity, basisBps, minVenueDepth) {
  // Sanity failures take precedence
  if (pairSanity === PRICE_SANITY.BROKEN) return BASIS_TYPE.BROKEN_CURVE;
  if (pairSanity === PRICE_SANITY.ANOMALY_DEPEG) return BASIS_TYPE.REAL_DEPEG_RISK;

  // Liquidity failure: depth too low to trade economically
  if (minVenueDepth < LIQUIDITY_FAILURE_MIN_DEPTH_USD) return BASIS_TYPE.LIQUIDITY_FAILURE;

  // Stale pool: negligible basis on a stable-stable pair
  if (basisBps < STALE_POOL_MAX_BASIS_BPS) return BASIS_TYPE.STALE_POOL;

  // Migration-sensitive pairs with meaningful basis
  if (pair.migrationSensitive && basisBps > MIGRATION_MIN_BASIS_BPS) {
    return BASIS_TYPE.MIGRATION_BASIS;
  }

  return BASIS_TYPE.TEMPORARY_BASIS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full pair evaluation
// ─────────────────────────────────────────────────────────────────────────────

function evaluatePair(pair) {
  // Step 1: per-venue sanity
  const venueSanities = pair.venues.map(v => ({
    venueId: v.venueId,
    ...checkVenueSanity(v, pair.sanityBoundBps || DEFAULT_SANITY_BOUND_BPS,
                            pair.brokenBoundBps || DEFAULT_BROKEN_BOUND_BPS),
  }));

  const priceSanity = aggregatePairSanity(venueSanities);

  // Step 2: find arb direction
  const direction = findArbDirection(pair);

  // Structural facts
  const poolExists = pair.venues.length >= 2 && pair.venues.every(v => v.pool_address);
  const depthsPositive = pair.venues.every(v => v.depth_usd > 0);
  const minVenueDepth = Math.min(...pair.venues.map(v => v.depth_usd));

  const basisBps = direction.valid ? direction.basisBps : 0;
  const basisType = classifyBasisType(pair, priceSanity, basisBps, minVenueDepth);

  // If sanity failed, we short-circuit: no economics run, no ladder
  const sanityGatePassed = (priceSanity === PRICE_SANITY.SANE);
  const liquidityGatePassed = minVenueDepth >= LIQUIDITY_FAILURE_MIN_DEPTH_USD;

  let ladder = [];
  let bestByProfit = null;
  let bestByRoi = null;
  let smallestProfitable = null;
  let largestProfitable = null;
  let firstFailureSizeUsd = null;
  let binding = { bindingConstraint: null, bindingVenue: null };
  let instantaneousEconomic = false;

  if (sanityGatePassed && liquidityGatePassed && direction.valid && basisBps > 0) {
    // Step 3: run size ladder
    const cutoff = minVenueDepth * 2;
    ladder = SIZE_LADDER_USD
      .filter(s => s <= cutoff)
      .map(s => evaluateSizeUsd(pair, direction, s));

    const profitable = ladder.filter(r => r.profitable);
    if (profitable.length) {
      bestByProfit = [...profitable].sort((a, b) => b.netProfitUsd - a.netProfitUsd)[0];
      bestByRoi = [...profitable].sort((a, b) => b.roiPct - a.roiPct)[0];
      smallestProfitable = [...profitable].sort((a, b) => a.sizeUsd - b.sizeUsd)[0];
      largestProfitable = [...profitable].sort((a, b) => b.sizeUsd - a.sizeUsd)[0];
      instantaneousEconomic = true;
    }

    for (let i = 0; i < ladder.length - 1; i++) {
      if (ladder[i].profitable && !ladder[i + 1].profitable) {
        firstFailureSizeUsd = ladder[i + 1].sizeUsd;
        break;
      }
    }
    if (!firstFailureSizeUsd && !profitable.length && ladder.length) {
      firstFailureSizeUsd = ladder[0].sizeUsd;
    }

    binding = identifyBindingConstraint(pair, direction, ladder, bestByProfit);
  } else {
    // Sanity/liquidity gate failed — record why
    if (!sanityGatePassed) {
      binding = { bindingConstraint: BINDING_ENUM.PRICE_SANITY, bindingVenue: null };
    } else if (!liquidityGatePassed) {
      binding = { bindingConstraint: BINDING_ENUM.LIQUIDITY_DEAD, bindingVenue: null };
    } else {
      binding = { bindingConstraint: BINDING_ENUM.NO_BASIS_EDGE, bindingVenue: null };
    }
  }

  // Opportunity class — v1 emits [D] only when instantaneously economic
  const opportunityClass = instantaneousEconomic ? ['D'] : [];

  // Inventory economic check — Class B composition hook (per Boss C9)
  let inventoryEconomic = null;
  if (bestByProfit) {
    inventoryEconomic = bestByProfit.sizeUsd <= INVENTORY_THRESHOLD_USD;
  }

  return {
    pairId: pair.pairId,
    chain: pair.chain,
    chainId: pair.chainId,
    assetA: pair.assetA.symbol,
    assetB: pair.assetB.symbol,
    startAsset: pair.startAsset,
    migrationSensitive: pair.migrationSensitive,

    // Opportunity classification
    opportunityClass,

    // Cycle-level / Boss C9 mandated fields
    basisType,
    basisBps,
    priceSanity,
    persistenceKnown: false,   // v1: no persistence data
    instantaneousEconomic,
    poolExists,
    depthsPositive,

    // Direction (only meaningful when valid)
    buyAsset:  direction.valid ? direction.buyAsset  : null,
    sellAsset: direction.valid ? direction.sellAsset : null,
    buyVenue:  direction.valid ? direction.buyVenue.venueId  : null,
    sellVenue: direction.valid ? direction.sellVenue.venueId : null,

    // Per-venue sanity trace
    venueSanities,

    // Ladder outputs
    underlyingBestByProfit: bestByProfit,
    underlyingBestByRoi:    bestByRoi,
    smallestProfitableSizeUsd: smallestProfitable ? smallestProfitable.sizeUsd : null,
    largestProfitableSizeUsd:  largestProfitable  ? largestProfitable.sizeUsd  : null,
    firstFailureSizeUsd,

    // Capacity
    weakestVenueDepthUsd: minVenueDepth,
    capacityNote: 'Conservative approximation: minimum venue USD depth. '
      + 'Real capacity requires per-leg output propagation. '
      + 'Boss C9 Wave 10B c4: v1 acceptable, explicitly marked.',

    // Binding
    bindingConstraint: binding.bindingConstraint,
    bindingVenue:      binding.bindingVenue,

    // Class B composition hint
    classBHint: {
      startAssetForFinancing: pair.startAsset,
      recommendedCapitalUsd: bestByProfit ? bestByProfit.sizeUsd : null,
      inventorySufficientForBest: inventoryEconomic,
      note: 'Class D output prepared for Class B consumption. Per Boss C9: '
        + 'Class D does NOT run Aave financing math. Router c6 composes: '
        + 'if !inventorySufficientForBest, invoke Class B; opportunityClass '
        + 'may become ["D","B"] for flash-financed stable basis.',
    },

    // Persistence: v1 does not know — Boss C9 requires this be separate
    persistenceHint: {
      persistenceKnown: false,
      note: 'v1 evaluates instantaneous economics only. Persistence '
        + 'classification (fleeting / recurring / persistent) requires '
        + 'time-series observation not implemented in c4.',
    },

    // Full ladder audit trail
    sizeLadder: ladder,

    // Constitutional
    executionAuthorized: false,
    broadcastAuthorized: false,
    capitalMovement: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output builders
// ─────────────────────────────────────────────────────────────────────────────

function buildScanOutput(pairs) {
  const evaluated = pairs.map(evaluatePair);
  const opportunityCount = evaluated.filter(p => p.opportunityClass.length > 0).length;

  return {
    $schema: SCHEMA_VERSION,
    scannedAt: new Date().toISOString(),
    chain: pairs[0] ? pairs[0].chain : 'arbitrum',
    pairCount: pairs.length,
    opportunityCount,
    constitutional: {
      capitalLocked: true,
      broadcastLocked: true,
      executionLocked: true,
      analyticsOnly: true,
      note: 'Class D is a stablecoin-basis analytics engine. '
        + 'No execution, no broadcast, no capital movement. '
        + 'Per Boss C9 Wave 10B: analytics only.',
    },
    pairs: evaluated,
  };
}

function fmt$(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  const n = Number(x);
  if (Math.abs(n) < 1)     return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1000)  return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${x.toFixed(3)}%`;
}

function fmtBps(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${x.toFixed(2)} bps`;
}

function renderHumanSummary(output) {
  const L = [];
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(' Class D (Stablecoin Basis) scanner — v1');
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(` Schema version:  ${output.$schema}`);
  L.push(` Scanned at:      ${output.scannedAt}`);
  L.push(` Chain:           ${output.chain}`);
  L.push(` Pairs:           ${output.pairCount}`);
  L.push(` Opportunities:   ${output.opportunityCount}`);
  L.push(' Constitutional state:');
  L.push(`   Capital LOCKED:   ${output.constitutional.capitalLocked}`);
  L.push(`   Broadcast LOCKED: ${output.constitutional.broadcastLocked}`);
  L.push(`   Execution LOCKED: ${output.constitutional.executionLocked}`);
  L.push(`   Analytics only:   ${output.constitutional.analyticsOnly}`);

  for (const p of output.pairs) {
    L.push('');
    L.push(` ── ${p.pairId} ──`);
    L.push(`   Opportunity class:              [${p.opportunityClass.join(', ')}]`);
    L.push(`   Migration sensitive:            ${p.migrationSensitive}`);
    L.push('   Boss C9 mandated fields:');
    L.push(`     basisType:                    ${p.basisType}`);
    L.push(`     basisBps:                     ${fmtBps(p.basisBps)}`);
    L.push(`     priceSanity:                  ${p.priceSanity}`);
    L.push(`     persistenceKnown:             ${p.persistenceKnown}`);
    L.push(`     buyAsset:                     ${p.buyAsset === null ? 'n/a' : p.buyAsset}`);
    L.push(`     sellAsset:                    ${p.sellAsset === null ? 'n/a' : p.sellAsset}`);
    L.push(`     bindingVenue:                 ${p.bindingVenue === null ? 'n/a' : p.bindingVenue}`);

    L.push('   Structural facts:');
    L.push(`     poolExists:                   ${p.poolExists}`);
    L.push(`     depthsPositive:               ${p.depthsPositive}`);
    L.push(`     instantaneousEconomic:        ${p.instantaneousEconomic}`);
    L.push(`     weakestVenueDepthUsd:         ${fmt$(p.weakestVenueDepthUsd)}`);

    L.push('   Per-venue sanity:');
    for (const vs of p.venueSanities) {
      L.push(`     ${vs.venueId}: ${vs.sanity} (${vs.deviationBps.toFixed(1)} bps from parity)`);
    }

    if (p.underlyingBestByProfit) {
      L.push('   Best by net profit:');
      L.push(`     Size:                         ${fmt$(p.underlyingBestByProfit.sizeUsd)}`);
      L.push(`     Net profit:                   ${fmt$(p.underlyingBestByProfit.netProfitUsd)}`);
      L.push(`     ROI:                          ${fmtPct(p.underlyingBestByProfit.roiPct)}`);
      L.push(`     Gross return:                 ${p.underlyingBestByProfit.grossReturn.toFixed(6)}`);
    } else {
      L.push('   Best by net profit:             none (no size profitable)');
    }

    if (p.underlyingBestByRoi) {
      L.push('   Best by ROI:');
      L.push(`     Size:                         ${fmt$(p.underlyingBestByRoi.sizeUsd)}`);
      L.push(`     ROI:                          ${fmtPct(p.underlyingBestByRoi.roiPct)}`);
      L.push(`     Net profit:                   ${fmt$(p.underlyingBestByRoi.netProfitUsd)}`);
    }

    L.push('   Ladder summary:');
    L.push(`     Smallest profitable:          ${p.smallestProfitableSizeUsd === null ? 'none' : fmt$(p.smallestProfitableSizeUsd)}`);
    L.push(`     Largest profitable:           ${p.largestProfitableSizeUsd  === null ? 'none' : fmt$(p.largestProfitableSizeUsd)}`);
    L.push(`     First failure size:           ${p.firstFailureSizeUsd === null ? 'n/a' : fmt$(p.firstFailureSizeUsd)}`);

    L.push('   Binding diagnosis:');
    L.push(`     Binding constraint:           ${p.bindingConstraint}`);
    L.push(`     Binding venue:                ${p.bindingVenue === null ? 'n/a' : p.bindingVenue}`);

    L.push('   Class B composition hint:');
    L.push(`     Start asset for financing:    ${p.classBHint.startAssetForFinancing}`);
    L.push(`     Recommended capital USD:      ${p.classBHint.recommendedCapitalUsd === null ? 'n/a' : fmt$(p.classBHint.recommendedCapitalUsd)}`);
    L.push(`     Inventory sufficient:         ${p.classBHint.inventorySufficientForBest === null ? 'n/a' : p.classBHint.inventorySufficientForBest}`);

    L.push('   Execution authorized:           false');
  }

  L.push('');
  L.push(' ── Interpretation ──');
  L.push('   Class D evaluates stablecoin cross-venue basis for atomic arb.');
  L.push('   Fixture uses illustrative venue data; live decision requires');
  L.push('   per-venue quoter reads.  persistenceKnown: false in v1.');
  L.push('');
  L.push(' Capital LOCKED. Proven winner UNTOUCHED. Broadcast LOCKED.');
  L.push(' Class D is a basis primitive. Composition with Class B happens');
  L.push(' in c6 Opportunity Router, not inside D.');
  L.push('');

  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const pairs = [FIXTURE_USDC_USDT, FIXTURE_USDC_USDCE];
  const output = buildScanOutput(pairs);

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.stderr.write(renderHumanSummary(output) + '\n');
}

main();
