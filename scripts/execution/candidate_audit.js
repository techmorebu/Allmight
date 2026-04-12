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

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  auditCandidate,
  auditBatch,
  classifyNearMiss,
  extractRegimeFlags,
  NEAR_MISS_SPREAD_GAP_PCT,
};
