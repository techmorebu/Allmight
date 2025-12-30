from __future__ import annotations


import sys
from pathlib import Path as _Path
_REPO_ROOT = _Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import argparse
import json
from pathlib import Path
from typing import List

from scripts.mcs_components.replay_component_io import ComponentRow, write_component_csv


def _parse_grid(args) -> List[str]:
    if getattr(args, "grid", ""):
        return [x.strip() for x in args.grid.split(",") if x.strip()]
    if getattr(args, "grid_json", ""):
        return json.loads(Path(args.grid_json).read_text(encoding="utf-8"))
    raise SystemExit("Must provide --grid or --grid-json")


def build_risk_penalty_csv(grid_assets: List[str], regime_state_json: Path, out_csv: Path) -> dict:
    if not regime_state_json.exists():
        raise FileNotFoundError(f"Missing regime_state JSON: {regime_state_json}")

    d = json.loads(regime_state_json.read_text(encoding="utf-8"))
    risk_penalty = float(d.get("risk_penalty", 0.0) or 0.0)

    rows: List[ComponentRow] = []
    for a in grid_assets:
        rows.append(
            ComponentRow(
                asset=a,
                value=risk_penalty,
                audit={"risk_penalty": risk_penalty, "source": str(regime_state_json)},
            )
        )

    write_component_csv(out_csv, rows)
    return {"out_csv": str(out_csv), "risk_penalty": risk_penalty}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid-json", default="", help="Path to JSON list of grid assets")
    ap.add_argument("--grid", default="", help="Comma-separated grid assets (overrides --grid-json)")
    ap.add_argument("--regime-state-json", required=True)
    ap.add_argument("--out-csv", required=True)
    args = ap.parse_args()

    grid_assets = _parse_grid(args)
    meta = build_risk_penalty_csv(grid_assets, Path(args.regime_state_json), Path(args.out_csv))
    print(json.dumps(meta, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
