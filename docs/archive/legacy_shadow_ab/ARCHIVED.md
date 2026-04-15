# Legacy Shadow A/B Harness — Archived 2026-04-15

These files are the original shadow A/B evaluation skeleton from early project phases.
They are NOT part of the current execution stack and are kept only for historical reference.

## What replaced them

| Old | New |
|-----|-----|
| `metrics.py`, `runner.py`, `pipelines.py` | `scripts/execution/pnl_engine.js` |
| `io.py`, `cli.py` | `scripts/execution/execution_sandbox.js` |
| `phase2_shadow_eval.py` | `scripts/tools/execution_sandbox_report.js` |

## Files KEPT in active paths

- `scripts/execution/shadow_mode.py` — legacy PnL reference (doctrine source)
- `scripts/execution/execute_trade.js` — future live execution bridge (not yet active)

## Do not delete

These archived files contain historical context for how the PnL doctrine was first
expressed. `shadow_mode.py` in particular was the canonical reference for
`pnl_engine.js` (Aave fee, gas cost, revert rule).
