'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution Simulator  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/execution_simulator.js
//  STATUS    : NEW — Boss ruling 2026-04-10 (Execution Simulator Layer)
//
//  PURPOSE
//  ─────────
//  Deterministic stress-test engine. Takes a trade blueprint and answers:
//
//    "If we tried this blueprint under adverse but realistic conditions,
//     would it still survive?"
//
//  THIS MODULE DOES NOT:
//  ✗ Send transactions
//  ✗ Call ethers or RPC endpoints
//  ✗ Use wallets or sign messages
//  ✗ Touch flash loan contracts
//  ✗ Introduce unseeded randomness
//
//  THIS MODULE DOES:
//  ✓ Apply deterministic price drift to entry/exit prices
//  ✓ Apply gas multipliers
//  ✓ Apply slippage multipliers
//  ✓ Simulate delay via labeled adverse-drift proxies
//  ✓ Score fragility across all stress cases
//  ✓ Compute execution confidence = blueprintConfidence × robustnessFactor
//  ✓ Return a structured SIM_EXECUTION_RESULT
//  ✓ Degrade gracefully on missing or malformed input
//
//  PIPELINE POSITION
//  ─────────────────
//  ACTIVATOR → BLUEPRINT ENGINE → [this module] → SIMULATION_LOGGER
//
//  Usage (standalone — no activator needed):
//    const { simulateBlueprint } = require('./execution_simulator');
//    const result = simulateBlueprint(blueprint);
// ═══════════════════════════════════════════════════════════════════════════════

// ─── STRESS CASE DEFINITIONS ──────────────────────────────────────────────────
// All dimensions are deterministic constants. Change only here.

// Price drift — adverse movement in basis points.
// Applied to BOTH legs: buy price worsens (higher cost), sell price worsens (lower proceeds).
// 1 bp = 0.0001 (0.01%). Adverse means profit-reducing direction.
const DRIFT_CASES = Object.freeze([
  { id: 'drift_1bp',  bps: 1  },
  { id: 'drift_3bp',  bps: 3  },
  { id: 'drift_5bp',  bps: 5  },
  { id: 'drift_10bp', bps: 10 },
]);

// Gas stress — multipliers applied to base gas cost.
const GAS_CASES = Object.freeze([
  { id: 'gas_1_0x',   mult: 1.00 },
  { id: 'gas_up_25pct', mult: 1.25 },
  { id: 'gas_up_50pct', mult: 1.50 },
  { id: 'gas_up_100pct', mult: 2.00 },
]);

// Slippage stress — multipliers applied to blueprint's estimated slippage fraction.
// Blueprint slippage is derived from (sizeUsd / (2 × depthUsd)).
const SLIPPAGE_CASES = Object.freeze([
  { id: 'slippage_x1',   mult: 1.00 },
  { id: 'slippage_x1_5', mult: 1.50 },
  { id: 'slippage_x2',   mult: 2.00 },
  { id: 'slippage_x3',   mult: 3.00 },
]);

// Delay sensitivity — proxied as additional adverse drift because no actual
// block replay data is available at this layer. Labeled explicitly as proxies.
// Do not misrepresent these as true block-delayed market snapshots.
// 1 block ≈ 0.25s on Arbitrum. Proxy: 2bp adverse drift per block.
const DELAY_CASES = Object.freeze([
  { id: 'delay_0_block', proxyDriftBps: 0,  proxyLabel: 'exact_entry' },
  { id: 'delay_1_block', proxyDriftBps: 2,  proxyLabel: 'proxy_2bp_drift' },
  { id: 'delay_2_block', proxyDriftBps: 4,  proxyLabel: 'proxy_4bp_drift' },
]);

// ─── VERDICT THRESHOLDS ───────────────────────────────────────────────────────
// Per-case verdict rules (deterministic, documented here — change only here).
//
//   PASS      netProfitUsd > PASS_THRESHOLD
//   MARGINAL  netProfitUsd > 0 and <= PASS_THRESHOLD
//   FAIL      netProfitUsd <= 0
//
// $0.10 pass threshold: at $100 trade size, 0.10% minimum edge in USD terms.
// Consistent with Boss viability floor analysis from ETH/USDC-RAMSES runs.

