import subprocess
import sys
from pathlib import Path

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_phase7_cli_explain_prints_prepared(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--plan-id", "plan_OK_001",
        "--outdir", str(outdir),
        "--explain",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    # should mention prepared payload keys
    assert "prepared:" in p.stdout
    assert "adapter=paper" in p.stdout or "paper" in p.stdout
