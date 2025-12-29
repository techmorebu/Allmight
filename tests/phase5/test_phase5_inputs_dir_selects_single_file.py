from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_inputs_dir_selects_single_file(tmp_path: Path) -> None:
    inputs_dir = tmp_path / "phase4"
    inputs_dir.mkdir(parents=True, exist_ok=True)

    # Create exactly one matching file for i60
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
    f = inputs_dir / "phase4_control_GRID_TEST_i60.json"
    f.write_text(json.dumps(phase4), encoding="utf-8")

    outdir = tmp_path / "out"
    cmd = [
        sys.executable,
        "scripts/phase5/run_phase5_execution_layer.py",
        "--asof",
        "i60",
        "--inputs-dir",
        str(inputs_dir),
        "--outdir",
        str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0

    doc = json.loads((outdir / "phase5_execution_intents.json").read_text(encoding="utf-8"))
    assert doc["status"] == "OK"
    assert doc["source_input"].endswith("phase4_control_GRID_TEST_i60.json")
