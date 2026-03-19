// scripts/analysis/breakeven_engine.js
// BREAKEVEN ENGINE v1
//
// Purpose: given a candidate surface's observed characteristics,
// classify it and identify the dominant blocker.
//
// Design principles:
//   1. Same-block spread is the only valid input. Cross-session spreads are rejected.
//   2. Active-tick depth is the only valid liquidity input. Total TVL is noise.
//   3. Blockers are evaluated in priority order: fee → liquidity → slippage → spread.
//   4. Classifications are conservative — a surface must clear ALL tests to advance.
//
// Key lessons encoded from field validation (2026-03-19):
//   - Total TVL reported by GeckoTerminal != active-tick execution depth
//   - Single-read spreads are unreliable; same-block persistence is required
//   - Active-tick depth = L × sqrtP (not pool balance)
//   - Cross-session price comparisons produce false gaps 5-14x larger than reality
//   - UniV3 ARB/USDC had $3,090 active-tick depth despite $2M+ TVL
//
// Usage:
//   const { classify } = require('./scripts/analysis/breakeven_engine');
//   const result = classify(surface);

'use strict';

// ── Classification constants ───────────────────────────────────────────────────

const CLASSIFICATIONS = {
  MONITORED:               'monitored',
  BLOCKED_FEE:             'blocked_fee',
  BLOCKED_LIQUIDITY:       'blocked_liquidity',
  BLOCKED_SLIPPAGE:        'blocked_slippage',
  CANDIDATE_SMALL_SIZE:    'candidate_small_size',
  CANDIDATE:               'candidate',
  PRE_EXECUTION_CANDIDATE: 'pre_execution_candidate',
};

// ── Thresholds ─────────────────────────────────────────────────────────────────
// These encode project field experience. Adjustable as more data accumulates.

const THRESHOLDS = {
  // Minimum active-tick depth (USD) per venue to consider execution viable.
  // Derived from: $100 trade on $3,090 depth = 6.5% impact = unusable.
  // A venue needs at least 2× the largest test notional in active-tick depth.
  MIN_ACTIVE_TICK_DEPTH_USD: 10_000,

  // Minimum same-block sample count for spread to be treated as persistent.
  MIN_VALID_SAMPLES: 5,

  // Minimum fraction of samples where spread > fee burden for surface
  // to be considered non-fee-blocked.
  FEE_POSITIVE_FRACTION_THRESHOLD: 0.50,

  // Minimum net spread (after fees) for CANDIDATE classification.
  // Below this is MONITORED even if occasionally fee-positive.
  MIN_AVG_NET_FOR_CANDIDATE: 0.0001,   // 0.01%

  // Minimum net spread for PRE_EXECUTION classification.
  MIN_AVG_NET_FOR_PRE_EXECUTION: 0.0010,  // 0.10%

  // Safety margin multiplier: recommended notional is max_pass × this.
  SAFE_NOTIONAL_MARGIN: 0.60,

  // Minimum viable notional for CANDIDATE (vs CANDIDATE_SMALL_SIZE).
  MIN_CANDIDATE_NOTIONAL: 250,

  // Maximum acceptable slippage at the smallest test notional.
  // If impact at $100 exceeds this, the surface is liquidity-blocked.
  MAX_SMALL_NOTIONAL_IMPACT: 0.05,   // 5%
};

// ── Input schema documentation ─────────────────────────────────────────────────
//
// surface = {
//   id:               string      — unique identifier, e.g. 'ARB/USDC:univ3-camelotv3'
//   pair:             string      — e.g. 'ARB/USDC'
//   venueA:           string      — buy venue label
//   venueB:           string      — sell venue label
//   routeType:        string      — 'direct-direct' | 'direct-synthetic' | 'synthetic-synthetic'
//
//   // Spread observations (MUST be same-block)
//   spreadSamples:    number[]    — array of gross spread % per sample (fractional, e.g. 0.00072)
//   feeAFrac:         number      — venue A fee, fractional (e.g. 0.0005 = 0.05%)
//   feeBFrac:         number      — venue B fee, fractional (e.g. 0.000249)
//   hopCount:         number      — total hops (2 for direct-direct, 3 for direct-synthetic)
//
//   // Liquidity (active-tick, NOT total TVL)
//   activeTick: {
//     venueA_usd:     number      — virtual USDC reserves at current tick for venue A
//     venueB_usd:     number      — virtual USDC reserves at current tick for venue B
//   }
//
//   // Slippage model results (optional — from arb_slippage_model.js output)
//   slippageByNotional: [         — array ordered by ascending notional
//     {
//       notional:     number,     — USD
//       impactFrac:   number,     — total fractional price impact (both legs)
//       netEdge:      number,     — gross_spread - fees - impact (fractional)
//       pass:         boolean,
//     }
//   ] | null,
//
//   // Direction consistency
//   directionConsistency: number  — fraction of samples with consistent direction (0.0–1.0)
//
//   // Metadata
//   validatedAt:      string      — ISO date of same-block validation
//   notes:            string      — optional
// }

