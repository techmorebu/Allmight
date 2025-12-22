#!/usr/bin/env python3
"""
Phase 2A-A (Path A) — Shared_Inputs (replay-relative)

Computes the Shared_Inputs row for ONE (AssetID, Timeframe) at a specific "as-of" candle,
using the exact Phase 0 sheet semantics:

- Windows are relative to the evaluation candle, NOT the latest in the file.
- SwingHigh_20 / SwingLow_20: max/min over the last 20 rows ending at as-of row
- ATR_14: average(High-Low) over last 14 rows ending at as-of row
- Last_Close / Prev_Close: Close at as-of row / previous row
- TrendSimple compares Prev_Close vs Last_Close: UP/DOWN/FLAT
- AvgVol_20: average Volume over last 20 rows ending at as-of row
- VolSpikeFlag: Last_Volume >= 1.5 * AvgVol_20

Input:
- A replay CSV for a single asset+timeframe, canonical schema:
  AssetID, Timeframe, Timestamp, Open, High, Low, Close, Volume
Output:
- One-row CSV with Shared_Inputs headers.

As-of selection:
- Default: last row in the file
- --asof-index: 0-based row index within this replay file (0 = first data row)
- --asof-timestamp: select the row whose Timestamp equals this (int). If multiple, uses last match.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import pandas as pd  # type: ignore

REQ = ["AssetID","Timeframe","Timestamp","Open","High","Low","Close","Volume"]


def _tail_window(df: pd.DataFrame, end_i: int, n: int) -> pd.DataFrame:
    """Inclusive end index end_i, take last n rows ending at end_i."""
    start = max(0, end_i - (n - 1))
    return df.iloc[start:end_i + 1]


def compute_at(df: pd.DataFrame, end_i: int) -> dict:
    # Preserve file order exactly (replay determinism)
    out = {}
    out["AssetID"] = str(df["AssetID"].iloc[0]).upper().strip()
    out["Timeframe"] = str(df["Timeframe"].iloc[0]).strip()

    # Last / Prev close at as-of index
    out["Last_Close"] = float(df["Close"].iloc[end_i])
    out["Prev_Close"] = float(df["Close"].iloc[end_i - 1]) if end_i - 1 >= 0 else float("nan")

    # Swing windows (20)
    w20 = _tail_window(df, end_i, 20)
    out["SwingHigh_20"] = float(w20["High"].max()) if len(w20) == 20 else float("nan")
    out["SwingLow_20"]  = float(w20["Low"].min())  if len(w20) == 20 else float("nan")

    # ATR_14 = average(High-Low) over last 14 rows ending at as-of
    w14 = _tail_window(df, end_i, 14)
    out["ATR_14"] = float((w14["High"] - w14["Low"]).mean()) if len(w14) == 14 else float("nan")

    # TrendSimple
    pc = out["Prev_Close"]
    lc = out["Last_Close"]
    if pd.isna(pc) or pd.isna(lc):
        out["TrendSimple"] = ""
    else:
        if pc > lc:
            out["TrendSimple"] = "UP"
        elif pc < lc:
            out["TrendSimple"] = "DOWN"
        else:
            out["TrendSimple"] = "FLAT"

    # VolatilityScore tiers on ATR_14 / Last_Close
    atr = out["ATR_14"]
    if pd.isna(atr) or pd.isna(lc) or lc == 0:
        out["VolatilityScore"] = ""
    else:
        r = atr / lc
        if r >= 0.02:
            out["VolatilityScore"] = 3
        elif r >= 0.01:
            out["VolatilityScore"] = 2
        elif r >= 0.005:
            out["VolatilityScore"] = 1
        else:
            out["VolatilityScore"] = 0

    out["Notes"] = ""

    # Volume metrics (20)
    out["Last_Volume"] = float(df["Volume"].iloc[end_i])
    out["AvgVol_20"] = float(w20["Volume"].mean()) if len(w20) == 20 else float("nan")

    lv = out["Last_Volume"]
    av = out["AvgVol_20"]
    if pd.isna(lv) or pd.isna(av) or av == 0:
        out["VolSpikeFlag"] = False
    else:
        out["VolSpikeFlag"] = bool(lv >= 1.5 * av)

    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, help="Replay OHLCV CSV (single asset+tf)")
    p.add_argument("--output", default="outputs/replay/shared_inputs_row.csv", help="Output one-row CSV")
    p.add_argument("--asof-index", type=int, default=None, help="0-based as-of row index within replay file")
    p.add_argument("--asof-timestamp", type=int, default=None, help="As-of Timestamp (seconds). Uses last match.")
    args = p.parse_args()

    if args.asof_index is not None and args.asof_timestamp is not None:
        raise SystemExit("Use only one: --asof-index OR --asof-timestamp")

    df = pd.read_csv(args.input)

    missing = [c for c in REQ if c not in df.columns]
    if missing:
        raise SystemExit(f"Input missing columns: {missing}")

    # Normalize + numeric
    df["AssetID"] = df["AssetID"].astype(str).str.upper().str.strip()
    df["Timeframe"] = df["Timeframe"].astype(str).str.strip()
    df["Timestamp"] = pd.to_numeric(df["Timestamp"], errors="coerce").astype("int64")
    for c in ["Open","High","Low","Close","Volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    if df.empty:
        raise SystemExit("Replay file is empty.")

    # Verify single asset/tf in file
    if df[["AssetID","Timeframe"]].drop_duplicates().shape[0] != 1:
        raise SystemExit("Replay file must contain exactly one (AssetID, Timeframe).")

    end_i = len(df) - 1
    if args.asof_index is not None:
        # Support Python-style negative indices: -1 => last row, -2 => second last, etc.
        end_i = args.asof_index
        if end_i < 0:
            end_i = len(df) + end_i
        if end_i < 0 or end_i >= len(df):
            raise SystemExit(f"--asof-index out of range. Must be {-len(df)}..{len(df)-1}")
    elif args.asof_timestamp is not None:
        matches = df.index[df["Timestamp"] == args.asof_timestamp].tolist()
        if not matches:
            raise SystemExit("No row found with that --asof-timestamp")
        end_i = matches[-1]

    out = compute_at(df, end_i)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame([out], columns=[
        "AssetID","Timeframe","Last_Close","Prev_Close","SwingHigh_20","SwingLow_20",
        "ATR_14","TrendSimple","VolatilityScore","Notes","Last_Volume","AvgVol_20","VolSpikeFlag"
    ]).to_csv(out_path, index=False)

    print(f"Wrote replay-relative Shared_Inputs: {out_path} asof_index={end_i} rows_in_replay={len(df)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
