from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import List


GRID_ASSETS: List[str] = ["BTC", "ETH", "XRP", "XAU"]
GRID_TAG = "GRID_BTC_ETH_XRP_XAU_15m"
REPLAY_DIR = Path("outputs/replay")


def _run(cmd: List[str]) -> None:
    print("+", " ".join(cmd))
    subprocess.check_call(cmd)


def _shared_inputs_path(asof: str) -> Path:
    return REPLAY_DIR / f"shared_inputs_{GRID_TAG}_{asof}.csv"


def _regime_state_path(asof: str) -> Path:
    return REPLAY_DIR / f"regime_state_{GRID_TAG}_{asof}.json"


def _out_component_path(component_id: str, asof: str) -> Path:
    return REPLAY_DIR / f"{component_id}_{GRID_TAG}_{asof}.csv"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Build Phase-3 component CSVs for a given asof (explicit inputs; no Phase-3 refactors)."
    )
    ap.add_argument(
        "--asof",
        required=True,
        choices=["i60", "last"],
        help="Replay anchor suffix. This selects explicit shared_inputs/regime_state inputs and writes matching *_<asof>.csv outputs.",
    )
    ap.add_argument(
        "--grid",
        default=",".join(GRID_ASSETS),
        help="Comma-separated grid assets (default: BTC,ETH,XRP,XAU).",
    )
    args = ap.parse_args()

    asof = args.asof
    grid = args.grid

    # Inputs
    shared_inputs = _shared_inputs_path(asof)
    regime_state = _regime_state_path(asof)

    missing_inputs = [p for p in [shared_inputs, regime_state] if not p.exists()]
    if missing_inputs:
        raise SystemExit(f"Missing required input(s) for asof={asof}: {missing_inputs}")

    # Outputs
    sweep_out = _out_component_path("sweep_l2", asof)
    liqu_out = _out_component_path("liquidity_arch_l3", asof)
    macro_out = _out_component_path("macro_score", asof)
    risk_out = _out_component_path("risk_penalty", asof)

    # Sweep (L2) from shared_inputs
    _run(
        [
            sys.executable,
            "-m",
            "scripts.mcs_components.calc_sweep_l2_replay",
            "--shared-inputs-csv",
            str(shared_inputs),
            "--grid",
            grid,
            "--out-csv",
            str(sweep_out),
        ]
    )

    # Liquidity Arch (L3) from shared_inputs
    _run(
        [
            sys.executable,
            "-m",
            "scripts.mcs_components.calc_liquidity_arch_l3_replay",
            "--shared-inputs-csv",
            str(shared_inputs),
            "--grid",
            grid,
            "--out-csv",
            str(liqu_out),
        ]
    )

    # Macro Score from regime_state
    _run(
        [
            sys.executable,
            "-m",
            "scripts.mcs_components.calc_macro_score_replay",
            "--regime-state-json",
            str(regime_state),
            "--grid",
            grid,
            "--out-csv",
            str(macro_out),
        ]
    )

    # Risk Penalty from regime_state
    _run(
        [
            sys.executable,
            "-m",
            "scripts.mcs_components.calc_risk_penalty_replay",
            "--regime-state-json",
            str(regime_state),
            "--grid",
            grid,
            "--out-csv",
            str(risk_out),
        ]
    )

    print("Wrote:")
    for p in [sweep_out, liqu_out, macro_out, risk_out]:
        print(" -", p)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
