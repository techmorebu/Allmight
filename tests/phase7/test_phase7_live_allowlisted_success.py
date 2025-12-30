import json
import subprocess
import sys
from pathlib import Path

POLICY_PATH = Path("config/phase7/live_arming_policy_v0.json")
FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_live_mode_allowlisted_adapter_succeeds(monkeypatch, tmp_path):
    # Backup original policy
    original = POLICY_PATH.read_text(encoding="utf-8")

    try:
        policy = json.loads(original)
        allowed = set([str(x) for x in policy.get("allowed_live_adapters", [])])
        allowed.add("live_cex_stub")
        policy["allowed_live_adapters"] = sorted(allowed)

        POLICY_PATH.write_text(json.dumps(policy, indent=2) + "\n", encoding="utf-8")

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
            "--explain",
        ]
        p = subprocess.run(cmd, capture_output=True, text=True)
        assert p.returncode == 0, p.stderr + p.stdout
        # should show prepared payload even in live mode (still NOT_RUN)
        assert "prepared:" in p.stdout

    finally:
        # Restore original policy
        POLICY_PATH.write_text(original, encoding="utf-8")
