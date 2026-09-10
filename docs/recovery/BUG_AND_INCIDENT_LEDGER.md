# PROJECT ALLMIGHT — BUG / INCIDENT LEDGER

Generated 2026-09-10T04:36:49Z. Standard: R80C. Historical identifiers preserved, never renumbered.

Status values: OPEN · TRIAGED · ROOT_CAUSE_PENDING · ROOT_CAUSE_CONFIRMED ·
FIX_AUTHORIZED · FIX_IMPLEMENTED · VALIDATION_PENDING · FIX_VALIDATED · CLOSED ·
PARKED · WONT_FIX. Severity S0-S4 by consequence.

---
## INCIDENT 015 — live callStatic signer/owner mismatch
**Status** PARKED · **Severity** not re-derived
**Provenance** RECONSTRUCTED_FROM_MEMORY · `SOURCE_EVIDENCE=NOT_RECOVERED`
No technical detail is asserted. Listed so the identifier is not lost (R80C).
**Action required:** locate the original record before any use.

---
## INCIDENT 020 — shadow/dry-execution NOT_OWNER ownership mismatch
**Status** PARKED · **Severity** not re-derived
**Provenance** RECONSTRUCTED_FROM_MEMORY · `SOURCE_EVIDENCE=NOT_RECOVERED`
Same treatment as INCIDENT 015. **Do not promote to technical authority.**

---
## INCIDENT 021 — notification_router SIGINT / sender identity unresolved
**Status** OPEN · **Provenance** SOURCE_GROUNDED
**Sources** `docs/evidence/INCIDENT_INDEX.md` (committed, `a73cc0c0…`);
`docs/recovery/PROJECT_RECOVERY_CHECKPOINT.md` §6 (committed, `87af0093…`)
**OBSERVED (checkpoint §6)** R-SIGINT mechanism proven twice, at 412 s and 2130 s
uptimes. Sender UNKNOWN and retrospectively unrecoverable: no auditd, `/proc`
exposes no sender, corrected journal windows show no sshd/logind/kill at either
instant. Signal-context instrumentation committed and armed.
**Disposition** PASSIVE OBSERVATION. A deliberate SIGINT is not authorized and
would not answer the historical question.

---
## INCIDENT 022 — watchdog name mismatch causes silent case fallthrough
**Status** OPEN · **STATE_CONFLICT=YES** · **RESTART-BLOCKING**
**Provenance** SOURCE_GROUNDED, two canonical documents disagree at the same HEAD
`923dd5041e645c22ad025a3f8335a03880f89b99`:
- `docs/evidence/INCIDENT_INDEX.md` — listed OPEN, "accepted patch not applied"
- `docs/recovery/PROJECT_RECOVERY_CHECKPOINT.md` §5 — "Source fixed, committed,
  and DEPLOYED via a controlled restart. CLOSED."
**CPT did not choose between them.** Both are hash-verified committed bytes.
**OBSERVED mechanism (checkpoint §5)** the watchdog matched `notifier)` while the
pid key is `notification_router`, so it detected the death and dispatched nothing,
silently.
**Disposition (Boss R80K Ruling 4)** treat as RESTART-BLOCKING until evidence
resolves the conflict. Resolution requires reading the deployed watchdog bytes,
which is not authorized in this slice.

---
## INCIDENT 023 — wrapper PID recorded instead of worker; kill -0 tests a subshell
**Status** OPEN · **Provenance** SOURCE_GROUNDED
**Sources** incident index (committed); checkpoint §5 `INC023-001` and §6 (committed)
**OBSERVED (checkpoint §6, live-confirmed)** FOUR components record wrapper pids,
not two — `fetcher`, `activator`, `volatility`, `shadow_engine`. THREE currently
show `bash -> sleep`, so `kill -0` succeeds during normal idle when no worker
process exists at all. The watchdog reads the same pid file and inherits this for
half the stack. `heat`, `monitor` and `notification_router` record their worker
directly and are NOT affected; the watchdog is legitimately a shell and is not an
instance.
**Mitigation to date** volatility has a worker-owned, session-bound heartbeat that
detects worker death independently of its wrapper pid. The pid entry is still the
wrapper; the pid namespace is unrepaired for every component.
**Cross-link (bounded)** subject-adjacent to the wrapper-vs-worker and
liveness-proof class encountered later in M2E-017G — the R73/R75 signature and
mandatory-worker gate failures, and the P3/P4/P5 `execution_live` repair.
**NO CLAIM OF IDENTICAL ROOT CAUSE IS MADE** (Boss R80K Ruling 4). 023 concerns
pid-namespace recording; the later items concern process-state semantics.

