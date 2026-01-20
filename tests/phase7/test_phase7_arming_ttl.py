from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

import scripts.phase6.arming_guard as ag


def _write_policy(ttl: int) -> None:
    p = Path("config/phase6/arming_policy_v0.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"arming_ttl_seconds": ttl}, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_jsonl_event(ts_unix: float) -> None:
    p = Path("outputs/phase6/arming/phase6_arming.jsonl")
    p.parent.mkdir(parents=True, exist_ok=True)
    # write a single JSONL line
    p.write_text(json.dumps({"event": "PHASE6_ARMING_CEREMONY", "ts_unix": ts_unix}) + "\n", encoding="utf-8")


def test_policy_invalid_fail_closed() -> None:
    # ttl=0 and default max_age_seconds => deny
    _write_policy(ttl=0)
    _write_jsonl_event(ts_unix=time.time())
    with pytest.raises(ag.ArmingDeny) as e:
        ag.require_recent_arming()
    assert e.value.code == "E_ARMING_POLICY_INVALID"


def test_stale_denied_by_policy_ttl() -> None:
    _write_policy(ttl=10)
    _write_jsonl_event(ts_unix=time.time() - 999)
    with pytest.raises(ag.ArmingDeny) as e:
        ag.require_recent_arming()
    assert e.value.code == "E_ARMING_STALE"


def test_fresh_allowed_by_policy_ttl() -> None:
    _write_policy(ttl=9999)
    _write_jsonl_event(ts_unix=time.time())
    ag.require_recent_arming()
