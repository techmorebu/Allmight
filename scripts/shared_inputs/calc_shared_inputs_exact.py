#!/usr/bin/env python3
"""
Phase 2A — Shared_Inputs (EXACT to Phase0_PaperBrain.xlsx)

Sheet behavior we replicate:
- Window calcs are bounded to Data_Staging rows 2..1000 (i.e., at most 999 data rows).
- SwingHigh_20 / SwingLow_20 use last 20 rows of the filtered (AssetID,Timeframe) subset
  within that bounded universe.
- ATR_14 is AVERAGE of last 14 (High-Low) rows (no True Range, no Wilder).
- Last_Volume is last Volume row.
- AvgVol_20 is average of last 20 Volume rows.
- VolSpikeFlag = Last_Volume >= 1.5 * AvgVol_20 (guarded for empty/0).
- TrendSimple compares Prev_Close to Last_Close:
    UP if Prev_Close > Last_Close
    DOWN if Prev_Close < Last_Close
    FLAT otherwise

Input:
- canonical long OHLCV CSV with columns:
  AssetID, Timeframe, Timestamp, Open, High, Low, Close, Volume
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd  # type: ignore


REQ = ["AssetID","Timeframe","Timestamp","Open","High","Low","Close","Volume"]

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = REPO_ROOT / "data" / "processed" / "data_staging_export.csv"
DEFAULT_OUTPUT = REPO_ROOT / "data" / "processed" / "shared_inputs_export.csv"

# Mirror sheet's Data_Staging!2:1000 cap (max 999 data rows in the table area)
SHEET_ROW_CAP = 999  # rows of data per (AssetID,Timeframe) after filtering


def tail_n(g: pd.DataFrame, n: int) -> pd.DataFrame:
    return g.iloc[-n:] if len(g) >= n else g


def compute_one(g: pd.DataFrame) -> dict:
    # g is one AssetID+Timeframe group
    # IMPORTANT: Preserve sheet row order. FILTER() keeps original row order; it does NOT sort by Timestamp.

    # Apply the same universe cap as the sheet's *2:*1000 ranges
    g = tail_n(g, SHEET_ROW_CAP)

    out = {}
    out["AssetID"] = str(g["AssetID"].iloc[0]).upper().strip()
    out["Timeframe"] = str(g["Timeframe"].iloc[0]).strip()

    # Last / Prev Close
    out["Last_Close"] = float(g["Close"].iloc[-1]) if len(g) >= 1 else float("nan")
    out["Prev_Close"] = float(g["Close"].iloc[-2]) if len(g) >= 2 else float("nan")

    # SwingHigh_20 / SwingLow_20 over last 20 rows of capped subset
    if len(g) >= 20:
        w20 = g.iloc[-20:]
        out["SwingHigh_20"] = float(w20["High"].max())
        out["SwingLow_20"]  = float(w20["Low"].min())
    else:
        out["SwingHigh_20"] = float("nan")
        out["SwingLow_20"]  = float("nan")

    # ATR_14 = simple average of last 14 (High-Low)
    if len(g) >= 14:
        w14 = g.iloc[-14:]
        out["ATR_14"] = float((w14["High"] - w14["Low"]).mean())
    else:
        out["ATR_14"] = float("nan")

    # TrendSimple (Prev vs Last)
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

    # Notes: sheet column exists, no formula
    out["Notes"] = ""

    # Volume metrics (same capped subset)
    out["Last_Volume"] = float(g["Volume"].iloc[-1]) if len(g) >= 1 else float("nan")
    if len(g) >= 20:
        out["AvgVol_20"] = float(g.iloc[-20:]["Volume"].mean())
    else:
        out["AvgVol_20"] = float("nan")

    lv = out["Last_Volume"]
    av = out["AvgVol_20"]
    if pd.isna(lv) or pd.isna(av) or av == 0:
        out["VolSpikeFlag"] = False
    else:
        out["VolSpikeFlag"] = bool(lv >= 1.5 * av)

    return out


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", default=str(DEFAULT_INPUT), help="Input long OHLCV CSV")
    p.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output Shared_Inputs CSV")
    p.add_argument("--asset", help="Optional filter AssetID (e.g., BTC)")
    p.add_argument("--timeframe", help="Optional filter Timeframe (requires --asset)")
    args = p.parse_args()

    if args.timeframe and not args.asset:
        p.error("--asset is required when using --timeframe")

    df = pd.read_csv(args.input)
    missing = [c for c in REQ if c not in df.columns]
    if missing:
        raise ValueError(f"Input missing columns: {missing}")

    df["AssetID"] = df["AssetID"].astype(str).str.upper().str.strip()
    df["Timeframe"] = df["Timeframe"].astype(str).str.strip()
    df["Timestamp"] = pd.to_numeric(df["Timestamp"], errors="coerce").astype("int64")

    for c in ["Open","High","Low","Close","Volume"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    if args.asset:
        a = args.asset.strip().upper()
        df = df[df["AssetID"] == a].copy()
        if args.timeframe:
            tf = args.timeframe.strip()
            df = df[df["Timeframe"] == tf].copy()

    if df.empty:
        raise ValueError("No rows to compute after filtering.")

    rows = []
    for (_, _), g in df.groupby(["AssetID","Timeframe"], sort=True):
        rows.append(compute_one(g))

    out = pd.DataFrame(rows, columns=[
        "AssetID","Timeframe","Last_Close","Prev_Close","SwingHigh_20","SwingLow_20",
        "ATR_14","TrendSimple","VolatilityScore","Notes","Last_Volume","AvgVol_20","VolSpikeFlag"
    ])

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(out_path, index=False)

    print(f"Wrote Shared_Inputs export: {out_path} rows={len(out)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
