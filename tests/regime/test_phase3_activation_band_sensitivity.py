from __future__ import annotations

from scripts.regime.calc_regime_replay import calc_institutional_regime_replay


def test_mcs_total_changes_when_component_changes():
    grid = ["BTC", "ETH"]

    l0 = {
        "BTC": {"StructureBias": "UP", "StructureScore": 3.0, "BiasSource": "t", "AssetRole": "RISK"},
        "ETH": {"StructureBias": "UP", "StructureScore": 3.0, "BiasSource": "t", "AssetRole": "RISK"},
    }
    l1 = {
        "BTC": {"PressureScore": 10.0},
        "ETH": {"PressureScore": 10.0},
    }

    sweep = {"BTC": 0.0, "ETH": 0.0}
    liq = {"BTC": 0.0, "ETH": 0.0}
    macro0 = {"BTC": 0.0, "ETH": 0.0}
    risk0 = {"BTC": 0.0, "ETH": 0.0}

    a = calc_institutional_regime_replay(
        asof_index=0,
        active_grid_symbols=grid,
        l0_by_symbol=l0,
        l1_by_symbol=l1,
        sweep_by_symbol=sweep,
        liquidity_arch_by_symbol=liq,
        macro_by_symbol=macro0,
        risk_penalty_by_symbol=risk0,
        allow_missing_components=False,
    )

    # Move MacroScore for BTC only; with weight*3 this must change MCS total deterministically
    macro1 = {"BTC": 1.0, "ETH": 0.0}

    b = calc_institutional_regime_replay(
        asof_index=0,
        active_grid_symbols=grid,
        l0_by_symbol=l0,
        l1_by_symbol=l1,
        sweep_by_symbol=sweep,
        liquidity_arch_by_symbol=liq,
        macro_by_symbol=macro1,
        risk_penalty_by_symbol=risk0,
        allow_missing_components=False,
    )

    assert b.mcs_total != a.mcs_total
