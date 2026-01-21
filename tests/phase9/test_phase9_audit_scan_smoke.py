from __future__ import annotations

import json
from pathlib import Path

def test_audit_scan_prefers_raw_ts_unix(tmp_path, monkeypatch) -> None:
    sink = tmp_path / "sink.jsonl"
    monkeypatch.setenv("ALLMIGHT_AUDIT_SINK_PATH", str(sink))

    # Event A: sink ts_unix exists, but raw ts_unix is older
    a = {
        "event": "BACKFILL::X",
        "phase": "PHASE5",
        "result": "OK",
        "ts_unix": 2000,
        "meta": {"raw": {"ts_unix": 1000}},
    }
    # Event B: no raw, uses sink ts_unix
    b = {"event": "Y", "phase": "PHASE9", "result": "OK", "ts_unix": 3000}

    sink.write_text("\\n".join([json.dumps(a), json.dumps(b)]) + "\\n", encoding="utf-8")

    from scripts.phase9.audit_scan import effective_ts_unix
    assert effective_ts_unix(a) == 1000
    assert effective_ts_unix(b) == 3000
