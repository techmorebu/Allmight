from __future__ import annotations

import pytest

from scripts.phase6.run_phase6_build_execution_plans import build_plans, Phase6Error


def test_phase6_never_enables_disallowed_modes():
    """
    Phase-5 allowed_modes is the HARD upper bound.
    Policy may restrict, never enable.
    """
    phase5_doc = {
        "meta": {"execution_policy_version": "v2"},
        "intents": [
            {
                "intent_id": "X-1",
                "status": "ALLOWED",
                "allowed_modes": ["paper"],

                # Policy tries to add a mode NOT allowed by Phase-5.
                # Phase-6 MUST NOT emit it.
                "execution_policy": {"allowed_modes": ["paper", "cex_spot"]},
            }
        ],
    }

    out = build_plans(phase5_doc, asof="i60", adapter="paper")
    modes = [p["mode"] for p in out["plans"] if p["mode"] is not None]
    assert modes == ["paper"]


def test_phase6_halts_if_allowed_modes_missing():
    phase5_doc = {"intents": [{"intent_id": "X-2", "status": "ALLOWED"}]}
    with pytest.raises(Phase6Error):
        build_plans(phase5_doc, asof="i60", adapter="paper")


def test_phase6_suppressed_intent_produces_suppressed_plan():
    phase5_doc = {
        "intents": [
            {"intent_id": "X-3", "status": "SUPPRESSED", "allowed_modes": ["paper", "cex_spot"]}
        ]
    }
    out = build_plans(phase5_doc, asof="last", adapter="paper")
    assert len(out["plans"]) == 1
    assert out["plans"][0]["status"] == "SUPPRESSED"
    assert out["plans"][0]["mode"] is None
