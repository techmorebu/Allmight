'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Candidate Audit  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/candidate_audit.js
//  STATUS    : NEW — Boss ruling 2026-04-11
//
//  PURPOSE
//  ─────────
//  Produce a clean, audit-grade record for every EXECUTION_CANDIDATE and
//  every near-miss that was close to ALLOW.
//
//  THIS MODULE DOES NOT:
//  ✗ Send transactions
//  ✗ Wire into any live trade path
//  ✗ Modify activator gates or filter rules
//  ✗ Make RPC calls
//
//  THIS MODULE DOES:
//  ✓ Classify each filter result as CONFIRMED / NEAR_MISS / REJECTED
//  ✓ Identify exactly which rule a near-miss failed on
//  ✓ Produce a deterministic, replayable audit record per candidate
//  ✓ Degrade gracefully on missing/malformed input
//
//  AUDIT VERDICTS
//  ──────────────
//  CANDIDATE_CONFIRMED  — passed all filter rules → ALLOW
//  CANDIDATE_NEAR_MISS  — failed one rule, OR failed two rules that are both near-miss-grade
//                         (see near_miss_multi — e.g. spread slightly below threshold AND SIM_MARGINAL)
//  CANDIDATE_REJECTED   — failed two or more rules (not close to ALLOW)
//
//  NEAR-MISS RULES (one-rule-short-of-ALLOW)
//  ─────────────────────────────────────────
//  near_miss_spread     — spread just below threshold (within NEAR_MISS_SPREAD_GAP_PCT)
//  near_miss_sim        — simulation was MARGINAL (not FAIL)
//  near_miss_size       — size was off by exactly one policy step
//  near_miss_multi      — two rules failed but all failures are near-miss-grade
//
//  NOTE on near_miss_sim: SIM_MARGINAL is captured here because it means the
//  blueprint survived some stress cases but not all. It is more actionable
//  information than a hard SIM_FAIL.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── NEAR-MISS THRESHOLDS ─────────────────────────────────────────────────────
// How close does a spread need to be to the threshold before it qualifies as a
// near-miss? Boss requires "slightly below threshold" — set to 0.03% gap.
// A surface at 0.2100% when threshold is 0.22% is a near-miss (gap = 0.01%).
// A surface at 0.1800% when threshold is 0.22% is not (gap = 0.04%).

const NEAR_MISS_SPREAD_GAP_PCT = 0.03;   // within 3bp of threshold = near-miss

// ─── REGIME FLAGS ─────────────────────────────────────────────────────────────
// Extracted from blueprint _context for human-readable audit summary.