// ── Core classification function ───────────────────────────────────────────────

function classify(surface) {
  const errors = validateInput(surface);
  if (errors.length > 0) {
    return {
      id:             surface.id || 'unknown',
      classification: 'input_error',
      blocker:        'invalid_input',
      blockerDetail:  errors.join('; '),
      viable:         false,
      maxPassNotional: null,
      safeNotionalBand: null,
      recommendedAction: 'Fix input schema errors before classifying',
      metrics: null,
    };
  }

  const metrics = computeMetrics(surface);
  const { blocker, blockerDetail } = identifyBlocker(surface, metrics);
  const classification = computeClassification(surface, metrics, blocker);
  const { maxPassNotional, safeNotionalBand } = extractNotionalBounds(surface);
  const recommendedAction = buildAction(classification, blocker, metrics, maxPassNotional);

  return {
    id:               surface.id,
    pair:             surface.pair,
    venueA:           surface.venueA,
    venueB:           surface.venueB,
    routeType:        surface.routeType,
    classification,
    viable:           isViable(classification),
    blocker,
    blockerDetail,
    maxPassNotional,
    safeNotionalBand,
    metrics,
    recommendedAction,
    validatedAt:      surface.validatedAt,
    activeTick:       surface.activeTick,
    directionConsistency: surface.directionConsistency,
    slippageByNotional:   surface.slippageByNotional || null,
  };
}

// ── Input validation ───────────────────────────────────────────────────────────

function validateInput(s) {
  const errs = [];
  if (!s.id)            errs.push('missing id');
  if (!s.pair)          errs.push('missing pair');
  if (!Array.isArray(s.spreadSamples) || s.spreadSamples.length === 0)
                        errs.push('spreadSamples must be non-empty array');
  if (typeof s.feeAFrac !== 'number' || s.feeAFrac < 0)
                        errs.push('invalid feeAFrac');
  if (typeof s.feeBFrac !== 'number' || s.feeBFrac < 0)
                        errs.push('invalid feeBFrac');
  if (!s.activeTick || typeof s.activeTick.venueA_usd !== 'number')
                        errs.push('missing activeTick.venueA_usd');
  if (!s.activeTick || typeof s.activeTick.venueB_usd !== 'number')
                        errs.push('missing activeTick.venueB_usd');
  if (typeof s.directionConsistency !== 'number')
                        errs.push('missing directionConsistency');
  return errs;
}

// ── Metrics computation ────────────────────────────────────────────────────────

function computeMetrics(s) {
  const roundTrip    = s.feeAFrac + s.feeBFrac;
  const spreads      = s.spreadSamples;
  const n            = spreads.length;
  const avgSpread    = spreads.reduce((a,b) => a+b, 0) / n;
  const minSpread    = Math.min(...spreads);
  const maxSpread    = Math.max(...spreads);
  const stdDev       = n >= 2
    ? Math.sqrt(spreads.reduce((s2,v) => s2 + (v - avgSpread) ** 2, 0) / (n - 1))
    : null;

  const netSpreads   = spreads.map(sp => sp - roundTrip);
  const avgNet       = netSpreads.reduce((a,b) => a+b, 0) / n;
  const feePosSamples = netSpreads.filter(n2 => n2 > 0).length;
  const feePosRate   = feePosSamples / n;

  const minActiveTick = Math.min(s.activeTick.venueA_usd, s.activeTick.venueB_usd);

  return {
    roundTrip,
    avgSpread,
    minSpread,
    maxSpread,
    stdDev,
    avgNet,
    feePosSamples,
    feePosRate,
    sampleCount:    n,
    sufficientSamples: n >= THRESHOLDS.MIN_VALID_SAMPLES,
    minActiveTick,
    spreadCv: stdDev !== null && avgSpread > 0 ? stdDev / avgSpread : null,  // coefficient of variation
  };
}

