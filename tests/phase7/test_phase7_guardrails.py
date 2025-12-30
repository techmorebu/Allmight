import pytest
from scripts.phase7.run_phase7 import run_phase7

FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_suppressed_plan_denied(tmp_path):
    r = run_phase7(FIX, "last", "paper", "paper", False, "plan_SUPP_001", tmp_path)
    assert r["receipts"][0]["decision"] == "DENY"
    assert "SUPPRESSED_PLAN" in r["receipts"][0]["reason_codes"]

def test_not_armed_denied(tmp_path):
    r = run_phase7(FIX, "last", "unknown_live_adapter", "live", False, "plan_OK_001", tmp_path)
    assert r["receipts"][0]["decision"] == "DENY"
    assert "NOT_ARMED" in r["receipts"][0]["reason_codes"]
