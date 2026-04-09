'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Volatility / Divergence Engine  v1.0  (Wave 2)
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/analysis/volatility_divergence_engine.js
//  STATUS    : NEW — Boss directive 2026-04-09 (Wave 2 timing intelligence)
//
//  PURPOSE
//  ─────────
//  Pure-computation heat model for surface prioritization.
//  No I/O. No Redis. No RPC. No execution logic.
//
//  INPUT
//  ─────
//  Each surface snapshot uses the monitor's existing surface format (spreadPct,
//  spreadVelocity, spreadStd, historyDepth, depthA, depthB). Raw per-venue
//  prices are consumed when available; the engine degrades cleanly when absent.
//
//  OUTPUT (per surface)
//  ─────────────────────
//  {
//    surfaceId          : string,
//    heatScore          : number  [0,1],
//    heatClass          : 'COLD'|'WARM'|'HOT'|'EXTREME',
//    heatRank           : number  (1 = hottest),
//    velocityScore      : number  [0,1],
//    divergenceScore    : number  [0,1],
//    spreadExpansionScore: number  [0,1],
//    instabilityScore   : number  [0,1],
//    depthChangeScore   : number  [0,1],
//    _depthChangeMissing: boolean | undefined,
//    _priorMissing      : boolean | undefined,
//  }
//
//  PIPELINE POSITION
//  ─────────────────
//  FETCHERS → REDIS → SCANNER → TIMESERIES → [this module] → ACTIVATOR
//
//  Heat is PRIORITY CONTEXT only.
//  Heat does NOT unlock execution. Heat does NOT bypass existing gates.
//
//  RULES (immutable)
//  ──────────────────
//  • No execution logic
//  • No contract calls
//  • No ML / prediction
//  • No TA indicators
//  • No architecture changes
//  • Deterministic output — stable sort, explicit tie-break
//  • Per-surface fault isolation — one bad surface cannot break the batch
// ═══════════════════════════════════════════════════════════════════════════════

// ─── HEAT WEIGHTS ─────────────────────────────────────────────────────────────
// Starting defaults (Boss-approved 2026-04-09). Keep centralized — do not
// inline these values elsewhere. Future calibration changes only this object.

const HEAT_WEIGHTS = Object.freeze({
  // Boss correction 2026-04-09: divergence weight reduced 0.25→0.15.
  // When only spreadPct is available, divergenceScore ≈ spreadScore (duplicate).
  // Weight shifted to velocity (spread acceleration) and spreadExpansion
  // to better represent PRE-formation dynamics, not already-formed spread.
  velocity        : 0.30,   // was 0.25 — spread acceleration proxy
  divergence      : 0.15,   // was 0.25 — raw price separation (overlaps spread)
  spreadExpansion : 0.25,   // was 0.20 — formation dynamics
  instability     : 0.15,   // unchanged
  depthChange     : 0.15,   // unchanged
});

// ─── HEAT CLASS THRESHOLDS ────────────────────────────────────────────────────
// Ordered high → low. classifyHeat() walks this table.

const HEAT_CLASSES = Object.freeze([
  { label: 'EXTREME', min: 0.75 },
  { label: 'HOT',     min: 0.50 },
  { label: 'WARM',    min: 0.20 },
  { label: 'COLD',    min: 0.00 },
]);

// ─── NORMALIZATION REFERENCES ─────────────────────────────────────────────────
// Calibrated from observed Arbitrum surface data (ETH/USDC, ETH/USDT, ARB/USDC).
// These are NOT hard floors — they are scaling references. Values above the
// reference saturate to 1.0 (clamped). Values of 0 score 0.0.

