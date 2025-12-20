#!/usr/bin/env python3
"""
Replay Harness (Phase 1D) — with wipe + rebuild support

Modes:
1) Single pair:
   python scripts/data/replay_ohlcv_window.py --asset BTC --timeframe 15m --n 200

2) All pairs from config (recommended):
   python scripts/data/replay_ohlcv_window.py --all --n 200

3) Wipe + rebuild (recommended for sanity):
   python scripts/data/replay_ohlcv_window.py --all --wipe --n 200

Input:
  data/staging/ohlcv_staging.csv

Outputs:
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
import json
from pathlib import Path
from typing import Iterable, List, Tuple

import pandas as pd  # type: ignore


REPO_ROOT = Path(__file__).resolve().parents[2]
STAGING = REPO_ROOT / "data" / "staging" / "ohlcv_staging.csv"
REPLAY_DIR = REPO_ROOT / "data" / "processed" / "replay"
CONFIG_ASSETS = REPO_ROOT / "config" / "assets.json"
CONFIG_TFS = REPO_ROOT / "config" / "timeframes.json"

CANON_COLS = ["AssetID", "Timeframe", "Timestamp", "Open", "High", "Low", "Close", "Volume"]


def asset_id_from_symbol(sym: str) -> str:
    # "BTC/USD" -> "BTC"
    return sym.split("/")[0].strip().upper()


def load_pairs_from_config() -> List[Tuple[str, str]]:
    if not CONFIG_ASSETS.exists():
        raise FileNotFoundError(f"Missing config: {CONFIG_ASSETS}")
    if not CONFIG_TFS.exists():
        raise FileNotFoundError(f"Missing config: {CONFIG_TFS}")

    assets_cfg = json.load(CONFIG_ASSETS.open("r", encoding="utf-8"))
    tf_cfg = json.load(CONFIG_TFS.open("r", encoding="utf-8"))

    symbols = assets_cfg.get("assets", [])
    timeframes = tf_cfg.get("timeframes", [])

    if not symbols or not timeframes:
        raise ValueError("Config missing 'assets' or 'timeframes'.")

    pairs = [(asset_id_from_symbol(s), str(tf).strip()) for s in symbols for tf in timeframes]
    return pairs


def wipe_replay_outputs() -> int:
    """Delete only generated replay CSVs, not the directory."""
    REPLAY_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for p in REPLAY_DIR.glob("ohlcv_replay_*.csv"):
        try:
            p.unlink()
            n += 1
        except Exception:
            # Best-effort; fail loudly later if we can't write.
            pass
    return n


def load_staging_df(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Missing staging file: {path}")

    df = pd.read_csv(path)

    missing = [c for c in CANON_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Staging CSV missing columns: {missing}")

    # Normalize types
    df["AssetID"] = df["AssetID"].astype(str).str.upper().str.strip()
    df["Timeframe"] = df["Timeframe"].astype(str).str.strip()
    df["Timestamp"] = pd.to_numeric(df["Timestamp"], errors="coerce")
    df = df.dropna(subset=["Timestamp"]).copy()
    df["Timestamp"] = df["Timestamp"].astype("int64")

    return df


def write_one(df: pd.DataFrame, asset: str, tf: str, n: int) -> Path:
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
    return out_path


def main() -> int:
    p = argparse.ArgumentParser()
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--all", action="store_true", help="Generate for all assets/timeframes from config/")
    mode.add_argument("--asset", help="AssetID, e.g. BTC (single mode)")
    p.add_argument("--timeframe", help="Timeframe, e.g. 15m (single mode, required with --asset)")
    p.add_argument("--n", type=int, default=200, help="Candles per replay window (default: 200)")
    p.add_argument("--wipe", action="store_true", help="Delete existing replay outputs before generating")
    p.add_argument("--input", default=str(STAGING), help="Path to staging CSV")
    args = p.parse_args()

    if args.asset and not args.timeframe:
        p.error("--timeframe is required when using --asset")

    if args.wipe:
        deleted = wipe_replay_outputs()
        print(f"Wipe enabled. Deleted {deleted} existing replay files.")

    df = load_staging_df(Path(args.input))

    if args.all:
        pairs = load_pairs_from_config()
        ok = 0
        fail = 0
        for asset, tf in pairs:
            try:
                out = write_one(df, asset, tf, int(args.n))
                ok += 1
            except Exception as e:
                fail += 1
                print(f"FAIL {asset} {tf}: {type(e).__name__}: {e}")
        print(f"Done. ok={ok} fail={fail} out_dir={REPLAY_DIR}")
        return 0 if ok > 0 and fail == 0 else 1

    # Single mode
    asset = args.asset.strip().upper()
    tf = args.timeframe.strip()
    out = write_one(df, asset, tf, int(args.n))
    print(f"Wrote replay window: {out} asset={asset} tf={tf} n={int(args.n)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
