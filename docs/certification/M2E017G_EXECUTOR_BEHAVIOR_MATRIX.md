# M2E-017G EXECUTOR BEHAVIOR MATRIX (A/I/D/S/C/T)

Generated 2026-09-10T04:34:57Z.

**SOURCE: `BOSS_M2E_017G_R28_DESIGN_ACCEPT_BUILD_AUTHORIZED.txt`**
SHA256 `c465ee2eece143c8c6439ba9b891e77829bbcf0785e7dc5de0b10f43b76f3505`, lines 91-138.
Transcribed from recovered exact bytes. **NOT reconstructed from memory.**

## 1. VERBATIM EXTRACT — R28 lines 88-140

```

At minimum:

  A01 8 live, exact identities
  A02 5 live / known watchdog-router-heat dead
  A03 1 live
  A04 0 live -> ZERO_LIVE_CLEAN_START_REQUIRED, no mutation

  I01 live baseline starttime mismatch -> STOP
  I02 live baseline signature mismatch -> STOP
  I03 baseline PID reuse -> STOP
  I04 dead baseline PID resurrection -> STOP
  I05 root-role substitution alternate PID -> STOP
  I06 second governed stack/process -> STOP

  D01 descendant closure captured before census
  D02 captured descendant survives parent -> exact descendant remains eligible
  D03 captured descendant vanishes unsignalled
  D04 captured descendant PID reused -> STOP
  D05 new governed descendant after closure -> STOP
  D06 captured descendant identity mismatch -> STOP

  S01 root vanishes before revalidation -> VANISHED_UNSIGNALLED, no syscall
  S02 kill returns ESRCH after revalidation -> VANISHED_UNSIGNALLED,
      TERM_ATTEMPTED YES, TERM_DELIVERED NO
  S03 kill returns EPERM -> STOP
  S04 other kill failure -> STOP
  S05 post-syscall same PID/starttime -> observation window
  S06 post-syscall changed starttime -> SIGNALLED_REUSED_PID / STOP
  S07 TERM accepted then process absent -> TERMINATED_BY_US
  S08 TERM accepted then survivor at 60s -> TERM_TIMEOUT_NOT_PROVEN_REFUSED,
      STOP, no escalation

  C01 PID file mapping drift -> STOP before signal
  C02 session drift -> STOP before signal
  C03 repo HEAD drift -> STOP before signal
  C04 launcher worktree SHA drift -> STOP before signal
  C05 launcher blob SHA drift -> STOP before signal
  C06 watchdog unexpectedly alive -> STOP
  C07 router unexpectedly alive -> STOP
  C08 router exit provenance missing/mismatch -> STOP

  T01 partial teardown STOP leaves no start attempt
  T02 old roots absent but captured descendant remains -> no control transition
  T03 old governed census non-empty -> no control transition
  T04 control-file transition failure -> no start
  T05 canonical start attempted exactly once
  T06 canonical start failure -> no retry
  T07 post-start not exact eight roles -> STOP / no retry
  T08 launcher SHA drift at proof -> STOP / no retry
  T09 SHADOW_POSTDATES_COMMIT != YES -> STOP / no retry
  T10 exact post-start proof -> COMPLETE

```

## 2. STRUCTURED TRANSCRIPTION — 42 cases

Every "expected" column below is the R28 text above. Fixture/evidence/verifier
columns are **PROPOSED by CPT** and are not part of R28.

**CASE COUNT, derived from R28 bytes:** A 4 + I 6 + D 6 + S 8 + C 8 + T 10 = **42**.

### A — baseline cardinality (4)
| ID | Expected (R28 verbatim) | Mutation/signal allowance |
|---|---|---|
| A01 | 8 live, exact identities | per teardown authority |
| A02 | 5 live / known watchdog-router-heat dead | per teardown authority |
| A03 | 1 live | per teardown authority |
| A04 | 0 live -> ZERO_LIVE_CLEAN_START_REQUIRED, no mutation | **none** |

