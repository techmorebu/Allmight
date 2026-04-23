from __future__ import annotations

import argparse
import json
import os
import re
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_SINK = Path("outputs/audit/allmight_audit.jsonl")

def _sink_path() -> Path:
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

def inferred_phase(evt: Dict[str, Any]) -> str:
    # display-only inference for known legacy/backfill artifacts
    ph = str(evt.get("phase", "UNKNOWN"))
    ev = str(evt.get("event", ""))
    if ph != "UNKNOWN":
        return ph
    if "PHASE6_ARMING_CEREMONY" in ev:
        return "PHASE6"
    if "PHASE5" in ev and "LIVE" in ev:
        # many backfilled phase5 live records have adapter_id as phase already,
        # but if truly unknown, lean Phase 5.
        return "PHASE5"
    return ph

def _read_str(d: Dict[str, Any], path: List[str]) -> Optional[str]:
    cur: Any = d
    for k in path:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    if cur is None:
        return None
    return str(cur)

def deny_code(evt: Dict[str, Any]) -> str:
    # Best effort extraction
    meta = evt.get("meta") or {}
    raw = meta.get("raw") if isinstance(meta, dict) else None
    if isinstance(raw, dict):
        for p in (["code"], ["deny_code"], ["error", "code"], ["deny", "code"]):
            v = _read_str(raw, p)
            if v:
                return v
        # try message scrape
        for p in (["message"], ["error", "message"], ["deny", "message"]):
            v = _read_str(raw, p)
            if v:
                m = re.search(r"(E_[A-Z0-9_]+)", v)
                if m:
                    return m.group(1)
    # fallback: scan top-level message if any
    v2 = str(evt.get("message", "") or "")
    m2 = re.search(r"(E_[A-Z0-9_]+)", v2)
    if m2:
        return m2.group(1)
    return "UNKNOWN_DENY_CODE"

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

def _incident_slice(evts: List[Dict[str, Any]], center: int, window_sec: int) -> List[Dict[str, Any]]:
    since = center - int(window_sec)
    until = center + int(window_sec)
    return _filter_time(evts, since=since, until=until)

def _dedupe(evts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for e in evts:
        t = effective_ts_unix(e)
        ev = str(e.get("event",""))
        ph = inferred_phase(e)
        res = str(e.get("result",""))
        meta = e.get("meta") or {}
        raw = meta.get("raw") if isinstance(meta, dict) else None
        action = raw.get("action") if isinstance(raw, dict) else None
        key = (t, ev, ph, res, str(action))
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out

def _fmt_line(evt: Dict[str, Any]) -> str:
    ts = effective_ts_unix(evt)
    ev = evt.get("event", "UNKNOWN")
    ph = inferred_phase(evt)
    res = evt.get("result", "UNKNOWN")
    git = evt.get("git_head", "UNKNOWN")
    # show deny code inline when deny
    if res == "DENY":
        return f"{ts}\t{res}\t{ph}\t{ev}\tcode={deny_code(evt)}\tgit={git}"
    return f"{ts}\t{res}\t{ph}\t{ev}\tgit={git}"

def _stats(evts: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_event = Counter(str(e.get("event","UNKNOWN")) for e in evts)
    by_phase = Counter(inferred_phase(e) for e in evts)
    by_result = Counter(str(e.get("result","UNKNOWN")) for e in evts)
    return {
        "count": len(evts),
        "by_event_top": by_event.most_common(20),
        "by_phase_top": by_phase.most_common(20),
        "by_result": by_result.most_common(),
    }

def _find_last(evts: List[Dict[str, Any]], pred) -> Optional[Dict[str, Any]]:
    for e in reversed(evts):
        if pred(e):
            return e
    return None

def _last_arming(evts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    def pred(e: Dict[str, Any]) -> bool:
        ev = str(e.get("event",""))
        return ("ARMING" in ev) or ("PHASE6_ARMING_CEREMONY" in ev)
    return _find_last(evts, pred)

def _last_live_attempt(evts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    def pred(e: Dict[str, Any]) -> bool:
        ev = str(e.get("event",""))
        return ("PHASE5_LIVE_ACTION_ATTEMPT" in ev)
    return _find_last(evts, pred)

def _deny_summary(evts: List[Dict[str, Any]]) -> Dict[str, Any]:
    denies = [e for e in evts if e.get("result") == "DENY"]
    by_code = Counter(deny_code(e) for e in denies)
    last = _find_last(evts, lambda e: e.get("result") == "DENY")
    return {
        "deny_count": len(denies),
        "by_code": by_code.most_common(20),
        "last_deny": _fmt_line(last) if last else None,
    }

def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 9: operator audit scan (canonical sink reader).")
    ap.add_argument("--tail", type=int, default=0, help="Print last N events (normalized line format).")
    ap.add_argument("--denies", type=int, default=0, help="Print last N DENY events.")
    ap.add_argument("--deny-summary", action="store_true", help="Print deny code summary.")
    ap.add_argument("--last-arming", action="store_true", help="Print last arming event + age.")
    ap.add_argument("--last-live-attempt", action="store_true", help="Print last phase5 live attempt (incl backfill).")
    ap.add_argument("--events", type=str, default="", help="Filter events by substring.")
    ap.add_argument("--since-unix", type=int, default=None)
    ap.add_argument("--until-unix", type=int, default=None)
    ap.add_argument("--incident", type=int, default=None, help="Incident center unix timestamp.")
    ap.add_argument("--window-sec", type=int, default=300, help="Incident window seconds (default 300).")
    ap.add_argument("--stats", action="store_true", help="Print counts by event/phase/result.")
    ap.add_argument("--dedupe", action="store_true", help="View-only dedupe for repeated backfill artifacts.")
    ap.add_argument("--json", dest="as_json", action="store_true", help="Emit JSON instead of line format.")
    args = ap.parse_args()

    path = _sink_path()
    evts = _read_jsonl(path)

    evts = _filter_time(evts, since=args.since_unix, until=args.until_unix)
    if args.events:
        evts = _event_match(evts, args.events)
    if args.incident is not None:
        evts = _incident_slice(evts, center=int(args.incident), window_sec=int(args.window_sec))
    if args.dedupe:
        evts = _dedupe(evts)

    out: Dict[str, Any] = {"sink": str(path), "count": len(evts)}
    lines: List[str] = []

    if args.stats:
        out["stats"] = _stats(evts)

    if args.deny_summary:
        out["deny_summary"] = _deny_summary(evts)

    if args.last_arming:
        a = _last_arming(evts)
        if a:
            ts = effective_ts_unix(a)
            age = int(time.time() - int(ts)) if ts is not None else None
            out["last_arming"] = {"line": _fmt_line(a), "age_seconds": age}
        else:
            out["last_arming"] = None

    if args.last_live_attempt:
        l = _last_live_attempt(evts)
        if l:
            out["last_live_attempt"] = {"line": _fmt_line(l)}
        else:
            out["last_live_attempt"] = None

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
        if lines:
            for ln in lines:
                print(ln)
        else:
            # summary line so operator knows it ran
            print(f"sink={path} count={len(evts)} (use --tail/--denies/--stats/--deny-summary/--last-arming)")

    return 0

if __name__ == "__main__":
    raise SystemExit(main())