// ── Blocker identification (priority order) ────────────────────────────────────
//
// Evaluation order matters:
//   1. Fee check first — if avg spread < fee burden, nothing else matters
//   2. Liquidity check — if active-tick depth is structurally inadequate
//   3. Slippage check — if model says all notionals fail even with adequate depth
//   4. Spread persistence — if spread is real but inconsistent
//   5. No blocker — surface is viable at some size

function identifyBlocker(surface, metrics) {
  // 1. Fee blocked — avg spread below round-trip fee
  if (metrics.avgSpread < metrics.roundTrip && metrics.feePosRate < THRESHOLDS.FEE_POSITIVE_FRACTION_THRESHOLD) {
    return {
      blocker: 'blocked_fee',
      blockerDetail:
        `Avg spread ${pctStr(metrics.avgSpread)} < round-trip fee ${pctStr(metrics.roundTrip)}. ` +
        `Fee-positive in only ${Math.round(metrics.feePosRate * 100)}% of samples. ` +
        `Need avg spread >${pctStr(metrics.roundTrip)} to be fee-viable.`,
    };
  }

  // 2. Liquidity blocked — active-tick depth too thin for minimum viable trade
  const minDepth = metrics.minActiveTick;
  if (minDepth < THRESHOLDS.MIN_ACTIVE_TICK_DEPTH_USD) {
    const limitingVenue = surface.activeTick.venueA_usd < surface.activeTick.venueB_usd
      ? surface.venueA : surface.venueB;
    return {
      blocker: 'blocked_liquidity',
      blockerDetail:
        `Active-tick depth on ${limitingVenue}: ${usdStr(minDepth)}. ` +
        `Minimum required: ${usdStr(THRESHOLDS.MIN_ACTIVE_TICK_DEPTH_USD)}. ` +
        `Total TVL is not execution liquidity — active-tick depth is what matters. ` +
        `Pool may have adequate TVL spread across many ticks but thin depth at current price.`,
    };
  }

  // 3. Slippage blocked — model ran but all notionals failed
  if (surface.slippageByNotional && surface.slippageByNotional.length > 0) {
    const passing = surface.slippageByNotional.filter(r => r.pass);
    if (passing.length === 0) {
      const smallestNotional = surface.slippageByNotional[0];
      return {
        blocker: 'blocked_slippage',
        blockerDetail:
          `Slippage model: 0/${surface.slippageByNotional.length} notionals pass. ` +
          `Smallest tested ($${smallestNotional.notional}) impact: ${pctStr(smallestNotional.impactFrac)}. ` +
          `Net edge at smallest notional: ${pctStr(smallestNotional.netEdge)}. ` +
          `Surface may still become viable if active-tick depth increases.`,
      };
    }
  }

  // 4. Spread too inconsistent — coefficient of variation too high
  if (metrics.spreadCv !== null && metrics.spreadCv > 1.0 && metrics.avgNet < 0) {
    return {
      blocker: 'blocked_inconsistent_spread',
      blockerDetail:
        `Spread CV=${metrics.spreadCv.toFixed(2)} (stddev/mean > 1.0). ` +
        `Spread is too noisy to classify as persistent signal. ` +
        `Need more samples during stable market conditions.`,
    };
  }

  // No blocker
  return { blocker: 'none', blockerDetail: null };
}

// ── Classification ─────────────────────────────────────────────────────────────

function computeClassification(surface, metrics, blocker) {
  // Any blocker → return the blocker classification directly
  if (blocker === 'blocked_fee')       return CLASSIFICATIONS.BLOCKED_FEE;
  if (blocker === 'blocked_liquidity') return CLASSIFICATIONS.BLOCKED_LIQUIDITY;
  if (blocker === 'blocked_slippage')  return CLASSIFICATIONS.BLOCKED_SLIPPAGE;

  // No structural blocker — evaluate quality
  if (!metrics.sufficientSamples || metrics.avgNet < THRESHOLDS.MIN_AVG_NET_FOR_CANDIDATE) {
    return CLASSIFICATIONS.MONITORED;
  }

  // Slippage model available — use it for notional-based classification
  if (surface.slippageByNotional && surface.slippageByNotional.length > 0) {
    const passing = surface.slippageByNotional.filter(r => r.pass);
    const maxPass = passing.length > 0 ? passing[passing.length - 1].notional : 0;

    if (maxPass === 0) return CLASSIFICATIONS.MONITORED;

    if (metrics.avgNet >= THRESHOLDS.MIN_AVG_NET_FOR_PRE_EXECUTION && maxPass >= 500) {
      return CLASSIFICATIONS.PRE_EXECUTION_CANDIDATE;
    }
    if (maxPass >= THRESHOLDS.MIN_CANDIDATE_NOTIONAL) {
      return CLASSIFICATIONS.CANDIDATE;
    }
    return CLASSIFICATIONS.CANDIDATE_SMALL_SIZE;
  }

  // No slippage model yet — classify on spread quality alone
  if (metrics.avgNet >= THRESHOLDS.MIN_AVG_NET_FOR_PRE_EXECUTION && metrics.feePosRate >= 0.8) {
    return CLASSIFICATIONS.PRE_EXECUTION_CANDIDATE;
  }
  if (metrics.avgNet >= THRESHOLDS.MIN_AVG_NET_FOR_CANDIDATE && metrics.feePosRate >= 0.5) {
    return CLASSIFICATIONS.CANDIDATE;
  }
  return CLASSIFICATIONS.MONITORED;
}

