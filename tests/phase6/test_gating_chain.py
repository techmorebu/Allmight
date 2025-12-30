from __future__ import annotations

from scripts.phase6.run_phase6_build_execution_plans import build_plans


def test_gating_chain_present_and_ordered():
    doc = {
        "meta": {"execution_policy_version": "v2"},
        "intents": [
            {"intent_id": "G-1", "status": "ALLOWED", "allowed_modes": ["paper"]},
        ],
    }
    out = build_plans(doc, asof="i60", adapter="paper")
    plan = out["plans"][0]

    chain = plan.get("gating_chain")
    assert isinstance(chain, list) and len(chain) >= 2

    gates = [x.get("gate") for x in chain]
    assert gates[0] == "intent_status"
    assert "phase5_allowed_modes" in gates
    assert gates[-1] == "effective_allowed_modes"
