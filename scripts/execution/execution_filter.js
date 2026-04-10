'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution Filter  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/execution_filter.js
//  STATUS    : NEW — Boss ruling 2026-04-10 (Execution Filter Layer)
//
//  PURPOSE
//  ─────────
//  Deterministic classification layer between simulation results and execution.
//  Takes a simulation result + its source blueprint and answers:
//
//    "Does this blueprint belong to the execution-candidate class?"
//
//  THIS MODULE DOES NOT:
//  ✗ Send transactions
//  ✗ Modify activator gates
//  ✗ Feed back into the arming logic
//  ✗ Change sizing dynamically
//  ✗ Call any RPC or I/O
//
//  THIS MODULE DOES:
//  ✓ Apply Boss-approved surface-specific filter rules
//  ✓ Classify every blueprint into exactly one candidate class
//  ✓ Return a deterministic filter decision with explicit reason
//  ✓ Degrade gracefully on missing/malformed input — never throws
//
//  PIPELINE POSITION (passive — read-only from activator perspective)
//  ─────────────────────────────────────────────────────────────────
//  ACTIVATOR → BLUEPRINT → SIMULATION → [this module] → FILTER_LOGGER
//                                                        ↕
//                                               (future: Execution Filter Gate)
//
//  CANDIDATE CLASSES (all four required by Boss)
//  ──────────────────────────────────────────────
//  EXECUTION_CANDIDATE  — passes ALL filter rules → eligible for execution design
//  SIM_MARGINAL         — simulation was marginal (not an outright fail)
//  BLUEPRINT_ONLY       — blueprint valid, simulation failed
//  DETECTION_ONLY       — signal valid but below viable spread floor
//
//  FILTER DECISIONS
//  ────────────────
//  ALLOW   — candidateClass = EXECUTION_CANDIDATE
//  REJECT  — any other candidateClass
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SURFACE FILTER RULES ─────────────────────────────────────────────────────
// Boss ruling 2026-04-10: first execution candidate class for ETH/USDC-RAMSES.
// Data-proven: spread ≥ 0.22% at $200 produces 100% SIM_PASS rate.
//
// Rules are surface-specific. Add a new entry when a new surface is promoted.
// Do NOT change existing rules without a Boss ruling — they are data-derived.
//
// All monetary thresholds in same units as blueprint fields:
//   spreadPct    → percent  (0.22 = 0.22%)
//   targetUsd    → dollars  (200   = $200)

const SURFACE_RULES = Object.freeze({
  'ETH/USDC-RAMSES': Object.freeze({
    // Core execution candidate rules (Boss ruling 2026-04-10)
    // Empirical basis: 56 blueprints at spread ≥ 0.22% AND $200 → 100% SIM_PASS
    minSpreadPct   : 0.22,   // premium execution zone — 100% SIM_PASS threshold
    requiredSizeUsd: 200,    // $200 = optimal notional (gas-edge breakeven point)
    requireSimPass : true,   // must be SIM_PASS — not MARGINAL, not FAIL

    // Optional supporting conditions — logged but not hard-blocking in v1.
    // Set to true to make them hard rules in a future version.
    preferNotDegraded  : true,  // profile not in degraded RPC mode (advisory)
    preferHeatKnown    : true,  // heatClass not UNKNOWN (advisory)
    preferProviderHealthy: true, // no current STATE_UNHEALTHY (advisory)
  }),

  // ── Future surfaces — add here after Boss classification ────────────────────
  // 'ETH/USDC:ramses_v2↔sushiswap_v3': { ... }
  // 'ARB/USDC': { ... }
});

// ─── SPREAD BAND BOUNDARIES ───────────────────────────────────────────────────
// Used to determine candidateClass when filter rejects.
// Consistent with Boss's 3-band model from 2026-04-10 ruling.

const SPREAD_DETECTION_FLOOR = 0.13;  // Band A: signal is real
const SPREAD_EXECUTION_FLOOR = 0.22;  // Band C: execution-simulation valid

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
let _filterSeq = 0;
function nextFilterId() {
  return `FILT-${Date.now().toString(36).toUpperCase()}-${String(++_filterSeq).padStart(6, '0')}`;
}

