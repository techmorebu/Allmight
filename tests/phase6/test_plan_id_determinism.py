from __future__ import annotations

from scripts.phase6.run_phase6_build_execution_plans import build_plans


def test_plan_id_is_deterministic_for_same_inputs():
    doc = {
        "meta": {"execution_policy_version": "v2"},
        "intents": [{"intent_id": "D-1", "status": "ALLOWED", "allowed_modes": ["paper"]}],
    }
    a = build_plans(doc, asof="i60", adapter="paper")
    b = build_plans(doc, asof="i60", adapter="paper")
    assert a["plans"][0]["plan_id"] == b["plans"][0]["plan_id"]


def test_plan_id_changes_when_policy_version_changes():
    doc1 = {
        "meta": {"execution_policy_version": "v2"},
        "intents": [{"intent_id": "D-2", "status": "ALLOWED", "allowed_modes": ["paper"]}],
    }
    doc2 = {
        "meta": {"execution_policy_version": "v3"},
        "intents": [{"intent_id": "D-2", "status": "ALLOWED", "allowed_modes": ["paper"]}],
    }
    a = build_plans(doc1, asof="i60", adapter="paper")
    b = build_plans(doc2, asof="i60", adapter="paper")
    assert a["plans"][0]["plan_id"] != b["plans"][0]["plan_id"]
