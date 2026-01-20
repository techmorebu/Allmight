from __future__ import annotations

import json
from pathlib import Path

from scripts.phase7.audit_event import emit_phase5_audit


def test_emit_phase5_audit_writes_normalized_record(tmp_path: Path) -> None:
    p = tmp_path / "audit.jsonl"
    emit_phase5_audit(
        event="TEST_EVENT",
        adapter_id="TEST_ADAPTER",
        action="PING",
        result="DENY",
        deny_code="E_TEST",
        payload={"foo": "bar"},
        audit_path=str(p),
    )
    line = p.read_text(encoding="utf-8").strip().splitlines()[-1]
    rec = json.loads(line)

    # required normalized keys
    assert rec["phase"] == "5"
    assert rec["event"] == "TEST_EVENT"
    assert rec["adapter_id"] == "TEST_ADAPTER"
    assert rec["result"] == "DENY"
    assert rec["deny_code"] == "E_TEST"
    assert "ts" in rec and "ts_unix" in rec
    assert rec["action"] == "PING"
    assert rec["foo"] == "bar"