---
## BUG-004 — heat termination by native V8 fatal CHECK in GC sweeper
**Status** ROOT_CAUSE_PENDING · **Severity** S2 · **Discovered** 2026-09-09 (M2E-017F)
**Component** governed runtime — `volatility_divergence_report.js` (heat role, PID 1668739)
**Symptom** process exited spontaneously during the M2E-017E window.
**OBSERVED** `heat_tail` shows a V8 fatal CHECK failure
`page_->ContainsLimit(object_address + current_size_)` → `V8_Fatal` → abort.
No `[vdr] Stopped.` (graceful SIGTERM path did not complete), no `[vdr] FATAL`
(JS error path not taken), no OOM marker.
**TESTED** M2E-017F diagnostic, `HEAT_CAUSE_ADJUDICATION=ADJUDICATED`,
`HEAT_CAUSE_CLASS=UNKNOWN`.
**PROVEN mechanism** `NATIVE_V8_FATAL_CHECK_FAILURE_IN_GC_SWEEPER`.
**Root cause** UNRESOLVED — the underlying V8 defect was never identified.
**Safety impact** unsupervised decay of the governed stack; heat did not restart
because the watchdog was already down.
**Capital impact** none.
**Residual risk** recurrence on restart is not excluded. `REGRESSION_TEST=NOT_POSSIBLE`
— reproducing a native V8 GC abort deterministically is outside current capability.

---
## BUG-005 — PID 0/1 executor-ancestor exclusion hole
**Status** FIX_VALIDATED · **Severity** S3 · **Discovered** 2026-09-09 (R68 SB matrix)
**Component** executor synthetic-baseline seam · **Affected SHA** pre-`583cfdbc…`
**Triggering condition** a synthetic baseline map naming PID 1.
**OBSERVED** `SELFSET` ancestry walk terminates before PID 1, so PID 1 — an ancestor
of every process — was absent from the exclusion set and would have been **admitted**.
**Safety impact** S3: an ownership-exclusion boundary could admit a PID that is
categorically not fixture-ownable.
**Fix** include `1` and `0` explicitly in `EXEC_ANC`.
**Implementation SHA** `583cfdbc4dff6a3351136dc98257f19ed1c2735348c6eb553c2ee8e66d50eae7`
**TESTED** sandbox `SB11` → `SB_PID_IS_EXECUTOR_ANCESTOR`; R79 host negative
`pid1_ancestor` → same code. **Regression** both retained.
**Residual risk** none identified. **Boss disposition** accepted within R79 evidence.

---
## BUG-006 — subshell STOP propagation defect
**Status** FIX_VALIDATED · **Severity** S3 · **Authority** R30
**Component** executor `signal_one` / `stop()`
**OBSERVED** `stop()` invoked inside `$( )` exits only the subshell, so SP02/SP05
ran through to a second target instead of halting.
**Fix** `signal_one` called directly; counters and `SIG_OUTCOME` made global.
**TESTED** structural audit PASS; subshell-delta audit PASS on later builds.
**Related** BUG-007 (same slice, different mechanism).

---
## BUG-007 — duplicate `adapter_init` from blind whole-file replacement
**Status** CLOSED · **Severity** S2 · **Authority** R34
**OBSERVED** `adapter_init` defined twice after a whole-file rewrite; `bash -n`
passed, so syntax validation did not catch it. Build disqualified.
**Fix / standing rule (R34)** no blind whole-file replacement; anchored structural
target, `PRE_EDIT_MATCH_COUNT` assertion, expected count, write only on exact match,
`POST_EDIT` structural count, complete affected-function inspection.
**Residual risk** none. Rule has held since.

---
## BUG-008 — R79 harness defect group (seven sub-defects)
**Status** FIX_VALIDATED · **Severity** S2 · **Component** R79 topology harness
(not the executor). Grouped per R80C; each sub-defect traceable to its ruling.

| Sub | Defect | Authority | Disposition |
|---|---|---|---|
| a | one-role map left `STATE[watchdog]`/`[notification_router]` unbound under `set -u` | R79B | fixed: three-role map |
| b | canonical-pidfile admission used the fixture pidfile | R79E F2 | fixed: `$CANON_PIDFILE` |
| c | P5 called before the fixture pidfile existed → `OW_NOT_PIDFILE=UNKNOWN`, PASS unreachable | R79E F1 | fixed: reordered |
| d | `pack`/`cleanup_fixture` defined after first possible STOP; single `FX_CREATED` flag left clone/tree behind | R79E F3 | fixed: defined first, three independent flags |
| e | acceptance gates absent — runner could emit completion after abnormal termination or zero G7 | R79F F1-F3 | fixed: 8+5+9+16 gates |
| f | hardcoded `REAL_SIGNAL_SYSCALL_COUNT=0` presented an inference as observation | R79F | fixed: reclassified |
| g | production-default case ran against the canonical repo | R79B | fixed: non-repo argument |

