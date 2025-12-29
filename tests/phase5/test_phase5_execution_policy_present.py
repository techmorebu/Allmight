from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_execution_policy_present(tmp_path: Path) -> None:
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

    doc = json.loads((outdir / "phase5_execution_intents.json").read_text(encoding="utf-8"))
    assert "execution_policy" in doc
    pol = doc["execution_policy"]

    assert pol["mode_preference_order"] == ["arbitrage", "directional", "flashloan"]
    assert pol["max_concurrent_intents"] == 1
    assert pol["require_simulation"] is True
    assert pol["dry_run_only"] is True
