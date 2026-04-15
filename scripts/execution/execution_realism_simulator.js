'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution Realism Simulator  v2.1
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/execution_realism_simulator.js
//  STATUS    : PATCHED — Boss ruling 2026-04-14 (v2.1)
//
//  CHANGES FROM v2.0 (audit-driven, Boss ruling)
//  ──────────────────────────────────────────────
//  1. failureProbability is now BLUEPRINT-SENSITIVE
//     v2.0 produced a constant 0.19 for every blueprint — the probability gate
//     never differentiated. v2.1 derives failure probability from:
//       • gas burden relative to edge (high gas burden = higher fail prob)
//       • spread thinness (closer to threshold = higher fail prob)
//       • latency sensitivity (HIGH/CRITICAL drift sensitivity = higher fail prob)
//
//  2. worstCaseNetUsd is now a COMBINED harsh scenario, not a cherry-picked min
//     v2.0 took the min across independent single-dimension stress cases —
//     not the same as everything going wrong simultaneously.
//     v2.1 computes one combined worst case:
//       1000ms latency + 3.0× gas + 30% MEV + 70% fill
//
//  3. Classification thresholds updated (Boss ruling exact values)
//     EXECUTION_VIABLE:   coreNet >= 0.10 AND worstCase > 0   AND failProb <= 0.30
//     EXECUTION_MARGINAL: coreNet >= 0.05 AND worstCase > -0.05 AND failProb <= 0.45
//     EXECUTION_FAIL:     everything else
//     FAIL is now reachable for filtered candidates — confirmed in testing.
//
//  DOWNSTREAM LAYER — does not modify upstream logic
//  ✗ execution_simulator.js  ✗ execution_filter.js  ✗ activator  ✗ thresholds
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SCENARIO DEFINITIONS ─────────────────────────────────────────────────────

const LATENCY_SCENARIOS = Object.freeze([
  { id: 'latency_200ms',  ms: 200,  driftBps: 0.8, label: 'IDEAL'     },
  { id: 'latency_500ms',  ms: 500,  driftBps: 2.0, label: 'REALISTIC' },
  { id: 'latency_1000ms', ms: 1000, driftBps: 4.0, label: 'DEGRADED'  },
]);

const FILL_SCENARIOS = Object.freeze([
  { id: 'fill_100pct', fraction: 1.00 },
  { id: 'fill_90pct',  fraction: 0.90 },
  { id: 'fill_80pct',  fraction: 0.80 },
  { id: 'fill_70pct',  fraction: 0.70 },
]);

const GAS_SCENARIOS = Object.freeze([
  { id: 'gas_1_0x', mult: 1.0 },
  { id: 'gas_1_5x', mult: 1.5 },
  { id: 'gas_2_0x', mult: 2.0 },
  { id: 'gas_3_0x', mult: 3.0 },
]);

const MEV_SCENARIOS = Object.freeze([
  { id: 'mev_0pct',  lossProb: 0.00 },
  { id: 'mev_10pct', lossProb: 0.10 },
  { id: 'mev_20pct', lossProb: 0.20 },
  { id: 'mev_30pct', lossProb: 0.30 },
]);

const FAIL_SCENARIOS = Object.freeze([
  { id: 'fail_5pct',  failProb: 0.05 },
  { id: 'fail_10pct', failProb: 0.10 },
  { id: 'fail_20pct', failProb: 0.20 },
]);

// ─── CLASSIFICATION THRESHOLDS (Boss ruling 2026-04-14) ───────────────────────

// EXECUTION_VIABLE:   coreNet >= 0.10  AND worstCase > 0    AND failProb <= 0.30
// EXECUTION_MARGINAL: coreNet >= 0.05  AND worstCase > -0.05 AND failProb <= 0.45
// EXECUTION_FAIL:     everything else
const VIABLE_MIN_CORE_NET       = 0.10;
const VIABLE_MIN_WORST_CASE     = 0.00;   // worst-case must be positive
const VIABLE_MAX_FAIL_PROB      = 0.30;
const MARGINAL_MIN_CORE_NET     = 0.05;
const MARGINAL_MIN_WORST_CASE   = -0.05;  // worst-case may dip slightly negative
const MARGINAL_MAX_FAIL_PROB    = 0.45;

