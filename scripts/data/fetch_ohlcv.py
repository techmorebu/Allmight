#!/usr/bin/env python3
"""
Fetch OHLCV from Coinbase (public) via CCXT and write to a staging CSV.

Output schema (matches Phase 0):
AssetID, Timeframe, Timestamp, Open, High, Low, Close, Volume

Notes:
- Coinbase symbols are typically like BTC/USD (not BTC/USDT).
- Timestamp is UNIX seconds (not ms) to match your sheet usage.
"""

from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import ccxt  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = REPO_ROOT / "config"
DATA_DIR = REPO_ROOT / "data"
STAGING_DIR = DATA_DIR / "staging"
LOGS_DIR = REPO_ROOT / "logs"

DEFAULT_OUTPUT = STAGING_DIR / "ohlcv_staging.csv"
DEFAULT_LIMIT = 200


@dataclass
class CandleRow:
    asset_id: str
    timeframe: str
    ts_sec: int
    o: float
    h: float
    l: float
    c: float
    v: float


def setup_logging() -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_DIR / "data_pipeline.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def load_json(path: Path) -> dict:
    if not path.exists():
        raise FileNotFoundError(f"Missing config file: {path}")
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def normalize_asset_id(symbol: str) -> str:
    # "BTC/USD" -> "BTC"
    return symbol.split("/")[0].strip().upper()


def ensure_dirs() -> None:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "raw").mkdir(parents=True, exist_ok=True)


def make_exchange() -> ccxt.Exchange:
    # Public endpoints only; no API keys required for OHLCV.
    ex = ccxt.coinbase({
        "enableRateLimit": True,
        # coinbase can be strict; keep it conservative
        "rateLimit": 350,
        "timeout": 20000,
    })
    return ex


def fetch_one(
    ex: ccxt.Exchange,
    symbol: str,
    timeframe: str,
    limit: int,
    retries: int = 3,
) -> Tuple[List[List[float]], Optional[str]]:
    """Return (ohlcv, error_message). ohlcv rows are [ms, o, h, l, c, v]."""
    last_err: Optional[str] = None
    for attempt in range(1, retries + 1):
        try:
            ohlcv = ex.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            if not ohlcv:
                return [], f"Empty OHLCV for {symbol} {timeframe}"
            return ohlcv, None
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            logging.warning(f"[{symbol} {timeframe}] attempt {attempt}/{retries} failed: {last_err}")
            time.sleep(1.0 * attempt)
    return [], last_err


def to_rows(symbol: str, timeframe: str, ohlcv: List[List[float]]) -> List[CandleRow]:
    asset_id = normalize_asset_id(symbol)
    rows: List[CandleRow] = []
    for item in ohlcv:
        # CCXT standard: [timestamp_ms, open, high, low, close, volume]
        ts_ms, o, h, l, c, v = item
        ts_sec = int(ts_ms // 1000)
        rows.append(CandleRow(asset_id, timeframe, ts_sec, float(o), float(h), float(l), float(c), float(v)))
    return rows


def write_csv(out_path: Path, rows: List[CandleRow]) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"])
        for r in rows:
            w.writerow([r.asset_id, r.timeframe, r.ts_sec, r.o, r.h, r.l, r.c, r.v])


def main() -> int:
    setup_logging()
    ensure_dirs()

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT, help="Candles per asset/timeframe (default: 200)")
    parser.add_argument("--output", type=str, default=str(DEFAULT_OUTPUT), help="Output CSV path")
    parser.add_argument("--dry-run", action="store_true", help="Do not write output; just fetch and report counts")
    args = parser.parse_args()

    assets_cfg = load_json(CONFIG_DIR / "assets.json")
    tf_cfg = load_json(CONFIG_DIR / "timeframes.json")

    symbols: List[str] = assets_cfg.get("assets", [])
    timeframes: List[str] = tf_cfg.get("timeframes", [])

    if not symbols or not timeframes:
        logging.error("Config missing 'assets' or 'timeframes'.")
        return 2

    ex = make_exchange()

    all_rows: List[CandleRow] = []
    failures = 0

    logging.info(f"Starting OHLCV fetch: exchange=coinbase symbols={len(symbols)} timeframes={timeframes} limit={args.limit}")

    for sym in symbols:
        for tf in timeframes:
            ohlcv, err = fetch_one(ex, sym, tf, args.limit)
            if err:
                failures += 1
                logging.error(f"FAIL {sym} {tf}: {err}")
                continue

            rows = to_rows(sym, tf, ohlcv)
            all_rows.extend(rows)
            logging.info(f"OK   {sym} {tf}: {len(rows)} candles")

    if args.dry_run:
        logging.info(f"Dry run complete. Total rows fetched: {len(all_rows)} failures: {failures}")
        return 0 if len(all_rows) > 0 else 1

    out_path = Path(args.output)
    write_csv(out_path, all_rows)
    logging.info(f"Wrote staging CSV: {out_path} rows={len(all_rows)} failures={failures}")

    # Non-zero if everything failed
    return 0 if len(all_rows) > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
