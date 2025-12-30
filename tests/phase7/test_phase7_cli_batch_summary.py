import json
import subprocess
import sys
from pathlib import Path

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_phase7_cli_batch_writes_summary(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--outdir", str(outdir),
        "--batch",
        "--status-filter", "all",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr

    summ = outdir / "phase7" / "last" / "phase7_batch_summary.json"
    assert summ.exists(), "batch summary must be written"
    data = json.loads(summ.read_text(encoding="utf-8"))
    assert data["asof"] == "last"
    assert data["adapter"] == "paper"
    assert "items" in data
    assert len(data["items"]) >= 1
    assert {"plan_id", "decision", "reason_codes", "idempotency_key"} <= set(data["items"][0].keys())
