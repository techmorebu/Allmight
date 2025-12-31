import os
import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_live_mode_requires_armed_and_token(tmp_path):
    outdir = tmp_path / "outputs"
    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "live",
        "--outdir", str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode != 0
    assert "requires --armed" in (p.stderr + p.stdout).lower()

def test_live_mode_token_must_match_env(tmp_path, monkeypatch):
    outdir = tmp_path / "outputs"
    monkeypatch.setenv("ALLMIGHT_ARMING_TOKEN", "SECRET123")

    cmd = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "live",
        "--armed",
        "--arming-token", "WRONG",
        "--outdir", str(outdir),
    ]
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode != 0
    assert "token mismatch" in (p.stderr + p.stdout).lower()
