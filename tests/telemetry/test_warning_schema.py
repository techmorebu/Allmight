#!/usr/bin/env python3
"""
Telemetry Contract Test - TELEMETRY_WARNING Schema

Enforces strict schema for TELEMETRY_WARNING events:
- Required fields (severity, subsystem, code_namespace, warning_codes, error_codes, ok)
- Codes are sorted, unique lists of strings
- Severity/ok consistency rules
- No empty warning events

Author: Allmight System
Phase: 2.4.0 - Instrumentation
"""

import json
from pathlib import Path
import pytest


ALLOWED_SEVERITIES = {"INFO", "WARN", "ERROR"}


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
    """Find telemetry JSONL roots"""
    candidates = [
        Path("data/telemetry"),
        Path("tests/fixtures/telemetry"),
    ]
    return [c for c in candidates if c.exists()]


def _collect_jsonl_files():
    """Collect all JSONL files"""
    roots = _find_telemetry_jsonl_roots()
    if not roots:
        pytest.skip("No telemetry JSONL found (data/telemetry or tests/fixtures/telemetry).")

    files = []
    for root in roots:
        files.extend(sorted(root.rglob("*.jsonl")))
    if not files:
        pytest.skip("Telemetry root exists but no .jsonl files found.")
    return files


def _is_sorted_unique_str_list(x):
    """Check if x is a sorted, unique list of non-empty strings"""
    if not isinstance(x, list):
        return False
    if not all(isinstance(s, str) for s in x):
        return False
    # unique
    if len(set(x)) != len(x):
        return False
    # sorted (lexicographic)
    if x != sorted(x):
        return False
    # non-empty strings
    if any(not s.strip() for s in x):
        return False
    return True


@pytest.mark.parametrize("jsonl_path", _collect_jsonl_files())
def test_telemetry_warning_schema(jsonl_path: Path):
    """
    Enforce TELEMETRY_WARNING schema
    
    Required fields:
    - schema_version, ts_ms, run_id, event_type (from base schema)
    - severity (INFO|WARN|ERROR)
    - subsystem (str, non-empty)
    - code_namespace (str, non-empty)
    - warning_codes (sorted unique str list)
    - error_codes (sorted unique str list)
    - ok (bool)
    
    Consistency rules:
    - If error_codes non-empty: severity=ERROR, ok=False
    - Else if warning_codes non-empty: severity in {WARN,INFO}, ok=True
    - At least one code must be present (no empty events)
    """
    for line_no, obj in _iter_jsonl_objects(jsonl_path):
        if obj.get("event_type") != "TELEMETRY_WARNING":
            continue

        # Required core header (base schema)
        assert "schema_version" in obj, \
            f"Missing schema_version in {jsonl_path} line {line_no}"
        assert "ts_ms" in obj, \
            f"Missing ts_ms in {jsonl_path} line {line_no}"
        assert "run_id" in obj, \
            f"Missing run_id in {jsonl_path} line {line_no}"
        assert "event_type" in obj, \
            f"Missing event_type in {jsonl_path} line {line_no}"

        assert isinstance(obj["schema_version"], int), \
            f"schema_version must be int in {jsonl_path} line {line_no}"
        assert obj["schema_version"] >= 1, \
            f"schema_version must be >=1 in {jsonl_path} line {line_no}"
        assert isinstance(obj["ts_ms"], int) and obj["ts_ms"] > 0, \
            f"ts_ms invalid in {jsonl_path} line {line_no}"
        assert isinstance(obj["run_id"], str) and obj["run_id"].strip(), \
            f"run_id invalid in {jsonl_path} line {line_no}"

        # Warning schema required fields
        for key in ("severity", "subsystem", "code_namespace", "warning_codes", "error_codes", "ok"):
            assert key in obj, \
                f"Missing '{key}' in {jsonl_path} line {line_no}"

        assert isinstance(obj["severity"], str), \
            f"severity must be str in {jsonl_path} line {line_no}"
        assert obj["severity"] in ALLOWED_SEVERITIES, \
            f"severity must be one of {ALLOWED_SEVERITIES} in {jsonl_path} line {line_no}"

        assert isinstance(obj["subsystem"], str) and obj["subsystem"].strip(), \
            f"subsystem invalid in {jsonl_path} line {line_no}"
        assert isinstance(obj["code_namespace"], str) and obj["code_namespace"].strip(), \
            f"code_namespace invalid in {jsonl_path} line {line_no}"

        assert _is_sorted_unique_str_list(obj["warning_codes"]), \
            f"warning_codes must be sorted unique str list in {jsonl_path} line {line_no}"
        assert _is_sorted_unique_str_list(obj["error_codes"]), \
            f"error_codes must be sorted unique str list in {jsonl_path} line {line_no}"

        assert isinstance(obj["ok"], bool), \
            f"ok must be bool in {jsonl_path} line {line_no}"

        warn_codes = obj["warning_codes"]
        err_codes = obj["error_codes"]

        # Do not allow empty warning events (no codes)
        assert (warn_codes or err_codes), \
            f"TELEMETRY_WARNING must include at least one code in {jsonl_path} line {line_no}"

        # Severity/ok consistency rules (canonical)
        if err_codes:
            assert obj["severity"] == "ERROR", \
                f"error_codes present => severity must be ERROR in {jsonl_path} line {line_no}"
            assert obj["ok"] is False, \
                f"error_codes present => ok must be False in {jsonl_path} line {line_no}"
        else:
            # warning-only (or info-only if you choose later; for now enforce WARN)
            assert obj["severity"] in {"WARN", "INFO"}, \
                f"warning_codes present => severity must be WARN/INFO in {jsonl_path} line {line_no}"
            assert obj["ok"] is True, \
                f"warning_codes present => ok must be True in {jsonl_path} line {line_no}"

        # Optional context must be small dict if present (type-only check)
        if "context" in obj:
            assert isinstance(obj["context"], dict), \
                f"context must be dict if present in {jsonl_path} line {line_no}"
