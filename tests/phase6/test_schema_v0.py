from __future__ import annotations

import json
from pathlib import Path

from scripts.phase6.run_phase6_build_execution_plans import build_plans


def test_phase6_output_matches_schema_v0_contract():
    schema = json.loads(Path("config/phase6/schema_v0.json").read_text(encoding="utf-8"))

    phase5_doc = {
        "intents": [
            {"intent_id": "S-1", "status": "ALLOWED", "allowed_modes": ["paper"]},
            {"intent_id": "S-2", "status": "SUPPRESSED", "allowed_modes": ["paper", "cex_spot"]},
        ]
    }
    out = build_plans(phase5_doc, asof="i60", adapter="paper")

    # meta keys
    for k in schema["required_meta_keys"]:
        assert k in out["meta"], f"missing meta.{k}"

    # plans contract
    assert isinstance(out.get("plans"), list)
    for p in out["plans"]:
        for k in schema["plan_required_keys"]:
            assert k in p, f"missing plan.{k}"
        assert p["status"] in schema["allowed_status"]
        assert p["requires_network"] is False

        # If suppressed, mode must be None and steps empty
        if p["status"] == "SUPPRESSED":
            assert p["mode"] is None
            assert p["steps"] == []

        # If planned, mode must be a string and steps non-empty
        if p["status"] == "PLANNED":
            assert isinstance(p["mode"], str) and p["mode"]
            assert isinstance(p["steps"], list) and len(p["steps"]) >= 1

    # trace contract
    assert isinstance(out.get("trace"), list)
    for t in out["trace"]:
        for k in schema["trace_required_keys"]:
            assert k in t, f"missing trace.{k}"