function extractRegimeFlags(bp) {
  const ctx = bp?._context ?? {};
  const flags = [];
  if (ctx.regime)       flags.push(`regime:${ctx.regime}`);
  if (ctx.edgeBucket)   flags.push(`edge:${ctx.edgeBucket}`);
  if (ctx.activeProfile)flags.push(`profile:${ctx.activeProfile}`);
  if (ctx.heatClass && ctx.heatClass !== 'UNKNOWN')
                        flags.push(`heat:${ctx.heatClass}`);
  if (ctx.windowId != null) flags.push(`win:${ctx.windowId}`);
  return flags;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
let _auditSeq = 0;
function nextAuditId() {
  return `AUD-${Date.now().toString(36).toUpperCase()}-${String(++_auditSeq).padStart(6, '0')}`;
}

// ─── NEAR-MISS CLASSIFICATION ─────────────────────────────────────────────────

/**
 * Determine if a REJECT filter result qualifies as a near-miss.
 *
 * Rules:
 *   1. Exactly one core gate failed → near_miss_spread / near_miss_sim / near_miss_size
 *   2. Two gates failed but all within near-miss grade → near_miss_multi
 *   3. Anything else → not a near-miss
 *
 * @param {object} flt   Filter decision from execution_filter.js
 * @param {object} bp    Blueprint record
 * @param {object} sim   Simulation record
 * @returns {{ isNearMiss: boolean, nearMissType: string|null, nearMissDetail: string|null }}
 */
function classifyNearMiss(flt, bp, sim) {
  if (flt.filterDecision === 'ALLOW') {
    return { isNearMiss: false, nearMissType: null, nearMissDetail: null };
  }

  const checks = flt.checks ?? [];
  const failed = checks.filter(c => !c.pass);

  if (failed.length === 0) {
    return { isNearMiss: false, nearMissType: null, nearMissDetail: null };
  }

  const nearMissChecks = [];

  for (const f of failed) {
    if (f.rule === 'spread_gte_min') {
      const spreadPct   = bp?.economics?.spreadPct ?? 0;
      const threshold   = flt?.metrics?.sizeUsd != null
        // get threshold from surface rules via flt detail
        ? parseFloat((f.detail?.match(/required≥([\d.]+)%/) ?? [])[1] ?? '0.22')
        : 0.22;
      const gap = threshold - spreadPct;
      if (gap <= NEAR_MISS_SPREAD_GAP_PCT && gap > 0) {
        nearMissChecks.push({
          rule  : 'near_miss_spread',
          detail: `spreadPct=${spreadPct.toFixed(4)}% threshold=${threshold}% gap=${gap.toFixed(4)}%`,
        });
      }
    } else if (f.rule === 'simulation_pass') {
      const verdict = sim?.summary?.simulationVerdict ?? 'SIM_FAIL';
      if (verdict === 'SIM_MARGINAL') {
        nearMissChecks.push({
          rule  : 'near_miss_sim',
          detail: `simulationVerdict=SIM_MARGINAL fragility=${sim?.summary?.fragilityScore?.toFixed(3)}`,
        });
      }
    } else if (f.rule === 'size_equals_required') {
      // Any size mismatch on the policy seam is a near-miss — it's an upstream policy
      // correction, not a fundamental edge failure. One patch away from ALLOW.
      nearMissChecks.push({
        rule  : 'near_miss_size',
        detail: f.detail,
      });
    }
  }

  if (nearMissChecks.length === 0) {
    return { isNearMiss: false, nearMissType: null, nearMissDetail: null };
  }

  const nearMissType   = nearMissChecks.length === 1
    ? nearMissChecks[0].rule
    : 'near_miss_multi';
  const nearMissDetail = nearMissChecks.map(c => c.detail).join(' | ');

  return { isNearMiss: true, nearMissType, nearMissDetail };
}

// ─── PRIMARY AUDIT FUNCTION ───────────────────────────────────────────────────

/**
 * Produce a single audit record from a (blueprint, simulation, filter) triple.
 *
 * Always returns an object — degrades gracefully on missing input.
 *
 * @param {object} bp    Blueprint from trade_blueprint_engine.js (or inline)
 * @param {object} sim   Simulation result from execution_simulator.js
 * @param {object} flt   Filter decision from execution_filter.js
 * @returns {object}     Audit record
 */
function auditCandidate(bp, sim, flt) {
  try {
    return _audit(bp, sim, flt);
  } catch (err) {
    return {
      candidateAuditId : nextAuditId(),
      ts               : nowIso(),
      blueprintId      : bp?.blueprintId ?? null,
      simulationId     : sim?.simulationId ?? null,
      pair             : bp?.pair ?? 'unknown',
      auditVerdict     : 'CANDIDATE_REJECTED',
      auditReason      : `audit_error: ${err.message}`,
      _degraded        : true,
      _error           : err.message,
    };
  }
}

function _audit(bp, sim, flt) {
  const ctx = bp?._context ?? {};

  // ── Determine audit verdict ───────────────────────────────────────────────
  let auditVerdict, auditReason, nearMissType = null, nearMissDetail = null;

  if (flt?.filterDecision === 'ALLOW') {
    auditVerdict = 'CANDIDATE_CONFIRMED';
    auditReason  = 'all_filter_rules_passed';
  } else {
    const nm = classifyNearMiss(flt, bp, sim);
    if (nm.isNearMiss) {
      auditVerdict  = 'CANDIDATE_NEAR_MISS';
      auditReason   = nm.nearMissType ?? 'near_miss';
      nearMissType  = nm.nearMissType;
      nearMissDetail= nm.nearMissDetail;
    } else {
      auditVerdict = 'CANDIDATE_REJECTED';
      auditReason  = flt?.filterReason ?? 'unknown_filter_reason';
    }
  }

  // ── Assemble record ───────────────────────────────────────────────────────
  const record = {
    candidateAuditId      : nextAuditId(),
    ts                    : nowIso(),

    // Identity
    pair                  : bp?.pair                             ?? 'unknown',
    blueprintId           : bp?.blueprintId                      ?? null,
    simulationId          : sim?.simulationId                    ?? null,
    filterId              : flt?.filterId                        ?? null,

    // Filter layer
    filterDecision        : flt?.filterDecision                  ?? null,
    candidateClass        : flt?.candidateClass                  ?? null,

    // Economics
    spreadPct             : bp?.economics?.spreadPct             ?? null,
    targetExecutionSizeUsd: bp?.sizing?.targetUsd                ?? null,
    baseNetProfitUsd      : sim?.baseCase?.expectedNetProfitUsd  ?? null,

    // Simulation quality
    executionConfidence   : sim?.confidence?.executionConfidence ?? null,
    fragilityScore        : sim?.summary?.fragilityScore         ?? null,
    simulationVerdict     : sim?.summary?.simulationVerdict      ?? null,
    worstCaseNetUsd       : sim?.summary?.worstCaseNetUsd        ?? null,
    bestCaseNetUsd        : sim?.summary?.bestCaseNetUsd         ?? null,

    // Market context
    heatClass             : ctx.heatClass                        ?? null,
    heatScore             : ctx.heatScore                        ?? null,
    heatAdvisory          : ctx.heatAdvisory                     ?? null,
    profile               : ctx.activeProfile                    ?? null,
    regime                : ctx.regime                           ?? null,
    regimeFlags           : extractRegimeFlags(bp),
    edgeBucket            : ctx.edgeBucket                       ?? null,
    direction             : bp?.direction                        ?? null,

    // Audit verdict
    auditVerdict,
    auditReason,

    // Near-miss detail (null if not applicable)
    nearMissType,
    nearMissDetail,
    failedChecks          : (flt?.checks ?? []).filter(c => !c.pass).map(c => ({
      rule  : c.rule,
      detail: c.detail,
    })),

    // Blueprint confidence
    blueprintConfidence   : bp?.viability?.confidenceScore       ?? null,
    bestSizeObserved      : ctx.bestSizeObserved                  ?? null,
  };

  // ── EDGE_EXECUTION_CANDIDATE tag (Boss ruling 2026-04-13) ─────────────────
  // Applied AFTER record is assembled so the classifier reads its own output.
  // Does not change auditVerdict or candidateClass — analysis tag only.
  record.edgeExecutionCandidate = isEdgeExecutionCandidate(record);
  if (record.edgeExecutionCandidate) {
    record.edgeExecutionReason =
      `SAFE + near_miss_spread + SIM_PASS + conf>=${EDGE_MIN_CONFIDENCE} — tracking only, not admission`;
  }

  // ── THRESHOLD TIER tag (Boss ruling 2026-04-19) ────────────────────────────
  // 3-band policy: CONFIRMED_STRICT / ADAPTIVE_BUFFER / BELOW_BUFFER.
  // Analysis tag only — does not change auditVerdict or filterDecision.
  record.thresholdTier = classifyThresholdTier(record);

  return record;
}

/**
 * Audit a batch of (blueprint, simulation, filter) triples.
 * Per-entry fault isolation — one bad entry never breaks the batch.
 *
 * @param {Array<{blueprint, simulation, filter}>} triples
 * @returns {object[]}  Audit records
 */
function auditBatch(triples) {
  if (!Array.isArray(triples) || !triples.length) return [];
  return triples.map(({ blueprint: bp, simulation: sim, filter: flt }) => {
    try {
      return auditCandidate(bp, sim, flt);
    } catch (err) {
      process.stderr.write(`[candidate_audit] batch error: ${err.message}\n`);
      return auditCandidate(null, null, null);
    }
  });
}

// ─── EDGE EXECUTION CANDIDATE CLASSIFIER ─────────────────────────────────────
// Boss ruling 2026-04-13: new analysis-only label for structurally recurring
// threshold-edge records. This is a TRACKING tag — NOT a filter admission class.
//
// Definition:
//   auditVerdict  = CANDIDATE_NEAR_MISS
//   nearMissType  = near_miss_spread
//   simulationVerdict = SIM_PASS
//   executionConfidence >= 0.65
//   profile = SAFE
//
// Note on regime: Boss brief specified persistent_depth_regime, but live data
// shows these records appear in 'surge' regime. The regime is logged as context
// but NOT used as a hard gate — preserving the real structural signal.
// Revisit if regime distribution shifts across future sessions.

const EDGE_MIN_CONFIDENCE = 0.65;
const EDGE_REQUIRED_PROFILE = 'SAFE';

/**
 * Determine whether an audit record qualifies as EDGE_EXECUTION_CANDIDATE.
 * Pure function — deterministic, no side effects.
 *
 * @param {object} record  Completed audit record
 * @returns {boolean}
 */
function isEdgeExecutionCandidate(record) {
  if (!record) return false;
  return (
    record.auditVerdict        === 'CANDIDATE_NEAR_MISS'  &&
    record.nearMissType        === 'near_miss_spread'      &&
    record.simulationVerdict   === 'SIM_PASS'              &&
    typeof record.executionConfidence === 'number'         &&
    record.executionConfidence >= EDGE_MIN_CONFIDENCE      &&
    record.profile             === EDGE_REQUIRED_PROFILE
  );
}



// ─── THRESHOLD TIER CLASSIFIER ───────────────────────────────────────────────
// Boss ruling 2026-04-19: 3-band threshold policy for ETH/USDC-RAMSES.
//
// Band definitions:
//   CONFIRMED_STRICT  — spread >= 0.2200%  (hard confirmed floor, unchanged)
//   ADAPTIVE_BUFFER   — 0.2185% <= spread < 0.2200%  AND safety conditions pass
//   BELOW_BUFFER      — everything else (spread < 0.2185% OR buffer conditions fail)
//
// Adaptive buffer safety conditions (ALL must pass):
//   1. profile = SAFE
//   2. executionConfidence >= 0.70  (higher bar than edge — 0.65 < buffer <= confirmed)
//   3. simulationVerdict = SIM_PASS
//   4. worstCaseNetUsd > 0         (positive worst-case realism)
//   5. regime in ('surge', 'persistent_depth_regime')  (strong regime only)
//
// This tag is ANALYSIS ONLY — it does not change auditVerdict, candidateClass,
// or filterDecision. It enables per-tier reporting and future size policy work.
//
// Size policy (for future execution tiering, not yet active):
//   CONFIRMED_STRICT : baseline notional + scale candidates
//   ADAPTIVE_BUFFER  : smaller notional — same as baseline, not scaled
//   BELOW_BUFFER     : no execution, analytics only

const TIER_CONFIRMED_SPREAD   = 0.22;    // confirmed floor (unchanged)
const TIER_ADAPTIVE_SPREAD_LO = 0.2185;  // adaptive buffer lower bound
const TIER_ADAPTIVE_MIN_CONF  = 0.70;    // higher confidence bar for buffer tier
const TIER_ADAPTIVE_REGIMES   = new Set(['surge', 'persistent_depth_regime']);

/**
 * Classify an audit record into a threshold tier.
 * Pure function — deterministic, no side effects.
 *
 * @param {object} record  Completed audit record
 * @returns {'CONFIRMED_STRICT'|'ADAPTIVE_BUFFER'|'BELOW_BUFFER'}
 */
function classifyThresholdTier(record) {
  if (!record) return 'BELOW_BUFFER';

  const spread    = record.spreadPct          ?? 0;
  const conf      = record.executionConfidence ?? 0;
  const simVerdict= record.simulationVerdict   ?? '';
  const profile   = record.profile             ?? '';
  const regime    = record.regime              ?? '';
  const worstCase = record.worstCaseNetUsd     ?? null;

  // Band 1 — Confirmed strict: spread at or above confirmed floor
  if (spread >= TIER_CONFIRMED_SPREAD) return 'CONFIRMED_STRICT';

  // Band 2 — Adaptive buffer: spread in buffer zone AND all safety conditions pass
  if (
    spread >= TIER_ADAPTIVE_SPREAD_LO  &&
    spread <  TIER_CONFIRMED_SPREAD    &&
    profile      === 'SAFE'            &&
    conf         >= TIER_ADAPTIVE_MIN_CONF &&
    simVerdict   === 'SIM_PASS'        &&
    typeof worstCase === 'number'      &&
    worstCase    >  0                  &&
    TIER_ADAPTIVE_REGIMES.has(regime)
  ) {
    return 'ADAPTIVE_BUFFER';
  }

  // Band 3 — Below buffer: everything else
  return 'BELOW_BUFFER';
}

module.exports = {
  auditCandidate,
  auditBatch,
  classifyNearMiss,
  extractRegimeFlags,
  isEdgeExecutionCandidate,
  classifyThresholdTier,
  NEAR_MISS_SPREAD_GAP_PCT,
  EDGE_MIN_CONFIDENCE,
  EDGE_REQUIRED_PROFILE,
  TIER_CONFIRMED_SPREAD,
  TIER_ADAPTIVE_SPREAD_LO,
  TIER_ADAPTIVE_MIN_CONF,
};
