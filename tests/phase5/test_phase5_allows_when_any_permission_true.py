from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_allows_when_any_permission_true(tmp_path: Path) -> None:
    phase4 = {
        "phase": 4,
        "asof": "i60",
        "grid": "GRID_BTC_ETH_XRP_XAU_15m",
        "inputs": {"global_confidence": 0.25},
        "summary": {},
        "assets": {
            "BTC": {
                "activation_band": "B0",
                "activation_band_flip": False,
                "activation_band_prev": None,
                "overrides_applied": [],
                "permissions": {"allow_arbitrage": True, "allow_directional": False, "allow_flashloan": True},
                "score": {"total": 0.0, "raw": {}, "normalized": {}, "contributions": {}},
            }
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

    intents_path = outdir / "phase5_execution_intents.json"
    doc = json.loads(intents_path.read_text(encoding="utf-8"))

    it = doc["intents"][0]
    assert it["status"] == "ALLOWED"
    assert it["allowed_modes"] == ["arbitrage", "flashloan"]

    codes = [r["code"] for r in it["reasons"]]
    assert "A_ALLOWED_BY_CONTROL" in codes
    assert "S_PERM_DIRECTIONAL_FALSE" in codes
