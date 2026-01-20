from __future__ import annotations

import time
from pathlib import Path

from scripts.phase6.arming_guard import require_recent_arming, ArmingDeny


def test_arming_required(tmp_path: Path) -> None:
    p = tmp_path / "missing.jsonl"
    try:
        require_recent_arming(path=p, max_age_seconds=60)
        assert False, "expected deny"
    except ArmingDeny as e:
        assert e.code == "E_ARMING_REQUIRED"


def test_arming_stale(tmp_path: Path) -> None:
    p = tmp_path / "arming.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text('{"event":"PHASE6_ARMING_CEREMONY","result":"OK"}\n', encoding="utf-8")

    # force stale by setting mtime far in past
    old = time.time() - 9999
    Path(p).touch()
    import os
    os.utime(p, (old, old))

    try:
        require_recent_arming(path=p, max_age_seconds=60)
        assert False, "expected stale deny"
    except ArmingDeny as e:
        assert e.code == "E_ARMING_STALE"


def test_arming_ok(tmp_path: Path) -> None:
    p = tmp_path / "arming.jsonl"
    p.write_text('{"event":"PHASE6_ARMING_CEREMONY","result":"OK"}\n', encoding="utf-8")
    rec = require_recent_arming(path=p, max_age_seconds=999999)
    assert rec["event"] == "PHASE6_ARMING_CEREMONY"
