from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Dict, List

from scripts.mcs_components.replay_component_io import (
    ComponentRow,
    ReplayComponentError,
    write_component_csv,
)



def _parse_spike_flag(raw) -> float:
    """
    Accepts: True/False, "True"/"False", "0"/"1", "", None, "yes"/"no", numbers.
    Returns: 0.0 or 1.0 (or numeric if explicitly numeric).
    """
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        return float(raw)
    t = str(raw).strip().lower()
    if t == "" or t in ("none", "null"):
        return 0.0
    if t in ("false", "f", "no", "n", "off"):
        return 0.0
    if t in ("true", "t", "yes", "y", "on"):
        return 1.0
    try:
        return float(t)
    except ValueError:
        return 0.0

def _clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _read_shared_inputs(path: Path, grid_assets: List[str]) -> Dict[str, dict]:
    if not path.exists():
        raise ReplayComponentError(f"Missing shared_inputs CSV: {path}")

    out: Dict[str, dict] = {}
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []

        asset_col = "asset" if "asset" in fields else ("AssetID" if "AssetID" in fields else "")
        if not asset_col:
            raise ReplayComponentError(
                f"shared_inputs schema missing ['asset' or 'AssetID']; got {fields}"
            )

        core_required = ["SwingHigh_20", "SwingLow_20", "Last_Close", "ATR_14", "Last_Volume", "AvgVol_20"]
        missing = [c for c in core_required if c not in fields]
        if missing:
            raise ReplayComponentError(f"shared_inputs schema missing {missing}; got {fields}")

        for r in reader:
            a = (r.get(asset_col) or "").strip()
            if not a:
                continue
            if a not in grid_assets:
                continue
            out[a] = r

    # Ensure every grid asset exists in shared inputs
    missing_assets = [a for a in grid_assets if a not in out]
    if missing_assets:
        raise ReplayComponentError(
            f"shared_inputs missing rows for grid assets={missing_assets}; grid order is authoritative"
        )
    return out


def build_sweep_l2_csv(grid_assets: List[str], shared_inputs_csv: Path, out_csv: Path) -> dict:
    """
    Produces SweepScore (L2) from shared_inputs replay data.

    This is intentionally deterministic and schema-tolerant:
    - Accepts AssetID or asset as the asset column
    - Prev_Close optional (defaults to Last_Close)
    - VolSpikeFlag optional (defaults 0)
    """
    shared = _read_shared_inputs(shared_inputs_csv, grid_assets)

    rows: List[ComponentRow] = []
    for a in grid_assets:
        r = shared[a]

        last = float(r.get("Last_Close") or 0.0)
        prev = float(r.get("Prev_Close") or last or 0.0)
        sh = float(r.get("SwingHigh_20") or 0.0)
        sl = float(r.get("SwingLow_20") or 0.0)
        atr = float(r.get("ATR_14") or 0.0)
        last_vol = float(r.get("Last_Volume") or 0.0)
        avg_vol = float(r.get("AvgVol_20") or 0.0)
        spike = _parse_spike_flag(r.get("VolSpikeFlag"))
        rng = (sh - sl)
        pos = 0.5
        if rng > 0:
            pos = _clamp((last - sl) / rng, 0.0, 1.0)

        ret = 0.0
        if prev and prev != 0:
            ret = (last - prev) / prev

        # “mom” is a directional proxy derived from position in range + return sign.
        mom = _clamp((pos - 0.5) * 2.0 + _clamp(ret * 10.0, -1.0, 1.0), -1.0, 1.0)

        atr_pct = (atr / last) if last else 0.0
        atr_scaled = atr_pct * 100.0  # keep small-ish but meaningful

        vol_ratio = (last_vol / avg_vol) if avg_vol else 1.0

        # Score: scale to ~[0..~6] in typical conditions, matching your observed magnitude
        score = (
            1.25 * pos +
            0.90 * abs(mom) +
            0.35 * atr_scaled +
            0.45 * max(0.0, vol_ratio - 1.0) +
            0.75 * max(0.0, spike)
        )

        audit = {
            "asset": a,
            "source": str(shared_inputs_csv),
            "pos": pos,
            "ret": ret,
            "mom": mom,
            "atr_pct": atr_pct,
            "atr_scaled": atr_scaled,
            "vol_ratio": vol_ratio,
            "spike": spike,
        }
        rows.append(ComponentRow(asset=a, value=score, audit=audit))

    write_component_csv(out_csv, rows)
    return {"out_csv": str(out_csv)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--shared-inputs-csv", required=True)
    ap.add_argument("--grid-json", default="", help="Path to JSON list of grid assets")
    ap.add_argument("--grid", default="", help="Comma-separated grid assets (overrides --grid-json)")
    ap.add_argument("--out-csv", required=True)
    args = ap.parse_args()

    if args.grid:
        grid_assets = [x.strip() for x in args.grid.split(",") if x.strip()]
    elif args.grid_json:
        grid_assets = json.loads(Path(args.grid_json).read_text(encoding="utf-8"))
    else:
        raise SystemExit("Must provide --grid or --grid-json")

    meta = build_sweep_l2_csv(grid_assets, Path(args.shared_inputs_csv), Path(args.out_csv))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
