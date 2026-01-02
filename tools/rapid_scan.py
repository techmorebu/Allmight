#!/usr/bin/env python3
"""
AllMight Rapid Scan

Goals:
- Single-command operator sanity check
- Deterministic output
- No network, no writes beyond stdout
- Phase-aware "latest handoff" discovery (semantic, not mtime)

This script is intentionally boring.
Boring is safe.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import List, Optional, Tuple


# -----------------------------
# Utils
# -----------------------------

def _run(cmd: List[str]) -> Tuple[int, str]:
    """Run a command, returning (returncode, combined_output)."""
    p = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return p.returncode, (p.stdout or "").rstrip()


def _utc_now_str() -> str:
    # Avoid datetime import churn; date is enough for ops display.
    # We keep it simple and rely on `date -u` for authoritative timestamp.
    rc, out = _run(["date", "-u", "+%Y-%m-%d %H:%M UTC"])
    return out if rc == 0 and out else "(utc time unavailable)"


def _iter_handoff_files() -> List[Path]:
    """
    Find handoff prompts anywhere in docs/phase*/ matching:
      docs/phaseX/PHASEX_HANDOFF_PROMPT_PHASEY.txt
    """
    root = Path("docs")
    if not root.exists():
        return []
    return sorted(root.glob("phase*/PHASE*_HANDOFF_PROMPT_PHASE*.txt"))


def _parse_phase_from_name(name: str) -> Optional[int]:
    """
    Extract PHASE<number> from a filename like:
      PHASE11_HANDOFF_PROMPT_PHASE12.txt
    Returns 11, or None.
    """
    m = re.match(r"^PHASE(\d+)_HANDOFF_PROMPT_PHASE(\d+)\.txt$", name)
    if not m:
        return None
    return int(m.group(1))


def _latest_handoff_by_phase() -> str:
    """
    Determine "latest" handoff by PHASE number, not mtime.
    """
    best: Optional[Path] = None
    best_phase = -1
    for p in _iter_handoff_files():
        ph = _parse_phase_from_name(p.name)
        if ph is None:
            continue
        if ph > best_phase:
            best_phase = ph
            best = p
    return str(best) if best else "NONE FOUND"


def _authoritative_files_for_handoff(handoff_path: str) -> List[str]:
    """
    Return authoritative files to read, based on the discovered handoff.
    Convention:
      - Always include the latest handoff
      - Include operator notes for that phase if present

    We keep this deterministic and minimal; phases can add more via appendices.
    """
    if handoff_path == "NONE FOUND":
        return []

    hp = Path(handoff_path)
    phase_dir = hp.parent  # docs/phaseNN
    out: List[str] = [handoff_path]

    # Operator notes typically live beside the handoff.
    # We prefer exact match: PHASE{N}_OPERATOR_NOTES.txt
    ph = _parse_phase_from_name(hp.name)
    if ph is not None:
        op = phase_dir / f"PHASE{ph}_OPERATOR_NOTES.txt"
        if op.exists():
            out.append(str(op))

    return out


def _appendices_list() -> List[str]:
    root = Path("docs/appendices")
    if not root.exists():
        return []
    # Print relative paths for consistency in operator notes.
    files = sorted(root.glob("*.txt"))
    return [str(p) for p in files]


def _phase11_authoritative_overlay() -> List[str]:
    """
    Phase 11 requested an explicit overlay section in rapid_scan output.
    These files may not exist early in Phase 11, but listing them helps operators.
    """
    return [
        "docs/phase11/PHASE11_HANDOFF_PROMPT_PHASE12.txt",
        "docs/phase11/PHASE11_OPERATOR_NOTES.txt",
        "docs/build_notes/PHASE11_BUILD_NOTES.txt",
        "docs/bug_notes/PHASE11_BUG_NOTES.txt",
    ]


# -----------------------------
# Main
# -----------------------------

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
        print("(git error)")
        print(out)
    else:
        print("(clean)" if out.strip() == "" else out)
    print("")

    # 2) Test status
    print("2) TEST STATUS (pytest -q)")
    print("-" * 20)
    rc, out = _run(["pytest", "-q"])
    if rc == 0:
        print(out)
    else:
        print(out)
        print("")
        print("NOTE: tests failed; rapid scan is non-authoritative until green.")
    print("")

    # 3) Current phase
    print("3) CURRENT PHASE")
    print("-" * 20)
    handoff = _latest_handoff_by_phase()
    print(f"Latest handoff: {handoff}")
    print("")

    # 4) Authoritative files (phase-aware)
    print("4) AUTHORITATIVE FILES TO READ")
    print("-" * 20)
    auth = _authoritative_files_for_handoff(handoff)
    if auth:
        for p in auth:
            print(p)
    else:
        print("(none discovered)")
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

    # 5.5) Phase 11 overlay
    print("5.5) PHASE 11 — AUTHORITATIVE FILES TO READ")
    print("-" * 42)
    for p in _phase11_authoritative_overlay():
        print(p)
    print("")

    # 6) Meta
    print("6) META")
    print("-" * 20)
    print("If anything above is unclear, the handoff or appendices are incomplete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
