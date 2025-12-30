import json
import subprocess
import sys

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_phase7_cli_batch_can_compact_receipts(tmp_path):
    outdir = tmp_path / "outputs"

    # run batch multiple times with varying mode via limit=1 but different adapter/mode isn't supported by CLI,
    # so we just run batch repeatedly; receipts will append for different plan_ids in fixture.
    # then compact should keep last=1 per plan.
    for _ in range(3):
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

    # Now compact via CLI
    cmd2 = [
        sys.executable, "-m", "scripts.phase7.phase7_cli",
        "--plans", FIX,
        "--asof", "last",
        "--adapter", "paper",
        "--mode", "paper",
        "--outdir", str(outdir),
        "--batch",
        "--status-filter", "all",
        "--compact-receipts",
        "--keep-last", "1",
    ]
    p2 = subprocess.run(cmd2, capture_output=True, text=True)
    assert p2.returncode == 0, p2.stderr

    receipts_path = outdir / "phase7" / "last" / "phase7_execution_receipts.json"
    data = json.loads(receipts_path.read_text(encoding="utf-8"))

    # fixture has 2 plans => keep-last=1 per plan => 2 receipts total
    assert len(data["receipts"]) == 2
