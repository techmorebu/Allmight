from __future__ import annotations

from pathlib import Path
import re
import subprocess


def _git_root() -> Path:
    return Path(subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip())


def _tracked_files() -> list[str]:
    return subprocess.check_output(["git", "ls-files"], text=True).splitlines()


def test_repo_scan_safety_no_raw_traversal() -> None:
    """
    Guardrail: repo-wide ban on raw filesystem traversal primitives that can enter vendor dirs
    and trigger hard failures (e.g., Errno 74 on unreadable node_modules entries).

    Allowed: traversal ONLY via scripts.tools.repo_files.iter_repo_files
    Exception: os.walk may exist ONLY inside scripts/tools/repo_files.py (as a hardened fallback).
    """
    root = _git_root()
    files = _tracked_files()

        # FORBIDDEN_TOKEN_BUILD:
    # Build forbidden tokens without embedding exact substrings that would cause this test
    # to match itself. This keeps enforcement strict while avoiding self-trigger.
    _tok_path_rglob = "Path." + "rglob("
    _tok_dot_rglob = "." + "rglob("
    _tok_os_walk = "os." + "walk("

    deny = [
        (re.compile(r"\b" + re.escape(_tok_path_rglob)), _tok_path_rglob),
        (re.compile(re.escape(_tok_dot_rglob)), _tok_dot_rglob),
        (re.compile(r"\b" + re.escape(_tok_os_walk)), _tok_os_walk),
    ]

    allow_os_walk_in = {"scripts/tools/repo_files.py"}

    offenders: list[tuple[str, str]] = []
    for rel in files:
        if not rel.endswith(".py"):
            continue
        p = root / rel
        s = p.read_text(encoding="utf-8", errors="replace")

        for rx, label in deny:
            if label == _tok_os_walk and rel in allow_os_walk_in:
                continue
            if rx.search(s):
                offenders.append((rel, label))

    assert not offenders, "Forbidden traversal primitives found: " + ", ".join([f"{f}:{k}" for f, k in offenders])
