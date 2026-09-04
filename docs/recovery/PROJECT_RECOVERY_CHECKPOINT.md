# ALLMIGHT — PROJECT RECOVERY CHECKPOINT

Frozen: 2026-09-03
Authority: Boss
Repository: techmorebu/Allmight
Canonical branch: main

## Authority model
Boss (ChatGPT) owns architecture, doctrine, classifications, thresholds, phase progression, and authorization gates.
CPT performs bounded implementation, validation, evidence production, and reporting.
Cornelius is operator.

Workflow:
Boss ruling → bounded CPT directive → CPT implementation/test → evidence → Boss evaluation → next ruling.

Evidence acceptance does not authorize deployment, restart, activation, signing, broadcast, or capital movement.

## Hard locks
- LIVE_TRADING_ENABLED=false
- AUTO_MICRO_ONESHOT=false
- LIVE_DEPLOY_APPROVED=false
- signing=NONE
- broadcast=LOCKED
- capital=UNTOUCHED
- economics=PARKED

## Verified repository baseline for recovery
- branch: main
- local HEAD at precheck: 8a555ad377ae0a2d9f68c754fbb342ff182d7a05
- remote main at precheck: 8a555ad377ae0a2d9f68c754fbb342ff182d7a05
- working tree intentionally not clean; recognized runtime/research/telemetry artifacts exist.

## Recognized deployed-vs-Git divergence
`scripts/tools/volatility_divergence_report.js` is the known M2-C deployed heat-heartbeat producer.
The deployed file differs from Git baseline by design at this recovery checkpoint.
This recognized divergence is NOT, by itself, an RCV-1 stop condition.

Known hashes from checkpoint:
- deployed M2-C: 6f623cca514c12aca2c027095a934b1ae3ccc22975901e6fd8448b30fe3903c4
- Git baseline: a63b15db005fd004dd4e19ff661bc155b215b49c7e506ced449f65be972f57f3

Do not overwrite, normalize, commit, or revert this file during recovery archival unless separately authorized by Boss.

## Security hold
The path `_legacy/root_clutter/secret.EXPOSED_DO_NOT_COMMIT` is tracked in current HEAD.
Do not read, print, upload, or expose its contents.
Repository visibility has been independently verified as PUBLIC.
If the credential is live, revoke/rotate it before archival sequencing resumes.
History sanitization is a separate Boss-controlled action.

## Recovery architecture
GitHub is the lean canonical working brain:
- active source/runtime code
- active configs and lockfiles
- tests/fixtures required for reproducibility
- current architecture/governance/operations
- recovery state
- concise evidence/incident/artifact indexes with hashes

Google Drive is durable bulk archive:
- raw evidence/logs
- historical ZIPs
- old reports
- exported conversations
- retired CPT bundles
- historical binaries/PDFs and generated outputs

CPT project knowledge should remain small and reconstructable from Git + Drive.

## Current sequencing
1. RCV-1: install and verify recovery/governance overlay.
2. Security preemption if tracked credential is live: revoke/rotate.
3. RCV-2: read-only lean-repo inventory.
4. Boss ruling on exact keep/move/security set.
5. Archive-to-Drive with hashes/readback.
6. Prune current main only after archive verification.
7. Fresh-CPT reconstruction test.
8. Consider Git history rewrite only if still necessary.

Do not resume the parked router diagnostic until recovery/archive establishment is verified unless Boss explicitly changes priority.
