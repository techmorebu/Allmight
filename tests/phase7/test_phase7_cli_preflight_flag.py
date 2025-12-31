import json
import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_cli_preflight_flag_outputs_json_and_exits_eligible(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--plan-id", "plan_OK_001",
        "--outdir", str(outdir),
        "--preflight",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr + p.stdout
    data = json.loads(p.stdout)
    assert data["eligible"] is True
    assert data["mode"] == "paper"
    assert data["adapter"] == "paper"

def test_cli_preflight_flag_exits_denied_for_live(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLMIGHT_ARMING_TOKEN", "SECRET123")
    outdir = tmp_path / "outputs"
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
        "--preflight",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode != 0
    data = json.loads(p.stdout)
    assert data["eligible"] is False
    assert "adapter_not_allowlisted" in data["reasons"]
