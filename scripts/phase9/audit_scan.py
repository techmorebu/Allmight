from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

DEFAULT_SINK = Path("outputs/audit/allmight_audit.jsonl")

def _sink_path() -> Path:
    # Hermetic override for tests / drills
    p = os.getenv("ALLMIGHT_AUDIT_SINK_PATH")
    return Path(p) if p else DEFAULT_SINK

def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            obj = json.loads(ln)
            if isinstance(obj, dict):
                out.append(obj)
        except json.JSONDecodeError:
            continue
    return out

def effective_ts_unix(evt: Dict[str, Any]) -> Optional[int]:
    # Prefer legacy/backfill raw ts_unix if present
    meta = evt.get("meta") or {}
    raw = meta.get("raw") if isinstance(meta, dict) else None
    if isinstance(raw, dict) and "ts_unix" in raw:
        try:
            return int(raw["ts_unix"])
        except Exception:
            pass
    if "ts_unix" in evt:
        try:
            return int(evt["ts_unix"])
        except Exception:
            return None
    return None

def _fmt_line(evt: Dict[str, Any]) -> str:
    ts = effective_ts_unix(evt)
    ev = evt.get("event", "UNKNOWN")
    ph = evt.get("phase", "UNKNOWN")
    res = evt.get("result", "UNKNOWN")
    git = evt.get("git_head", "UNKNOWN")
    return f"{ts}\t{res}\t{ph}\t{ev}\tgit={git}"

def _filter_time(evts: List[Dict[str, Any]], since: Optional[int], until: Optional[int]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for e in evts:
        t = effective_ts_unix(e)
        if t is None:
            continue
        if since is not None and t < since:
            continue
        if until is not None and t > until:
            continue
        out.append(e)
    return out

def _tail(evts: List[Dict[str, Any]], n: int) -> List[Dict[str, Any]]:
    if n <= 0:
        return []
    return evts[-n:]

def _denies(evts: List[Dict[str, Any]], n: int) -> List[Dict[str, Any]]:
    d = [e for e in evts if (e.get("result") == "DENY")]
    return _tail(d, n)

def _event_match(evts: List[Dict[str, Any]], pat: str) -> List[Dict[str, Any]]:
    p = pat.lower()
    return [e for e in evts if str(e.get("event","")).lower().find(p) >= 0]

def _stats(evts: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_event = Counter(str(e.get("event","UNKNOWN")) for e in evts)
    by_phase = Counter(str(e.get("phase","UNKNOWN")) for e in evts)
    by_result = Counter(str(e.get("result","UNKNOWN")) for e in evts)
    return {
        "count": len(evts),
        "by_event_top": by_event.most_common(20),
        "by_phase_top": by_phase.most_common(20),
        "by_result": by_result.most_common(),
    }

def _incident_slice(evts: List[Dict[str, Any]], center: int, window_sec: int) -> List[Dict[str, Any]]:
    since = center - int(window_sec)
    until = center + int(window_sec)
    return _filter_time(evts, since=since, until=until)

def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 9: operator audit scan (canonical sink reader).")
    ap.add_argument("--tail", type=int, default=0, help="Print last N events (normalized line format).")
    ap.add_argument("--denies", type=int, default=0, help="Print last N DENY events.")
    ap.add_argument("--events", type=str, default="", help="Filter events by substring.")
    ap.add_argument("--since-unix", type=int, default=None)
    ap.add_argument("--until-unix", type=int, default=None)
    ap.add_argument("--incident", type=int, default=None, help="Incident center unix timestamp.")
    ap.add_argument("--window-sec", type=int, default=300, help="Incident window seconds (default 300).")
    ap.add_argument("--stats", action="store_true", help="Print counts by event/phase/result.")
    ap.add_argument("--json", dest="as_json", action="store_true", help="Emit JSON instead of line format.")
    args = ap.parse_args()

    path = _sink_path()
    evts = _read_jsonl(path)

    # time-filter first (makes stats/slices consistent)
    evts = _filter_time(evts, since=args.since_unix, until=args.until_unix)

    if args.events:
        evts = _event_match(evts, args.events)

    if args.incident is not None:
        evts = _incident_slice(evts, center=int(args.incident), window_sec=int(args.window_sec))

    out: Dict[str, Any] = {"sink": str(path), "count": len(evts)}

    if args.stats:
        out["stats"] = _stats(evts)

    lines: List[str] = []
    if args.denies:
        sel = _denies(evts, args.denies)
        lines.extend(_fmt_line(e) for e in sel)
    if args.tail:
        sel = _tail(evts, args.tail)
        lines.extend(_fmt_line(e) for e in sel)

    if args.as_json:
        out["lines"] = lines
        print(json.dumps(out, indent=2, sort_keys=True))
    else:
        # print selected lines; if none selected, print a tiny summary header
        if lines:
            for ln in lines:
                print(ln)
        else:
            print(f"sink={path} count={len(evts)} (use --tail/--denies/--stats)")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
