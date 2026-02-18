#!/usr/bin/env python3
"""
Telemetry Contract Test - Minimum Schema Requirements

Enforces that all telemetry JSONL files contain required fields:
- schema_version (int >= 1)
- ts_ms (int > 0)
- run_id (str, non-empty)
- event_type (str, non-empty)

Author: Allmight System
Phase: 2.4.0 - Instrumentation
"""

import json
from pathlib import Path
import pytest


def _iter_jsonl_objects(p: Path):
    """Iterate over JSONL file, yielding (line_number, object)"""
    with p.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                raise AssertionError(f"Invalid JSON in {p} line {i}: {e}") from e
            yield i, obj


def _find_telemetry_jsonl_roots():
    """
    Prefer repo runtime telemetry if present.
    If not present (CI), fall back to test fixtures.
    """
    candidates = [
        Path("data/telemetry"),
        Path("tests/fixtures/telemetry"),
    ]
    return [c for c in candidates if c.exists()]


def _collect_jsonl_files():
    """Collect all JSONL files from telemetry roots"""
    roots = _find_telemetry_jsonl_roots()
    if not roots:
        pytest.skip("No telemetry JSONL found (data/telemetry or tests/fixtures/telemetry).")

    files = []
    for root in roots:
        files.extend(sorted(root.rglob("*.jsonl")))
    if not files:
        pytest.skip("Telemetry root exists but no .jsonl files found.")
    return files


@pytest.mark.parametrize("jsonl_path", _collect_jsonl_files())
def test_telemetry_minimum_fields(jsonl_path: Path):
    """
    Enforce minimum schema requirements on all telemetry events
    
    Required fields:
    - schema_version: int >= 1
    - ts_ms: int > 0  
    - run_id: str (non-empty)
    - event_type: str (non-empty)
    """
    for line_no, obj in _iter_jsonl_objects(jsonl_path):
        # Required fields
        for key in ("schema_version", "ts_ms", "run_id", "event_type"):
            assert key in obj, f"Missing '{key}' in {jsonl_path} line {line_no}"

        # Types
        assert isinstance(obj["schema_version"], int), \
            f"schema_version must be int in {jsonl_path} line {line_no}"
        assert isinstance(obj["ts_ms"], int), \
            f"ts_ms must be int in {jsonl_path} line {line_no}"
        assert isinstance(obj["run_id"], str), \
            f"run_id must be str in {jsonl_path} line {line_no}"
        assert isinstance(obj["event_type"], str), \
            f"event_type must be str in {jsonl_path} line {line_no}"

        # Sanity
        assert obj["schema_version"] >= 1, \
            f"schema_version must be >=1 in {jsonl_path} line {line_no}"
        assert obj["ts_ms"] > 0, \
            f"ts_ms must be >0 in {jsonl_path} line {line_no}"
        assert obj["run_id"].strip(), \
            f"run_id must be non-empty in {jsonl_path} line {line_no}"
        assert obj["event_type"].strip(), \
            f"event_type must be non-empty in {jsonl_path} line {line_no}"

        # Light conditional checks (don't over-tighten yet)
        if obj["event_type"] == "PIPELINE_STAGE_END":
            assert "duration_ms" in obj, \
                f"Missing duration_ms in {jsonl_path} line {line_no}"
            assert isinstance(obj["duration_ms"], int), \
                f"duration_ms must be int in {jsonl_path} line {line_no}"
            assert obj["duration_ms"] >= 0, \
                f"duration_ms must be >=0 in {jsonl_path} line {line_no}"