// ─── CANDIDATE CLASS ──────────────────────────────────────────────────────────

/**
 * Determine the candidate class from blueprint + simulation data.
 * Independent of surface-specific rules — purely based on signal quality layers.
 *
 * @param {object} bp   Blueprint
 * @param {object} sim  Simulation result
 * @returns {'EXECUTION_CANDIDATE'|'SIM_MARGINAL'|'BLUEPRINT_ONLY'|'DETECTION_ONLY'}
 */
function deriveCandidateClass(bp, sim) {
  const spreadPct = bp?.economics?.spreadPct ?? 0;
  const verdict   = sim?.summary?.simulationVerdict;

  // Below detection floor → DETECTION_ONLY regardless of simulation
  if (spreadPct < SPREAD_DETECTION_FLOOR) return 'DETECTION_ONLY';

  // Simulation not available or degraded → BLUEPRINT_ONLY
  if (!verdict || sim?._degraded) return 'BLUEPRINT_ONLY';

  // Simulation was marginal → SIM_MARGINAL
  if (verdict === 'SIM_MARGINAL') return 'SIM_MARGINAL';

  // Simulation failed → BLUEPRINT_ONLY (signal + blueprint valid, sim fails)
  if (verdict === 'SIM_FAIL') return 'BLUEPRINT_ONLY';

  // Simulation passed AND spread in execution zone → EXECUTION_CANDIDATE
  if (verdict === 'SIM_PASS' && spreadPct >= SPREAD_EXECUTION_FLOOR) {
    return 'EXECUTION_CANDIDATE';
  }

  // SIM_PASS but spread below execution floor → BLUEPRINT_ONLY
  // (simulation says ok, but not in the execution-grade zone yet)
  return 'BLUEPRINT_ONLY';
}

// ─── PRIMARY FILTER ───────────────────────────────────────────────────────────

/**
 * Apply surface-specific filter rules to a blueprint + simulation pair.
 *
 * Deterministic. Per-pair fault isolation. Never throws.
 *
 * @param {object} bp   Blueprint from trade_blueprint_engine.js
 * @param {object} sim  Simulation result from execution_simulator.js
 * @returns {object}   Filter decision record
 */
function applyFilter(bp, sim) {
  try {
    return _applyFilter(bp, sim);
  } catch (err) {
    return {
      filterId        : nextFilterId(),
      ts              : nowIso(),
      blueprintId     : bp?.blueprintId ?? null,
      simulationId    : sim?.simulationId ?? null,
      pair            : bp?.pair ?? 'unknown',
      filterDecision  : 'REJECT',
      filterReason    : `filter_error: ${err.message}`,
      candidateClass  : 'BLUEPRINT_ONLY',
      _degraded       : true,
      _error          : err.message,
    };
  }
}

