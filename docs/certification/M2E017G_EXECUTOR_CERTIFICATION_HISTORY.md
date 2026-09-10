# M2E-017G EXECUTOR CERTIFICATION HISTORY

Generated 2026-09-10T04:35:41Z.

## IDENTITIES
| Identity | SHA256 | State |
|---|---|---|
| prior certified | `e1f1cca7481a48b33e9a501a57a57359aa07ebb1f647998353c939fcb30eb918` | **bytes UNAVAILABLE** |
| current | `583cfdbc4dff6a3351136dc98257f19ed1c2735348c6eb553c2ee8e66d50eae7` | **NOT CERTIFIED** |

**OBSERVED:** an exhaustive SHA search of the build environment found no artifact
hashing to `e1f1cca7…`. It was superseded in place by the R68 seam edit.
**Consequence:** byte-level diff against the certified predecessor is impossible.
The current bytes are therefore a **standalone certification target**; certification
credit does not transfer by ancestry, similarity, or prior behaviour (R80).

## CHANGES SINCE e1f1cca7 — two, both at trust boundaries

### 1. Synthetic-baseline / TEST_ADAPTER certification seam (R68)
Test-only substitution of the immutable `BASELINE` literal, gated behind six locks:
`TEST_MODE` · `PROC_ROOT_SYNTHETIC` · `SIGNAL_ADAPTER` · `HOOK_ENABLED` ·
`CASE_SP01` · `MAP_READABLE`. Any absent/inconsistent lock → `SB_LOCKS_INCOMPLETE`
STOP; no mixed real/synthetic topology. Map validation enforces role allowlist,
decimal PIDs and starttimes, safe signature charset, no duplicates, no governed
baseline PID, no canonical pidfile member, not the executor, not an executor
ancestor, and a P5 binding carrying the certified P5 SHA.
- **TESTED:** SB matrix 20/20 in sandbox.
- **TESTED:** R79 host topology proof PASS.

### 2. PID-0/1 executor-ancestor hole fix (R68 §12 regression)
`SELFSET` terminates its walk before PID 1, so PID 1 — an ancestor of every process —
was never in the exclusion set and would have been **admitted** into a synthetic
baseline. Repaired by including `1` and `0` explicitly.
- **TESTED:** `SB11` rejects PID 1 → `SB_PID_IS_EXECUTOR_ANCESTOR`.
- **TESTED:** R79 negative `pid1_ancestor` reproduced the same code on the host.
- Recorded as `BUG-005`.

## R79 TOPOLOGY PROOF
PASS. Evidence `fc63edb5b94bcd092cd524e7cc6a97a969dbd1748a536c6cd902bc9a5f096a6f`.
Detail in `M2E017G_R79_TOPOLOGY_PROOF.md`.

## R80 REQUIREMENT
Full A/I/D/S/C/T matrix (R28) + R40 command-position audit + R40 verifier-consistency
audit + synthetic-seam overlay + PID-0/1 overlay. No seam-only delta certification.

## CERTIFICATION LIMITATIONS — current state
- **NOT TESTED:** real teardown signal delivery on any live governed process.
- **NOT TESTED:** SP01-SP05 stop-propagation regression (never run).
- **NOT TESTED:** T05-T10 launcher/start behaviour.
- **INFERRED, not observed:** zero real signal syscalls under TEST_ADAPTER.
- **UNAVAILABLE:** predecessor bytes for differential audit.
- **OPEN S2+ bugs affecting the executor:** see `BUG_AND_INCIDENT_LEDGER.md`.
