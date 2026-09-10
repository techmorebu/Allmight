# M2E-017G R79 OFFLINE SYNTHETIC-BASELINE TOPOLOGY PROOF

Generated 2026-09-10T04:35:41Z. Authority R79/R79A/R79D/R79E/R79F/R79G. Result **PASS**, consumed.

Evidence ZIP `fc63edb5b94bcd092cd524e7cc6a97a969dbd1748a536c6cd902bc9a5f096a6f`
Runner `30fad8c93a271ee8436e23a1f33caf51134b3c2a8aa6e4d793306dffcab07be1`

## MODEL
- Standalone exact-HEAD fixture clone under `/home/allmight/sp01_fixture`
  (`git clone --no-hardlinks --local`, detached checkout, launcher worktree and
  git-blob SHAs both `0364dd39…`).
- Fixture-local synthetic control files in `clone/logs` — canonical control state
  never used as test authority.
- **Real** temporary non-governed processes from certified P3 (R79A model), so G7
  discovers them through the executor's unmodified `pgrep -P` parentage.
- Synthetic `PROC_ROOT` mirroring only the accepted live fixture identities.
- Three-role synthetic baseline: `watchdog`/`notification_router` absent from the
  mirror → `DEAD_AT_BASELINE`; fixture root mirrored → `LIVE_VERIFIED`.

## TESTED — positive
```
FIXTURE_ROOT 2566903   FIXTURE_DESC 2566905   ppid 2566903
POS_G7_FROZEN_DESCENDANTS      2566905
POS_G7_FROZEN_COUNT            1
POS_G7_FROZEN_IS_FIXTURE_DESC  YES
POS_BASELINE_LIVE_ROLES  shadow_engine        (count 1)
POS_BASELINE_DEAD_ROLES  watchdog notification_router (count 2)
GOVERNED_SELECTION_COUNT 0   CANONICAL_PIDFILE_ADMISSION_COUNT 0
SYNTHETIC_BASELINE_MODE ENABLED · PROC_ROOT_MODE TEST_SYNTHETIC
SIGNAL_SYSCALL_MODE TEST_ADAPTER · TEST_MODE_ENABLED YES
G5_ROUTER_CLEAN_EXIT_RECORD PRESENT · G6_PIDFILE_MAP_INTACT YES
P5 six predicates all YES · OWNERSHIP_GATE PASS
HOOK_UNEXPECTED_MUTATION 0
```

## TESTED — negatives (all five matched expected immutable codes)
`missing_lock_hook` SB_LOCKS_INCOMPLETE · `malformed_map` SB_PID_NOT_DECIMAL ·
`stale_pidfile_pid` SB_PID_IS_GOVERNED_BASELINE · `pid1_ancestor`
SB_PID_IS_EXECUTOR_ANCESTOR · `wrong_p5_binding` SB_P5_SHA_MISMATCH

## TESTED — production default
Non-repository argument. `DISABLED` / `REAL_KILL` / `REAL_PROC` / `NO`, stopping at
`G1_NO_REPO` with `TERM_ATTEMPTED_COUNT 0`, `SIGNALLED 0`, `USED_SIGKILL NO`.

## ADAPTER SIGNAL CLASSIFICATION
- **OBSERVED:** `SIGNAL_SYSCALL_MODE=TEST_ADAPTER`; `TERM_ATTEMPTED 2`,
  `TERM_DELIVERED 0`, `TERM_ESRCH 2`, `USED_SIGKILL NO`.
- **INFERRED:** real executor signal syscalls = 0, from the observed adapter mode
  plus the exact reviewed adapter branch.
  `REAL_SIGNAL_OBSERVATION_METHOD=NOT_DIRECTLY_OBSERVED_INFERRED_FROM_ADAPTER_MODE`.
- **NOT OBSERVED:** direct syscall instrumentation. No strace was used or required.

## PT_ROOT_SURVIVOR INTERPRETATION
`POS_STOP_GATE=PT_ROOT_SURVIVOR` occurred **after** all required topology evidence
was established and is consistent with the adapter-injected ESRCH path.
Per Boss R79 acceptance it **must not** be interpreted as successful teardown
behaviour or carried forward as such.

## EXACT NON-CLAIMS
R79 does **not** prove: real teardown · real TERM delivery · SP01 · restart ·
launcher behaviour · executor certification.

## POST-STATE — OBSERVED
`FIXTURE_CLEANUP_RESULT CLEANED` · both fixture PIDs absent · clone and tree removed ·
canonical HEAD and all three control hashes unchanged · baseline 8/8 absent ·
governed role hits 0 · all seven artifact SHAs unchanged.
