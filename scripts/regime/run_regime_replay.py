from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Dict, List, Tuple

from scripts.regime.calc_regime_replay import calc_institutional_regime_replay
from scripts.mcs_components.replay_component_io import read_component_csv_as_map
from scripts.mcs_components.replay_component_io import read_component_csv_as_map


def _read_grid_csv(path: str) -> List[Dict[str, str]]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing file: {path}")
    with open(path, "r", newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    if not rows:
        raise ValueError(f"Empty CSV: {path}")
    return rows


def _ensure_same_grid(l0_rows: List[Dict[str, str]], l1_rows: List[Dict[str, str]]) -> List[str]:
    l0_assets = [r["asset"] for r in l0_rows]
    l1_assets = [r["asset"] for r in l1_rows]
    if l0_assets != l1_assets:
        raise ValueError(
            "Grid ordering mismatch between L0 and L1:\n"
            f"L0 assets: {l0_assets}\n"
            f"L1 assets: {l1_assets}\n"
        )
    return l0_assets


def _to_l0_by_symbol(l0_rows: List[Dict[str, str]]) -> Dict[str, Dict]:
    out: Dict[str, Dict] = {}
    for r in l0_rows:
        sym = r["asset"]

        sb = r.get("structure_bias")  # may be NEUTRAL
        ts = r.get("trend_simple")    # UP/DOWN per L0 output

        if sb and sb != "NEUTRAL":
            bias = sb
            bias_source = "L0.structure_bias"
        else:
            bias = ts if ts else "UNKNOWN"
            bias_source = "L0.trend_simple_fallback"

        # Deterministic role tagging (temporary until Phase 0 role tables are extracted)
        role = "SAFE" if sym.upper() in ("XAU", "PAXG") else "RISK"

        out[sym] = {
            "StructureBias": bias,
            "BiasSource": bias_source,
            "AssetRole": role,
            "StructureScore": float(r.get("ssp_total_structure_score", 0.0)),
        }
    return out

def _to_l1_by_symbol(l1_rows: List[Dict[str, str]]) -> Dict[str, Dict]:
    out: Dict[str, Dict] = {}
    for r in l1_rows:
        sym = r["asset"]
        out[sym] = {
            "PressureScore": float(r.get("pressure_score", 0.0)),
        }
    return out


def _state_to_jsonable(state) -> Dict:
    # dataclasses -> dict, but keep dominant_drivers as list of dicts
    return {
        "asof_index": state.asof_index,
        "regime": state.regime,
        "confidence": state.confidence,
        "activation_band": state.activation_band,
        "mcs_total": state.mcs_total,
        "macro_score": state.macro_score,
        "risk_penalty": state.risk_penalty,
        "dominant_drivers": [
            {
                "symbol": d.symbol,
                "driver": d.driver,
                "structure_bias": d.structure_bias,
                "structure_score": d.structure_score,
                "pressure_score": d.pressure_score,
                "activation_band": state.activation_band,
        "mcs_total": state.mcs_total,
                "macro_score": state.macro_score,
                "risk_penalty": state.risk_penalty,
                "bias_source": d.bias_source,
                "asset_role": d.asset_role,
            }
            for d in state.dominant_drivers
        ],
        "allow_directional": state.allow_directional,
        "allow_flashloan": state.allow_flashloan,
        "suppress_execution": state.suppress_execution,
        "audit": {k:v for k,v in state.audit.items() if k not in ("activation_band","activation_band_str")},
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Phase 2: Institutional Regime Layer (replay-relative)")
    p.add_argument("--timeframe", default="15m")
    p.add_argument("--asof-label", choices=["last", "i60"], required=True, help="Replay snapshot label")
    p.add_argument("--grid", default="BTC,ETH,XRP,XAU", help="Comma-separated grid order (must match GRID CSV order)")
    p.add_argument("--outputs-dir", default="outputs/replay")
    p.add_argument("--asof-index", type=int, default=-1, help="As-of index tag stored in output only (default -1 for label runs)")
    p.add_argument("--sweep-csv", default="", help="Phase 3 SweepScore CSV (grid-ordered)")
    p.add_argument("--liquidity-arch-csv", default="", help="Phase 3 LiquidityArchScore CSV (grid-ordered)")
    p.add_argument("--macro-score-csv", default="", help="Phase 3 MacroScore CSV (grid-ordered)")
    p.add_argument("--risk-penalty-csv", default="", help="Phase 3 RiskPenalty CSV (grid-ordered)")
    p.add_argument("--allow-missing-components", action="store_true", help="Allow missing Phase 3 inputs to default to policy missing value (audited)")
    args = p.parse_args()

    tf = args.timeframe
    label = args.asof_label
    grid_syms = [s.strip() for s in args.grid.split(",") if s.strip()]
    outdir = args.outputs_dir

    l0_path = os.path.join(outdir, f"structure_l0_GRID_{'_'.join(grid_syms)}_{tf}_{label}.csv")
    l1_path = os.path.join(outdir, f"pressure_l1_GRID_{'_'.join(grid_syms)}_{tf}_{label}.csv")

    l0_rows = _read_grid_csv(l0_path)
    l1_rows = _read_grid_csv(l1_path)

    # Authoritative order comes from the files; also enforce it's the expected active grid
    file_order = _ensure_same_grid(l0_rows, l1_rows)
    if file_order != grid_syms:
        raise ValueError(
            "Active Grid mismatch vs file order:\n"
            f"Expected --grid: {grid_syms}\n"
            f"File order:      {file_order}\n"
            "Fix by passing --grid to match the GRID files, or regenerate GRID outputs."
        )

    l0_by = _to_l0_by_symbol(l0_rows)
    l1_by = _to_l1_by_symbol(l1_rows)

    # Phase 3 component inputs
    sweep_by = None
    liq_by = None
    macro_by = None
    risk_by = None

    if args.sweep_csv:
        sweep_by, _ = read_component_csv_as_map(Path(args.sweep_csv), grid_syms, component_name="SweepScore", allow_missing=args.allow_missing_components)
    if args.liquidity_arch_csv:
        liq_by, _ = read_component_csv_as_map(Path(args.liquidity_arch_csv), grid_syms, component_name="LiquidityArchScore", allow_missing=args.allow_missing_components)
    if args.macro_score_csv:
        macro_by, _ = read_component_csv_as_map(Path(args.macro_score_csv), grid_syms, component_name="MacroScore", allow_missing=args.allow_missing_components)
    if args.risk_penalty_csv:
        risk_by, _ = read_component_csv_as_map(Path(args.risk_penalty_csv), grid_syms, component_name="RiskPenalty", allow_missing=args.allow_missing_components)

    state = calc_institutional_regime_replay(
        asof_index=args.asof_index,
        active_grid_symbols=grid_syms,
        l0_by_symbol=l0_by,
        l1_by_symbol=l1_by,
        sweep_by_symbol=sweep_by,
        liquidity_arch_by_symbol=liq_by,
        macro_by_symbol=macro_by,
        risk_penalty_by_symbol=risk_by,
        allow_missing_components=bool(args.allow_missing_components),
    )

    os.makedirs(outdir, exist_ok=True)
    out_path = os.path.join(outdir, f"regime_state_GRID_{'_'.join(grid_syms)}_{tf}_{label}.json")

    payload = _state_to_jsonable(state)
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")

    print(out_path)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
