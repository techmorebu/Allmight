from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from scripts.phase9.audit_scan import (
    _read_jsonl,
    _sink_path,
    _filter_time,
    _dedupe,
    _fmt_line,
    _stats,
    effective_ts_unix,
    inferred_phase,
)

OUT_DIR = Path("outputs/phase9/incidents")

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def _find_last(evts: List[Dict[str, Any]], pred) -> Optional[Dict[str, Any]]:
    for e in reversed(evts):
        if pred(e):
            return e
    return None

def _last_deny(evts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    return _find_last(evts, lambda e: e.get("result") == "DENY")

def _last_arming(evts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    def pred(e: Dict[str, Any]) -> bool:
        ev = str(e.get("event", ""))
        return ("ARMING" in ev) or ("PHASE6_ARMING_CEREMONY" in ev)
    return _find_last(evts, pred)

def _last_live_attempt(evts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    def pred(e: Dict[str, Any]) -> bool:
        ev = str(e.get("event",""))
        return ("PHASE5_LIVE_ACTION_ATTEMPT" in ev)
    return _find_last(evts, pred)

def _deny_codes(evts: List[Dict[str, Any]]) -> Counter:
    # Keep this local so audit_incident stays stable even if deny_code evolves
    import re
    def code(evt: Dict[str, Any]) -> str:
        meta = evt.get("meta") or {}
        raw = meta.get("raw") if isinstance(meta, dict) else None
        if isinstance(raw, dict):
            for k in ("code", "deny_code"):
                v = raw.get(k)
                if v:
                    return str(v)
            msg = raw.get("message") or raw.get("error", {}).get("message") if isinstance(raw.get("error"), dict) else None
            if msg:
                m = re.search(r"(E_[A-Z0-9_]+)", str(msg))
                if m:
                    return m.group(1)
        return "UNKNOWN_DENY_CODE"
    c = Counter()
    for e in evts:
        if e.get("result") == "DENY":
            c[code(e)] += 1
    return c

def render_report(
    sink: Path,
    center_unix: int,
    window_sec: int,
    args_namespace: str,
    evts_window: List[Dict[str, Any]],
) -> str:
    since = center_unix - window_sec
    until = center_unix + window_sec

    lines = []
    lines.append("ALLMIGHT AUDIT INCIDENT REPORT (PHASE9)")
    lines.append("=" * 60)
    lines.append(f"as_of_utc: {utc_now_iso()}")
    lines.append(f"sink: {sink}")
    lines.append(f"center_unix: {center_unix}")
    lines.append(f"window_sec: {window_sec}")
    lines.append(f"range: [{since}, {until}]")
    lines.append(f"args: {args_namespace}")
    lines.append("")

    st = _stats(evts_window)
    lines.append("SUMMARY")
    lines.append("-" * 60)
    lines.append(f"count: {st['count']}")
    lines.append(f"by_result: {st['by_result']}")
    lines.append("top_events:")
    for ev, n in st["by_event_top"][:10]:
        lines.append(f"  - {ev}: {n}")
    lines.append("top_phases:")
    for ph, n in st["by_phase_top"][:10]:
        lines.append(f"  - {ph}: {n}")
    lines.append("")

    deny_counts = _deny_codes(evts_window)
    if sum(deny_counts.values()) > 0:
        lines.append("DENY BREAKDOWN")
        lines.append("-" * 60)
        for code, n in deny_counts.most_common(20):
            lines.append(f"  - {code}: {n}")
        lines.append("")

    lines.append("TIMELINE (normalized)")
    lines.append("-" * 60)
    # Sort by effective timestamp for deterministic output
    evts_sorted = sorted(
        (e for e in evts_window if effective_ts_unix(e) is not None),
        key=lambda e: int(effective_ts_unix(e) or 0),
    )
    for e in evts_sorted:
        lines.append(_fmt_line(e))

    lines.append("")
    return "\n".join(lines)

def default_out_path(center_unix: int, window_sec: int, git_head: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    return OUT_DIR / f"incident_{center_unix}_{window_sec}sec_{git_head}.txt"

def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 9: generate incident report from canonical audit sink.")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--center-unix", type=int, default=None)
    g.add_argument("--last-deny", action="store_true")
    g.add_argument("--last-arming", action="store_true")
    g.add_argument("--last-live-attempt", action="store_true")
    ap.add_argument("--window-sec", type=int, default=300)
    ap.add_argument("--dedupe", action="store_true")
    ap.add_argument("--out", type=str, default="")
    ap.add_argument("--print", dest="do_print", action="store_true")
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()

    sink = _sink_path()
    evts = _read_jsonl(sink)

    center_evt: Optional[Dict[str, Any]] = None
    center_unix: Optional[int] = args.center_unix

    if args.last_deny:
        center_evt = _last_deny(evts)
    elif args.last_arming:
        center_evt = _last_arming(evts)
    elif args.last_live_attempt:
        center_evt = _last_live_attempt(evts)

    if center_unix is None:
        if not center_evt:
            raise SystemExit("No matching event found for selector.")
        t = effective_ts_unix(center_evt)
        if t is None:
            raise SystemExit("Selected event lacks effective ts_unix.")
        center_unix = int(t)

    window = int(args.window_sec)
    evts_window = _filter_time(evts, since=center_unix - window, until=center_unix + window)
    if args.dedupe:
        evts_window = _dedupe(evts_window)

    args_ns = " ".join([a for a in os.sys.argv[1:]])
    git_head = os.getenv("GIT_HEAD_OVERRIDE", "") or os.popen("git rev-parse --short HEAD").read().strip()

    report = render_report(
        sink=sink,
        center_unix=int(center_unix),
        window_sec=window,
        args_namespace=args_ns,
        evts_window=evts_window,
    )

    out_path = Path(args.out) if args.out else default_out_path(int(center_unix), window, git_head)

    if not args.no_write:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report, encoding="utf-8")

    if args.do_print or args.no_write:
        print(report)

    if not args.no_write:
        print(str(out_path))

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
