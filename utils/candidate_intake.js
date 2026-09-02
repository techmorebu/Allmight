'use strict';
/*
 * I-2 — EXACT-CANDIDATE EXECUTION ADMISSION (ISOLATED STAGING)
 * Boss C9, 2026-09-01. NOT deployed. No canonical file modified.
 *
 * Replaces "latest record" selection with explicit-identity intake on the JS
 * capital-moving admission path ONLY. The non-writing live-shadow research
 * companion is deliberately untouched.
 *
 *   EXECUTION REQUEST → immutable candidate identity → exact candidate evidence
 *   → modelVersion → executableUnderCurrentExecutor → execution-model gate
 *   → independent LIVE_DEPLOY_APPROVED → only then executor interaction
 */
const A = require('./admission_gate');
const G1 = require('./execution_model_gate');

// Boss C9 auditability refinement. Production taxonomy was inspected first:
// capital_policy.js exposes VERDICT TIERS ('PAPER_ONLY', 'DRY_WALLET_ONLY',
// 'MICRO_LIVE_ELIGIBLE'), not blocker codes, and micro_live_oneshot.js defines
// no uppercase rejection vocabulary. No existing code covers global live
// authorization, so this one is introduced without competing with any.
// It does NOT change LIVE_DEPLOY_APPROVED semantics — it only makes the
// existing rejection reason explicit and auditable.
const GLOBAL_AUTH_BLOCKER = 'GLOBAL_LIVE_AUTHORIZATION_NOT_APPROVED';

const INTAKE = Object.freeze({
  CANDIDATE_NOT_FOUND:         'CANDIDATE_NOT_FOUND',
  CANDIDATE_IDENTITY_AMBIGUOUS:'CANDIDATE_IDENTITY_AMBIGUOUS',
  IDENTITY_NOT_SUPPLIED:       'IDENTITY_NOT_SUPPLIED',
  BLUEPRINT_NOT_FOUND:         'BLUEPRINT_NOT_FOUND',
  BLUEPRINT_IDENTITY_MISMATCH: 'BLUEPRINT_IDENTITY_MISMATCH',
});

// Canonical rule already in use: dry_execution_engine.js:309
const blockOfSignalId = (id) => {
  const tail = String(id ?? '').split('-').pop();
  const n = Number(tail);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Exact intake. NO "latest" fallback exists anywhere in this function.
 * @param {string} requestedSignalId
 * @param {Array}  candidates   candidate records (order irrelevant by design)
 * @param {Array}  blueprints   blueprint records keyed by signalBlock
 * @param {boolean} liveDeployApproved
 */
function admitExactCandidate(requestedSignalId, candidates, blueprints, liveDeployApproved) {
  const out = { requestedSignalId: requestedSignalId ?? null, admitted: false,
                blockers: [], candidate: null, blueprint: null,
                executabilityAdmitted: false, authorizationApproved: liveDeployApproved === true };

  // 1/2. identity must be supplied — never defaulted, never inferred
  if (requestedSignalId === undefined || requestedSignalId === null || String(requestedSignalId) === '') {
    out.blockers.push(`${INTAKE.IDENTITY_NOT_SUPPLIED}: no explicit signalId supplied; latest-candidate selection is not permitted`);
    return out;
  }

  // 3/4. exact lookup with duplicate detection — selection is by identity only,
  // so ordering and recency are irrelevant and cannot influence the result.
  const matches = (candidates || []).filter((c) => c && String(c.signalId) === String(requestedSignalId));
  if (matches.length === 0) {
    out.blockers.push(`${INTAKE.CANDIDATE_NOT_FOUND}: no candidate with signalId '${requestedSignalId}'`);
    return out;
  }
  if (matches.length > 1) {
    out.blockers.push(`${INTAKE.CANDIDATE_IDENTITY_AMBIGUOUS}: ${matches.length} candidates share signalId '${requestedSignalId}'`);
    return out;
  }
  const candidate = matches[0];
  out.candidate = { signalId: candidate.signalId, modelVersion: candidate.modelVersion ?? null };

  // 7. blueprint linkage via EXISTING canonical identity rules — never a
  // separately fetched "latest" blueprint.
  const block = blockOfSignalId(candidate.signalId);
  const bpMatches = (blueprints || []).filter((b) => b && Number(b.signalBlock) === block);
  if (block === null || bpMatches.length === 0) {
    out.blockers.push(`${INTAKE.BLUEPRINT_NOT_FOUND}: no blueprint with signalBlock ${block} for candidate '${candidate.signalId}'`);
    return out;
  }
  if (bpMatches.length > 1) {
    out.blockers.push(`${INTAKE.BLUEPRINT_IDENTITY_MISMATCH}: ${bpMatches.length} blueprints share signalBlock ${block}`);
    return out;
  }
  out.blueprint = { signalBlock: bpMatches[0].signalBlock };

  // 6/8/9/10/11/12/13. shared gate — identical taxonomy, MICRO_LIVE boundary
  const gate = A.admissionBlockers(candidate, A.BOUNDARY.MICRO_LIVE,
    { requestedIdentity: requestedSignalId });
  out.blockers.push(...gate.blockers);
  out.executabilityAdmitted = gate.admitted;

  // 12/13. orthogonal gates; neither substitutes for the other.
  // The booleans remain independent AND the global rejection is now explicit,
  // so a receipt records WHY authorization failed rather than only that it did.
  if (!out.authorizationApproved) {
    out.blockers.push(`${GLOBAL_AUTH_BLOCKER}: LIVE_DEPLOY_APPROVED is not true`);
  }
  out.admitted = gate.admitted && out.authorizationApproved;
  return out;
}

module.exports = { INTAKE, GLOBAL_AUTH_BLOCKER, BLOCKER: A.BLOCKER, G1_BLOCKER: G1.BLOCKER,
                   blockOfSignalId, admitExactCandidate };
