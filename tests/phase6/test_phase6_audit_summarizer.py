from __future__ import annotations

import json
from pathlib import Path

from scripts.phase6.summarize_phase5_audit import _read_jsonl, summarize


def test_read_jsonl_and_summarize(tmp_path: Path) -> None:
    p = tmp_path / "audit.jsonl"
    rows = [
        {"event": "A", "result": "DENY", "deny_code": "E_X"},
        {"event": "A", "result": "DENY", "deny_code": "E_X"},
        {"event": "B", "result": "OK"},
        {"event": "C"},
        "not json",
    ]
    p.write_text("\n".join([json.dumps(r) if isinstance(r, dict) else r for r in rows]) + "\n", encoding="utf-8")

    parsed = _read_jsonl(p)
    assert len(parsed) == 4

    s = summarize(parsed)
    assert s["count"] == 4
    assert s["by_event"]["A"] == 2
    assert s["by_result"]["DENY"] == 2
    assert s["by_deny_code"]["E_X"] == 2
