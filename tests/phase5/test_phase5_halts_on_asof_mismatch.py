from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_halts_on_asof_mismatch(tmp_path: Path) -> None:
    # Minimal Phase-4-ish dict structure (real top-level shape)
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
                "overrides_applied": [
                    {"type": "confidence_gate", "band_curr": "B0", "band_prev": None, "band_flip": False, "confidence_threshold_used": 0.25}
                ],
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
        "last",  # mismatch on purpose
        "--input",
        str(in_path),
        "--outdir",
        str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)

    # Must HALT deterministically
    assert p.returncode == 2

    halt_path = outdir / "phase5_halt_report.json"
    assert halt_path.exists()

    report = json.loads(halt_path.read_text(encoding="utf-8"))
    assert report["status"] == "HALT"
    assert report["code"] == "E_ASOF_MISMATCH"
    assert report["details"]["file_asof"] == "i60"
    assert report["details"]["requested_asof"] == "last"
