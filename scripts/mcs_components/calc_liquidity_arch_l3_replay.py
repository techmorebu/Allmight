from __future__ import annotations


import sys
from pathlib import Path as _Path
_REPO_ROOT = _Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, List

from scripts.mcs_components.replay_component_io import ComponentRow, ReplayComponentError, write_component_csv


def _read_shared_inputs(path: Path, grid_assets: List[str]) -> Dict[str, dict]:
    if not path.exists():
        raise ReplayComponentError(f"Missing shared_inputs CSV: {path}")

    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []

        asset_col = "asset" if "asset" in fields else ("AssetID" if "AssetID" in fields else "")
        if not asset_col:
            raise ReplayComponentError(f"shared_inputs schema missing ['asset' or 'AssetID']; got {fields}")

        required = [asset_col, "SwingHigh_20", "SwingLow_20", "Last_Close", "ATR_14"]
        missing_cols = [c for c in required if c not in fields]
        if missing_cols:
            raise ReplayComponentError(f"shared_inputs schema missing {missing_cols}; got {fields}")

        out: Dict[str, dict] = {}
        for r in reader:
            sym = str(r.get(asset_col, "")).strip()
            if not sym:
                continue
            out[sym] = r

    missing_syms = [s for s in grid_assets if s not in out]
    if missing_syms:
        raise ReplayComponentError(f"shared_inputs missing grid symbols: {missing_syms} (grid order is authoritative)")
    return out


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def build_liquidity_arch_l3_csv(grid_assets: List[str], shared_inputs_csv: Path, out_csv: Path) -> dict:
    """
    LiquidityArchScore (L3) — Phase 3 replay-backed input.

    Replay-faithful *proxy* derived from shared_inputs:
      - narrower ATR% => more "liquid" (higher score)
      - smaller swing range relative to price => more "liquid" (higher score)

    Score bounded 0..10, deterministic, auditable.
    """
    shared = _read_shared_inputs(shared_inputs_csv, grid_assets)

    rows: List[ComponentRow] = []
    for sym in grid_assets:
        r = shared[sym]
        sh = float(r["SwingHigh_20"])
        sl = float(r["SwingLow_20"])
        last = float(r["Last_Close"])
        atr = float(r["ATR_14"])

        atr_pct = 0.0 if last == 0 else abs(atr / last)
        range_pct = 0.0 if last == 0 else abs((sh - sl) / last)

        # Convert "wider is worse" into "higher score is better"
        # Cap at 10% ATR and 20% range for scaling; beyond that saturates.
        atr_pen = _clamp((atr_pct / 0.10) * 10.0, 0.0, 10.0)
        rng_pen = _clamp((range_pct / 0.20) * 10.0, 0.0, 10.0)

        # Higher score = lower penalties
        value = _clamp(10.0 - (0.6 * atr_pen + 0.4 * rng_pen), 0.0, 10.0)

        audit = {
            "source": str(shared_inputs_csv),
            "asset": sym,
            "atr_pct": atr_pct,
            "range_pct": range_pct,
            "atr_pen": atr_pen,
            "rng_pen": rng_pen,
        }
        rows.append(ComponentRow(asset=sym, value=value, audit=audit))

    write_component_csv(out_csv, rows)
    return {"out_csv": str(out_csv)}


def _parse_grid(args) -> List[str]:
    if getattr(args, "grid", ""):
        return [x.strip() for x in args.grid.split(",") if x.strip()]
    if getattr(args, "grid_json", ""):
        return json.loads(Path(args.grid_json).read_text(encoding="utf-8"))
    raise SystemExit("Must provide --grid or --grid-json")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared-inputs-csv", required=True)
    ap.add_argument("--grid-json", default="", help="Path to JSON list of grid assets")
    ap.add_argument("--grid", default="", help="Comma-separated grid assets (overrides --grid-json)")
    ap.add_argument("--out-csv", required=True)
    args = ap.parse_args()

    grid_assets = _parse_grid(args)
    meta = build_liquidity_arch_l3_csv(grid_assets, Path(args.shared_inputs_csv), Path(args.out_csv))
    print(json.dumps(meta, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
