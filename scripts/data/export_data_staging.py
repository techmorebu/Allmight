#!/usr/bin/env python3
"""
Phase 1E — Data_Staging Exporter (sheet-ingestable)

Goal:
- Produce a deterministic, long-format Data_Staging export that matches Phase 0 schema:
  A AssetID, B Timeframe, C Timestamp, D Open, E High, F Low, G Close, H Volume

Inputs:
- data/staging/ohlcv_staging.csv (canonical staging)

Outputs:
- data/processed/data_staging_export.csv (unified long table)

Features:
- --n: keep last N candles per (AssetID, Timeframe) (default: 200)
- --wipe: delete existing export file before writing
- --asset/--timeframe: filter to one pair (debug mode)
- Default behavior exports ALL pairs found in staging.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

import pandas as pd  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[2]
STAGING = REPO_ROOT / "data" / "staging" / "ohlcv_staging.csv"
OUTDIR = REPO_ROOT / "data" / "processed"
OUTFILE = OUTDIR / "data_staging_export.csv"

CANON_COLS = ["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"]


def load_staging(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing staging file: {path}")

    df = pd.read_csv(path)

    missing = [c for c in CANON_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Staging CSV missing columns: {missing}")

    # Normalize types + casing
    df["AssetID"] = df["AssetID"].astype(str).str.upper().str.strip()
    df["Timeframe"] = df["Timeframe"].astype(str).str.strip()
    df["Timestamp"] = pd.to_numeric(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"]).copy()
    df["Timestamp"] = df["Timestamp"].astype("int64")

    # Keep canonical order only
    df = df[CANON_COLS]
    return df


def apply_window(df: pd.DataFrame, n: int) -> pd.DataFrame:
    if n <= 0:
        # no windowing; still enforce ordering
        return (
            df.sort_values(["AssetID", "Timeframe", "Timestamp"], ascending=True)
              .reset_index(drop=True)
        )

    # Deterministic: sort then tail(n) per group, then resort for final output
    df = df.sort_values(["AssetID", "Timeframe", "Timestamp"], ascending=True)
    df = df.groupby(["AssetID", "Timeframe"], as_index=False).tail(n)
    df = df.sort_values(["AssetID", "Timeframe", "Timestamp"], ascending=True).reset_index(drop=True)
    return df


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", default=str(STAGING), help="Path to canonical staging CSV")
    p.add_argument("--output", default=str(OUTFILE), help="Output path for Data_Staging export CSV")
    p.add_argument("--n", type=int, default=200, help="Keep last N candles per AssetID+Timeframe (default: 200)")
    p.add_argument("--wipe", action="store_true", help="Delete existing export before writing")
    p.add_argument("--asset", help="Optional AssetID filter (e.g., BTC)")
    p.add_argument("--timeframe", help="Optional Timeframe filter (e.g., 15m). If provided, requires --asset.")
    args = p.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)

    if args.timeframe and not args.asset:
        p.error("--asset is required when using --timeframe")

    if args.wipe and out_path.exists():
        out_path.unlink()
        print(f"Wipe enabled. Deleted prior export: {out_path}")

    df = load_staging(in_path)

    if args.asset:
        asset = args.asset.strip().upper()
        df = df[df["AssetID"] == asset].copy()
        if args.timeframe:
            tf = args.timeframe.strip()
            df = df[df["Timeframe"] == tf].copy()

    if df.empty:
        raise ValueError("No rows to export after filtering. Check --asset/--timeframe or staging content.")

    df = apply_window(df, int(args.n))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False)

    # Report counts
    groups = df.groupby(["AssetID", "Timeframe"]).size()
    print(f"Wrote Data_Staging export: {out_path} rows={len(df)} groups={len(groups)} n={int(args.n)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