const PASS_THRESHOLD_USD  = 0.10;
const DUST_THRESHOLD_USD  = 0.00;

// ─── OVERALL VERDICT — CORE CASES ────────────────────────────────────────────
// Overall SIM_PASS requires ALL of these to pass (not just most).
// Boss specified: drift_3bp, gas_up_25pct, slippage_x1_5, delay_1_block.

const CORE_CASE_IDS = Object.freeze([
  'drift_3bp',
  'gas_up_25pct',
  'slippage_x1_5',
  'delay_1_block',
]);

// ─── OVERALL VERDICT THRESHOLDS ───────────────────────────────────────────────
// SIM_PASS:     all core cases pass AND fragility <= FRAGILITY_PASS_MAX
// SIM_MARGINAL: mixed — some core cases marginal or fail, fragility moderate
// SIM_FAIL:     any core case fails OR fragility >= FRAGILITY_FAIL_MIN

const FRAGILITY_PASS_MAX = 0.30;   // ≤ 30% weighted fail ratio = robust
const FRAGILITY_FAIL_MIN = 0.60;   // ≥ 60% = fragile

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function r4(x)  { return isFinite(x) ? +x.toFixed(4) : null; }
function r6(x)  { return isFinite(x) ? +x.toFixed(6) : null; }
function r2(x)  { return isFinite(x) ? +x.toFixed(2) : null; }
function nowIso() { return new Date().toISOString(); }

let _simSeq = 0;
function nextSimId() {
  return `SIM-${Date.now().toString(36).toUpperCase()}-${String(++_simSeq).padStart(6, '0')}`;
}

// ─── PER-CASE VERDICT ─────────────────────────────────────────────────────────

/**
 * Classify a single stress case result.
 * @param {number|null} netProfitUsd
 * @returns {'PASS'|'MARGINAL'|'FAIL'}
 */
function verdictForCase(netProfitUsd) {
  if (netProfitUsd == null || !isFinite(netProfitUsd)) return 'FAIL';
  if (netProfitUsd > PASS_THRESHOLD_USD)  return 'PASS';
  if (netProfitUsd > DUST_THRESHOLD_USD)  return 'MARGINAL';
  return 'FAIL';
}

// ─── CORE PROFIT COMPUTATION ──────────────────────────────────────────────────

/**
 * Compute net profit for a single stress scenario.
 *
 * Model:
 *   1. Buy baseToken at adversely-drifted entry price
 *   2. Sell baseToken at adversely-drifted exit price
 *   3. Apply stressed slippage to sell output
 *   4. Deduct stressed gas cost
 *   net = tokenOut - tokenIn - gas
 *
 * Drift is adverse: buy price increases (worse for buyer), sell price decreases (worse for seller).
 * Drift magnitude: price × (1 ± driftBps × 0.0001)
 *
 * @param {object} bp          Blueprint object
 * @param {number} driftBps    Adverse price drift in basis points
 * @param {number} gasMult     Gas cost multiplier (1.0 = base)
 * @param {number} slipMult    Slippage multiplier (1.0 = base)
 * @returns {{ netProfitUsd, tokenOut, gasUsdStressed, slippageFracStressed }}
 */