function _applyFilter(bp, sim) {
  const pair      = bp?.pair ?? 'unknown';
  const rules     = SURFACE_RULES[pair];
  const filterId  = nextFilterId();
  const ts        = nowIso();

  // ── Candidate class (independent of surface rules) ────────────────────────
  const candidateClass = deriveCandidateClass(bp, sim);

  // ── No rules defined for this surface ────────────────────────────────────
  if (!rules) {
    return {
      filterId, ts,
      blueprintId    : bp?.blueprintId     ?? null,
      simulationId   : sim?.simulationId   ?? null,
      pair,
      filterDecision : 'REJECT',
      filterReason   : 'no_surface_rules',
      candidateClass,
      rulesApplied   : false,
    };
  }

  // ── Extract values ────────────────────────────────────────────────────────
  const spreadPct   = bp?.economics?.spreadPct             ?? 0;
  const sizeUsd     = bp?.sizing?.targetUsd                ?? 0;
  const verdict     = sim?.summary?.simulationVerdict      ?? 'SIM_FAIL';
  const rpcDegraded = bp?._context?.rpcDegraded            ?? false;
  const heatClass   = bp?._context?.heatClass              ?? 'UNKNOWN';
  const profile     = bp?._context?.activeProfile          ?? 'SAFE';

  // ── Core hard rules — rejection short-circuits ───────────────────────────
  // Evaluated in order. First failure wins. All reported for audit.

  const checks = [
    {
      rule    : 'spread_gte_min',
      pass    : spreadPct >= rules.minSpreadPct,
      detail  : `spreadPct=${spreadPct.toFixed(4)}%  required≥${rules.minSpreadPct}%`,
    },
    {
      rule    : 'size_equals_required',
      pass    : sizeUsd === rules.requiredSizeUsd,
      detail  : `sizeUsd=${sizeUsd}  required=${rules.requiredSizeUsd}`,
    },
    {
      rule    : 'simulation_pass',
      pass    : !rules.requireSimPass || verdict === 'SIM_PASS',
      detail  : `simulationVerdict=${verdict}`,
    },
  ];

  const firstFail = checks.find(c => !c.pass);

  if (firstFail) {
    return {
      filterId, ts,
      blueprintId    : bp?.blueprintId   ?? null,
      simulationId   : sim?.simulationId ?? null,
      pair,
      filterDecision : 'REJECT',
      filterReason   : firstFail.rule,
      filterDetail   : firstFail.detail,
      candidateClass,
      checks,
      // Advisory conditions — logged even on reject for future tuning
      advisory: {
        rpcDegraded,
        heatClass,
        heatKnown   : heatClass !== 'UNKNOWN',
        profile,
        preferNotDegraded  : rules.preferNotDegraded,
        preferHeatKnown    : rules.preferHeatKnown,
      },
      // Key metrics for report
      metrics: {
        spreadPct,
        sizeUsd,
        simulationVerdict : verdict,
        fragilityScore    : sim?.summary?.fragilityScore ?? null,
        executionConfidence: sim?.confidence?.executionConfidence ?? null,
        blueprintConfidence: bp?.viability?.confidenceScore ?? null,
      },
    };
  }

  // ── All hard rules passed — ALLOW ─────────────────────────────────────────
  // Check advisory conditions — log but do not block.
  const advisoryWarnings = [];
  if (rules.preferNotDegraded && rpcDegraded)      advisoryWarnings.push('rpc_degraded');
  if (rules.preferHeatKnown   && heatClass === 'UNKNOWN') advisoryWarnings.push('heat_unknown');

  return {
    filterId, ts,
    blueprintId    : bp?.blueprintId   ?? null,
    simulationId   : sim?.simulationId ?? null,
    pair,
    filterDecision : 'ALLOW',
    filterReason   : 'all_rules_passed',
    candidateClass : 'EXECUTION_CANDIDATE',
    checks,
    advisoryWarnings: advisoryWarnings.length ? advisoryWarnings : [],
    advisory: {
      rpcDegraded,
      heatClass,
      heatKnown   : heatClass !== 'UNKNOWN',
      profile,
    },
    metrics: {
      spreadPct,
      sizeUsd,
      simulationVerdict    : verdict,
      fragilityScore       : sim?.summary?.fragilityScore          ?? null,
      executionConfidence  : sim?.confidence?.executionConfidence  ?? null,
      blueprintConfidence  : bp?.viability?.confidenceScore        ?? null,
      baseNetProfitUsd     : sim?.baseCase?.expectedNetProfitUsd   ?? null,
      direction            : bp?.direction                          ?? null,
      regime               : bp?._context?.regime                   ?? null,
      edgeBucket           : bp?._context?.edgeBucket               ?? null,
      heatScore            : bp?._context?.heatScore                ?? null,
    },
  };
}

/**
 * Filter an array of (blueprint, simulation) pairs.
 * Per-entry fault isolation — one bad entry never breaks the batch.
 *
 * @param {Array<{blueprint, simulation}>} pairs
 * @returns {object[]}  Array of filter decisions
 */
function filterBatch(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return [];
  return pairs.map(({ blueprint, simulation }) => {
    try {
      return applyFilter(blueprint, simulation);
    } catch (err) {
      process.stderr.write(`[execution_filter] batch entry error: ${err.message}\n`);
      return applyFilter(null, null);
    }
  });
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  applyFilter,
  filterBatch,
  deriveCandidateClass,

  // Constants — read-only
  SURFACE_RULES,
  SPREAD_DETECTION_FLOOR,
  SPREAD_EXECUTION_FLOOR,
};
