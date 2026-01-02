# PHASE 11 — Architecture Delta

As-of: 2026-01-02

## Summary
Phase 11 added a pure snapshot reconciliation layer (no network, no credentials, no retries).

## Additions
- `allmight/adapters/snapshot_merge.py`
  - Policies: `pick_first`, `pick_first_valid`, `median`, `reject_outliers`, `median_strict`
  - Explicit refusal codes for strict behavior
- `allmight/adapters/snapshot_normalize_merge.py`
  - `normalize_and_merge()` helper: pair enforcement + invalid filtering
- `allmight/adapters/snapshot_aggregate.py`
  - Aggregate result structure: merged snapshot + audit metadata
- `allmight/adapters/snapshot_band.py`
  - Shared spread/band helper used by strict reconciliation

## Constraints / Invariants Reinforced
- Still read-only: no execution, no account endpoints, no credentials
- Still pure: deterministic logic under tests
- Refusals are explicit and test-backed

## Notes for Next Phase
- If integrating into Broker paths, keep trust boundary explicit:
  - merge/normalize must remain “pure” layer
  - broker remains single network gateway
