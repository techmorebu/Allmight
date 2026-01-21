from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from scripts.phase9.remedy_catalog import explain_code


def _get_effective_ts_unix(ev: dict) -> int:
    # Prefer original/raw timestamp if present (backfill keeps raw ts_unix).
    try:
        meta = ev.get("meta") or {}
        raw = meta.get("raw") or {}
        if "ts_unix" in raw:
            return int(raw["ts_unix"])
        if "ts_unix" in ev:
            return int(ev["ts_unix"])
    except Exception:
        return 0
    return 0


def _extract_deny_code(ev: dict) -> str:
    # DENY codes may appear in multiple places depending on schema evolution.
    # Prefer the original/raw code for backfilled events:
    #   meta.raw.deny_code
    #
    # If no code is found, return UNKNOWN_DENY_CODE (never None).
    meta = ev.get("meta") or {}
    raw = meta.get("raw") or {}

    # Most likely (observed in outputs/audit/allmight_audit.jsonl):
    v = raw.get("deny_code")
    if isinstance(v, str) and v.strip():
        return v.strip()

    # Compatibility fallbacks (older patterns):
    v = raw.get("code")
    if isinstance(v, str) and v.strip():
        return v.strip()

    v = ev.get("code")
    if isinstance(v, str) and v.strip():
        return v.strip()

    v = meta.get("code")
    if isinstance(v, str) and v.strip():
        return v.strip()

    # As a last resort, if a deny "reason" exists and is string-like:
    v = raw.get("deny_reason")
    if isinstance(v, str) and v.strip():
        return v.strip()

    return "UNKNOWN_DENY_CODE"



def _fmt_line(ev: dict) -> str:
    # Unified, operator-readable line format.
    # Includes effective timestamp (raw ts_unix preferred), result, phase, event, code (if DENY), git.
    tsu = _get_effective_ts_unix(ev)
    result = str(ev.get("result", ""))
    phase = str(ev.get("phase", ""))
    event = str(ev.get("event", ""))
    git = str(ev.get("git_head", ""))

    code = ""
    if result == "DENY":
        code = _extract_deny_code(ev)

    parts = [str(tsu), result, phase, event]
    if code:
        parts.append(f"code={code}")
    if git:
        parts.append(f"git={git}")
    return "\t".join(parts)

    # Most likely (per observed event):
    if isinstance(raw.get("deny_code"), str) and raw["deny_code"]:
        return raw["deny_code"]

    # Compatibility fallbacks:
    if isinstance(raw.get("code"), str) and raw["code"]:
        return raw["code"]
    if isinstance(ev.get("code"), str) and ev["code"]:
        return ev["code"]
    if isinstance(meta.get("code"), str) and meta["code"]:
        return meta["code"]
    if isinstance(raw.get("reason_code"), str) and raw["reason_code"]:
        return raw["reason_code"]

    return "UNKNOWN_DENY_CODE"


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    if not path.exists():
        return []
    out: List[Dict[str, Any]] = []
    for ln in path.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def _event_ts_unix(ev: Dict[str, Any]) -> int:
    # Prefer raw ts_unix; fall back to 0.
    v = ev.get("ts_unix")
    try:
        return int(v)
    except Exception:
        return 0


def _norm_line(ev: Dict[str, Any]) -> str:
    tsu = _event_ts_unix(ev)
    res = ev.get("result", "UNKNOWN")
    phase = ev.get("phase", "UNKNOWN")
    event = ev.get("event", "UNKNOWN")
    code = ""
    meta = ev.get("meta") or {}
    if isinstance(meta, dict) and "code" in meta:
        code = f"\tcode={meta.get('code')}"
    git_head = ev.get("git_head")
    git_s = f"\tgit={git_head}" if git_head else ""
    return f"{tsu}\t{res}\t{phase}\t{event}{code}{git_s}"


def _deny_code(ev: Dict[str, Any]) -> str | None:
    meta = ev.get("meta") or {}
    if isinstance(meta, dict):
        c = meta.get("code")
        if isinstance(c, str) and c:
            return c
    return None


