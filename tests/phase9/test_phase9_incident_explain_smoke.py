from __future__ import annotations

import json
from pathlib import Path

from scripts.phase9.remedy_catalog import get_remedy_catalog
from scripts.phase9.audit_incident_explain import build_report


def test_phase9_remedy_catalog_has_required_codes() -> None:
    cat = get_remedy_catalog()
    required = {
        "E_FLAG_REQUIRED",
        "E_LIVE_DISABLED",
        "E_ARMING_REQUIRED",
        "E_ARMING_STALE",
        "E_ARMING_TTL",
        "E_KILL_SWITCH_ACTIVE",
        "E_POLICY_INVALID",
        "E_ENVELOPE_INVALID",
    }
    missing = sorted([c for c in required if c not in cat])
    assert not missing, f"Missing remedy codes: {missing}"


def test_phase9_incident_explain_builds_report(tmp_path: Path) -> None:
    sink = tmp_path / "sink.jsonl"
    evs = [
        {"ts_unix": 100, "ts": "X", "result": "DENY", "phase": "PHASE5", "event": "TEST_DENY", "git_head": "abc", "meta": {"code": "E_LIVE_DISABLED"}},
        {"ts_unix": 101, "ts": "X", "result": "OK", "phase": "PHASE5", "event": "TEST_OK", "git_head": "abc", "meta": {}},
    ]
    sink.write_text("\n".join(json.dumps(x) for x in evs) + "\n", encoding="utf-8")

    report, out_path = build_report(sink, center_unix=100, window_sec=10, dedupe=False)
    assert "EXPLAINED" in report
    assert "E_LIVE_DISABLED" in report
    assert "DENY EXPLANATIONS + REMEDIES" in report
    assert out_path.exists()