// ── Notional bounds ────────────────────────────────────────────────────────────

function extractNotionalBounds(surface) {
  if (!surface.slippageByNotional || surface.slippageByNotional.length === 0) {
    return { maxPassNotional: null, safeNotionalBand: null };
  }
  const passing = surface.slippageByNotional.filter(r => r.pass);
  if (passing.length === 0) return { maxPassNotional: null, safeNotionalBand: null };

  const maxPass = passing[passing.length - 1].notional;
  const safeLow  = Math.round(maxPass * THRESHOLDS.SAFE_NOTIONAL_MARGIN * 0.5);
  const safeHigh = Math.round(maxPass * THRESHOLDS.SAFE_NOTIONAL_MARGIN);
  return {
    maxPassNotional: maxPass,
    safeNotionalBand: { low: safeLow, high: safeHigh },
  };
}

// ── Recommended action ─────────────────────────────────────────────────────────

function buildAction(classification, blocker, metrics, maxPassNotional) {
  switch (classification) {
    case CLASSIFICATIONS.BLOCKED_FEE:
      return `Monitor for spread widening above ${pctStr(metrics.roundTrip)}. ` +
             `Consider lower-fee venue alternatives.`;
    case CLASSIFICATIONS.BLOCKED_LIQUIDITY:
      return `Monitor for LPs re-concentrating positions at current price tick. ` +
             `Check active-tick depth weekly, not total TVL. ` +
             `Do not use this venue as execution target until depth exceeds $${THRESHOLDS.MIN_ACTIVE_TICK_DEPTH_USD.toLocaleString()}.`;
    case CLASSIFICATIONS.BLOCKED_SLIPPAGE:
      return `Re-run slippage model when spread widens or active-tick depth increases. ` +
             `Not currently viable at any tested notional.`;
    case CLASSIFICATIONS.MONITORED:
      return `Continue same-block monitoring. Flag if avg net spread exceeds ${pctStr(THRESHOLDS.MIN_AVG_NET_FOR_CANDIDATE)} for 5+ consecutive samples.`;
    case CLASSIFICATIONS.CANDIDATE_SMALL_SIZE:
      return `Run slippage model at micro notionals ($10–$100). ` +
             `Validate gas cost as % of P&L at small size. ` +
             `Max pass: $${maxPassNotional}.`;
    case CLASSIFICATIONS.CANDIDATE:
      return `Run full slippage model. Validate gas overhead. ` +
             `Design atomic execution path. Max viable: $${maxPassNotional}.`;
    case CLASSIFICATIONS.PRE_EXECUTION_CANDIDATE:
      return `PRIORITY: Design execution path. Model gas overhead. ` +
             `Run paper simulation before live execution. ` +
             `Safe test band: $${maxPassNotional ? Math.round(maxPassNotional * 0.3) : 'tbd'}–$${maxPassNotional ? Math.round(maxPassNotional * 0.6) : 'tbd'}.`;
    default:
      return 'Classify surface before determining action.';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isViable(classification) {
  return [
    CLASSIFICATIONS.CANDIDATE_SMALL_SIZE,
    CLASSIFICATIONS.CANDIDATE,
    CLASSIFICATIONS.PRE_EXECUTION_CANDIDATE,
  ].includes(classification);
}

function pctStr(f)  { return (f * 100).toFixed(4) + '%'; }
function usdStr(n)  { return '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

// ── Multi-surface batch classifier ────────────────────────────────────────────

function classifyAll(surfaces) {
  return surfaces.map(classify);
}

// ── Exports ────────────────────────────────────────────────────────────────────

module.exports = {
  classify,
  classifyAll,
  CLASSIFICATIONS,
  THRESHOLDS,
};
