import json
import subprocess
import sys
from pathlib import Path

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_phase7_cli_batch_writes_multiple_traces(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--outdir", str(outdir),
        "--batch",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr

    # both plan traces should exist
    t1 = outdir / "phase7" / "last" / "traces" / "plan_SUPP_001.json"
    t2 = outdir / "phase7" / "last" / "traces" / "plan_OK_001.json"
    assert t1.exists()
    assert t2.exists()

def test_phase7_cli_batch_halt_after(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--outdir", str(outdir),
        "--batch",
        "--halt-after", "1",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr

    receipts = outdir / "phase7" / "last" / "phase7_execution_receipts.json"
    data = json.loads(receipts.read_text(encoding="utf-8"))
    # halt-after=1 should result in only 1 receipt written in this run directory
    assert len(data["receipts"]) == 1
