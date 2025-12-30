from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_writes_human_audit_file(tmp_path: Path) -> None:
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
                "permissions": {"allow_arbitrage": True, "allow_directional": False, "allow_flashloan": False},
                "score": {"total": 0.0, "raw": {}, "normalized": {}, "contributions": {}},
            },
            "XRP": {
                "activation_band": "B2",
                "activation_band_flip": True,
                "activation_band_prev": "B1",
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

    audit_path = outdir / "phase5_audit.txt"
    assert audit_path.exists()

    txt = audit_path.read_text(encoding="utf-8")

    # Header
    assert "PHASE 5 — EXECUTION LAYER AUDIT" in txt
    assert "asof: i60" in txt
    assert "grid: GRID_BTC_ETH_XRP_XAU_15m" in txt

    # Asset sections
    assert "ASSET: BTC" in txt
    assert "status: ALLOWED" in txt
    assert "allowed_modes: arbitrage" in txt

    assert "ASSET: XRP" in txt
    assert "status: SUPPRESSED" in txt
    assert "S_SUPPRESSION_INFERRED_FROM_PERMISSIONS" in txt
