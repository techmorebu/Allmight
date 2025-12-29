from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_payload_flags_match_allowed_modes(tmp_path: Path) -> None:
    phase4 = {
        "phase": 4,
        "asof": "i60",
        "grid": "GRID_TEST",
        "inputs": {"global_confidence": 0.25},
        "summary": {},
        "assets": {
            "BTC": {
                "activation_band": "B0",
                "activation_band_flip": False,
                "activation_band_prev": None,
                "overrides_applied": [],
                "permissions": {"allow_arbitrage": True, "allow_directional": False, "allow_flashloan": False},
                "score": {"total": 0.0, "raw": {}, "normalized": {}, "contributions": {}},
            },
            "ETH": {
                "activation_band": "B0",
                "activation_band_flip": False,
                "activation_band_prev": None,
                "overrides_applied": [],
                "permissions": {"allow_arbitrage": False, "allow_directional": False, "allow_flashloan": False},
                "score": {"total": 0.0, "raw": {}, "normalized": {}, "contributions": {}},
            },
        },
    }

    in_path = tmp_path / "phase4_control_test.json"
    in_path.write_text(json.dumps(phase4), encoding="utf-8")

    outdir = tmp_path / "out"
    cmd = [
        sys.executable,
        "scripts/phase5/run_phase5_execution_layer.py",
        "--asof",
        "i60",
        "--input",
        str(in_path),
        "--outdir",
        str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0

    doc = json.loads((outdir / "phase5_execution_intents.json").read_text(encoding="utf-8"))
    intents = {it["asset"]: it for it in doc["intents"]}

    # BTC allowed arbitrage only
    btc = intents["BTC"]
    assert btc["allowed_modes"] == ["arbitrage"]
    payload = btc["intent_payload"]
    assert payload["arbitrage"]["enabled"] is True
    assert payload["directional"]["enabled"] is False
    assert payload["flashloan"]["enabled"] is False

    # ETH suppressed => all disabled
    eth = intents["ETH"]
    assert eth["status"] == "SUPPRESSED"
    payload = eth["intent_payload"]
    assert payload["arbitrage"]["enabled"] is False
    assert payload["directional"]["enabled"] is False
    assert payload["flashloan"]["enabled"] is False
