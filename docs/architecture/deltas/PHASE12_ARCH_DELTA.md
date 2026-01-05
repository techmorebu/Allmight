# PHASE 12 — Architecture Delta (Draft)

## What Phase 12 Adds
A read-only orchestration helper for multi-source market snapshots that:
- Calls multiple snapshot adapters in a declared order
- Routes every live-read through `AdapterBroker.call(operation="market_snapshot_live")`
- Reconciles results using Phase 11 snapshot primitives only
- Optionally emits deterministic audit output for operator debugging

## What Phase 12 Depends On (Authoritative)
- Phase 11 snapshot reconciliation primitives:
  - normalize/merge helpers
  - SnapshotAggregate + audit-emission capability
- AdapterBroker boundary:
  - default-deny network
  - capability-scoped declarations
  - redaction/refusal semantics preserved by `.call`

## What Phase 12 Deliberately Does NOT Do
- No execution, trading, signing, or writes
- No retries/backoff
- No credential handling or account endpoints
- No new allowlists/domains
- No daemons/schedulers/websockets/UI

## Determinism & Ordering Rules
- Adapter order is preserved exactly as provided by the caller.
- Audit output preserves adapter order exactly.
- Merge policies are Phase 11 policies; Phase 12 adds no new merge logic.
- If no usable snapshots remain after filtering/refusals, the call fails explicitly.

## Operator Debug Contract (Audit)
Audit must tell a future operator:
- Which adapters were called (in order)
- Which succeeded/failed and why
- Which inputs were used for merge
- Which merge policy was applied

## Extension Points
Phase 13 may build strategy logic on top of the merged snapshot + audit,
but Phase 12 remains a pure read-only orchestration membrane.

