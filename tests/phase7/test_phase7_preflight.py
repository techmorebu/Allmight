import json
import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_preflight_denies_live_when_not_allowlisted(tmp_path, monkeypatch):
    monkeypatch.setenv("ALLMIGHT_ARMING_TOKEN", "SECRET123")
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_preflight",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "live_cex_stub",
        "--mode", "live",
        "--armed",
        "--arming-token", "SECRET123",
        "--plan-id", "plan_OK_001",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode != 0
    data = json.loads(p.stdout)
    assert data["eligible"] is False
    assert "adapter_not_allowlisted" in data["reasons"]

def test_preflight_allows_paper_without_arming(tmp_path):
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_preflight",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--plan-id", "plan_OK_001",
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode == 0, p.stderr
    data = json.loads(p.stdout)
    assert data["eligible"] is True
