from __future__ import annotations

from pathlib import Path

from scripts.phase6.arming_ceremony import build_arming_snapshot


def test_build_arming_snapshot(tmp_path: Path, monkeypatch) -> None:
    # Create a fake envelope
    env = tmp_path / "env.json"
    env.write_text("{\"allow_live\": false}\n", encoding="utf-8")

    # Ensure function returns stable keys
    snap = build_arming_snapshot(env)
    assert "git_head" in snap
    assert snap["envelope_path"] == str(env)
    assert isinstance(snap["kill_switch_active"], bool)
    # sha should exist for existing file
    assert snap["envelope_sha256"] is not None
