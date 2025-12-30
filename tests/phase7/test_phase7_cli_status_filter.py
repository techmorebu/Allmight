import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_phase7_cli_batch_status_filter_allowed(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--outdir", str(outdir),
        "--batch",
        "--status-filter", "allowed",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    # Should only process the ALLOWED plan from our fixture.
    assert "batch_processed=1" in p.stdout

def test_phase7_cli_batch_status_filter_suppressed(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--outdir", str(outdir),
        "--batch",
        "--status-filter", "suppressed",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    assert "batch_processed=1" in p.stdout
