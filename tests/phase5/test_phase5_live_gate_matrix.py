from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts.phase5.live_envelope import LiveDeny, assert_live_allowed


ACK = "I ACKNOWLEDGE LIVE EXECUTION RISK"
ADAPTER = "COINBASE_SPOT_LIVE_V0"


def _tmp_env(allow_live: bool, allowed_adapters: list[str]) -> Path:
    src = Path("config/phase5/live_execution_envelope_v0.json")
    data = json.loads(src.read_text(encoding="utf-8"))
    data["allow_live"] = bool(allow_live)
    data["allowed_adapters"] = list(allowed_adapters)
    tmp = Path("/tmp/phase5_test_env.json")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return tmp


def test_default_denies() -> None:
    with pytest.raises(LiveDeny) as ei:
        assert_live_allowed(ADAPTER, ack=ACK)
    assert ei.value.code == "E_LIVE_DISABLED"


def test_env_missing_denies(monkeypatch: pytest.MonkeyPatch) -> None:
    tmp = _tmp_env(True, [ADAPTER])
    monkeypatch.delenv("ALLMIGHT_LIVE", raising=False)
    with pytest.raises(LiveDeny) as ei:
        assert_live_allowed(ADAPTER, ack=ACK, config_path=tmp)
    assert ei.value.code == "E_ENV_NOT_SET"


def test_ack_wrong_denies(monkeypatch: pytest.MonkeyPatch) -> None:
    tmp = _tmp_env(True, [ADAPTER])
    monkeypatch.setenv("ALLMIGHT_LIVE", "1")
    with pytest.raises(LiveDeny) as ei:
        assert_live_allowed(ADAPTER, ack="WRONG", config_path=tmp)
    assert ei.value.code == "E_OPERATOR_ACK"


def test_allowlist_denies(monkeypatch: pytest.MonkeyPatch) -> None:
    tmp = _tmp_env(True, [ADAPTER])
    monkeypatch.setenv("ALLMIGHT_LIVE", "1")
    with pytest.raises(LiveDeny) as ei:
        assert_live_allowed("SOME_OTHER_ADAPTER", ack=ACK, config_path=tmp)
    assert ei.value.code == "E_ADAPTER_NOT_ALLOWED"


def test_kill_switch_denies(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Write kill-switch to real path because envelope checks path existence.
    ks = Path("config/phase5/KILL_SWITCH")
    ks.parent.mkdir(parents=True, exist_ok=True)
    ks.write_text("KILL\n", encoding="utf-8")

    try:
        src = Path("config/phase5/live_execution_envelope_v0.json")
        data = json.loads(src.read_text(encoding="utf-8"))
        data["allow_live"] = True
        data["allowed_adapters"] = [ADAPTER]
        tmp = tmp_path / "phase5_test_env_kill.json"
        tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        monkeypatch.setenv("ALLMIGHT_LIVE", "1")
        with pytest.raises(LiveDeny) as ei:
            assert_live_allowed(ADAPTER, ack=ACK, config_path=tmp)
        assert ei.value.code == "E_KILL_SWITCH_ACTIVE"
    finally:
        try:
            ks.unlink()
        except FileNotFoundError:
            pass
