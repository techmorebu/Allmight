#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]

PHASE_RE = re.compile(r"PHASE(\d+)_HANDOFF_PROMPT_PHASE(\d+)\.txt$")

def utc_now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

def latest_handoff() -> str | None:
    # Find the newest PHASE*_HANDOFF_PROMPT_PHASE*.txt anywhere under docs/
    docs = ROOT / "docs"
    candidates = list(docs.rglob("PHASE*_HANDOFF_PROMPT_PHASE*.txt"))
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return str(candidates[0].relative_to(ROOT))

def phase_dir(n: int) -> Path:
    return ROOT / f"docs/phase{n}"

def arch_delta_path(n: int) -> Path:
    return ROOT / f"docs/architecture/deltas/PHASE{n}_ARCH_DELTA.md"

def default_authoritative_files(phase_n: int) -> list[str]:
    # Minimal “always true” read order.
    # Operator can customize the packet after generation if needed.
    return [
        f"docs/phase{phase_n}/PHASE{phase_n}_HANDOFF_PROMPT_PHASE{phase_n+1}.txt",
        f"docs/phase{phase_n}/PHASE{phase_n}_OPERATOR_NOTES.txt",
        f"docs/build_notes/PHASE{phase_n}_BUILD_NOTES.txt",
        f"docs/bug_notes/PHASE{phase_n}_BUG_NOTES.txt",
    ]

def packet_text(phase_n: int) -> str:
    handoff = latest_handoff() or "(none discovered)"
    auth = default_authoritative_files(phase_n)
    arch_delta = str(arch_delta_path(phase_n).relative_to(ROOT))

    return f"""PHASE {phase_n} PACKET (AUTHORITATIVE)
==============================

As-of: {utc_now_str()}
Status: FROZEN when committed + pushed

0) NON-NEGOTIABLE ENTRY PROCEDURE
---------------------------------
Read (in order):
- docs/appendices/APPX_CHAT_RESPONSE_PROTOCOL.txt
- docs/appendices/APPX_PROJECT_RAPID_SCAN_PROTOCOL.txt
- docs/appendices/APPX_PHASE_PACKET_AND_ARCH_UPDATE_STANDARD.txt

Run:
- python tools/rapid_scan.py
- pytest -q

If any of the above is skipped, subsequent work is invalid.

1) AUTHORITATIVE FILES TO READ (ORDERED)
----------------------------------------
""" + "\n".join(auth) + f"""


2) ARCHITECTURE (READ THIS SO YOU DON'T LIE TO YOURSELF)
--------------------------------------------------------
- Architecture Delta (THIS PHASE): {arch_delta}
- Living Architecture (if present): docs/architecture/ARCHITECTURE.md
- Latest handoff discovered by scan: {handoff}

3) WHAT CHANGED IN THIS PHASE (SUMMARY)
---------------------------------------
(Write a crisp summary here. Keep it factual. 5–12 bullets.)

4) HARD INVARIANTS (CANNOT BE BROKEN)
-------------------------------------
- Network is default-deny.
- All live operations route through AdapterBroker.call.
- Allowlists are explicit and capability-scoped (no wildcards).
- Tests define behavior, not comments.
- No retries, no credentials, no write operations unless re-scoped explicitly.

5) NEXT PHASE BUILD PLAN (MUST BE EXPLICIT)
-------------------------------------------
(Write the next phase TODO list here, ordered. No vibes. No poetry.)

6) OPERATOR QUICKSTART (COPY/PASTE)
-----------------------------------
# Rapid orient
python tools/rapid_scan.py

# Sanity
pytest -q

# Style rule: create/patch files using python-writer pattern (no heredocs)
# Example:
# python - <<'PY'
# from pathlib import Path
# Path('path/to/file.txt').write_text('content', encoding='utf-8')
# PY

7) META
-------
If a future operator asks:
- "What do I read first?"
- "What changed architecturally?"
- "What must be built next?"
then this packet is incomplete.

END
"""

def main(argv: list[str]) -> int:
    if "--phase" not in argv:
        print("Usage: python tools/make_phase_packet.py --phase N", file=sys.stderr)
        return 2
    i = argv.index("--phase")
    try:
        phase_n = int(argv[i+1])
    except Exception:
        print("Invalid phase N", file=sys.stderr)
        return 2

    pdir = phase_dir(phase_n)
    pdir.mkdir(parents=True, exist_ok=True)
    out = pdir / f"PHASE{phase_n}_PACKET.txt"
    out.write_text(packet_text(phase_n), encoding="utf-8")
    print(f"Wrote: {out.relative_to(ROOT)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