const NORM = Object.freeze({
  // spreadVelocity is change in spreadPct (%) over last 3 samples.
  // 0.05% change across 3 scans = aggressive expansion → full score.
  VELOCITY_REF_PCT       : 0.05,

  // spreadPct in % → converted to bps internally.
  // 30 bps (0.30%) cross-venue divergence = extreme → full score.
  DIVERGENCE_REF_BPS     : 30,

  // Δspread = current.spreadPct − prior.spreadPct (%).
  // 0.05% widening in one interval = strong expansion → full positive.
  EXPANSION_REF_PCT      : 0.05,

  // spreadStd = standard deviation of recent spread samples (%).
  // 0.03% std = unstable market → full instability score.
  INSTABILITY_REF_STD    : 0.03,

  // Δdepth / prior_depth (fraction). 0.30 = 30% depth change → full score.
  DEPTH_CHANGE_REF_FRAC  : 0.30,
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Clamp x to [0, 1]. Used on every raw score before compositing.
 * @param {number} x
 * @returns {number}
 */
function clamp01(x) {
  if (!isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Round to 4 decimal places for stable output.
 * @param {number} x
 * @returns {number}
 */
function r4(x) {
  return isFinite(x) ? +x.toFixed(4) : 0;
}

// ─── SCORE FUNCTIONS ──────────────────────────────────────────────────────────

/**
 * Validate and normalize a surface observation into a stable internal shape.
 * Returns null if the surface is structurally invalid (missing surfaceId or
 * negative/non-finite spreadPct). All callers must check for null.
 *
 * @param {object} s  Raw surface record from monitor log or Redis scan.
 * @returns {object|null}
 */
function normalizeSurfaceObservation(s) {
  if (!s || typeof s.surfaceId !== 'string' || !s.surfaceId) return null;

  const spreadPct = Number(s.spreadPct);
  if (!isFinite(spreadPct) || spreadPct < 0) return null;

  return {
    surfaceId       : s.surfaceId,
    pair            : String(s.pair  || 'unknown'),
    venueA          : String(s.venueA || 'unknown'),
    venueB          : String(s.venueB || 'unknown'),
    spreadPct,                                           // % (e.g. 0.15 = 15 bps)
    spreadVelocity  : isFinite(Number(s.spreadVelocity)) ? Number(s.spreadVelocity) : 0,
    spreadStd       : (s.spreadStd != null && isFinite(Number(s.spreadStd)))
                        ? Number(s.spreadStd) : null,
    depthA          : (s.depthA != null && isFinite(Number(s.depthA)) && Number(s.depthA) >= 0)
                        ? Number(s.depthA) : null,
    depthB          : (s.depthB != null && isFinite(Number(s.depthB)) && Number(s.depthB) >= 0)
                        ? Number(s.depthB) : null,
    historyDepth    : Number(s.historyDepth) || 0,
    ts              : s.ts || s.scanTs || null,
  };
}

/**
 * Velocity score — spread acceleration proxy.
 *
 * IMPORTANT: This measures SPREAD CHANGE RATE, not raw per-venue price velocity.
 * It is a spread acceleration proxy — useful for detecting spread that is
 * expanding or contracting quickly. It does NOT directly measure price motion
 * entering an LP range. That distinction matters: a spread can widen fast while
 * underlying price barely moves (venue A lags). Do not misread this as market
 * speed in the traditional TA sense.
 *
 * Source: spreadVelocity (Δspread across last 3 monitor samples) or Δspread
 * between explicit current/prior records. Absolute value: both expansion AND
 * compression signal rapid spread dynamics.
 * Normalized by NORM.VELOCITY_REF_PCT.
 *
 * @param {object} cur  Normalized current snapshot.
 * @param {object|null} prior  Normalized prior snapshot (may be null).
 * @returns {{ velocityScore: number, _priorMissing?: boolean }}
 */
function computeVelocityScore(cur, prior) {
  if (!prior) {
    // spreadVelocity from the monitor is the running in-history measure,
    // so we can still use it even without an explicit prior record.
    // However if historyDepth < 3 the monitor emits 0, so this is valid.
    const v = Math.abs(cur.spreadVelocity);
    return { velocityScore: r4(clamp01(v / NORM.VELOCITY_REF_PCT)) };
  }

  // If we have an explicit prior, prefer Δspread as raw velocity signal.
  // This is independent of monitor's internal history buffer depth.
  const deltaSpread = Math.abs(cur.spreadPct - prior.spreadPct);
  const score = clamp01(deltaSpread / NORM.VELOCITY_REF_PCT);
  return { velocityScore: r4(score) };
}

/**
 * Divergence score — raw cross-venue price spread.
 *
 * spreadPct (%) × 100 = bps. Normalized by NORM.DIVERGENCE_REF_BPS.
 * High divergence = venues disagree strongly = higher probability of arb edge.
 *
 * @param {object} cur  Normalized current snapshot.
 * @returns {{ divergenceScore: number }}
 */
function computeDivergenceScore(cur) {
  const bps   = cur.spreadPct * 100;
  const score = clamp01(bps / NORM.DIVERGENCE_REF_BPS);
  return { divergenceScore: r4(score) };
}

/**
 * Spread expansion score — is the spread widening?
 *
 * Maps Δspread to [0, 1]:
 *   Expanding  → score > 0.5 (up to 1.0)
 *   Flat       → score = 0.5
 *   Contracting → score < 0.5 (down to 0.0)
 *
 * Uses NORM.EXPANSION_REF_PCT as the ±reference band for full saturation.
 * If no prior: falls back to spreadVelocity sign to infer direction.
 *
 * @param {object} cur
 * @param {object|null} prior
 * @returns {{ spreadExpansionScore: number, _priorMissing?: boolean }}
 */
function computeSpreadExpansionScore(cur, prior) {
  let deltaSpread;
  let priorMissing = false;

  if (prior) {
    deltaSpread = cur.spreadPct - prior.spreadPct;
  } else if (cur.historyDepth >= 3) {
    // Monitor's spreadVelocity is direction-aware delta across 3 samples.
    // Treat it as a proxy for expansion direction when prior record is absent.
    deltaSpread  = cur.spreadVelocity;
    priorMissing = true;
  } else {
    // Insufficient data — neutral
    const result = { spreadExpansionScore: r4(0.5) };
    result._priorMissing = true;
    return result;
  }

  // Map to [0,1]: 0 = max contraction, 0.5 = flat, 1.0 = max expansion
  const clamped = deltaSpread / NORM.EXPANSION_REF_PCT;
  const score   = clamp01((clamped + 1) / 2);
  const result  = { spreadExpansionScore: r4(score) };
  if (priorMissing) result._priorMissing = true;
  return result;
}

/**
 * Instability score — venue desynchronization / price dispersion.
 *
 * Uses spreadStd (std dev of recent spread% values from monitor history).
 * Higher std = more chaotic spread signal = more desync between venues.
 * Normalized by NORM.INSTABILITY_REF_STD.
 *
 * If spreadStd is null (insufficient monitor history): returns 0 with flag.
 *
 * @param {object} cur  Normalized current snapshot.
 * @returns {{ instabilityScore: number, _stdMissing?: boolean }}
 */
function computeInstabilityScore(cur) {
  if (cur.spreadStd == null) {
    return { instabilityScore: r4(0), _stdMissing: true };
  }
  const score = clamp01(cur.spreadStd / NORM.INSTABILITY_REF_STD);
  return { instabilityScore: r4(score) };
}

/**
 * Depth change score — is effective depth growing?
 *
 * Effective depth = min(depthA, depthB) — the thin leg constrains execution.
 * Growing depth = more reliable execution environment → higher score.
 * Shrinking depth = LP leaving → lower score.
 *
 * Requires both current AND prior to have valid depthA/B.
 * Degrades gracefully to 0 with _depthChangeMissing=true otherwise.
 *
 * @param {object} cur
 * @param {object|null} prior
 * @returns {{ depthChangeScore: number, _depthChangeMissing?: boolean }}
 */
function computeDepthChangeScore(cur, prior) {
  if (
    prior == null ||
    cur.depthA == null || cur.depthB == null ||
    prior.depthA == null || prior.depthB == null
  ) {
    return { depthChangeScore: r4(0), _depthChangeMissing: true };
  }

  const curDepth   = Math.min(cur.depthA,   cur.depthB);
  const priorDepth = Math.min(prior.depthA, prior.depthB);

  if (priorDepth <= 0) {
    return { depthChangeScore: r4(0), _depthChangeMissing: true };
  }

  // Fractional change. Positive = depth grew = better execution environment.
  const frac  = (curDepth - priorDepth) / priorDepth;
  // Map to [0,1]: 0 = max shrink (-REF), 0.5 = flat, 1.0 = max grow (+REF)
  const score = clamp01((frac / NORM.DEPTH_CHANGE_REF_FRAC + 1) / 2);
  return { depthChangeScore: r4(score) };
}

/**
 * Heat score — bounded weighted composite of all five component scores.
 *
 * heatScore ∈ [0, 1] always.
 * When depthChangeScore=0 (missing), it contributes 0×0.15 = 0 to the sum,
 * so the maximum achievable heatScore is 0.85. This is intentional — surfaces
 * with available depth data are structurally more informative.
 *
 * @param {object} scores  { velocityScore, divergenceScore, spreadExpansionScore,
 *                           instabilityScore, depthChangeScore }
 * @returns {number} heatScore [0,1]
 */
function computeHeatScore(scores) {
  const {
    velocityScore,
    divergenceScore,
    spreadExpansionScore,
    instabilityScore,
    depthChangeScore,
  } = scores;

  const raw = (
    HEAT_WEIGHTS.velocity        * velocityScore         +
    HEAT_WEIGHTS.divergence      * divergenceScore        +
    HEAT_WEIGHTS.spreadExpansion * spreadExpansionScore   +
    HEAT_WEIGHTS.instability     * instabilityScore       +
    HEAT_WEIGHTS.depthChange     * depthChangeScore
  );

  return r4(clamp01(raw));
}

/**
 * Classify heat score into a heat class label.
 * Walks HEAT_CLASSES table high → low. First match wins.
 *
 * @param {number} heatScore  [0,1]
 * @returns {string} 'COLD'|'WARM'|'HOT'|'EXTREME'
 */
function classifyHeat(heatScore) {
  for (const { label, min } of HEAT_CLASSES) {
    if (heatScore >= min) return label;
  }
  return 'COLD'; // unreachable but explicit
}

/**
 * Rank surfaces by heatScore (descending).
 *
 * TIE-BREAK ORDER (deterministic):
 *   1. heatScore DESC
 *   2. divergenceScore DESC  (raw price separation)
 *   3. velocityScore DESC    (market momentum)
 *   4. surfaceId ASC         (lexicographic — final stable tie-break)
 *
 * Returns a new array — does NOT mutate input.
 *
 * @param {object[]} evaluated  Array of evaluated surface records with heatScore etc.
 * @returns {object[]}  Same records with heatRank field added, sorted.
 */
function rankSurfaces(evaluated) {
  const sorted = evaluated.slice().sort((a, b) => {
    if (b.heatScore       !== a.heatScore)       return b.heatScore       - a.heatScore;
    if (b.divergenceScore !== a.divergenceScore) return b.divergenceScore - a.divergenceScore;
    if (b.velocityScore   !== a.velocityScore)   return b.velocityScore   - a.velocityScore;
    return a.surfaceId < b.surfaceId ? -1 : a.surfaceId > b.surfaceId ? 1 : 0;
  });

  return sorted.map((s, i) => ({ ...s, heatRank: i + 1 }));
}

/**
 * Evaluate a single surface. Pure function. Per-surface fault isolation.
 *
 * @param {object} raw          Raw surface record (monitor format or Redis format).
 * @param {object|null} rawPrior  Raw prior surface record (same format) or null.
 * @returns {object|null}  Evaluated heat record, or null if surface is invalid.
 */
function evaluateSurface(raw, rawPrior) {
  let cur;
  try {
    cur = normalizeSurfaceObservation(raw);
  } catch (_) {
    cur = null;
  }
  if (!cur) return null;

  let prior = null;
  if (rawPrior) {
    try {
      prior = normalizeSurfaceObservation(rawPrior);
    } catch (_) {
      prior = null;
    }
  }

  const velResult   = computeVelocityScore(cur, prior);
  const divResult   = computeDivergenceScore(cur);
  const expResult   = computeSpreadExpansionScore(cur, prior);
  const instResult  = computeInstabilityScore(cur);
  const depthResult = computeDepthChangeScore(cur, prior);

  const scores = {
    velocityScore        : velResult.velocityScore,
    divergenceScore      : divResult.divergenceScore,
    spreadExpansionScore : expResult.spreadExpansionScore,
    instabilityScore     : instResult.instabilityScore,
    depthChangeScore     : depthResult.depthChangeScore,
  };

  const heatScore = computeHeatScore(scores);
  const heatClass = classifyHeat(heatScore);

  const result = {
    surfaceId            : cur.surfaceId,
    pair                 : cur.pair,
    venueA               : cur.venueA,
    venueB               : cur.venueB,
    spreadPct            : cur.spreadPct,
    heatScore,
    heatClass,
    heatRank             : 0,   // filled by rankSurfaces()
    ...scores,
  };

  // Diagnostic flags — explain why a component scored low
  if (velResult._priorMissing    ) result._velocityPriorMissing  = true;
  if (expResult._priorMissing    ) result._expansionPriorMissing = true;
  if (instResult._stdMissing     ) result._instabilityStdMissing = true;
  if (depthResult._depthChangeMissing) result._depthChangeMissing = true;

  return result;
}

/**
 * Evaluate an array of surface snapshots and return a ranked heat list.
 *
 * This is the PRIMARY entry point for external callers.
 *
 * @param {object[]} snapshots      Array of raw current surface records.
 * @param {Map<string,object>} priorMap  Map of surfaceId → raw prior record.
 *                                       Pass new Map() or {} if no history available.
 * @returns {object[]}  Ranked heat records (heatRank=1 = hottest).
 *                      Surfaces that fail validation are omitted — batch continues.
 */
function evaluateSurfaces(snapshots, priorMap) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return [];

  const safeMap = (priorMap instanceof Map) ? priorMap
                : (priorMap && typeof priorMap === 'object')
                    ? new Map(Object.entries(priorMap))
                    : new Map();

  const evaluated = [];
  for (const s of snapshots) {
    let result = null;
    try {
      const prior = safeMap.get(s?.surfaceId) ?? null;
      result = evaluateSurface(s, prior);
    } catch (err) {
      // Per-surface fault isolation: one bad surface does not break the batch.
      // Emit nothing for this surface; continue processing others.
      process.stderr.write(
        `[vde] surface eval error (${s?.surfaceId ?? 'unknown'}): ${err.message}\n`
      );
    }
    if (result) evaluated.push(result);
  }

  return rankSurfaces(evaluated);
}

// ─── MODULE EXPORTS ───────────────────────────────────────────────────────────

module.exports = {
  // Primary entry point
  evaluateSurfaces,

  // Per-surface entry point (lower-level callers)
  evaluateSurface,

  // Individual score functions (for testing and custom pipelines)
  normalizeSurfaceObservation,
  computeVelocityScore,
  computeDivergenceScore,
  computeSpreadExpansionScore,
  computeInstabilityScore,
  computeDepthChangeScore,
  computeHeatScore,
  classifyHeat,
  rankSurfaces,

  // Constants (read-only — exposed for report formatting)
  HEAT_WEIGHTS,
  HEAT_CLASSES,
  NORM,
};
