from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_phase5_inputs_dir_no_match_halts(tmp_path: Path) -> None:
    # Create an inputs dir with files that do NOT match requested asof suffix
    inputs_dir = tmp_path / "phase4"
    inputs_dir.mkdir(parents=True, exist_ok=True)

    # A file with wrong suffix (_last.json) while we request i60
    (inputs_dir / "phase4_control_TEST_last.json").write_text(json.dumps({"phase": 4, "asof": "last"}), encoding="utf-8")

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

    assert p.returncode == 2
    report = json.loads((outdir / "phase5_halt_report.json").read_text(encoding="utf-8"))
    assert report["code"] == "E_NO_PHASE4_FILES"
