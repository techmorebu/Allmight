'use strict';
/*
 * G-4 — SHARED END-TO-END EXECUTION-MODEL ADMISSION GATE
 * Boss C9, 2026-09-01.  ISOLATED / NON-CANONICAL. No canonical file modified.
 *
 *   One shared gate, invoked at every independent candidate-admission boundary,
 *   identical taxonomy, fail closed everywhere, no downstream restoration.
 *
 * Extends the ACCEPTED G-1 module rather than reimplementing it — three copies
 * of one semantic is the divergence failure this project has repeatedly hit.
 */
const G1 = require('./execution_model_gate');

// J. PER-BOUNDARY LEGACY POLICY — stated explicitly, not one blanket rule.
const BOUNDARY = Object.freeze({
  // Scoring/eligibility. Legacy records predate the model and must retain
  // historical behaviour, or G-1 would retroactively block all history.
  CAPITAL_POLICY: { id: 'CAPITAL_POLICY', legacy: 'ALLOWED_HISTORICAL' },
  // Dry execution processes recorded ledger rows, including historical ones.
  // Legacy rows are DIAGNOSTIC-ONLY: they may be processed for analysis but
  // must never be treated as execution-faithful.
  DRY_EXECUTION:  { id: 'DRY_EXECUTION',  legacy: 'DIAGNOSTIC_ONLY' },
  // Live execution risks capital. A record lacking exec_faithful_v1 evidence
  // cannot demonstrate executability, so legacy FAILS CLOSED here.
  MICRO_LIVE:     { id: 'MICRO_LIVE',     legacy: 'FAIL_CLOSED' },
});

const BLOCKER = Object.freeze({
  ...G1.BLOCKER,
  EVIDENCE_IDENTITY_MISMATCH: 'EXECUTION_MODEL_EVIDENCE_IDENTITY_MISMATCH',
  LEGACY_NOT_PERMITTED:       'EXECUTION_MODEL_LEGACY_NOT_PERMITTED',
});

const isLegacy = (s) => {
  const v = s ? s.modelVersion : undefined;
  return v === undefined || v === null || G1.LEGACY_MODEL_VERSIONS.includes(v);
};

/**
 * @param {object} candidate       the record being admitted
 * @param {object} boundary        one of BOUNDARY.*
 * @param {object} [opts]          { requestedIdentity } for live-path linkage
 * @returns {{admitted:boolean, blockers:string[], boundary:string}}
 */
function admissionBlockers(candidate, boundary, opts = {}) {
  const b = boundary || BOUNDARY.CAPITAL_POLICY;
  const blockers = [];

  if (isLegacy(candidate)) {
    if (b.legacy === 'FAIL_CLOSED') {
      blockers.push(`${BLOCKER.LEGACY_NOT_PERMITTED}: ${b.id} requires exec_faithful_v1 evidence; record is legacy/unversioned`);
      return { admitted: false, blockers, boundary: b.id };
    }
    // ALLOWED_HISTORICAL and DIAGNOSTIC_ONLY raise no execution-model blocker.
    return { admitted: true, blockers, boundary: b.id };
  }

  // Non-legacy: identical G-1 semantics at every boundary.
  blockers.push(...G1.executionModelBlockers(candidate));

  // Live path additionally requires the evidence be bound to THIS candidate.
  // Boss: a gate satisfied by an unrelated "latest" record is not a gate.
  if (b.id === BOUNDARY.MICRO_LIVE.id) {
    const want = opts.requestedIdentity ?? null;
    const have = candidate ? candidate.signalId : undefined;
    if (!want || !have || String(want) !== String(have)) {
      blockers.push(`${BLOCKER.EVIDENCE_IDENTITY_MISMATCH}: evidence signalId '${String(have)}' is not bound to requested candidate '${String(want)}'`);
    }
  }
  return { admitted: blockers.length === 0, blockers, boundary: b.id };
}

/** Dry path: consume upstream evidence — never recompute executability. */
function dryAdmissionFilter(ledgerRows, opts = {}) {
  return (ledgerRows || []).filter((r) => {
    if (r.realisticSurvives !== true) return false;          // existing predicate, unchanged
    return admissionBlockers(r, BOUNDARY.DRY_EXECUTION, opts).admitted;
  });
}

/** Live path: BOTH global authorization AND per-candidate executability. */
function liveAdmission(candidate, requestedIdentity, liveDeployApproved) {
  const r = admissionBlockers(candidate, BOUNDARY.MICRO_LIVE, { requestedIdentity });
  const authorized = liveDeployApproved === true;
  return {
    admitted: r.admitted && authorized,
    executabilityAdmitted: r.admitted,
    authorizationApproved: authorized,
    blockers: r.blockers,
    boundary: r.boundary,
  };
}

module.exports = { BOUNDARY, BLOCKER, admissionBlockers, dryAdmissionFilter, liveAdmission, isLegacy };
