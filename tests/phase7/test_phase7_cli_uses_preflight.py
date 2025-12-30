import json
import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_cli_live_denial_matches_preflight(monkeypatch, tmp_path):
    monkeypatch.setenv("ALLMIGHT_ARMING_TOKEN", "SECRET123")
    outdir = tmp_path / "outputs"

    # Preflight (should deny adapter not allowlisted by default policy)
    p1 = subprocess.run(
        [
            sys.executable, "-m", "scripts.phase7.phase7_preflight",
            "--plans", FIX,
            "--asof", "last",
            "--adapter", "live_cex_stub",
            "--mode", "live",
            "--armed",
            "--arming-token", "SECRET123",
            "--plan-id", "plan_OK_001",
        ],
        capture_output=True, text=True
    )
    assert p1.returncode != 0
    pre = json.loads(p1.stdout)
    assert pre["eligible"] is False

    # CLI (should deny too)
    p2 = subprocess.run(
        [
            sys.executable, "-m", "scripts.phase7.phase7_cli",
            "--plans", FIX,
            "--asof", "last",
            "--adapter", "live_cex_stub",
            "--mode", "live",
            "--plan-id", "plan_OK_001",
            "--armed",
            "--arming-token", "SECRET123",
            "--outdir", str(outdir),
        ],
        capture_output=True, text=True
    )
    assert p2.returncode != 0
    msg = (p2.stderr + p2.stdout).lower()

    # CLI should surface reason codes (codes=[...])
    assert any(r in msg for r in pre["reasons"])
