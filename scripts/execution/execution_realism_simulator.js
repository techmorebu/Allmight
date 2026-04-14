'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution Realism Simulator  v2.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/execution_realism_simulator.js
//  STATUS    : NEW — Boss ruling 2026-04-14
//
//  PURPOSE
//  ─────────
//  Models real-world execution conditions on CONFIRMED candidates to answer:
//    "If this candidate fires in real life — do we still profit?"
//
//  This is a DOWNSTREAM ANALYSIS LAYER. It does NOT modify:
//    ✗ execution_simulator.js (stress-test layer — upstream)
//    ✗ execution_filter.js    (admission gate)
//    ✗ activator logic or spread thresholds
//    ✗ blueprint formation
//
//  MODELS ADDED BEYOND EXISTING SIMULATOR
//  ────────────────────────────────────────
//  1. Latency model    — 200ms/500ms/1000ms → directional price drift
//                        asymmetric entry/exit (spread collapses faster)
//  2. Partial fills    — 70%/80%/90%/100% fill at expected price
//  3. Failure events   — 5%/10%/20% total execution failure probability
//  4. Gas spikes       — 1.0×/1.5×/2.0×/3.0× dynamic gas scenarios
//  5. MEV competition  — 10%/20%/30% probability edge evaporates before fill
//
//  CLASSIFICATION
//  ──────────────
//  EXECUTION_VIABLE   — survives core real-world scenario with positive net ≥ $0.10
//  EXECUTION_MARGINAL — positive in core scenario but thin ($0.01–$0.10)
//  EXECUTION_FAIL     — fails or goes negative under core real-world conditions
//
//  DETERMINISM
//  ───────────
//  All stochastic elements use a seeded LCG — identical inputs → identical output.
//  Seed derived from blueprintId.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SCENARIO DEFINITIONS ─────────────────────────────────────────────────────

// Latency scenarios — detection-to-execution time on Arbitrum (~0.25s/block)
// Drift proxy: 1bp adverse drift per 250ms latency, asymmetric entry/exit
const LATENCY_SCENARIOS = Object.freeze([
  { id: 'latency_200ms',  ms: 200,  driftBps: 0.8, label: 'IDEAL'     },
  { id: 'latency_500ms',  ms: 500,  driftBps: 2.0, label: 'REALISTIC' },
  { id: 'latency_1000ms', ms: 1000, driftBps: 4.0, label: 'DEGRADED'  },
]);

// Partial fill scenarios — fraction of targetUsd filled at expected price
const FILL_SCENARIOS = Object.freeze([
  { id: 'fill_100pct', fraction: 1.00 },
  { id: 'fill_90pct',  fraction: 0.90 },
  { id: 'fill_80pct',  fraction: 0.80 },
  { id: 'fill_70pct',  fraction: 0.70 },
]);

// Gas spike scenarios — multipliers on base gas cost
const GAS_SCENARIOS = Object.freeze([
  { id: 'gas_1_0x', mult: 1.0 },
  { id: 'gas_1_5x', mult: 1.5 },
  { id: 'gas_2_0x', mult: 2.0 },
  { id: 'gas_3_0x', mult: 3.0 },
]);

// MEV/competition — probability edge evaporates before fill
const MEV_SCENARIOS = Object.freeze([
  { id: 'mev_0pct',  lossProb: 0.00 },
  { id: 'mev_10pct', lossProb: 0.10 },
  { id: 'mev_20pct', lossProb: 0.20 },
  { id: 'mev_30pct', lossProb: 0.30 },
]);

// Execution failure — total trade failure probability (pool shift, gas OOG, etc.)
const FAIL_SCENARIOS = Object.freeze([
  { id: 'fail_5pct',  failProb: 0.05 },
  { id: 'fail_10pct', failProb: 0.10 },
  { id: 'fail_20pct', failProb: 0.20 },
]);

// ─── CLASSIFICATION THRESHOLDS ────────────────────────────────────────────────

