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
        required = ["asset", "SwingHigh_20", "SwingLow_20", "Last_Close", "Last_Volume", "AvgVol_20"]
        missing_cols = [c for c in required if c not in fields]
        if missing_cols:
            raise ReplayComponentError(f"shared_inputs schema missing {missing_cols}; got {fields}")

        out: Dict[str, dict] = {}
        for r in reader:
            a = (r.get("asset") or "").strip()
            if a not in grid_assets:
                continue
            out[a] = {
                "swing_high": float(r["SwingHigh_20"]),
                "swing_low": float(r["SwingLow_20"]),
                "last_close": float(r["Last_Close"]),
                "last_vol": float(r["Last_Volume"]),
                "avgvol": float(r["AvgVol_20"]) if float(r["AvgVol_20"]) != 0 else 1e-9,
                "last_high": float(r["Last_High"]) if "Last_High" in r and (r["Last_High"] or "").strip() else None,
                "last_low": float(r["Last_Low"]) if "Last_Low" in r and (r["Last_Low"] or "").strip() else None,
            }
        return out


def _score_sweep(x: dict) -> Tuple[float, dict]:
    """
    Deterministic sweep proxy from replay shared_inputs.
    Scale 0..3:
      2 = wick-sweep (took liquidity + closed back inside)
      3 = wick-sweep + volume spike
      1 = breakout beyond swing range (no wick-sweep)
    """
    last_close = x["last_close"]
    high = x["last_high"] if x["last_high"] is not None else last_close
    low = x["last_low"] if x["last_low"] is not None else last_close
    sh = x["swing_high"]
    sl = x["swing_low"]

    swept_high = (high > sh) and (last_close < sh)
    swept_low = (low < sl) and (last_close > sl)
    breakout = (last_close > sh) or (last_close < sl)
    vol_spike = x["last_vol"] > 1.5 * x["avgvol"]

    score = 0.0
    if swept_high or swept_low:
        score = 3.0 if vol_spike else 2.0
    elif breakout:
        score = 1.0

    audit = {
        "swept_high": swept_high,
        "swept_low": swept_low,
        "breakout": breakout,
        "vol_spike": vol_spike,
    }
    return score, audit


def build_sweep_l2_csv(grid_assets: List[str], shared_inputs_csv: Path, out_csv: Path) -> dict:
    shared = _read_shared_inputs(shared_inputs_csv, grid_assets)
    rows: List[ComponentRow] = []
    missing: List[str] = []
    for a in grid_assets:
        if a not in shared:
            missing.append(a)
            rows.append(ComponentRow(asset=a, value=0.0, audit={"missing_shared_inputs": True}))
            continue
        v, audit = _score_sweep(shared[a])
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
    meta = build_sweep_l2_csv(grid_assets, Path(args.shared_inputs_csv), Path(args.out_csv))
    print(json.dumps(meta, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
