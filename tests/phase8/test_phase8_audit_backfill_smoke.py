from __future__ import annotations

import json
import os
from pathlib import Path

def test_backfill_dry_run_does_not_write_sink(tmp_path, monkeypatch) -> None:
    # Arrange: isolated sink + a fake legacy jsonl
    sink_dir = tmp_path / "audit"
    sink_dir.mkdir(parents=True, exist_ok=True)
    sink_path = sink_dir / "allmight_audit.jsonl"
    monkeypatch.setenv("ALLMIGHT_AUDIT_SINK_PATH", str(sink_path))

    legacy = tmp_path / "legacy.jsonl"
    legacy.write_text(
        "\n".join([
            json.dumps({"event": "LEGACY_ONE", "phase": "PHASE5", "result": "OK"}),
            json.dumps({"deny_code": "E_NOPE", "event": "X", "result": "DENY"}),
        ]) + "\n",
        encoding="utf-8",
    )

    from scripts.phase8.audit_backfill import backfill_sources

    # Act: dry run (apply=False)
    res = backfill_sources([str(legacy)], apply=False)

    # Assert
    assert sink_path.exists() is False, "Dry-run must not create sink file"
    assert res[0].read_lines == 2
    assert res[0].written_events == 0
    assert res[0].skipped_lines == 2

def test_backfill_apply_writes_sink(tmp_path, monkeypatch) -> None:
    sink_dir = tmp_path / "audit"
    sink_dir.mkdir(parents=True, exist_ok=True)
    sink_path = sink_dir / "allmight_audit.jsonl"
    monkeypatch.setenv("ALLMIGHT_AUDIT_SINK_PATH", str(sink_path))

    legacy = tmp_path / "legacy.jsonl"
    legacy.write_text(
        "\n".join([
            json.dumps({"event": "LEGACY_ONE", "phase": "PHASE5", "result": "OK"}),
            json.dumps({"event": "LEGACY_TWO", "phase": "PHASE6", "result": "OK"}),
        ]) + "\n",
        encoding="utf-8",
    )

    from scripts.phase8.audit_backfill import backfill_sources

    res = backfill_sources([str(legacy)], apply=True)

    assert sink_path.exists(), "Apply must create sink file"
    lines = [ln.strip() for ln in sink_path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    assert len(lines) == 2
    obj = json.loads(lines[0])
    assert obj["schema_version"] == "AUDIT_SINK_V0"
    assert obj["event"].startswith("BACKFILL::")
    assert obj["meta"]["source_path"].endswith("legacy.jsonl")
    assert res[0].written_events == 2
