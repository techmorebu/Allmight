from scripts.regime.calc_regime_replay import calc_institutional_regime_replay

def test_regime_is_deterministic_and_tie_stable():
    grid = ["BTC", "ETH", "XRP", "XAU"]

    l0 = {
        "BTC": {"StructureBias": "UP", "StructureScore": 3},
        "ETH": {"StructureBias": "UP", "StructureScore": 2},
        "XRP": {"StructureBias": "DOWN", "StructureScore": 1},
        "XAU": {"StructureBias": "UP", "StructureScore": 2},  # safe-asset inversion matters
    }
    l1 = {
        "BTC": {"PressureScore": 7},
        "ETH": {"PressureScore": 6},
        "XRP": {"PressureScore": 4},
        "XAU": {"PressureScore": 6},
    }

    a = calc_institutional_regime_replay(
        asof_index=100, active_grid_symbols=grid, l0_by_symbol=l0, l1_by_symbol=l1
    )
    b = calc_institutional_regime_replay(
        asof_index=100, active_grid_symbols=grid, l0_by_symbol=l0, l1_by_symbol=l1
    )

    assert a == b
    assert [d.symbol for d in a.dominant_drivers] == [d.symbol for d in b.dominant_drivers]
