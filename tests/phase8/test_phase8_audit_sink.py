from __future__ import annotations

import json
from pathlib import Path

from scripts.phase8.audit_sink import write_audit_event, ENV_SINK_PATH, SCHEMA_VERSION


def test_audit_sink_writes_canonical_jsonl(tmp_path, monkeypatch) -> None:
    sink = tmp_path / "audit.jsonl"
    monkeypatch.setenv(ENV_SINK_PATH, str(sink))

    rec = write_audit_event({"event": "UNIT_TEST", "phase": "PHASE8", "result": "OK", "meta": {"x": 1}})

    assert sink.exists()
    lines = [ln.strip() for ln in sink.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 1

    loaded = json.loads(lines[0])

    # required canonical fields
    assert loaded["schema_version"] == SCHEMA_VERSION
    assert isinstance(loaded["ts"], str) and loaded["ts"].endswith("Z")
    assert isinstance(loaded["ts_unix"], int)
    assert isinstance(loaded["git_head"], str) and len(loaded["git_head"]) >= 4

    # payload preserved
    assert loaded["event"] == "UNIT_TEST"
    assert loaded["phase"] == "PHASE8"
    assert loaded["result"] == "OK"
    assert loaded["meta"]["x"] == 1

    # function return matches written record
    assert rec["event"] == loaded["event"]
    assert rec["schema_version"] == loaded["schema_version"]
