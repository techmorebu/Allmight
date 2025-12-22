# Phase 2B — Institutional Pressure L1 (Replay-Relative)

## Goal
Rebuild Phase 0 sheet `02_Institutional_Pressure_L1` as deterministic, replay-relative Python.

## Key Deliverables
- `scripts/pressure/calc_pressure_replay.py`
  - Function: `calc_pressure_l1_replay(shared_inputs_df, structure_l0_df, active_grid, ...)`
  - Produces L1 fields equivalent to the Phase 0 sheet columns A..N (implementation focuses on computed fields + score outputs).
- `scripts/pressure/run_pressure_grid.py`
  - One-command runner that:
    1) Generates replay windows from staging via `scripts/data/replay_ohlcv_window.py`
    2) Computes one-row Shared_Inputs for `asof_index` and `asof_index-60`
    3) Builds a grid (row-index semantics)
    4) Computes Structure L0 then Pressure L1
    5) Writes artifacts under `outputs/replay/` (gitignored)

## Inputs (Replay Semantics)
Row semantics are *replay-relative*:
- Each Active Grid row is treated independently and represents one AssetID + Timeframe.
- Shared_Inputs + L0 + L1 are computed per row at the same `asof_index` within that asset’s replay file.

## L1 Dependencies
From Shared_Inputs:
- `Last_Close`, `Prev_Close`, `ATR_14`, `TrendSimple`, `VolSpikeFlag`
From Structure L0:
- `StructureBias`, `SSP_TotalStructureScore`

## Coinbase-only Proxy Support (XAU)
The replay harness is staging-driven (filters by `AssetID + Timeframe`), so proxies must exist in `data/staging/ohlcv_staging.csv`.

Implemented:
- XAU proxy via Coinbase `PAXG/USD` ingested into staging as `AssetID=XAU`:
  - `scripts/data/ingest_coinbase_to_staging.py --symbol PAXG/USD --assetid XAU --timeframe 15m`

## Validation
- Verified deterministic replay behavior:
  - Same asset/timeframe with different `asof_index` produces different L0/L1 values.
- Verified multi-row grid behavior:
  - BTC/ETH/XRP/XAU pipeline runs end-to-end.
  - Example: XAU `vol_spike_gate` changed between i60 and last, impacting `pressure_score` accordingly.

## Artifacts
Runner outputs (gitignored):
- `outputs/replay/shared_inputs_GRID_<ASSETS>_<TF>_{last|i60}.csv`
- `outputs/replay/structure_l0_GRID_<ASSETS>_<TF>_{last|i60}.csv`
- `outputs/replay/pressure_l1_GRID_<ASSETS>_<TF>_{last|i60}.csv`
