from __future__ import annotations

import json

def test_deny_code_extraction_best_effort(tmp_path, monkeypatch) -> None:
    sink = tmp_path / "sink.jsonl"
    monkeypatch.setenv("ALLMIGHT_AUDIT_SINK_PATH", str(sink))

    evt = {
        "event": "X",
        "phase": "P",
        "result": "DENY",
        "ts_unix": 123,
        "meta": {"raw": {"message": "DENY: E_ARMING_REQUIRED :: No arming record found"}},
    }
    sink.write_text(json.dumps(evt) + "\n", encoding="utf-8")

    from scripts.phase9.audit_scan import deny_code, _read_jsonl
    evts = _read_jsonl(sink)
    assert deny_code(evts[0]) == "E_ARMING_REQUIRED"
