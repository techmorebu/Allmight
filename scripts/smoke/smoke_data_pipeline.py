#!/usr/bin/env python3
"""
Smoke test for Phase 1 data pipeline output.

Validates:
- staging CSV exists
- required headers present
- row count >= 60
- numeric columns are numeric
- volume is not a timestamp-like integer
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
STAGING_CSV = REPO_ROOT / "data" / "staging" / "ohlcv_staging.csv"

REQUIRED_HEADERS = ["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"]


def is_float(x: str) -> bool:
    try:
        float(x)
        return True
    except Exception:
        return False


def main() -> int:
    if not STAGING_CSV.exists():
        print(f"FAIL: Missing staging CSV: {STAGING_CSV}")
        return 2

    with STAGING_CSV.open("r", encoding="utf-8") as f:
        r = csv.DictReader(f)
        headers = r.fieldnames or []
        missing = [h for h in REQUIRED_HEADERS if h not in headers]
        if missing:
            print(f"FAIL: Missing headers: {missing}")
            print(f"Found headers: {headers}")
            return 3

        rows = list(r)

    if len(rows) < 60:
        print(f"FAIL: Too few rows ({len(rows)}). Need at least 60 for Swing20/ATR14 stability.")
        return 4

    # Check first 50 rows for numeric sanity
    for i, row in enumerate(rows[:50], start=1):
        # Timestamp should be int-ish
        ts = row["Timestamp"]
        if not ts.isdigit():
            print(f"FAIL: Timestamp not an integer at row {i}: {ts}")
            return 5

        # Price columns numeric
        for k in ["Open", "High", "Low", "Close", "Volume"]:
            if not is_float(row[k]):
                print(f"FAIL: Non-numeric {k} at row {i}: {row[k]}")
                return 6

        # Volume sanity: should not look like a UNIX timestamp
        vol = float(row["Volume"])
        if vol > 1_000_000_000:  # 1e9, timestamps often ~1.7e9 seconds or 1.7e12 ms
            print(f"FAIL: Volume looks timestamp-like at row {i}: {vol}")
            return 7

    print(f"PASS: {STAGING_CSV} rows={len(rows)} headers OK numeric sanity OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