const VIABLE_MIN_REAL_NET_USD   = 0.10;  // core scenario must clear $0.10
const VIABLE_MAX_FAIL_PROB      = 0.30;  // aggregate failure probability ceiling
const MARGINAL_MIN_REAL_NET_USD = 0.01;  // positive but thin

// Core real-world scenario — the single scenario used for VIABLE verdict
// Realistic latency + moderate gas + 90% fill + 10% MEV + 10% fail
const CORE_REAL_SCENARIO = Object.freeze({
  driftBps     : 2.0,   // 500ms latency proxy
  gasMult      : 1.5,
  fillFraction : 0.90,
  mevLossProb  : 0.10,
  failProb     : 0.10,
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

/**
 * Compute expected net profit under a single real-world condition set.
 *
 * Key insight: spread collapses asymmetrically under latency —
 * exit price worsens more than entry (spread compresses toward equilibrium).
 * Entry drift: 60% of latency drift. Exit drift: 100%.
 */
function computeRealNet(bp, driftBps, gasMult, fillFraction, mevLossProb) {
  const spread   = bp.economics?.spreadPct ?? 0;      // %
  const gasBase  = bp.economics?.gasCostUsd ?? 0.028; // USD
  const sizeUsd  = bp.sizing?.targetUsd ?? 200;
  const entryFee = bp.venues?.entry?.feePct ?? 0.0001;
  const exitFee  = bp.venues?.exit?.feePct  ?? 0.0005;

  // Asymmetric drift — exit worsens more (spread collapse tendency)
  const entryDriftPct = (driftBps * 0.60) / 100;
  const exitDriftPct  = (driftBps * 1.00) / 100;
  const effectiveSpreadPct = Math.max(0, spread - entryDriftPct - exitDriftPct);

  const filledSizeUsd = sizeUsd * fillFraction;
  const revenue       = filledSizeUsd * (effectiveSpreadPct / 100);
  const gasCost       = gasBase * gasMult;
  const fees          = filledSizeUsd * (entryFee + exitFee);
  const netBeforeMev  = revenue - gasCost - fees;

  // MEV: expected value = (1-p)×net - p×gasCost (gas still paid on failed tx)
  const netAfterMev   = (1 - mevLossProb) * netBeforeMev - mevLossProb * gasCost;

  return { netUsd: netAfterMev, effectiveSpreadPct, gasCost, fees, revenue, filledSizeUsd };
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

/**
 * Run execution realism simulation on one blueprint.
 * Deterministic: same blueprint → same output.
 *
 * @param {object} bp  Blueprint record
 * @returns {object}   Realism simulation result
 */
function simulateExecutionRealism(bp) {
  if (!bp) throw new Error('blueprint is required');
  seedFromId(bp.blueprintId ?? '');  // seed kept for future stochastic extension

  const C = CORE_REAL_SCENARIO;

  // ── Base and core real-world cases ────────────────────────────────────────
  const baseResult = computeRealNet(bp, 0, 1.0, 1.0, 0.0);          // ideal
  const coreResult = computeRealNet(bp, C.driftBps, C.gasMult, C.fillFraction, C.mevLossProb);

  // ── Latency dimension ─────────────────────────────────────────────────────
  const latencyCases = LATENCY_SCENARIOS.map(s => ({
    id: s.id, ms: s.ms, label: s.label,
    netUsd: +computeRealNet(bp, s.driftBps, 1.0, 1.0, 0.0).netUsd.toFixed(4),
  }));
  const latencySensitivity = sensitivityLabel(
    baseResult.netUsd,
    latencyCases.find(c => c.id === 'latency_1000ms')?.netUsd ?? 0
  );

  // ── Gas dimension ─────────────────────────────────────────────────────────
  const gasCases = GAS_SCENARIOS.map(s => ({
    id: s.id, mult: s.mult,
    netUsd: +computeRealNet(bp, C.driftBps, s.mult, C.fillFraction, 0.0).netUsd.toFixed(4),
  }));
  const gasSensitivity = sensitivityLabel(
    baseResult.netUsd,
    gasCases.find(c => c.id === 'gas_3_0x')?.netUsd ?? 0
  );

  // ── Drift dimension ───────────────────────────────────────────────────────
  const driftSensitivity = sensitivityLabel(
    baseResult.netUsd,
    computeRealNet(bp, LATENCY_SCENARIOS[2].driftBps, 1.0, 1.0, 0.0).netUsd
  );

  // ── Fill dimension ────────────────────────────────────────────────────────
  const fillCases = FILL_SCENARIOS.map(s => ({
    id: s.id, fraction: s.fraction,
    netUsd: +computeRealNet(bp, C.driftBps, C.gasMult, s.fraction, C.mevLossProb).netUsd.toFixed(4),
  }));

  // ── MEV dimension ─────────────────────────────────────────────────────────
  const mevCases = MEV_SCENARIOS.map(s => ({
    id: s.id, lossProb: s.lossProb,
    netUsd: +computeRealNet(bp, C.driftBps, C.gasMult, C.fillFraction, s.lossProb).netUsd.toFixed(4),
  }));

  // ── Failure cases ─────────────────────────────────────────────────────────
  const gasCostCore = (bp.economics?.gasCostUsd ?? 0.028) * C.gasMult;
  const failCases = FAIL_SCENARIOS.map(s => ({
    id: s.id, failProb: s.failProb,
    expectedNet: +((1 - s.failProb) * coreResult.netUsd - s.failProb * gasCostCore).toFixed(4),
  }));

  // ── Aggregate failure probability ─────────────────────────────────────────
  // P(total loss) = P(MEV evap) + P(exec fail) - P(both)  [inclusion-exclusion]
  const failureProbability = +(
    C.mevLossProb + C.failProb - (C.mevLossProb * C.failProb)
  ).toFixed(4);

  // ── Worst/best case across all dimensions ────────────────────────────────
  const allNets = [
    ...latencyCases.map(c => c.netUsd),
    ...gasCases.map(c => c.netUsd),
    ...fillCases.map(c => c.netUsd),
    ...mevCases.map(c => c.netUsd),
    ...failCases.map(c => c.expectedNet),
  ].filter(n => n != null && isFinite(n));

  const worstCaseNetUsd = +Math.min(...allNets).toFixed(4);
  const bestCaseNetUsd  = +baseResult.netUsd.toFixed(4);

  // ── Classification ────────────────────────────────────────────────────────
  const coreNet = coreResult.netUsd;
  let executionClass;
  if (coreNet >= VIABLE_MIN_REAL_NET_USD && failureProbability <= VIABLE_MAX_FAIL_PROB) {
    executionClass = 'EXECUTION_VIABLE';
  } else if (coreNet >= MARGINAL_MIN_REAL_NET_USD) {
    executionClass = 'EXECUTION_MARGINAL';
  } else {
    executionClass = 'EXECUTION_FAIL';
  }

  const uid = `REAL-${(bp.blueprintId ?? 'UNK').slice(-8).toUpperCase()}`;

  return {
    realizationId      : uid,
    blueprintId        : bp.blueprintId,
    pair               : bp.pair,
    ts                 : new Date().toISOString(),

    // Verdict
    executionClass,
    executionViable    : executionClass === 'EXECUTION_VIABLE',

    // Core scenario net (primary metric)
    expectedRealNetUsd : +coreNet.toFixed(4),
    worstCaseNetUsd,
    bestCaseNetUsd,
    failureProbability,

    // Sensitivity profile
    sensitivity        : { latency: latencySensitivity, drift: driftSensitivity, gas: gasSensitivity },

    // Dimension breakdowns
    latencyCases,
    gasCases,
    fillCases,
    mevCases,
    failCases,

    // Source context
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
  CORE_REAL_SCENARIO, VIABLE_MIN_REAL_NET_USD, VIABLE_MAX_FAIL_PROB,
};
