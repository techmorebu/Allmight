from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.mcs_components.calc_sweep_l2_replay import build_sweep_l2_csv
from scripts.mcs_components.calc_liquidity_arch_l3_replay import build_liquidity_arch_l3_csv
from scripts.mcs_components.calc_macro_score_replay import build_macro_score_csv
from scripts.mcs_components.calc_risk_penalty_replay import build_risk_penalty_csv
from scripts.mcs_components.replay_component_io import ReplayComponentError, read_component_csv_as_map


def test_generators_deterministic(tmp_path: Path):
    grid = ["BTC", "ETH"]

    shared = tmp_path / "shared.csv"
    shared.write_text(
        "asset,SwingHigh_20,SwingLow_20,Last_Close,Last_Volume,AvgVol_20,ATR_14,Last_High,Last_Low\n"
        "BTC,105,95,100,200,100,2,106,99\n"
        "ETH,60,40,50,50,100,5,51,49\n",
        encoding="utf-8",
    )

    regime = tmp_path / "regime_state.json"
    regime.write_text(json.dumps({"macro_score": 2.0, "risk_penalty": 1.0}), encoding="utf-8")

    out1 = tmp_path / "sweep1.csv"
    out2 = tmp_path / "sweep2.csv"
    build_sweep_l2_csv(grid, shared, out1)
    build_sweep_l2_csv(grid, shared, out2)
    assert out1.read_text(encoding="utf-8") == out2.read_text(encoding="utf-8")

    l1 = tmp_path / "liq1.csv"
    l2 = tmp_path / "liq2.csv"
    build_liquidity_arch_l3_csv(grid, shared, l1)
    build_liquidity_arch_l3_csv(grid, shared, l2)
    assert l1.read_text(encoding="utf-8") == l2.read_text(encoding="utf-8")

    m1 = tmp_path / "macro1.csv"
    m2 = tmp_path / "macro2.csv"
    build_macro_score_csv(grid, regime, m1)
    build_macro_score_csv(grid, regime, m2)
    assert m1.read_text(encoding="utf-8") == m2.read_text(encoding="utf-8")

    r1 = tmp_path / "risk1.csv"
    r2 = tmp_path / "risk2.csv"
    build_risk_penalty_csv(grid, regime, r1)
    build_risk_penalty_csv(grid, regime, r2)
    assert r1.read_text(encoding="utf-8") == r2.read_text(encoding="utf-8")


def test_missing_file_error(tmp_path: Path):
    with pytest.raises(ReplayComponentError) as e:
        read_component_csv_as_map(tmp_path / "nope.csv", ["BTC"], component_name="SweepScore", allow_missing=False)
    assert "Missing SweepScore CSV" in str(e.value)
