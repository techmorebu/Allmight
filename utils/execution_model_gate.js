'use strict';
/*
 * G-1 — CAPITAL-POLICY EXECUTION-MODEL GATE
 * Boss C9, 2026-09-01.  ISOLATED / NON-CANONICAL staging patch.
 *
 * NOT deployed. capital_policy.js is UNMODIFIED (baseline 82c05921…).
 *
 *   A fail-closed invariant is not implemented until downstream reducers
 *   preserve it.
 *
 * PROVEN DEFECT (C-2): capital_policy.js:161-178 decides eligibility from
 * legacy economics (signal.netSpreadPct) and gateResult.totalScore. It never
 * consults executability, so exec_faithful_v1 would be advisory only.
 *
 * This module is SUBTRACTIVE. It can only add blockers. It cannot raise a
 * score, lower a threshold, widen a gate, or award a tier.
 */

const SUPPORTED_MODEL_VERSIONS = Object.freeze(['exec_faithful_v1']);
const LEGACY_MODEL_VERSIONS   = Object.freeze(['linear_spot_v1']);

// H. Blocker identities — distinct, never collapsed into spread/score failure.
const BLOCKER = Object.freeze({
  NON_EXECUTABLE:      'EXECUTION_MODEL_NON_EXECUTABLE',
  EVIDENCE_INVALID:    'EXECUTION_MODEL_EVIDENCE_INVALID',
  VERSION_UNSUPPORTED: 'EXECUTION_MODEL_VERSION_UNSUPPORTED',
});

/**
 * Returns an array of hard blockers to APPEND to perSignalBlockers, before any
 * score-tier evaluation. Empty array = this gate raises no objection.
 *
 * @param {object} signal  the candidate record
 * @returns {string[]}
 */
function executionModelBlockers(signal) {
  const v = signal ? signal.modelVersion : undefined;

  // 3. Genuine legacy records keep their pre-G-1 behaviour. Absent version is
  //    historical, not a defect — but it is NEVER reinterpreted as supported.
  if (v === undefined || v === null) return [];
  if (LEGACY_MODEL_VERSIONS.includes(v)) return [];

  // 4. Unknown future versions fail closed. An unknown model is NOT legacy.
  if (!SUPPORTED_MODEL_VERSIONS.includes(v)) {
    return [`${BLOCKER.VERSION_UNSUPPORTED}: modelVersion '${String(v)}' is not supported`];
  }

  // 2. Supported version ⇒ the executability field must be a real boolean.
  //    Absent / null / malformed fails closed. Never defaults optimistically —
  //    the `?? 0` pattern at capital_policy.js:161 must not be repeated here.
  const e = signal.executableUnderCurrentExecutor;
  if (typeof e !== 'boolean') {
    return [`${BLOCKER.EVIDENCE_INVALID}: executableUnderCurrentExecutor is ${e === undefined ? 'absent' : JSON.stringify(e)} (boolean required)`];
  }

  // 1. Non-executable fails closed before any tier can be awarded.
  if (e === false) {
    const why = signal.failureClass ? ` (${signal.failureClass})` : '';
    return [`${BLOCKER.NON_EXECUTABLE}: executor cannot complete this candidate${why}`];
  }
  return [];
}

/**
 * Reference implementation of the corrected verdict ordering, reproducing
 * capital_policy.js:174-181 with the model gate inserted BEFORE tiering.
 * The gate must be explicit — never reliant on the score being incidentally low.
 */
function verdictWithGate(signal, gateResult, perSignalBlockersIn) {
  const perSignalBlockers = [...(perSignalBlockersIn || []), ...executionModelBlockers(signal)];
  if (gateResult?.hardBlockers?.length > 0) return { verdict: 'BLOCK', perSignalBlockers };
  if (perSignalBlockers.length > 0)         return { verdict: 'BLOCK', perSignalBlockers };
  if (!gateResult || gateResult.totalScore < 75) return { verdict: 'BLOCK', perSignalBlockers };
  if (gateResult.totalScore < 85)           return { verdict: 'PAPER_ONLY', perSignalBlockers };
  if (gateResult.totalScore < 92)           return { verdict: 'DRY_WALLET_ONLY', perSignalBlockers };
  return { verdict: 'MICRO_LIVE_ELIGIBLE', perSignalBlockers };
}

module.exports = { SUPPORTED_MODEL_VERSIONS, LEGACY_MODEL_VERSIONS, BLOCKER,
                   executionModelBlockers, verdictWithGate };
