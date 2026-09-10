# M2E-017G R80 EXECUTOR RE-CERTIFICATION PLAN

Generated 2026-09-10T04:36:49Z. **PROPOSED — not authorized for execution.**

Target `583cfdbc4dff6a3351136dc98257f19ed1c2735348c6eb553c2ee8e66d50eae7` (NOT CERTIFIED).
Verifier hash: TBD — not yet built (R80 Ruling 7 forbids building the host runner yet).

## SCOPE (R80 Ruling 1) — full matrix, no delta certification
All 42 R28 cases: A01-A04 (4) · I01-I06 (6) · D01-D06 (6) · S01-S08 (8) ·
C01-C08 (8) · **T01-T10 (10)**. Sum 4+6+6+8+8+10 = 42.
Plus the mandatory R28 **self-lineage / process-selection regression**.
Definitions transcribed in `M2E017G_EXECUTOR_BEHAVIOR_MATRIX.md` from R28 exact bytes.

## R40 AUDITS (R80 Ruling 2 — apply as written, including new seam gates)
Authority `f12e5ab2b696d7848b0637d28f1b489ed0943f2ee0ba6d6d69de4a896ada92d3`.
**PROPOSED** — exact clause citation deferred until Boss rules the recovered bytes
authoritative; per R80A they are `RECOVERED_GOVERNANCE_AUTHORITY_CANDIDATE` only.
1. Command-position audit across production path, seam path, verifier helpers, hook
   invocation, adapter boundary, control-state transition, launcher boundary.
2. Verifier-consistency: a verifier may not certify a path command execution would
   reject, and vice versa; terminal states cannot be followed by valid governed
   execution evidence; certification must use authoritative executor evidence fields,
   not runner-reconstructed substitutes.
3. **R79 lesson, binding:** absence of a literal `kill` does not prove absence of
   signal authority. Audit effective executable capability, including indirect
   signal-capable helpers such as `timeout`.

## OVERLAYS (R80 Ruling 4)
**A. Synthetic seam** — lock completeness and each-lock-missing; malformed/unreadable
map; synthetic ≠ governed baseline; ≠ PID 0/1; ≠ executor/ancestors; P5 binding
mismatch; TEST_ADAPTER selects the adapter branch; production defaults; no mixed
fallback; hook mutation impossible without its independent ownership gate.
*R79 evidence is reusable for the topology property only* — real pgrep parentage can
freeze the correct non-governed fixture descendant under the synthetic world. **Not**
reusable as proof of teardown, TERM delivery, SP01, restart or launcher behaviour.

**B. PID-0/1 ancestor fix** — PID 0 rejected; PID 1 rejected; executor PID rejected;
every executor ancestor rejected; a valid non-governed fixture descendant still
admissible; stale governed identities still rejected; no regression in the P5
six-predicate result.

## EVIDENCE SCHEMA (R80 Ruling 5) — per case
`case_id · category · fixture identity · expected gate/result · actual gate/result ·
executor exit status · authoritative executor evidence field · independent verifier
result · EXECUTOR_RESULT==EXPECTED · VERIFIER_RESULT==EXPECTED ·
EXECUTOR_AND_VERIFIER_CONSISTENT`.
Any disagreement is certification failure even if one side reports PASS. Evidence must
be case-bounded and attributable to the exact invocation. No PASS may be manufactured
by finding expected strings anywhere in a log.

## SAFETY PROOF OBLIGATION (R80 §13)
The audit harness must demonstrate it cannot restart, launch, broadcast, touch capital
or mutate canonical control state, reported as three separate surfaces:
runner-direct · executor real-signal branch · certified P3 cleanup.

## BUG INTERLOCK (R80C)
- `OPEN_BUGS_AFFECTING_EXECUTOR`: BUG-004 (S2, runtime/restart readiness), BUG-009 (S1, CPT tooling)
- `BUG-010` (S2, documentation scope) FIX_VALIDATED under R80D
- `CLOSED_BUGS_RETESTED`: BUG-005, BUG-006, BUG-007
- `KNOWN_LIMITATIONS`: predecessor bytes unavailable; SP01-SP05 never run; real
  teardown untested; zero-real-signal is inferred not observed
- `REGRESSION_CASES`: SB matrix; R79 negatives; SP01-SP05 when authorized

## T05-T10 (corrected R80D)
```
REQUIRED_MATRIX_CASES
EXECUTION_DEPENDENCY=LAUNCHER
CURRENT_EXECUTION_AUTHORITY=LOCKED
```
Boss to rule: fixture-reproducible without canonical launcher mutation, or a later
bounded launcher certification window. **Not silently omitted.**

## HOST PRE/POST CONDITIONS (proposed)
Pre: canonical HEAD exact · governed hits 0 · baseline 8/8 absent · three control
hashes match standing R79C values · fixture path absent.
Post: all of the above unchanged · fixture cleaned · all component SHAs unchanged.

## ACCEPTANCE RULE (proposed)
`R80_RESULT=EXECUTOR_583cfdbc_RECERTIFICATION_PASS` only if every one of: full matrix
PASS · both R40 audits PASS · both overlays PASS · evidence verifier PASS ·
executor/verifier consistency PASS · immutable hashes exact · no unauthorized surface
exercised · post-run integrity PASS. **A generic completion is not a pass.**
Certification would still not authorize SP01, restart, launcher, broadcast or capital.
