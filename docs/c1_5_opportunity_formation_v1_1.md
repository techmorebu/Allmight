# c1.5 Opportunity Formation Class A v1.1

**Module:** `scripts/telemetry/opportunity_formation_class_a_v1.js`
**Tests:** `tests/opportunity_formation/`
**Status:** PUBLISHED (Boss C9 ratification 2026-08-29)
**Bundle-of-record:** W11_C1_5_OPPORTUNITY_FORMATION_v1_1_2026-08-29 (SHA `9300ed8e513264fab5d84c90e45e377210aff646059b2cd42be3a20de2253cd6`)

## Purpose

Structural formation of Class A cross-DEX opportunities (Ramses x Uniswap V3 ETH/USDC on Arbitrum) from paired c1 observations. Deliberately fail-closed on economics in v1 (no canonical gas, no canonical threshold, no Ramses depth).

## Design locks (Boss C9)

- Bounded to Class A surface: chain=arbitrum + pair=ETH/USDC-RAMSES + venue in {ramses_v2, uniswap_v3}. Out-of-scope records ignored + counted in run manifest diagnostics.
- Canonical stream: `data/formation_class_a_v1.jsonl` -- APPEND-ONLY IDEMPOTENT
- Rejections: `data/formation_sessions/<runId>/formation_rejected.json`
- Deterministic: byte-identical canonical output across runs (formationRunId + formedAt segregated to run manifest)
- surfaceId (router-canonical): `arbitrum:WETH-USDC:ramses_v2>uniswap_v3`
- registrySurfaceId: `eth_usdc_ramses` (secondary identity)
- NO RPC. NO gas measurement. NO scheduler. NO execution. NO broadcast. NO capital path.

## v1.1 structural behavior (by design)

Every canonical record satisfies:
- economic = false
- netEdgeBps = null
- thresholdNetEdgeBps = null
- sameBlockVerified = false

Normal paired records accumulate deterministic reasons:
`ineligibleReasons: ["depth_missing", "gas_unavailable", "threshold_unavailable"]`

This preserves economic uncertainty rather than manufacturing profitability. Economic determination becomes possible only when Boss authorizes: canonical gas telemetry (Track C, producer selection pending), Ramses depth remediation (Track B, implementation authorization pending), and canonical threshold designation (THR, future ruling).

## Usage

```bash
# Structural formation from current c1 observations
node scripts/telemetry/opportunity_formation_class_a_v1.js

# Defaults:
#   --input data/observations.jsonl
#   --output data/formation_class_a_v1.jsonl
#   --sessions-dir data/formation_sessions

# Idempotent -- safe to rerun. Existing canonical records preserved byte-identically.
```

## Acceptance evidence

- 55/55 assertions across 16 Boss C9 v1 criteria (regression suite)
- 15/15 scope gate assertions (A20/A21/A22)
- 17/17 idempotency assertions (A17/A18/A19)
- 7/7 c5 integration (canonical opportunity_persistence.js, unchanged)
- 6/6 c6 provable + 3 bounded interface findings
- 5/5 deterministic byte-identical replay
- 7/7 c5 contract compatibility

**Total: 112 assertions across 7 test suites -- all green.**

## Downstream chain (proven end-to-end)

`REAL MARKET OBSERVATIONS -> c1 canonical -> c1.5 v1.1 formation -> c5 persistence_telemetry_v1`

## Running tests in-repo

```bash
cd ~/Allmight
node tests/opportunity_formation/acceptance_suite.js
node tests/opportunity_formation/c5_contract_compatibility.js
REPO=~/Allmight node tests/opportunity_formation/c5_integration.js
node tests/opportunity_formation/c6_unchanged_consumption.js
node tests/opportunity_formation/scope_gate.js
node tests/opportunity_formation/idempotency.js
node tests/opportunity_formation/deterministic_replay.js
```

## Governance

- Publication authorized by Boss C9 ruling 2026-08-29
- Machine proof completed on canonical HEAD `b5eb9d206743a23375dbdc8c7310e82ec9bf3ad0`
- Canonical c5 SHA `59d2c0b53ed546407da05e162d0858c914e02f1f18ddda6260aff6c532e5eba6` (verified unchanged)
- Capital LOCKED. Execution LOCKED. Broadcast LOCKED.