R40/R29 note: A04 was accepted in R29 Ruling 5 with `SIGNALLED 0`,
`CONTROL_FILES_CHANGED 0`, `START_ATTEMPTED 0`, `USED_SIGKILL NO`.

### I — identity (6) — all STOP
| ID | Expected (R28 verbatim) |
|---|---|
| I01 | live baseline starttime mismatch -> STOP |
| I02 | live baseline signature mismatch -> STOP |
| I03 | baseline PID reuse -> STOP |
| I04 | dead baseline PID resurrection -> STOP |
| I05 | root-role substitution alternate PID -> STOP |
| I06 | second governed stack/process -> STOP |

### D — descendant closure (6)
| ID | Expected (R28 verbatim) |
|---|---|
| D01 | descendant closure captured before census |
| D02 | captured descendant survives parent -> exact descendant remains eligible |
| D03 | captured descendant vanishes unsignalled |
| D04 | captured descendant PID reused -> STOP |
| D05 | new governed descendant after closure -> STOP |
| D06 | captured descendant identity mismatch -> STOP |

### S — signal boundary (8)
| ID | Expected (R28 verbatim) |
|---|---|
| S01 | root vanishes before revalidation -> VANISHED_UNSIGNALLED, no syscall |
| S02 | kill returns ESRCH after revalidation -> VANISHED_UNSIGNALLED |
| S03 | kill returns EPERM -> STOP |
| S04 | other kill failure -> STOP |
| S05 | post-syscall same PID/starttime -> observation window |
| S06 | post-syscall changed starttime -> SIGNALLED_REUSED_PID / STOP |
| S07 | TERM accepted then process absent -> TERMINATED_BY_US |
| S08 | TERM accepted then survivor at 60s -> TERM_TIMEOUT_NOT_PROVEN_REFUSED |

**R29 Ruling 4 governs S01-S08 fixture construction** — see the authority index.

### C — control/authority drift (8) — all STOP before signal
| ID | Expected (R28 verbatim) |
|---|---|
| C01 | PID file mapping drift -> STOP before signal |
| C02 | session drift -> STOP before signal |
| C03 | repo HEAD drift -> STOP before signal |
| C04 | launcher worktree SHA drift -> STOP before signal |
| C05 | launcher blob SHA drift -> STOP before signal |
| C06 | watchdog unexpectedly alive -> STOP |
| C07 | router unexpectedly alive -> STOP |
| C08 | router exit provenance missing/mismatch -> STOP |

### T — teardown / control transition (10)
| ID | Expected (R28 verbatim) | Launcher dependency |
|---|---|---|
| T01 | partial teardown STOP leaves no start attempt | no |
| T02 | old roots absent but captured descendant remains -> no control transition | no |
| T03 | old governed census non-empty -> no control transition | no |
| T04 | control-file transition failure -> no start | no |
| T05 | canonical start attempted exactly once | **YES** |
| T06 | canonical start failure -> no retry | **YES** |
| T07 | post-start not exact eight roles -> STOP / no retry | **YES** |
| T08 | launcher SHA drift at proof -> STOP / no retry | **YES** |
| T09 | SHADOW_POSTDATES_COMMIT != YES -> STOP / no retry | **YES** |
| T10 | exact post-start proof -> COMPLETE | **YES** |

## 3. T05-T10 DEPENDENCY (R80B, corrected R80D)
```
REQUIRED_MATRIX_CASES
EXECUTION_DEPENDENCY=LAUNCHER
CURRENT_EXECUTION_AUTHORITY=LOCKED
```
Not omitted. Boss to rule whether they are fixture-reproducible without canonical
launcher mutation, or require a later bounded launcher certification window.

**R80D CORRECTION:** the launcher-dependent group is **T05-T10**, not T05-T09.
T10 was present in the verbatim extract but dropped from the structured table.
Recorded as BUG-010 (S2).

## 4. ADDITIONAL R28 REQUIREMENT
R28 also specifies a **SELF-LINEAGE / PROCESS-SELECTION REGRESSION** section
immediately after T10. It is mandatory and is carried in the R80 plan alongside the
42 numbered cases.