function computeStressedProfit(bp, driftBps, gasMult, slipMult) {
  const entryPrice = bp.venues?.entry?.expectedPrice;
  const exitPrice  = bp.venues?.exit?.expectedPrice;
  const sizeUsd    = bp.sizing?.targetUsd;
  const entryFee   = bp.venues?.entry?.feePct ?? 0;
  const exitFee    = bp.venues?.exit?.feePct  ?? 0;
  const baseGasUsd = bp.economics?.gasCostUsd;
  const baseSlipBps= bp.economics?.slippageBps ?? 0;

  if (!entryPrice || !exitPrice || !sizeUsd || entryPrice <= 0 || exitPrice <= 0 || !sizeUsd) {
    return { netProfitUsd: null, tokenOut: null, gasUsdStressed: null, slippageFracStressed: null };
  }

  // Apply adverse drift: buy at higher price (worse), sell at lower price (worse)
  const driftFrac       = driftBps * 0.0001;
  const stressedEntry   = entryPrice * (1 + driftFrac);   // buy price worsens
  const stressedExit    = exitPrice  * (1 - driftFrac);   // sell price worsens

  // Slippage fraction — stressed
  const baseSlipFrac      = baseSlipBps / 10_000;
  const slippageFracStressed = Math.min(baseSlipFrac * slipMult, 0.15);  // cap at 15%

  // Token math: spend sizeUsd of USDC → receive baseToken → sell for USDC
  const baseAmt     = (sizeUsd / stressedEntry) * (1 - entryFee);
  const tokenOut    = baseAmt * stressedExit * (1 - exitFee) * (1 - slippageFracStressed);

  // Gas
  const gasUsdStressed = (baseGasUsd ?? 0) * gasMult;

  // Net
  const netProfitUsd = tokenOut - sizeUsd - gasUsdStressed;

  return {
    netProfitUsd     : r4(netProfitUsd),
    tokenOut         : r6(tokenOut),
    gasUsdStressed   : r6(gasUsdStressed),
    slippageFracStressed: r4(slippageFracStressed),
  };
}

// ─── STRESS CASE RUNNER ───────────────────────────────────────────────────────

/**
 * Run all stress cases for a blueprint.
 * Returns a flat map of { caseId → { netProfitUsd, verdict, ... } }
 *
 * @param {object} bp  Blueprint
 * @returns {object}
 */
function runAllStressCases(bp) {
  const cases = {};

  // ── Price drift (gas and slippage at base) ──────────────────────────────────
  for (const { id, bps } of DRIFT_CASES) {
    const r = computeStressedProfit(bp, bps, 1.0, 1.0);
    cases[id] = {
      driftBps       : bps,
      netProfitUsd   : r.netProfitUsd,
      tokenOut       : r.tokenOut,
      verdict        : verdictForCase(r.netProfitUsd),
    };
  }

  // ── Gas stress (no drift, base slippage) ────────────────────────────────────
  for (const { id, mult } of GAS_CASES) {
    const r = computeStressedProfit(bp, 0, mult, 1.0);
    cases[id] = {
      gasMult        : mult,
      gasUsdStressed : r.gasUsdStressed,
      netProfitUsd   : r.netProfitUsd,
      verdict        : verdictForCase(r.netProfitUsd),
    };
  }

  // ── Slippage stress (no drift, base gas) ────────────────────────────────────
  for (const { id, mult } of SLIPPAGE_CASES) {
    const r = computeStressedProfit(bp, 0, 1.0, mult);
    cases[id] = {
      slippageMult         : mult,
      slippageFracStressed : r.slippageFracStressed,
      netProfitUsd         : r.netProfitUsd,
      verdict              : verdictForCase(r.netProfitUsd),
    };
  }

  // ── Delay sensitivity (proxy: adverse drift per block, base gas, base slip) ──
  for (const { id, proxyDriftBps, proxyLabel } of DELAY_CASES) {
    const r = computeStressedProfit(bp, proxyDriftBps, 1.0, 1.0);
    cases[id] = {
      proxyDriftBps  : proxyDriftBps,
      proxyLabel,    // IMPORTANT: clearly labeled as proxy, not actual block replay
      netProfitUsd   : r.netProfitUsd,
      verdict        : verdictForCase(r.netProfitUsd),
    };
  }

  return cases;
}

// ─── FRAGILITY SCORE ──────────────────────────────────────────────────────────

/**
 * Compute fragility score ∈ [0, 1].
 *
 * fragility = (failCount / total) + (marginalCount / total) × 0.5
 *
 * 0.0 = fully robust (all cases PASS)
 * 1.0 = fully fragile (all cases FAIL)
 *
 * Weighted: FAIL counts fully, MARGINAL counts half.
 * Simple, explainable, deterministic.
 *
 * @param {object} cases  Stress case map
 * @returns {number}
 */