def _summarize(events: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_result: Dict[str, int] = {}
    by_event: Dict[str, int] = {}
    by_phase: Dict[str, int] = {}
    deny_codes: Dict[str, int] = {}

    for ev in events:
        by_result[str(ev.get("result", "UNKNOWN"))] = by_result.get(str(ev.get("result", "UNKNOWN")), 0) + 1
        by_event[str(ev.get("event", "UNKNOWN"))] = by_event.get(str(ev.get("event", "UNKNOWN")), 0) + 1
        by_phase[str(ev.get("phase", "UNKNOWN"))] = by_phase.get(str(ev.get("phase", "UNKNOWN")), 0) + 1
        if str(ev.get("result")) == "DENY":
            code = _deny_code(ev) or "UNKNOWN_DENY_CODE"
            deny_codes[code] = deny_codes.get(code, 0) + 1

    def topk(d: Dict[str, int], k: int = 10) -> List[Tuple[str, int]]:
        return sorted(d.items(), key=lambda x: (-x[1], x[0]))[:k]

    return {
        "count": len(events),
        "by_result": topk(by_result, 50),
        "top_events": topk(by_event, 10),
        "top_phases": topk(by_phase, 10),
        "deny_codes": topk(deny_codes, 50),
    }


def _render_remedies(deny_codes: List[str]) -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("DENY EXPLANATIONS + REMEDIES (operator-friendly)")
    lines.append("------------------------------------------------------------")
    if not deny_codes:
        lines.append("(No DENY codes in this window)")
        return "\n".join(lines) + "\n"

    for code in sorted(set(deny_codes)):
        rem = explain_code(code)
        if rem is None:
            lines.append(f"CODE: {code}")
            lines.append("Meaning: (no mapping yet)")
            lines.append("Immediate actions:")
            lines.append("  - Add a mapping in scripts/phase9/remedy_catalog.py")
            lines.append("")
            continue

        lines.append(f"CODE: {rem.code} :: {rem.title}")
        lines.append(f"Meaning: {rem.meaning}")
        if rem.why_it_happens:
            lines.append("Why it happens:")
            for x in rem.why_it_happens:
                lines.append(f"  - {x}")
        if rem.immediate_actions:
            lines.append("Immediate actions:")
            for x in rem.immediate_actions:
                lines.append(f"  - {x}")
        if rem.verification_commands:
            lines.append("Verification commands:")
            for x in rem.verification_commands:
                lines.append(f"  $ {x}")
        if rem.escalation:
            lines.append("Escalation:")
            for x in rem.escalation:
                lines.append(f"  - {x}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def build_report(
    sink: Path,
    center_unix: int,
    window_sec: int,
    dedupe: bool = False,
) -> Tuple[str, Path]:
    all_events = _read_jsonl(sink)
    lo = int(center_unix) - int(window_sec)
    hi = int(center_unix) + int(window_sec)

    window = [ev for ev in all_events if lo <= _event_ts_unix(ev) <= hi]
    window.sort(key=_event_ts_unix)

    if dedupe:
        seen = set()
        deduped = []
        for ev in window:
            key = (_event_ts_unix(ev), ev.get("result"), ev.get("phase"), ev.get("event"), _deny_code(ev))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(ev)
        window = deduped

    summary = _summarize(window)
    deny_codes = [c for (c, n) in summary["deny_codes"]]

    now_utc = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    lines: List[str] = []
    lines.append("ALLMIGHT AUDIT INCIDENT REPORT (PHASE9) — EXPLAINED")
    lines.append("=" * 60)
    lines.append(f"as_of_utc: {now_utc}")
    lines.append(f"sink: {sink.as_posix()}")
    lines.append(f"center_unix: {center_unix}")
    lines.append(f"window_sec: {window_sec}")
    lines.append(f"range: [{lo}, {hi}]")
    lines.append("")
    lines.append("SUMMARY")
    lines.append("-" * 60)
    lines.append(f"count: {summary['count']}")
    lines.append(f"by_result: {summary['by_result']}")
    lines.append("top_events:")
    for k, v in summary["top_events"]:
        lines.append(f"  - {k}: {v}")
    lines.append("top_phases:")
    for k, v in summary["top_phases"]:
        lines.append(f"  - {k}: {v}")

    if summary["deny_codes"]:
        lines.append("")
        lines.append("DENY BREAKDOWN")
        lines.append("-" * 60)
        for k, v in summary["deny_codes"]:
            lines.append(f"  - {k}: {v}")

    lines.append(_render_remedies(deny_codes))

    lines.append("TIMELINE (normalized)")
    lines.append("-" * 60)
    for ev in window:
        lines.append(_fmt_line(ev))

    out_dir = Path("outputs/phase9/incidents")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"incident_explained_{center_unix}_{window_sec}sec.txt"
    report = "\n".join(lines).rstrip() + "\n"
    out_path.write_text(report, encoding="utf-8")
    return report, out_path


def _find_last_by_result(sink: Path, want_result: str) -> int | None:
    evs = _read_jsonl(sink)
    # scan reverse, pick first matching with ts_unix
    for ev in reversed(evs):
        if str(ev.get("result")) != want_result:
            continue
        tsu = _event_ts_unix(ev)
        if tsu > 0:
            return tsu
    return None


def _find_last_live_attempt(sink: Path) -> int | None:
    evs = _read_jsonl(sink)
    for ev in reversed(evs):
        if "LIVE" in str(ev.get("event", "")) and _event_ts_unix(ev) > 0:
            return _event_ts_unix(ev)
    return None


def _find_last_arming(sink: Path) -> int | None:
    evs = _read_jsonl(sink)
    for ev in reversed(evs):
        if "ARMING" in str(ev.get("event", "")) and _event_ts_unix(ev) > 0:
            return _event_ts_unix(ev)
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate an operator-friendly explained incident report from the canonical audit sink.")
    ap.add_argument("--sink", default="outputs/audit/allmight_audit.jsonl")
    ap.add_argument("--center-unix", type=int, default=0, help="Center ts_unix for the incident window.")
    ap.add_argument("--window-sec", type=int, default=600)
    ap.add_argument("--dedupe", action="store_true")
    ap.add_argument("--print", dest="do_print", action="store_true")

    g = ap.add_mutually_exclusive_group()
    g.add_argument("--last-deny", action="store_true")
    g.add_argument("--last-live-attempt", action="store_true")
    g.add_argument("--last-arming", action="store_true")

    args = ap.parse_args()
    sink = Path(args.sink)

    center = int(args.center_unix)
    if args.last_deny:
        v = _find_last_by_result(sink, "DENY")
        if v is None:
            raise SystemExit("No DENY event found in sink")
        center = v
    elif args.last_live_attempt:
        v = _find_last_live_attempt(sink)
        if v is None:
            raise SystemExit("No LIVE attempt found in sink")
        center = v
    elif args.last_arming:
        v = _find_last_arming(sink)
        if v is None:
            raise SystemExit("No ARMING event found in sink")
        center = v

    if center <= 0:
        raise SystemExit("Provide --center-unix or use --last-deny/--last-live-attempt/--last-arming")

    report, out_path = build_report(sink, center, int(args.window_sec), dedupe=bool(args.dedupe))
    if args.do_print:
        print(report.rstrip())
        print("")
        print(out_path.as_posix())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
