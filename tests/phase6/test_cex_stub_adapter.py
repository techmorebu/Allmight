from __future__ import annotations

from scripts.phase6.run_phase6_build_execution_plans import build_plans


def test_cex_stub_does_not_enable_modes_not_allowed_by_phase5():
    # Phase5 only allows paper; selecting cex_stub adapter must NOT enable anything else.
    doc = {
        "meta": {"execution_policy_version": "v2"},
        "intents": [{"intent_id": "H-1", "status": "ALLOWED", "allowed_modes": ["paper"]}],
    }
    out = build_plans(doc, asof="i60", adapter="cex_stub")

    modes = [p["mode"] for p in out["plans"] if p["mode"] is not None]
    assert modes == ["paper"]

    plan = out["plans"][0]
    assert plan["requires_network"] is False
    assert plan["steps"][0]["type"] == "DRY_RUN"


def test_cex_stub_can_plan_when_phase5_allows_cex_mode():
    doc = {
        "meta": {"execution_policy_version": "v2"},
        "intents": [{"intent_id": "H-2", "status": "ALLOWED", "allowed_modes": ["cex_spot"]}],
    }
    out = build_plans(doc, asof="i60", adapter="cex_stub")
    plan = out["plans"][0]

    assert plan["status"] == "PLANNED"
    assert plan["mode"] == "cex_spot"
    assert plan["requires_network"] is False
    assert "cex_stub" in plan["steps"][0]["detail"]
