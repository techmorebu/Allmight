# Phase 2B — Known Issues / Gotchas

## 1) `--asof-index` does not accept negative indices (Shared_Inputs)
`calc_shared_inputs_replay.py` currently rejects `--asof-index -1`.
Workaround: use explicit indices (e.g. last = n-1, i60 = (n-1)-60).

Recommended improvement:
- Support Python-style negatives by translating:
  - -1 => last row
  - -60 => 60 from end, etc.
(with bounds checks)

## 2) Replay harness is staging-driven (not exchange-driven)
`scripts/data/replay_ohlcv_window.py` filters `data/staging/ohlcv_staging.csv` by `AssetID + Timeframe`.
It does NOT fetch from ccxt directly.

Implication:
- Any new asset/proxy must be ingested into staging first (canonical schema).

## 3) SPX not available from Coinbase spot
Coinbase spot lacks SPX/SPY spot pairs.
SPX support requires:
- alternate data source, or
- proxy asset with its own ingestion path (future module)

## 4) Excel workbook contains UDF/dynamic-array constructs
Phase 0 workbook uses `__xludf.DUMMYFUNCTION(...)` wrappers.
`openpyxl` cannot evaluate these, so numerical parity validation is done via:
- formula structure equivalence
- deterministic replay consistency
- cross-checking outputs between windows
