#!/usr/bin/env python3
from __future__ import annotations
from scripts.tools.repo_files import iter_repo_files

import argparse
from pathlib import Path

DEFAULT_ROOTS = [
    "tests",
    "docs",
    "allmight",
    "tools",
    "scripts",
    "config",
]

DEFAULT_GLOBS = [
    "**/*phase{n}*",
    "**/*PHASE{N}*",
    "**/*phase_{n}*",
    "**/*PHASE_{N}*",
    "**/phase{n}/**",
    "**/PHASE{N}/**",
    "**/phase{n}_*/**",
    "**/PHASE{N}_*/**",
]

EXCLUDE_DIRS = {".git", ".venv", "__pycache__", ".pytest_cache", "node_modules", "dist", "build"}

def iter_files(root: Path):
    for p in iter_repo_files(root):
        parts = set(p.parts)
        if parts & EXCLUDE_DIRS:
            continue
        yield p

def main() -> int:
    ap = argparse.ArgumentParser(description="Locate Phase WIP artifacts anywhere in the repo.")
    ap.add_argument("--phase", required=True, help="Phase number, e.g. 12")
    ap.add_argument("--roots", nargs="*", default=DEFAULT_ROOTS, help="Roots to scan (default: common repo dirs)")
    args = ap.parse_args()

    n = str(args.phase).strip()
    N = n  # same, but kept for template symmetry
    patterns = [g.format(n=n, N=N) for g in DEFAULT_GLOBS]

    found = set()
    for r in args.roots:
        root = Path(r)
        if not root.exists():
            continue

        # pattern-based (fast)
        for pat in patterns:
            for m in root.glob(pat):
                if any(x in m.parts for x in EXCLUDE_DIRS):
                    continue
                found.add(m)

        # content-based (reliable)
        needle1 = f"phase{n}"
        needle2 = f"PHASE{n}"
        for p in iter_files(root):
            if p.is_dir():
                continue
            s = str(p)
            if needle1 in s or needle2 in s:
                found.add(p)

    # Sort paths: dirs first, then files
    def key(p: Path):
        return (0 if p.is_dir() else 1, str(p))

    out = sorted(found, key=key)
    print(f"PHASE {n} — WIP LOCATOR")
    print("=" * 60)
    if not out:
        print("(none found)")
        return 0

    for p in out:
        print(str(p))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
