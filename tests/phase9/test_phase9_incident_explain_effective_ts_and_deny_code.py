from __future__ import annotations

from scripts.phase9.audit_incident_explain import _extract_deny_code, _get_effective_ts_unix


def test_effective_ts_prefers_meta_raw_ts_unix() -> None:
    ev = {"ts_unix": 999, "meta": {"raw": {"ts_unix": 123}}}
    assert _get_effective_ts_unix(ev) == 123


def test_effective_ts_falls_back_to_top_level_ts_unix() -> None:
    ev = {"ts_unix": 777}
    assert _get_effective_ts_unix(ev) == 777


def test_extract_deny_code_from_meta_raw_deny_code() -> None:
    ev = {"result": "DENY", "meta": {"raw": {"deny_code": "E_LIVE_DISABLED"}}}
    assert _extract_deny_code(ev) == "E_LIVE_DISABLED"


def test_extract_deny_code_unknown_when_missing() -> None:
    ev = {"result": "DENY", "meta": {"raw": {}}}
    assert _extract_deny_code(ev) == "UNKNOWN_DENY_CODE"