**TESTED** R79 host run PASS on the corrected runner `30fad8c9…`.
**Residual risk** none for the harness. **Lesson recorded:** "runner completed" is
not evidence that topology was proved.

---
## BUG-009 — CPT verifier-precision defect class (recurring)
**Status** OPEN · **Severity** S1 · **Component** CPT audit tooling, not shipped code
**Symptom** repeated audit/verification errors that produced wrong verdicts about
otherwise-correct artifacts. **OBSERVED instances this arc:**
`sh`-instead-of-`bash` execution (multiple) · unbound-variable ancestry walk ·
a false PASS with an uncomputed mandatory field · non-terminating harness ·
`[[ -d /proc/ ]]` true on an empty variable · character classes excluding digits
(`CERTIFIED_P5_SHA`, `pid1_ancestor`) · a stated cause asserted without a reproducer
(R51) · naming R29/R30/R33 as the matrix source when R28 defines it.
**Safety impact** no shipped defect resulted; all were caught before host action.
The risk is a **false PASS**, which is why this stays open.
**Containment** explicit-`bash` execution for every check; reproduce before naming a
cause; verify audit regexes against known-positive input.
`REGRESSION_TEST=NOT_POSSIBLE` for the class as a whole.
**PRIOR CANONICAL CHARACTERIZATION (recovered R80J)** — this class was already
documented in `PROJECT_RECOVERY_CHECKPOINT.md` §8 before this session:
"roughly a dozen measurements CPT wrote were wrong while the system was fine —
`pgrep -c … || echo 0` fabricating counts, `\s` in POSIX awk, scans matching their
own comments, UTC values passed to local-time queries. The system's own instruments
were right every time." Checkpoint rules 5, 19 and 20 encode the same lesson.
The 2026-09-10 `grep -c … || echo 0` arithmetic error is a **RECURRENCE** of that
exact documented construct, not a new mechanism.

**RECURRENCE INSTANCES — preservation-review construction (2026-09-10, R80L-accepted):**
1. **Vacuous invariant pass.** `mkdir -p a/{b,c}` ran under `/bin/sh`, which has no
   brace expansion, so the staging tree was never created. All four invariant counts
   reported 0 against an EMPTY directory and read as a clean pass. This is exactly
   checkpoint §8 rule 5 — a zero-result probe must prove it can hit a known positive
   first. **Containment:** assert a non-empty measurement surface before interpreting
   any zero as success.
2. **printf option parsing.** Three lines beginning `- **` were consumed as printf
   options and silently dropped, while their continuation lines survived — output that
   looked complete but was not. **Containment:** never pass caller-controlled text as
   a printf format argument.
3. **Self-referential manifest.** `MANIFEST.sha256` initially included itself, making
   it permanently self-inconsistent. **Containment:** exclude the manifest from its
   own file list.

Per Boss R80L no new root bug ID is required; these are recurrence events under
BUG-009. BUG-009 remains the root class per
Boss R80K Ruling 6; the eight instances listed above are recurrence events.

---
## BUG-010 — T10 dropped from the structured certification matrix
**Status** FIX_VALIDATED · **Severity** S2 · **Discovered** 2026-09-10 (Boss R80D)
**Component** certification documentation — `M2E017G_EXECUTOR_BEHAVIOR_MATRIX.md`
and `M2E017G_R80_RECERTIFICATION_PLAN.md`
**Triggering condition** transcription of R28 lines 88-140 into a structured table.
**OBSERVED** R28 defines **T01-T10**; the verbatim extract preserved T10, but the
structured table declared "T — (9)" and stopped at T09. The plan compounded it by
claiming "all 42 cases" while enumerating T01-T09.
**Detection** arithmetic — 4+6+6+8+8+9 = 41, not 42. Boss caught it on byte review.
**Safety impact** S2: full certification could have been claimed while a required
case was silently omitted. Certification-blocking, no runtime effect.
**Root cause** CONFIRMED — CPT transcription error; the extract range was correct,
the manual table was not.
**Fix** T10 restored; group count corrected to 10; launcher-dependent group
corrected to T05-T10; explicit per-group arithmetic added so the sum is checkable.
**Regression** every document now states the derived count `A4+I6+D6+S8+C8+T10=42`.
The package proves zero stale `T01-T09` / `T05-T09` **SCOPE ASSERTIONS** remain.
Historical defect/correction references containing those strings are preserved
intentionally and are not active scope statements.
Verification criterion is semantic and location-bounded, not literal-string absence:
```
ACTIVE_SCOPE_ASSERTION_T01_T09_COUNT=0
ACTIVE_SCOPE_ASSERTION_T05_T09_COUNT=0
```
**R80E note:** R80E corrected the regression-proof wording from literal-string
absence to stale-scope-assertion absence. The matrix omission itself remains
independently verified corrected; BUG-010 stays FIX_VALIDATED and is not reopened.
**Residual risk** other transcriptions from prose remain unverified by arithmetic;
this is the same defect class as BUG-009.
**Related** BUG-009 (CPT verifier-precision class).