function computeFragilityScore(cases) {
  const all   = Object.values(cases);
  const total = all.length;
  if (total === 0) return 1.0;

  const failCount     = all.filter(c => c.verdict === 'FAIL').length;
  const marginalCount = all.filter(c => c.verdict === 'MARGINAL').length;

  const raw = (failCount / total) + (marginalCount / total) * 0.5;
  return +Math.min(1, Math.max(0, raw)).toFixed(4);
}

// ─── OVERALL VERDICT ──────────────────────────────────────────────────────────

/**
 * Determine overall simulation verdict.
 *
 * Rules (deterministic):
 *   SIM_PASS     — ALL core cases pass AND fragility <= FRAGILITY_PASS_MAX
 *   SIM_FAIL     — ANY core case fails OR fragility >= FRAGILITY_FAIL_MIN
 *   SIM_MARGINAL — everything else
 *
 * Core cases: drift_3bp, gas_up_25pct, slippage_x1_5, delay_1_block
 *
 * @param {object} cases        All stress cases
 * @param {number} fragility    Fragility score
 * @returns {'SIM_PASS'|'SIM_MARGINAL'|'SIM_FAIL'}
 */
function computeOverallVerdict(cases, fragility) {
  const coreResults = CORE_CASE_IDS.map(id => cases[id]?.verdict ?? 'FAIL');
  const anyCoreFail = coreResults.includes('FAIL');
  const allCorePass = coreResults.every(v => v === 'PASS');

  if (anyCoreFail || fragility >= FRAGILITY_FAIL_MIN) return 'SIM_FAIL';
  if (allCorePass && fragility <= FRAGILITY_PASS_MAX) return 'SIM_PASS';
  return 'SIM_MARGINAL';
}

// ─── EXECUTION CONFIDENCE ─────────────────────────────────────────────────────

/**
 * Compute execution confidence.
 *
 * Does NOT overwrite blueprint confidence.
 * Returns both for separation of concerns:
 *   blueprintConfidence — structural quality from blueprint engine
 *   executionConfidence — blueprintConfidence × robustnessFactor
 *
 * robustnessFactor = 1 − fragilityScore
 *
 * @param {number} blueprintConfidence
 * @param {number} fragilityScore
 * @returns {{ blueprintConfidence, robustnessFactor, executionConfidence }}
 */
function computeExecutionConfidence(blueprintConfidence, fragilityScore) {
  const conf            = isFinite(blueprintConfidence) ? blueprintConfidence : 0;
  const robustnessFactor = +(1 - fragilityScore).toFixed(4);
  const executionConfidence = +(conf * robustnessFactor).toFixed(4);
  return { blueprintConfidence: +conf.toFixed(4), robustnessFactor, executionConfidence };
}

// ─── BASE CASE ────────────────────────────────────────────────────────────────

/**
 * Compute base case (no stress applied — sanity check reference point).
 *
 * @param {object} bp
 * @returns {{ expectedNetProfitUsd, expectedEdgePct, tokenOut }}
 */
