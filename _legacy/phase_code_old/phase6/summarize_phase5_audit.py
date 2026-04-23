from __future__ import annotations

import argparse
import json
from pathlib import Path
from collections import Counter
from typing import Any


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            # ignore bad lines (audit logs are append-only; corruption should not crash operator tooling)
            continue
    return rows


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_event = Counter()
    by_result = Counter()
    by_deny = Counter()

    for r in rows:
        if "event" in r:
            by_event[str(r.get("event"))] += 1
        if "result" in r:
            by_result[str(r.get("result"))] += 1
        if "deny_code" in r:
            by_deny[str(r.get("deny_code"))] += 1

    return {
        "count": len(rows),
        "by_event": dict(by_event),
        "by_result": dict(by_result),
        "by_deny_code": dict(by_deny),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Summarize Phase 5 live audit jsonl for operator review.")
    ap.add_argument("--path", required=True, help="Path to phase5_live_audit.jsonl")
    ap.add_argument("--tail", type=int, default=20, help="Tail N lines to print (default 20)")
    args = ap.parse_args()

    p = Path(args.path)
    rows = _read_jsonl(p)
    s = summarize(rows)

    print(json.dumps({
        "path": str(p),
        "summary": s,
    }, indent=2, sort_keys=True))

    if rows:
        tail = rows[-int(args.tail):] if args.tail > 0 else []
        print("\nTAIL:")
        for r in tail:
            print(json.dumps(r, sort_keys=True))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