// Core scenario — realistic mid-stress
const CORE_REAL_SCENARIO = Object.freeze({
  driftBps     : 2.0,    // 500ms latency
  gasMult      : 1.5,
  fillFraction : 0.90,
  mevLossProb  : 0.10,
  failProb     : 0.10,
});

// Combined worst-case scenario — all stressors simultaneously
// Boss directive: "not cherry-picked independent outputs — one genuine harsh case"
const COMBINED_WORST_SCENARIO = Object.freeze({
  driftBps     : 4.0,    // 1000ms latency
  gasMult      : 3.0,
  fillFraction : 0.70,
  mevLossProb  : 0.30,
});

// ─── DETERMINISTIC SEED ───────────────────────────────────────────────────────

function seedFromId(id) {
  let h = 5381;
  for (let i = 0; i < (id || '').length; i++) {
    h = ((h << 5) + h) ^ id.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}

// ─── CORE NET CALCULATION ─────────────────────────────────────────────────────

function computeRealNet(bp, driftBps, gasMult, fillFraction, mevLossProb) {
  const spread   = bp.economics?.spreadPct ?? 0;
  const gasBase  = bp.economics?.gasCostUsd ?? 0.028;
  const sizeUsd  = bp.sizing?.targetUsd ?? 200;
  const entryFee = bp.venues?.entry?.feePct ?? 0.0001;
  const exitFee  = bp.venues?.exit?.feePct  ?? 0.0005;

  // Asymmetric drift — exit worsens more (spread collapse tendency)
  const entryDriftPct      = (driftBps * 0.60) / 100;
  const exitDriftPct       = (driftBps * 1.00) / 100;
  const effectiveSpreadPct = Math.max(0, spread - entryDriftPct - exitDriftPct);

  const filledSizeUsd = sizeUsd * fillFraction;
  const revenue       = filledSizeUsd * (effectiveSpreadPct / 100);
  const gasCost       = gasBase * gasMult;
  const fees          = filledSizeUsd * (entryFee + exitFee);
  const netBeforeMev  = revenue - gasCost - fees;

  // MEV: expected value — we still pay gas on a failed tx
  const netAfterMev   = (1 - mevLossProb) * netBeforeMev - mevLossProb * gasCost;

  return { netUsd: netAfterMev, effectiveSpreadPct, gasCost, fees, revenue, filledSizeUsd };
}

// ─── BLUEPRINT-SENSITIVE FAILURE PROBABILITY (v2.1 Fix 1) ────────────────────
//
// Three factors drive blueprint-specific failure probability:
//
//   1. GAS BURDEN RATIO — gas cost as a fraction of core net revenue
//      When gas consumes a large fraction of the edge, small gas spikes
//      flip the trade negative. High gas burden = higher fail probability.
//
//   2. SPREAD MARGIN above threshold — how far above the 0.22% floor
//      Thin-spread candidates near the threshold have less buffer against
//      drift and partial fills. Spread margin drives this.
//
//   3. LATENCY SENSITIVITY — from sensitivity analysis
//      HIGH/CRITICAL latency sensitivity means the blueprint cannot tolerate
//      the realistic latency window; adds to failure probability.
//
// Base: 0.10 MEV + 0.10 exec-fail = 0.19 constant in v2.0.
// v2.1 adjusts this base upward for weaker blueprints.

const SPREAD_THRESHOLD_PCT = 0.22;  // confirmed band floor

function computeFailureProbability(bp, coreResult, driftSensitivity, latencySensitivity) {
  // Base probability (MEV + execution fail at 10% each)
  let prob = CORE_REAL_SCENARIO.mevLossProb + CORE_REAL_SCENARIO.failProb
             - (CORE_REAL_SCENARIO.mevLossProb * CORE_REAL_SCENARIO.failProb);
  // = 0.19

  // Factor 1: gas burden — gas cost / core gross revenue
  const gasBase = bp.economics?.gasCostUsd ?? 0.028;
  const gasCoreUsd = gasBase * CORE_REAL_SCENARIO.gasMult;  // 1.5× gas
  const grossRevenue = Math.abs(coreResult.revenue ?? 0.001);
  const gasBurdenRatio = gasCoreUsd / grossRevenue;
  // High gas burden: >50% of revenue → +0.10; >100% → +0.20
  if (gasBurdenRatio > 1.0)       prob += 0.20;
  else if (gasBurdenRatio > 0.5)  prob += 0.10;
  else if (gasBurdenRatio > 0.25) prob += 0.05;

  // Factor 2: spread margin above threshold
  const spreadPct = bp.economics?.spreadPct ?? 0;
  const spreadMargin = spreadPct - SPREAD_THRESHOLD_PCT;
  // Near the threshold: < 0.01% margin → +0.10; < 0.03% → +0.05
  if (spreadMargin < 0.01)       prob += 0.10;
  else if (spreadMargin < 0.03)  prob += 0.05;
  // Very thick spread (> 0.10% above threshold) → -0.05 bonus
  else if (spreadMargin > 0.10)  prob -= 0.05;

  // Factor 3: latency sensitivity
  if (latencySensitivity === 'CRITICAL') prob += 0.15;
  else if (latencySensitivity === 'HIGH') prob += 0.08;

  return +Math.min(0.99, Math.max(0, prob)).toFixed(4);
}

// ─── SENSITIVITY LABELS ───────────────────────────────────────────────────────

function sensitivityLabel(baseNet, stressedNet) {
  if (!isFinite(baseNet) || baseNet <= 0) return 'N/A';
  const drop = (baseNet - stressedNet) / Math.abs(baseNet);
  if (drop >= 0.80) return 'CRITICAL';
  if (drop >= 0.50) return 'HIGH';
  if (drop >= 0.25) return 'MODERATE';
  return 'LOW';
}

// ─── PRIMARY SIMULATION FUNCTION ──────────────────────────────────────────────

function simulateExecutionRealism(bp) {
  if (!bp) throw new Error('blueprint is required');
  seedFromId(bp.blueprintId ?? '');

  const C = CORE_REAL_SCENARIO;
  const W = COMBINED_WORST_SCENARIO;

  // ── Core and base cases ───────────────────────────────────────────────────
  const baseResult = computeRealNet(bp, 0,        1.0,        1.0,        0.0);
  const coreResult = computeRealNet(bp, C.driftBps, C.gasMult, C.fillFraction, C.mevLossProb);

  // ── Combined worst-case (Fix 2) — all stressors simultaneously ───────────
  const worstResult = computeRealNet(bp, W.driftBps, W.gasMult, W.fillFraction, W.mevLossProb);
  const worstCaseNetUsd = +worstResult.netUsd.toFixed(4);

  // ── Dimension cases (informational) ──────────────────────────────────────
  const latencyCases = LATENCY_SCENARIOS.map(s => ({
    id: s.id, ms: s.ms, label: s.label,
    netUsd: +computeRealNet(bp, s.driftBps, 1.0, 1.0, 0.0).netUsd.toFixed(4),
  }));
  const gasCases = GAS_SCENARIOS.map(s => ({
    id: s.id, mult: s.mult,
    netUsd: +computeRealNet(bp, C.driftBps, s.mult, C.fillFraction, 0.0).netUsd.toFixed(4),
  }));
  const fillCases = FILL_SCENARIOS.map(s => ({
    id: s.id, fraction: s.fraction,
    netUsd: +computeRealNet(bp, C.driftBps, C.gasMult, s.fraction, C.mevLossProb).netUsd.toFixed(4),
  }));
  const mevCases = MEV_SCENARIOS.map(s => ({
    id: s.id, lossProb: s.lossProb,
    netUsd: +computeRealNet(bp, C.driftBps, C.gasMult, C.fillFraction, s.lossProb).netUsd.toFixed(4),
  }));
  const gasCostCore = (bp.economics?.gasCostUsd ?? 0.028) * C.gasMult;
  const failCases = FAIL_SCENARIOS.map(s => ({
    id: s.id, failProb: s.failProb,
    expectedNet: +((1 - s.failProb) * coreResult.netUsd - s.failProb * gasCostCore).toFixed(4),
  }));

  // ── Sensitivity labels ────────────────────────────────────────────────────
  const latencySensitivity = sensitivityLabel(
    baseResult.netUsd, latencyCases.find(c => c.id === 'latency_1000ms')?.netUsd ?? 0);
  const gasSensitivity = sensitivityLabel(
    baseResult.netUsd, gasCases.find(c => c.id === 'gas_3_0x')?.netUsd ?? 0);
  const driftSensitivity = sensitivityLabel(
    baseResult.netUsd, computeRealNet(bp, 4.0, 1.0, 1.0, 0.0).netUsd);

  // ── Blueprint-sensitive failure probability (Fix 1) ───────────────────────
  const failureProbability = computeFailureProbability(
    bp, coreResult, driftSensitivity, latencySensitivity);

  // ── Classification (Boss ruling thresholds, Fix 3) ────────────────────────
  const coreNet = coreResult.netUsd;
  let executionClass;
  if (coreNet >= VIABLE_MIN_CORE_NET &&
      worstCaseNetUsd > VIABLE_MIN_WORST_CASE &&
      failureProbability <= VIABLE_MAX_FAIL_PROB) {
    executionClass = 'EXECUTION_VIABLE';
  } else if (coreNet >= MARGINAL_MIN_CORE_NET &&
             worstCaseNetUsd > MARGINAL_MIN_WORST_CASE &&
             failureProbability <= MARGINAL_MAX_FAIL_PROB) {
    executionClass = 'EXECUTION_MARGINAL';
  } else {
    executionClass = 'EXECUTION_FAIL';
  }

  return {
    realizationId      : `REAL-${(bp.blueprintId ?? 'UNK').slice(-8).toUpperCase()}`,
    blueprintId        : bp.blueprintId,
    pair               : bp.pair,
    ts                 : new Date().toISOString(),

    executionClass,
    executionViable    : executionClass === 'EXECUTION_VIABLE',

    expectedRealNetUsd : +coreNet.toFixed(4),
    worstCaseNetUsd,                            // combined harsh scenario
    bestCaseNetUsd     : +baseResult.netUsd.toFixed(4),
    failureProbability,                         // blueprint-sensitive

    sensitivity        : { latency: latencySensitivity, drift: driftSensitivity, gas: gasSensitivity },

    // Informational dimension breakdowns
    latencyCases, gasCases, fillCases, mevCases, failCases,

    sourceSpreadPct    : bp.economics?.spreadPct,
    sourceSizeUsd      : bp.sizing?.targetUsd,
    sourceBaseGasUsd   : bp.economics?.gasCostUsd,
    sourceConfidence   : bp.viability?.confidenceScore,
    profile            : bp._context?.activeProfile,
    heatClass          : bp._context?.heatClass,
    regime             : bp._context?.regime,
  };
}

function simulateBatch(blueprints) {
  if (!Array.isArray(blueprints) || !blueprints.length) return [];
  return blueprints.map(bp => {
    try { return simulateExecutionRealism(bp); }
    catch (err) {
      return { realizationId:'REAL-ERROR', blueprintId: bp?.blueprintId ?? null,
               executionClass:'EXECUTION_FAIL', executionViable: false,
               expectedRealNetUsd: null, _error: err.message };
    }
  });
}

module.exports = {
  simulateExecutionRealism, simulateBatch,
  LATENCY_SCENARIOS, FILL_SCENARIOS, GAS_SCENARIOS, MEV_SCENARIOS, FAIL_SCENARIOS,
  CORE_REAL_SCENARIO, COMBINED_WORST_SCENARIO,
  VIABLE_MIN_CORE_NET, VIABLE_MAX_FAIL_PROB,
  MARGINAL_MIN_CORE_NET, MARGINAL_MAX_FAIL_PROB,
  SPREAD_THRESHOLD_PCT,
};
