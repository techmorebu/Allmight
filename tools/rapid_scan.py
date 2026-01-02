#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple


ROOT = Path(__file__).resolve().parents[1]


def _utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _run(cmd: List[str]) -> Tuple[int, str]:
    p = subprocess.run(
        cmd,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return p.returncode, (p.stdout or "").rstrip("\n")


def _safe_rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except Exception:
        return str(p)


def _glob_latest(pattern: str) -> Optional[Path]:
    hits = sorted(ROOT.glob(pattern), key=lambda p: p.stat().st_mtime, reverse=True)
    return hits[0] if hits else None


def _latest_handoff() -> str:
    # Prefer phase handoffs; newest mtime wins.
    p = _glob_latest("docs/phase*/PHASE*_HANDOFF_PROMPT_PHASE*.txt")
    if not p:
        return "NONE FOUND"
    return _safe_rel(p)


def _infer_phase_from_handoff(rel_path: str) -> Optional[int]:
    # docs/phase11/PHASE11_HANDOFF_PROMPT_PHASE12.txt -> 11
    m = re.search(r"docs/phase(\d+)/", rel_path)
    if m:
        try:
            return int(m.group(1))
        except Exception:
            return None
    return None


def _appendices_list() -> List[str]:
    appx_dir = ROOT / "docs" / "appendices"
    if not appx_dir.exists():
        return []
    out = []
    for p in sorted(appx_dir.glob("*.txt")):
        out.append(_safe_rel(p))
    return out


def _phase_dir(phase: int) -> Path:
    return ROOT / "docs" / f"phase{phase}"


def _phase_authoritative_files(phase: int) -> List[str]:
    out: List[str] = []

    # Primary: phase handoff + operator notes in phase dir
    pd = _phase_dir(phase)
    if pd.exists():
        handoff = _glob_latest(f"docs/phase{phase}/PHASE{phase:02d}_HANDOFF_PROMPT_PHASE*.txt") or \
                 _glob_latest(f"docs/phase{phase}/PHASE{phase}_HANDOFF_PROMPT_PHASE*.txt")
        if handoff:
            out.append(_safe_rel(handoff))

        # operator notes (exact) else any operator notes
        op_exact = pd / f"PHASE{phase:02d}_OPERATOR_NOTES.txt"
        if op_exact.exists():
            out.append(_safe_rel(op_exact))
        else:
            ops = sorted(pd.glob("*OPERATOR_NOTES*.txt"))
            out.extend(_safe_rel(x) for x in ops)

    # Build/bug notes (standard locations)
    bn = ROOT / "docs" / "build_notes" / f"PHASE{phase:02d}_BUILD_NOTES.txt"
    if bn.exists():
        out.append(_safe_rel(bn))
    bn2 = ROOT / "docs" / "build_notes" / f"PHASE{phase}_BUILD_NOTES.txt"
    if bn2.exists() and _safe_rel(bn2) not in out:
        out.append(_safe_rel(bn2))

    bug = ROOT / "docs" / "bug_notes" / f"PHASE{phase:02d}_BUG_NOTES.txt"
    if bug.exists():
        out.append(_safe_rel(bug))
    bug2 = ROOT / "docs" / "bug_notes" / f"PHASE{phase}_BUG_NOTES.txt"
    if bug2.exists() and _safe_rel(bug2) not in out:
        out.append(_safe_rel(bug2))

    # De-dup preserving order
    seen = set()
    uniq = []
    for x in out:
        if x not in seen:
            seen.add(x)
            uniq.append(x)
    return uniq


def _authoritative_files() -> List[str]:
    handoff = _latest_handoff()
    if handoff == "NONE FOUND":
        return []

    phase = _infer_phase_from_handoff(handoff)
    if phase is None:
        # fallback: just show handoff
        return [handoff]

    return _phase_authoritative_files(phase)


def _latest_phase_packet() -> Optional[str]:
    # Accept either:
    # - docs/phase*/PHASE*_PHASE_PACKET.* (new standard)
    # - docs/phase*/PHASE*_PACKET.*
    p = _glob_latest("docs/phase*/PHASE*_PHASE_PACKET.*") or _glob_latest("docs/phase*/PHASE*_PACKET.*")
    return _safe_rel(p) if p else None


def _latest_arch_delta() -> Optional[str]:
    p = _glob_latest("docs/architecture/deltas/*.md") or _glob_latest("docs/architecture/deltas/*.txt")
    return _safe_rel(p) if p else None


def main() -> int:
    print("ALLMIGHT RAPID SCAN")
    print("=" * 60)
    print(f"As-of: {_utc_now_str()}")
    print("")

    # 1) Git status
    print("1) GIT STATUS")
    print("-" * 20)
    rc, out = _run(["git", "status", "--porcelain"])
    if rc != 0:
        print("(git status failed)")
        print(out)
    else:
        print("(clean)" if not out.strip() else out)
    print("")

    # 2) Tests
    print("2) TEST STATUS (pytest -q)")
    print("-" * 20)
    rc, out = _run(["pytest", "-q"])
    if rc != 0:
        # Print whatever we got (might be empty if pytest crashed early)
        if out.strip():
            print(out)
        print("")
        print("NOTE: tests failed; rapid scan is non-authoritative until green.")
    else:
        print(out)
    print("")

    # 3) Current phase
    print("3) CURRENT PHASE")
    print("-" * 20)
    handoff = _latest_handoff()
    print(f"Latest handoff: {handoff}")
    print("")

    # 4) Authoritative files
    print("4) AUTHORITATIVE FILES TO READ")
    print("-" * 20)
    auth = _authoritative_files()
    if auth:
        for f in auth:
            print(f)
    else:
        print("(none discovered)")
    print("")

    # 4.5) Phase packet + arch delta
    print("4.5) PHASE PACKET + ARCHITECTURE DELTA (IF PRESENT)")
    print("-" * 20)
    pkt = _latest_phase_packet()
    print(pkt if pkt else "(no phase packet found)")
    delta = _latest_arch_delta()
    print(delta if delta else "(no architecture delta found)")
    print("")

    # 5) Appendices
    print("5) APPENDICES (MANDATORY)")
    print("-" * 20)
    appx = _appendices_list()
    if appx:
        for a in appx:
            print(a)
    else:
        print("(none found)")
    print("")

    # 6) Meta
    print("6) META")
    print("-" * 20)
    print("If anything above is unclear, the handoff or appendices are incomplete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
