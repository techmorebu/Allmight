from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List

from scripts.mcs_components.replay_component_io import ComponentRow, ReplayComponentError, write_component_csv


def build_macro_score_csv(grid_assets: List[str], regime_state_json: Path, out_csv: Path) -> dict:
    if not regime_state_json.exists():
        raise ReplayComponentError(f"Missing regime_state JSON: {regime_state_json}")
    state = json.loads(regime_state_json.read_text(encoding="utf-8"))
    macro = float(state.get("macro_score", 0.0))
    rows = [
        ComponentRow(asset=a, value=macro, audit={"source": str(regime_state_json), "macro_score": macro})
        for a in grid_assets
    ]
    write_component_csv(out_csv, rows)
    return {"out_csv": str(out_csv), "macro_score": macro}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grid-json", required=True)
    ap.add_argument("--regime-state-json", required=True)
    ap.add_argument("--out-csv", required=True)
    args = ap.parse_args()

    grid_assets = json.loads(Path(args.grid_json).read_text(encoding="utf-8"))
    meta = build_macro_score_csv(grid_assets, Path(args.regime_state_json), Path(args.out_csv))
    print(json.dumps(meta, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
