from __future__ import annotations

from pathlib import Path


def test_phase5_schema_file_exists_and_has_anchors() -> None:
    p = Path("config/phase5/intent_schema_v1.txt")
    assert p.exists()

    txt = p.read_text(encoding="utf-8")

    # Anchors: version + key fields
    assert "PHASE 5 — EXECUTION INTENT SCHEMA v1" in txt
    assert "phase5_execution_intents.json" in txt
    assert "phase5_audit.txt" in txt

    assert "Top-level fields" in txt
    assert "Intent object" in txt
    assert "Reason object" in txt
    assert "phase4_evidence" in txt

    assert "Invariants" in txt
    assert "Temporal integrity" in txt
