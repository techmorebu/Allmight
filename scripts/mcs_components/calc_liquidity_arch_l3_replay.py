from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, List, Tuple

from scripts.mcs_components.replay_component_io import ComponentRow, ReplayComponentError, write_component_csv


def _read_shared_inputs(path: Path, grid_assets: List[str]) -> Dict[str, dict]:
    if not path.exists():
        raise ReplayComponentError(f"Missing shared_inputs CSV: {path}")
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        required = ["asset", "SwingHigh_20", "SwingLow_20", "Last_Close", "ATR_14"]
        missing_cols = [c for c in required if c not in fields]
        if missing_cols:
            raise ReplayComponentError(f"shared_inputs schema missing {missing_cols}; got {fields}")

        out: Dict[str, dict] = {}
        for r in reader:
            a = (r.get("asset") or "").strip()
            if a not in grid_assets:
                continue
            atr = float(r["ATR_14"])
            out[a] = {
                "swing_high": float(r["SwingHigh_20"]),
                "swing_low": float(r["SwingLow_20"]),
                "last_close": float(r["Last_Close"]),
                "atr": atr if atr != 0 else 1e-9,
            }
        return out


def _score_liquidity_arch(x: dict) -> Tuple[float, dict]:
    """
    Deterministic proximity-to-liquidity-shelf proxy.
    Scale: 0..3
    """
    lc = x["last_close"]
    atr = x["atr"]
    d_high = abs(x["swing_high"] - lc) / atr
    d_low = abs(lc - x["swing_low"]) / atr
    best = min(d_high, d_low)

    if best <= 0.5:
        s = 3.0
    elif best <= 1.0:
        s = 2.0
    elif best <= 2.0:
        s = 1.0
    else:
        s = 0.0

    return s, {"d_high_atr": d_high, "d_low_atr": d_low, "best_atr": best}


def build_liquidity_arch_l3_csv(grid_assets: List[str], shared_inputs_csv: Path, out_csv: Path) -> dict:
    shared = _read_shared_inputs(shared_inputs_csv, grid_assets)
    rows: List[ComponentRow] = []
    missing: List[str] = []
    for a in grid_assets:
        if a not in shared:
            missing.append(a)
            rows.append(ComponentRow(asset=a, value=0.0, audit={"missing_shared_inputs": True}))
            continue
        v, audit = _score_liquidity_arch(shared[a])
        rows.append(ComponentRow(asset=a, value=v, audit=audit))
    write_component_csv(out_csv, rows)
    return {"out_csv": str(out_csv), "missing_assets": missing}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid-json", required=True)
    ap.add_argument("--shared-inputs-csv", required=True)
    ap.add_argument("--out-csv", required=True)
    args = ap.parse_args()

    grid_assets = json.loads(Path(args.grid_json).read_text(encoding="utf-8"))
    meta = build_liquidity_arch_l3_csv(grid_assets, Path(args.shared_inputs_csv), Path(args.out_csv))
    print(json.dumps(meta, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
