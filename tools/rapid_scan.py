#!/usr/bin/env python3
"""
Allmight Rapid Scan Utility (authoritative)

Purpose:
- Provide a fast, zero-guesswork snapshot of repo health and phase context.
- MUST be safe: read-only operations only (git status, pytest, file listing).
- No network.
- No credentials.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import glob
import subprocess
import sys
from typing import List, Tuple


ROOT = Path(__file__).resolve().parents[1]


def _utc_now_str() -> str:
    # Format to match existing docs: "YYYY-MM-DD HH:MM UTC"
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d %H:%M UTC")


def _run(cmd: List[str]) -> Tuple[int, str]:
    """Run a command safely and capture combined output."""
    try:
        p = subprocess.run(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
        return p.returncode, (p.stdout or "")
    except FileNotFoundError:
        return 127, f"ERROR: command not found: {cmd[0]}\n"
    except Exception as e:
        return 1, f"ERROR: exception running {cmd!r}: {e}\n"


def _print_header() -> None:
    print("ALLMIGHT RAPID SCAN")
    print("=" * 60)
    print(f"As-of: {_utc_now_str()}")
    print("")


def _section(title: str) -> None:
    print(title)
    print("-" * 20)


def _latest_handoff_path() -> str:
    # Canonical handoffs: docs/phase*/PHASE*_HANDOFF_PROMPT_*.txt
    candidates = glob.glob(str(ROOT / "docs" / "phase*" / "PHASE*_HANDOFF_PROMPT_*.txt"))
    if not candidates:
        return "NONE FOUND (docs/phase*/PHASE*_HANDOFF_PROMPT_*.txt)"
    # Prefer newest by mtime
    newest = max(candidates, key=lambda s: Path(s).stat().st_mtime)
    # Print repo-relative
    return str(Path(newest).resolve().relative_to(ROOT))


def _phase_from_handoff(handoff_rel: str) -> str:
    # docs/phase9/... -> "9"
    parts = Path(handoff_rel).parts
    for part in parts:
        if part.startswith("phase") and part[5:].isdigit():
            return part[5:]
    return "UNKNOWN"


def _authoritative_phase_files(phase_num: str) -> List[str]:
    # Conservative: list a few likely authoritative phase files if they exist.
    # We avoid guessing content and only list existing files.
    phase_dir = ROOT / f"docs/phase{phase_num}"
    if not phase_dir.exists():
        return []
    preferred = [
        phase_dir / f"PHASE{phase_num}_HANDOFF_PROMPT_PHASE{int(phase_num)+1}.txt" if phase_num.isdigit() else None,
        phase_dir / f"PHASE{phase_num}_ARCHITECTURE_READONLY_LIVE.txt" if phase_num.isdigit() else None,
        phase_dir / f"PHASE{phase_num}_OPERATOR_NOTES.txt" if phase_num.isdigit() else None,
        phase_dir / f"PHASE{phase_num}_TEST_PLAN_NEGATIVE_CASES.txt" if phase_num.isdigit() else None,
    ]
    out: List[str] = []
    for f in preferred:
        if f is None:
            continue
        if f.exists():
            out.append(str(f.relative_to(ROOT)))
    # Fallback: list any PHASE{n}_*.txt if preferred list is empty
    if not out:
        for f in sorted(phase_dir.glob(f"PHASE{phase_num}_*.txt")):
            out.append(str(f.relative_to(ROOT)))
    return out


def _appendices_list() -> List[str]:
    appx_dir = ROOT / "docs" / "appendices"
    if not appx_dir.exists():
        return []
    return [str(p.relative_to(ROOT)) for p in sorted(appx_dir.glob("APPX_*.txt"))]


def main() -> int:
    _print_header()

    # 1) Git status
    print("1) GIT STATUS")
    print("-" * 20)
    rc, out = _run(["git", "status", "--porcelain=v1"])
    if rc != 0:
        print(out.rstrip())
    else:
        out = out.strip()
        print(out if out else "(clean)")
    print("")

    # 2) Test status
    print("2) TEST STATUS (pytest -q)")
    print("-" * 20)
    rc, out = _run(["pytest", "-q"])
    print(out.rstrip())
    print("")

    # 3) Current phase (latest handoff)
    print("3) CURRENT PHASE")
    print("-" * 20)
    handoff = _latest_handoff_path()
    print(f"Latest handoff: {handoff}")
    print("")

    # 4) Authoritative files to read
    print("4) AUTHORITATIVE FILES TO READ")
    print("-" * 20)
    phase_num = _phase_from_handoff(handoff)
    files = _authoritative_phase_files(phase_num) if phase_num.isdigit() else []
    if files:
        for f in files:
            print(f)
    else:
        # At minimum, always include the latest handoff if present.
        if "NONE FOUND" not in handoff:
            print(handoff)
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

    # 5.5) Phase 11 authoritative files

    print("5.5) PHASE 11 — AUTHORITATIVE FILES TO READ")

    print('-' * 42)

    print("docs/phase11/PHASE11_HANDOFF_PROMPT_PHASE12.txt")

    print("docs/phase11/PHASE11_OPERATOR_NOTES.txt")

    print("docs/build_notes/PHASE11_BUILD_NOTES.txt")

    print("docs/bug_notes/PHASE11_BUG_NOTES.txt")

    print("")


    # 6) Meta

    print("6) META")
    print("-" * 20)
    print("If anything above is unclear, the handoff or appendices are incomplete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
