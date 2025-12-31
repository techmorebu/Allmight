import json
from pathlib import Path
from scripts.phase7.run_phase7 import run_phase7

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_trace_file_is_written(tmp_path):
    outdir = tmp_path / "outputs"
    r = run_phase7(FIX, "last", "paper", "paper", False, "plan_OK_001", outdir)
    trace = outdir / "phase7" / "last" / "traces" / "plan_OK_001.json"
    assert trace.exists(), "trace file must exist"
    data = json.loads(trace.read_text(encoding="utf-8"))
    assert data["plan_id"] == "plan_OK_001"
    assert "events" in data
    assert len(data["events"]) >= 1

def test_idempotency_blocks_second_final_receipt(tmp_path):
    outdir = tmp_path / "outputs"

    # First run: should create receipt (DENY or ALLOW depending on gates, but we mark FINAL in receipt)
    r1 = run_phase7(FIX, "last", "paper", "paper", False, "plan_SUPP_001", outdir)
    assert r1["receipts"][0]["plan_id"] == "plan_SUPP_001"

    # Second run with same key should be blocked as already final (no overwrite)
    r2 = run_phase7(FIX, "last", "paper", "paper", False, "plan_SUPP_001", outdir)
    assert r2["receipts"][0]["decision"] == "DENY"
    assert "IDEMPOTENT_ALREADY_FINAL" in r2["receipts"][0]["reason_codes"]
