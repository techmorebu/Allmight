#!/usr/bin/env python3
"""
Build a "latest candle" snapshot from the staging OHLCV file.

Input:
  data/staging/ohlcv_staging.csv

Output:
  data/processed/ohlcv_latest.csv

The output contains one row per (AssetID, Timeframe): the most recent candle by Timestamp.
Schema preserved:
  AssetID, Timeframe, Timestamp, Open, High, Low, Close, Volume
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[2]
STAGING = REPO_ROOT / "data" / "staging" / "ohlcv_staging.csv"
OUTDIR = REPO_ROOT / "data" / "processed"
OUTFILE = OUTDIR / "ohlcv_latest.csv"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", default=str(STAGING), help="Path to staging OHLCV CSV")
    p.add_argument("--output", default=str(OUTFILE), help="Path to latest snapshot CSV")
    args = p.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)

    if not in_path.exists():
        raise FileNotFoundError(f"Missing staging file: {in_path}")

    df = pd.read_csv(in_path)

    required = ["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Staging CSV missing columns: {missing}")

    # Ensure Timestamp numeric for proper sorting
    df["Timestamp"] = pd.to_numeric(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"]).copy()
    df["Timestamp"] = df["Timestamp"].astype("int64")

    # Sort and take latest per (AssetID, Timeframe)
    df = df.sort_values(["AssetID", "Timeframe", "Timestamp"])
    latest = df.groupby(["AssetID", "Timeframe"], as_index=False).tail(1)

    # Keep canonical column order
    latest = latest[required].sort_values(["AssetID", "Timeframe"]).reset_index(drop=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    latest.to_csv(out_path, index=False)

    print(f"Wrote latest snapshot: {out_path} rows={len(latest)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
