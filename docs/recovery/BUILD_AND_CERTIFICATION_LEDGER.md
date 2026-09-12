# PROJECT ALLMIGHT — BUILD AND CERTIFICATION LEDGER

Generated 2026-09-10T04:37:34Z. One row per meaningful slice: ruling, artifact, evidence, verdict,
state transition, unresolved item, next step. Avoids replaying the full chat.

| Ruling | Implementation artifact | Test / evidence | Boss verdict | State transition | Unresolved |
|---|---|---|---|---|---|
| M2E-017C | five-path commit `923dd504…` | git status evidence | ACCEPTED | canonical source repaired | runtime remediation pending |
| M2E-017D R7 | restart executor `c879f414…` | live restart attempt | STOP `C_ROOT_TERM_REFUSED_notification_router` | 7/8 roots alive, watchdog down | delayed-TERM vs refusal |
| R8-R13 | router diagnostic `a12f5aa5…` | `1e57e179…` | ACCEPTED | router exited cleanly at 42 s | 20 s window too short |
| M2E-017E R16 | continuation `90514f83…` | live run | STOP `A_SURVIVOR_ABSENT` | heat had already died | heat cause unknown |
| M2E-017F R24 | heat diagnostic `46ab2e81…` | diagnosis complete | ACCEPTED | V8 GC fatal proven | **BUG-004 root cause open** |
| R26/R27 | monotonic-decay design | design doc | ACCEPTED | design basis for M2E-017G | — |
| R28 | — | — | **defines A/I/D/S/C/T** | matrix authority established | later lost from index |
| R29/R30 | executor builds | A04 PASS; subshell defect | R30 correction | BUG-006 | — |
| R34 | edit discipline | — | STANDING RULE | BUG-007 closed | — |
| R40 | — | — | **verifier-consistency authority** | R40 standard established | — |
| R41-R57 | P1-P5 primitive rebuild | 14+30+40+52+48 case matrices | CERTIFIED each | decomposition converged | BUG-009 open |
| R58/R59 | zombie-state discovery | G5 reproducer, verdict R2 | ACCEPTED | `execution_live` added to P3/P4/P5 | — |
| R63-R65 | SP01 hook | refusal matrix | hash frozen `4ef4b949…` | hook instantiated | path binding wrong for host |
| R66-R71 | SP01 attempts | — | BLOCKED | three immutable couplings found | SP01 suspended |
| R72 | drift reset | — | RULING | **uptime preservation abandoned** | — |
| R76 | `4fcf3ebb…` shutdown block | 5 roots TERM, clean | ACCEPTED | five roots stopped | one orphan remained |
| R77 | `7aca1b46…` orphan cleanup | one TERM, clean | ACCEPTED | **QUIESCENT** | — |
| R78/R78A | hook `fcbb957c…` | refusal + positive matrix | ACCEPTED | host-bound hook ready | — |
| R79C | feasibility probe `18be8406…` | PASS | ACCEPTED | fixture-repo model feasible | — |
| R79D-R79F | runner rebuilds | three review holds | corrections | acceptance gates added | **BUG-008** |
| R79G | runner `30fad8c9…` | `fc63edb5…` | **PASS / CONSUMED** | topology proven | not certification |
| R80 | — | — | DIRECTIVE | full re-certification required | matrix definition lost |
| R80A | authority recovery | R28 located | STOP accepted, recovery active | **R28 recovered** | pending byte review |
| R80B/R80C | doc package `a4fcbca6…` | 18/18 manifest | **T10 defect found** | documentation lane active | commit not authorized |
| R80D | corrected doc package | zero stale scope strings | pending | R28/R29/R30/R33/R40 accepted as R80 authority | git canonicalization separate |
| R80E/R80F | wording + manifest integrity | BUG-010, BUG-011 | ACCEPTED | package `5549f87b…` verified | — |
| R80G | Stage-1 acceptance | independent byte review | ACCEPTED | BUG-011 FIX_VALIDATED; preservation prep authorized | commit not authorized |
| R80H/R80I/R80J | read-only canonical reads | HEAD + control-file hashes; checkpoint recovered 589 lines / 34793 B | ACCEPTED | conflict resolved; INCIDENT 021-023 recovered | INCIDENT 022 STATE_CONFLICT |
| R80K | preservation governance | — | RULING | GOV-CHK-001 governs; §§3/6/12 supersession required | — |
| R80L | pre-commit review correction | BUG-011 staged state stale | ACCEPTED | ledger repaired to FIX_VALIDATED; 3 BUG-009 recurrences recorded | — |
| R80M | host merge construction | **prefix + suffix proof PASS** | ACCEPTED | canonical byte preservation PROVEN | merge lives in /tmp only |
| R80N | final preservation freshness gate | this refresh | pending | overlay regenerated; merge re-proof required | canonical mutation still locked |

