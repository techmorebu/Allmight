import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_live_cex_stub_paper_mode_does_not_require_arming(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "live_cex_stub",
        "--mode", "paper",
        "--plan-id", "plan_OK_001",
        "--outdir", str(outdir),
        "--explain",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr + p.stdout
    assert "prepared:" in p.stdout

def test_live_cex_stub_live_mode_denied_if_not_allowlisted(tmp_path, monkeypatch):
    outdir = tmp_path / "outputs"
    monkeypatch.setenv("ALLMIGHT_ARMING_TOKEN", "SECRET123")

    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "live_cex_stub",
        "--mode", "live",
        "--plan-id", "plan_OK_001",
        "--armed",
        "--arming-token", "SECRET123",
        "--outdir", str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode != 0
    msg = (p.stderr + p.stdout).lower()
    assert "adapter not allowlisted" in msg
