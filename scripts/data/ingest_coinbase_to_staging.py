#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path
import pandas as pd  # type: ignore
import ccxt  # type: ignore

REPO_ROOT = Path(__file__).resolve().parents[2]
STAGING = REPO_ROOT / "data" / "staging" / "ohlcv_staging.csv"
CANON_COLS = ["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"]

def fetch_ohlcv_coinbase(symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    ex = ccxt.coinbase({"enableRateLimit": True})
    ex.load_markets()
    if symbol not in ex.markets:
        raise ValueError(f"Symbol not available on coinbase: {symbol}")

    ohlcv = ex.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
    if not ohlcv:
        raise ValueError("No OHLCV returned (empty).")

    # ccxt OHLCV format: [ms, open, high, low, close, volume]
    df = pd.DataFrame(ohlcv, columns=["TimestampMs", "Open", "High", "Low", "Close", "Volume"])
    df["Timestamp"] = (df["TimestampMs"] // 1000).astype("int64")
    df = df.drop(columns=["TimestampMs"])
    return df

def load_staging(path: Path) -> pd.DataFrame:
    if not path.exists():
        # create empty staging with columns
        return pd.DataFrame(columns=CANON_COLS)
    df = pd.read_csv(path)
    # If file exists but missing cols, fail loudly (don’t silently corrupt)
    missing = [c for c in CANON_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Existing staging missing columns: {missing}")
    return df

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", required=True, help="Exchange symbol, e.g. PAXG/USD")
    ap.add_argument("--assetid", required=True, help="AssetID to store under, e.g. XAU")
    ap.add_argument("--timeframe", required=True, help="e.g. 15m")
    ap.add_argument("--limit", type=int, default=1000)
    ap.add_argument("--staging", default=str(STAGING))
    args = ap.parse_args()

    symbol = args.symbol.strip().upper()
    assetid = args.assetid.strip().upper()
    tf = args.timeframe.strip()

    fresh = fetch_ohlcv_coinbase(symbol=symbol, timeframe=tf, limit=int(args.limit))
    fresh.insert(0, "Timeframe", tf)
    fresh.insert(0, "AssetID", assetid)
    fresh = fresh[CANON_COLS].copy()

    staging_path = Path(args.staging)
    staging_path.parent.mkdir(parents=True, exist_ok=True)

    old = load_staging(staging_path)

    merged = pd.concat([old, fresh], ignore_index=True)

    # Normalize + dedupe
    merged["AssetID"] = merged["AssetID"].astype(str).str.upper().str.strip()
    merged["Timeframe"] = merged["Timeframe"].astype(str).str.strip()
    merged["Timestamp"] = pd.to_numeric(merged["Timestamp"], errors="coerce")
    merged = merged.dropna(subset=["Timestamp"]).copy()
    merged["Timestamp"] = merged["Timestamp"].astype("int64")

    # De-dupe exact candle identity
    merged = merged.drop_duplicates(subset=["AssetID", "Timeframe", "Timestamp"], keep="last")
    merged = merged.sort_values(["AssetID", "Timeframe", "Timestamp"], ascending=[True, True, True])

    merged.to_csv(staging_path, index=False)

    print(f"Wrote staging: {staging_path}")
    print(f"Appended {len(fresh)} rows for {assetid} {tf} (from {symbol})")
    sub = merged[(merged["AssetID"] == assetid) & (merged["Timeframe"] == tf)]
    print(f"Total rows now for {assetid} {tf}: {len(sub)}")
    print("Newest timestamp:", int(sub["Timestamp"].max()) if len(sub) else None)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