## HOST MERGE RESULT (R80M, superseded by the R80N overlay change)

```
BASE_CHECKPOINT_SHA   87af009366a887640d1e84a98955c6aee195eddbc2fcbc2e887017cf94cd19f3
BASE_BYTES            34793
OVERLAY_SHA           713ecfbf1c94a7a081708c1534c0ca2c9cd75d46b54e76a3f780c0cfb0a8cb14  (9359 B)
MERGED_SHA            e6ab75929ee412941dd02a603cb48dad9222815da4eb3927cdb0a9ee6bf1a4dd
MERGED_BYTES          44152
BASE_PREFIX_MATCH     YES
OVERLAY_SUFFIX_MATCH  YES
CANONICAL_REPO_CHANGED_BY_MERGE_CONSTRUCTION   NO
```

**This merged SHA is NO LONGER the destination SHA.** R80N required the overlay to
carry merge provenance, which changed its bytes. Per the R80N merge-SHA rule a
stale merged SHA must never be carried across an overlay mutation, so
`MERGE_REPROOF_REQUIRED=YES` and a fresh host merge proof is needed before staging.
The R80M proof remains valid evidence *for the overlay it was computed against*.

## NEXT STEP
Boss review of recovered authority bytes and this draft document set. Then R80 test
package design, then a separate host execution authorization.

## STANDING LESSONS
1. **R72** — when interruption is acceptable, take the clean maintenance window over
   increasingly complicated attempts to preserve uptime.
2. **R79F** — "runner completed" is not evidence that anything was proved.
3. **R80B** — a certification standard that lives only in chat will be lost. R28
   defined the matrix and was nearly unrecoverable four days later.
4. **R51** — a hypothesis that explains the symptom is not a diagnosis. Reproduce first.
5. **R80D** — transcribing a list from prose is a defect surface. Derive and check the
   count arithmetically; a table that "looks complete" is not evidence that it is.
6. **R80M/R80N** — prove both halves of a concatenation independently. Size alone
   does not prove history was preserved, and a hash proven against one version of an
   artifact says nothing about the next.
7. **R80N** — a file cannot contain its own hash. Self-referential integrity values
   belong in an external record, never embedded in the artifact they describe.


---

## PRESERVATION OVERLAY 2 — 2026-09-12T00:53:58Z
**Authority:** Boss R80CB / R80CC · **Transaction:** `M2E017G-PRESV-002`
**Baseline HEAD:** `4133fd9dd5b84565c3903e85ef04c6d6325aa2f4`

Content above is preserved verbatim; where superseded, this section controls.

### Slices since the first preservation commit

| Ruling range | Work | Verdict |
|---|---|---|
| R80O-R80AF | v3→v9 runner hardening; A01-A04 built and run | A-slice ACCEPTED |
| R80AG-R80AO | I-slice; I04/I05 reachability, I06 P5 contract | I01-I03 ACCEPTED |
| R80AP-R80BJ | D-slice; D01 only buildable; v24 abort and evidence hold | D01 ACCEPTED |
| R80BK-R80BY | S-slice design, build and correction (chat-only) | S02-S06, S08 ACCEPTED |
| R80BZ-R80CA | S07 launcher-boundary finding and disposition | S07 CLOSED |
| R80CB-R80CC | preservation-first ruling and transaction design | this transaction |

**Lessons added:** a verification statement must not assert more than its probe
checks (recurring, BUG-009) · a file cannot contain its own hash · absence of
output is not evidence of absence of action · preservation must recur with the
work, not once.
