# ETC Baseline v1.1 — Post-Correction Milestone

## v1 (pre-correction) -> v1.1 (post-correction)
X1a applied (commit ca80c38): blueprint post-aave accounting correction.

## Deterministic delta (validated on frozen v0 inputs, Boss "B")
- expectedEdgePct: shifted DOWN by exactly 5.00 bps (Aave flash fee)
- netProfitUsd:    shifted DOWN by exactly size * 0.0005 ($0.10 at $200)
- All 8 sampled blueprints: edge shift 0.05, net shift 0.10. PASSED.

## Scope (Boss G2.15)
- X1a ONLY — display/accounting correction
- finalEdge (gate, line 669) UNTOUCHED; signal generation UNCHANGED
- X1b (profitability-aware gating) deferred to Phase ETC-H1
- X2 (detected-vs-executed spread drift) documented + deferred
- Out-of-scope copies (trade_blueprint_engine, opportunity_watcher): follow-up

## Notable finding
Post-correction, some "viable"-marked blueprints show NEGATIVE post-aave
edge (e.g. BP-MPGL7R5D-000001: 0.02669 -> -0.02331). Confirms the
thin-edge interpretation: pre-correction edge was optimistic by the
omitted 5 bps Aave fee.

## Three-layer economic hierarchy (official, Boss G2.15)
1. detected spread          - raw market dislocation
2. modeled executable edge  - after deterministic friction (incl. aave)
3. realized executable outcome - after real execution

## Baseline lineage
- v0/v1 (frozen, pre-correction): logs/evidence/etc_baseline_v0/
- v1.1 (post-correction milestone): commit ca80c38

## Status
- X1a: applied, validated, committed (ca80c38), pushed
- Next: ETC frontier sampling (26-35 bps regime - critical data objective)
- Live trading: STILL LOCKED | Capital: STILL SAFE
