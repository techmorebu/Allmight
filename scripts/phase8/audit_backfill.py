from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from scripts.phase8.audit_sink import write_audit_event

# Default known legacy sources (safe to extend later)
DEFAULT_SOURCES: List[str] = [
    "outputs/phase5/live_audit/phase5_live_audit.jsonl",
    "outputs/phase6/arming/phase6_arming.jsonl",
]

@dataclass(frozen=True)
class BackfillResult:
    source: str
    read_lines: int
    written_events: int
    skipped_lines: int

def _read_jsonl(path: Path) -> Iterable[Dict[str, Any]]:
    if not path.exists():
        return
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            obj = json.loads(ln)
            if isinstance(obj, dict):
                yield obj
        except json.JSONDecodeError:
            continue

def _normalize_legacy_event(obj: Dict[str, Any], source_path: str) -> Dict[str, Any]:
    # Minimal normalization: preserve original as meta.raw, and provide a stable event label.
    # The sink will add ts/ts_unix/git_head/schema_version.
    event = obj.get("event") or obj.get("deny_code") or obj.get("action") or "LEGACY_EVENT"
    phase = obj.get("phase") or obj.get("adapter_id") or "UNKNOWN"
    result = obj.get("result") or ("DENY" if "deny_code" in obj else "OK")
    meta = {
        "source_path": source_path,
        "source_schema": "LEGACY_JSONL_V0",
        "raw": obj,
    }
    return {
        "event": f"BACKFILL::{event}",
        "phase": str(phase),
        "result": str(result),
        "meta": meta,
    }

def backfill_sources(sources: List[str], apply: bool) -> List[BackfillResult]:
    results: List[BackfillResult] = []
    for src in sources:
        p = Path(src)
        read_lines = 0
        written = 0
        skipped = 0

        if not p.exists():
            results.append(BackfillResult(source=src, read_lines=0, written_events=0, skipped_lines=0))
            continue

        for obj in _read_jsonl(p):
            read_lines += 1
            evt = _normalize_legacy_event(obj, source_path=str(p))
            if apply:
                write_audit_event(evt)
                written += 1
            else:
                skipped += 1  # "skipped" means "dry-run no write"
        results.append(BackfillResult(source=src, read_lines=read_lines, written_events=written, skipped_lines=skipped))
    return results

def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 8: backfill legacy audit jsonl streams into the canonical sink.")
    ap.add_argument("--source", action="append", default=None, help="Legacy jsonl source path (repeatable).")
    ap.add_argument("--apply", action="store_true", help="Actually write to sink. Default is DRY_RUN.")
    ap.add_argument("--print", dest="do_print", action="store_true", help="Print summary JSON to stdout.")
    args = ap.parse_args()

    sources = args.source if args.source else DEFAULT_SOURCES
    res = backfill_sources(sources=sources, apply=bool(args.apply))

    out = {
        "status": "APPLIED" if args.apply else "DRY_RUN",
        "sources": sources,
        "results": [
            {"source": r.source, "read_lines": r.read_lines, "written_events": r.written_events, "skipped_lines": r.skipped_lines}
            for r in res
        ],
    }
    if args.do_print:
        print(json.dumps(out, indent=2, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
