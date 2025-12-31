import json
from scripts.phase7.run_phase7 import run_phase7

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_paper_adapter_prepares_action(tmp_path):
    outdir = tmp_path / "outputs"
    r = run_phase7(FIX, "last", "paper", "paper", False, "plan_OK_001", outdir)
    rec = r["receipts"][0]
    assert rec["result"]["status"] == "NOT_RUN"
    # prepared action should exist
    prepared = rec["result"]["details"].get("prepared")
    assert prepared is not None
    assert prepared["adapter"] == "paper"
    assert prepared["plan_id"] == "plan_OK_001"