function computeBaseCase(bp) {
  const r = computeStressedProfit(bp, 0, 1.0, 1.0);
  return {
    expectedNetProfitUsd : r.netProfitUsd,
    expectedEdgePct      : r6(bp.economics?.expectedEdgePct),
    tokenOut             : r.tokenOut,
    gasCostUsd           : r6(bp.economics?.gasCostUsd),
    // Sanity: blueprint's own netProfitUsd for cross-check
    blueprintNetProfitUsd: r2(bp.economics?.netProfitUsd),
  };
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

/**
 * Compute summary statistics across all stress cases.
 *
 * @param {object} cases
 * @param {number} fragilityScore
 * @param {'SIM_PASS'|'SIM_MARGINAL'|'SIM_FAIL'} simulationVerdict
 * @returns {object}
 */
function computeSummary(cases, fragilityScore, simulationVerdict) {
  const all    = Object.values(cases);
  const profits = all.map(c => c.netProfitUsd).filter(v => v != null && isFinite(v));

  return {
    totalCases         : all.length,
    passCount          : all.filter(c => c.verdict === 'PASS').length,
    marginalCount      : all.filter(c => c.verdict === 'MARGINAL').length,
    failCount          : all.filter(c => c.verdict === 'FAIL').length,
    coreCasesPass      : CORE_CASE_IDS.every(id => cases[id]?.verdict === 'PASS'),
    worstCaseNetUsd    : profits.length ? r4(Math.min(...profits)) : null,
    bestCaseNetUsd     : profits.length ? r4(Math.max(...profits)) : null,
    fragilityScore,
    simulationVerdict,
  };
}

// ─── PRIMARY ENTRY POINT ──────────────────────────────────────────────────────

/**
 * Simulate a trade blueprint under all stress scenarios.
 *
 * Per-signal fault isolation: degrades gracefully on missing/malformed input.
 * Never throws to the caller.
 *
 * @param {object} blueprint  From trade_blueprint_engine.js or inline activator computation
 * @returns {object}  SIM_EXECUTION_RESULT
 */
function simulateBlueprint(blueprint) {
  try {
    return _simulate(blueprint);
  } catch (err) {
    return {
      simulationId      : nextSimId(),
      blueprintId       : blueprint?.blueprintId ?? null,
      ts                : nowIso(),
      pair              : blueprint?.pair ?? 'unknown',
      _degraded         : true,
      _error            : err.message,
    };
  }
}

function _simulate(bp) {
  if (!bp || typeof bp !== 'object') throw new Error('blueprint must be an object');

  const simId = nextSimId();

  // ── Base case ────────────────────────────────────────────────────────────────
  const baseCase = computeBaseCase(bp);

  // ── All stress cases ─────────────────────────────────────────────────────────
  const stressCases = runAllStressCases(bp);

  // ── Summary metrics ──────────────────────────────────────────────────────────
  const fragilityScore     = computeFragilityScore(stressCases);
  const simulationVerdict  = computeOverallVerdict(stressCases, fragilityScore);
  const summary            = computeSummary(stressCases, fragilityScore, simulationVerdict);

  // ── Confidence ───────────────────────────────────────────────────────────────
  const confidence = computeExecutionConfidence(
    bp.viability?.confidenceScore ?? 0,
    fragilityScore
  );

  return {
    simulationId     : simId,
    blueprintId      : bp.blueprintId ?? null,
    ts               : nowIso(),

    pair             : bp.pair      ?? 'unknown',
    direction        : bp.direction ?? 'unknown',

    baseCase,
    stressCases,
    summary,

    confidence,   // { blueprintConfidence, robustnessFactor, executionConfidence }

    _context: {
      profile         : bp._context?.activeProfile ?? null,
      heatClass       : bp._context?.heatClass     ?? null,
      heatScore       : bp._context?.heatScore      ?? null,
      regime          : bp._context?.regime         ?? null,
      confidenceScore : bp.viability?.confidenceScore ?? null,
      originalSizeUsd : bp._context?.originalSizeUsd ?? null,
      heatSizeAdjusted: bp._context?.heatSizeAdjusted ?? false,
      // Verdict thresholds used — for audit/reproducibility
      _thresholds: {
        passUsd       : PASS_THRESHOLD_USD,
        dustUsd       : DUST_THRESHOLD_USD,
        fragilityPass : FRAGILITY_PASS_MAX,
        fragilityFail : FRAGILITY_FAIL_MIN,
        coreCaseIds   : CORE_CASE_IDS,
      },
    },
  };
}

// ─── MODULE EXPORTS ───────────────────────────────────────────────────────────

module.exports = {
  // Primary entry point
  simulateBlueprint,

  // Lower-level functions (for testing and custom pipelines)
  computeStressedProfit,
  computeFragilityScore,
  computeOverallVerdict,
  computeExecutionConfidence,
  computeBaseCase,
  runAllStressCases,
  verdictForCase,

  // Constants — read-only for report formatting
  DRIFT_CASES,
  GAS_CASES,
  SLIPPAGE_CASES,
  DELAY_CASES,
  CORE_CASE_IDS,
  PASS_THRESHOLD_USD,
  FRAGILITY_PASS_MAX,
  FRAGILITY_FAIL_MIN,
};
