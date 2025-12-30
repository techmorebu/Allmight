from __future__ import annotations

import json
import subprocess
from pathlib import Path


def test_phase6_runner_writes_outputs(tmp_path: Path):
    # Arrange: create a fake phase5 tree under tmp_path
    phase5_dir = tmp_path / "outputs" / "phase5" / "i60"
    phase5_dir.mkdir(parents=True, exist_ok=True)

    (phase5_dir / "phase5_execution_intents.json").write_text(
        json.dumps({
            "meta": {"execution_policy_version": "v2"},
            "intents": [
                {"intent_id": "T-1", "status": "ALLOWED", "allowed_modes": ["paper"]},
                {"intent_id": "T-2", "status": "SUPPRESSED", "allowed_modes": ["paper", "cex_spot"]},
            ],
        }, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    # Act: run phase6 against tmp_path outputs
    out_root = tmp_path / "outputs" / "phase6"
    cmd = [
        "python",
        "scripts/phase6/run_phase6_build_execution_plans.py",
        "--asof", "i60",
        "--adapter", "paper",
        "--phase5-root", str(tmp_path / "outputs" / "phase5"),
        "--out-root", str(out_root),
    ]
    subprocess.check_call(cmd)

    # Assert: artifacts exist + are parseable
    plan_path = out_root / "i60" / "phase6_execution_plans.json"
    audit_path = out_root / "i60" / "phase6_audit.txt"

    assert plan_path.exists()
    assert audit_path.exists()

    doc = json.loads(plan_path.read_text(encoding="utf-8"))
    assert doc["meta"]["phase"] == 6
    assert doc["meta"]["asof"] == "i60"
    assert doc["meta"]["dry_run"] is True

    # Planned + suppressed: should produce 2 plans (1 planned, 1 suppressed)
    statuses = [p["status"] for p in doc["plans"]]
    assert "PLANNED" in statuses
    assert "SUPPRESSED" in statuses


def test_phase6_runner_halts_if_missing_phase5_file(tmp_path: Path):
    out_root = tmp_path / "outputs" / "phase6"
    cmd = [
        "python",
        "scripts/phase6/run_phase6_build_execution_plans.py",
        "--asof", "i60",
        "--adapter", "paper",
        "--phase5-root", str(tmp_path / "outputs" / "phase5"),
        "--out-root", str(out_root),
    ]
    # Should non-zero because the required phase5 file doesn't exist
    p = subprocess.run(cmd, capture_output=True, text=True)
    assert p.returncode != 0
    assert "Missing required input" in (p.stderr + p.stdout)