---
## BUG-011 — R80E documentation package retained stale manifest hash after ledger mutation
**Status** FIX_VALIDATED · **Severity** S2 · **Discovered** 2026-09-10 (Boss R80F)
**Component** documentation preservation packaging (CPT tooling, not shipped code)
**Affected artifact** `MANIFEST.md` in package `1bb9df71…`
**OBSERVED** actual `BUG_AND_INCIDENT_LEDGER.md` in the uploaded ZIP hashed to
`d2b27d36fb07870d9b89888d5e672f14a6b9a28c0a387d3dcb2724b5c328c65b`, while
`MANIFEST.md` still recorded the pre-R80E value
`0653843622ea3667387c1dca954ba13de62cba6d79ad2803410416fb8b0bfac2`.
**Root cause** CONFIRMED — the package carries two integrity records. `MANIFEST.sha256`
was regenerated after the content edit; the hash block embedded in `MANIFEST.md` was
generated once during initial assembly and never refreshed. The reported
"manifest 20 entries OK" verified only `MANIFEST.sha256`, so the stale record in
`MANIFEST.md` was never checked and the PASS was narrower than the claim implied.
**Safety impact** S2: a preservation artifact was reported manifest-PASS while its own
manifest failed to authenticate a changed document. On future recovery this could cause
the correct file to be rejected, or an incorrect integrity claim to be trusted.
**Capital/runtime impact** none. No executable bytes affected.
**Fix** regenerate `MANIFEST.md` hash blocks from final content, then `MANIFEST.sha256`,
then verify **against the extracted ZIP contents** rather than the staging directory,
with the verifier exiting nonzero on any mismatch.
**Regression** packaging now cross-checks the `MANIFEST.md` embedded block against
`MANIFEST.sha256` and against the extracted ZIP, and reports
`MANIFEST_MISMATCH_COUNT` explicitly.
**Boss disposition** Boss R80G independently verified the rebuilt package
`5549f87b666beeba537940e13ec065c14974419f64a03ac158def64074f9d5b2` and accepted
the manifest correction: MANIFEST_MISMATCH_COUNT=0, BUG_LEDGER_HASH_MATCH=YES,
both integrity records agreeing with the actual extracted bytes.
**BUG-011 is FIX_VALIDATED.** R80K preserved this disposition; R80L reiterated it.
**Related** BUG-009 (verifier-precision class — a check narrower than its claim),
BUG-010 (transcription defect in the same package).
**PRIOR CANONICAL RULE (recovered R80J)** checkpoint §8 rule 12: "A MANIFEST must
be GENERATED from the bundled bytes, never transcribed. M2E-004A shipped a stale
health.js hash because it was typed." BUG-011 is the same failure shape — a hash
block generated once and carried forward unregenerated. Per Boss R80K Ruling 6,
BUG-011 remains its own concrete packaging-integrity record and stays FIX_VALIDATED;
this note records the prior rule, not a merge into BUG-009.

---
## CERTIFICATION INTERLOCK (R80C)
**OPEN_BUGS_AFFECTING_EXECUTOR:** BUG-004 (S2, governed runtime — not the executor
boundary, but affects restart readiness). BUG-009 (S1, CPT tooling).
**No OPEN S3/S4 defect affects the executor certification boundary.**
**CLOSED_BUGS_RETESTED under R80:** BUG-005, BUG-006, BUG-007.
**BUG-010** FIX_VALIDATED under R80D — matrix scope corrected to T01-T10.
**BUG-011** FIX_VALIDATED — verified by Boss R80G, preserved by R80K/R80L.
