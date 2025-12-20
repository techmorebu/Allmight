#!/usr/bin/env python3
"""
Replay Harness (Phase 1D)

Given AssetID and Timeframe, extract the last N candles from the canonical staging CSV
and write a deterministic replay window CSV.

Input:
  data/staging/ohlcv_staging.csv

Output:
  data/processed/replay/ohlcv_replay_<ASSET>_<TF>.csv

Schema:
  AssetID, Timeframe, Timestamp, Open, High, Low, Close, Volume

Guarantees:
- Filters strictly by AssetID + Timeframe
- Sorts by Timestamp ascending (oldest -> newest)
- Output row count = N (unless not enough data exists)
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[2]
STAGING = REPO_ROOT / "data" / "staging" / "ohlcv_staging.csv"
REPLAY_DIR = REPO_ROOT / "data" / "processed" / "replay"


CANON_COLS = ["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"]


def normalize_tf(tf: str) -> str:
    # filesystem-safe but still readable: "15m" stays "15m", "1h" stays "1h"
    return tf.strip()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--asset", required=True, help="AssetID, e.g. BTC")
    p.add_argument("--timeframe", required=True, help="Timeframe, e.g. 15m")
    p.add_argument("--n", type=int, default=200, help="Number of candles to export (default: 200)")
    p.add_argument("--input", default=str(STAGING), help="Path to staging CSV")
    args = p.parse_args()

    asset = args.asset.strip().upper()
    tf = normalize_tf(args.timeframe)
    n = int(args.n)

    in_path = Path(args.input)
    if not in_path.exists():
        raise FileNotFoundError(f"Missing staging file: {in_path}")

    df = pd.read_csv(in_path)

    missing = [c for c in CANON_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Staging CSV missing columns: {missing}")

    # Normalize types
    df["AssetID"] = df["AssetID"].astype(str).str.upper().str.strip()
    df["Timeframe"] = df["Timeframe"].astype(str).str.strip()
    df["Timestamp"] = pd.to_numeric(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"]).copy()
    df["Timestamp"] = df["Timestamp"].astype("int64")

    sub = df[(df["AssetID"] == asset) & (df["Timeframe"] == tf)].copy()
    if sub.empty:
        raise ValueError(f"No rows found for AssetID={asset} Timeframe={tf}")

    sub = sub.sort_values("Timestamp", ascending=True)

    if n > 0 and len(sub) > n:
        sub = sub.tail(n)

    sub = sub[CANON_COLS].reset_index(drop=True)

    REPLAY_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPLAY_DIR / f"ohlcv_replay_{asset}_{tf}.csv"
    sub.to_csv(out_path, index=False)

    print(f"Wrote replay window: {out_path} rows={len(sub)} asset={asset} tf={tf}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
