from __future__ import annotations

import json
from pathlib import Path

def test_incident_report_generates_file(tmp_path, monkeypatch) -> None:
    sink = tmp_path / "sink.jsonl"
    monkeypatch.setenv("ALLMIGHT_AUDIT_SINK_PATH", str(sink))

    evt = {
        "event": "X_EVENT",
        "phase": "PHASEX",
        "result": "OK",
        "ts_unix": 1000,
        "git_head": "abc",
        "meta": {"raw": {"ts_unix": 1000}},
    }
    sink.write_text(json.dumps(evt) + "\n", encoding="utf-8")

    from scripts.phase9.audit_incident import main as run

    # run with explicit output
    out = tmp_path / "out.txt"
    monkeypatch.setenv("GIT_HEAD_OVERRIDE", "abc")
    import sys
    argv = ["audit_incident.py", "--center-unix", "1000", "--window-sec", "10", "--out", str(out)]
    monkeypatch.setattr(sys, "argv", argv)

    assert run() == 0
    s = out.read_text(encoding="utf-8")
    assert "INCIDENT REPORT" in s
    assert "X_EVENT" in s
