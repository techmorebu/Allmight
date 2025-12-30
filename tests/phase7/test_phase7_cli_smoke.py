import json
import subprocess
import sys
from pathlib import Path

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_phase7_cli_smoke(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--plan-id", "plan_OK_001",
        "--outdir", str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    # should have written receipts
    receipts = outdir / "phase7" / "last" / "phase7_execution_receipts.json"
    assert receipts.exists()
    data = json.loads(receipts.read_text(encoding="utf-8"))
    assert data["receipts"][0]["plan_id"] == "plan_OK_001"
