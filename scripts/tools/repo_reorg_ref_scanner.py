#!/usr/bin/env python3
"""
repo_reorg_ref_scanner.py

Companion to repo_reorg_surface_phase.py.

After running --apply, some files moved from scripts/tools/ into
scripts/discovery/ or scripts/validators/. Any require(), import,
README command example, or handoff doc that referenced the old path
now points to a stale location.

This script finds every such stale reference and prints a patch checklist.

Usage:
    python scripts/tools/repo_reorg_ref_scanner.py
    python scripts/tools/repo_reorg_ref_scanner.py --root /path/to/repo
    python scripts/tools/repo_reorg_ref_scanner.py --json
    python scripts/tools/repo_reorg_ref_scanner.py --fix    (writes patched files)

Safety:
    --fix rewrites files in-place using exact string substitution only.
    It does not use regex. It does not touch files that have no matches.
    It writes a backup (.bak) alongside each modified file before patching.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Sequence, Tuple


SCRIPT_NAME = "repo_reorg_ref_scanner.py"

# ─────────────────────────────────────────────────────────────────────────────
# Move map — must exactly match MOVES in repo_reorg_surface_phase.py
# ─────────────────────────────────────────────────────────────────────────────

MOVE_MAP: Sequence[Tuple[str, str]] = (
    # (old_relative_path,                        new_relative_path)
    ("scripts/tools/find_arb_usdc_pools.js",    "scripts/discovery/find_arb_usdc_pools.js"),
    ("scripts/tools/arb_pool_smoke_test.js",    "scripts/discovery/arb_pool_smoke_test.js"),
    ("scripts/tools/arb_pool_smoke_test_p2.js", "scripts/discovery/arb_pool_smoke_test_p2.js"),
    ("scripts/tools/spread_validator.js",       "scripts/validators/spread_validator.js"),
    ("scripts/tools/arb_direct_validator.js",   "scripts/validators/arb_direct_validator.js"),
    ("scripts/tools/arb_synthetic_validator.js","scripts/validators/arb_synthetic_validator.js"),
    ("scripts/tools/wbtc_spread_validator.js",  "scripts/validators/wbtc_spread_validator.js"),
    ("scripts/tools/arb_slippage_model.js",     "scripts/validators/arb_slippage_model.js"),
)

# Extensions to scan
SCAN_EXTENSIONS = {
    ".js", ".ts", ".mjs", ".cjs",
    ".py",
    ".md", ".txt", ".json", ".yaml", ".yml", ".sh",
}

# Directories to skip entirely
SKIP_DIRS = {
    "node_modules", ".git", "cache", ".nyc_output",
    "__pycache__", ".pytest_cache", "dist", "build",
}


# ─────────────────────────────────────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class Hit:
    file: str
    line_number: int
    line: str
    old_path: str
    new_path: str


@dataclass
class FileResult:
    file: str
    hits: List[Hit] = field(default_factory=list)
    patched: bool = False
    backup: str = ""
    patch_error: str = ""


@dataclass
class ScanReport:
    generated_at_utc: str
    repo_root: str
    mode: str
    files_scanned: int = 0
    files_with_hits: int = 0
    total_hits: int = 0
    results: List[FileResult] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def should_skip(path: Path) -> bool:
    for part in path.parts:
        if part in SKIP_DIRS:
            return True
    return False


def scan_file(path: Path, repo_root: Path) -> List[Hit]:
    hits: List[Hit] = []
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return hits

    rel = path.relative_to(repo_root).as_posix()
    lines = text.splitlines()

    for old_path, new_path in MOVE_MAP:
        # Match both forward-slash and the bare filename in various reference styles:
        #   require('./scripts/tools/arb_direct_validator')
        #   require('../tools/arb_direct_validator')
        #   node scripts/tools/arb_direct_validator.js
        #   scripts/tools/arb_direct_validator.js   (in markdown)
        filename = old_path.split("/")[-1]
        stem = filename.rsplit(".", 1)[0]   # without extension

        for i, line in enumerate(lines, start=1):
            # Check for old_path substring first (most precise)
            if old_path in line:
                hits.append(Hit(
                    file=rel,
                    line_number=i,
                    line=line.rstrip(),
                    old_path=old_path,
                    new_path=new_path,
                ))
            # Also catch bare stem references like require('.../arb_direct_validator')
            # but only when the old directory is also present
            elif "scripts/tools/" in line and (filename in line or stem in line):
                hits.append(Hit(
                    file=rel,
                    line_number=i,
                    line=line.rstrip(),
                    old_path=old_path,
                    new_path=new_path,
                ))

    return hits


def patch_file(path: Path, file_result: FileResult) -> None:
    """
    Replace all stale old_path occurrences with new_path in the file.
    Writes a .bak backup first. Uses exact string substitution only.
    """
    try:
        original = path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        file_result.patch_error = f"read failed: {e}"
        return

    backup_path = path.with_suffix(path.suffix + ".bak")
    try:
        shutil.copy2(path, backup_path)
        file_result.backup = backup_path.name
    except Exception as e:
        file_result.patch_error = f"backup failed: {e}"
        return

    patched = original
    for old_path, new_path in MOVE_MAP:
        patched = patched.replace(old_path, new_path)

    if patched == original:
        file_result.patch_error = "no changes after substitution (may need manual review)"
        return

    try:
        path.write_text(patched, encoding="utf-8", newline="\n")
        file_result.patched = True
    except Exception as e:
        file_result.patch_error = f"write failed: {e}"


def build_markdown_report(report: ScanReport) -> str:
    lines: List[str] = []
    lines.append("# Repo Reorg Reference Scanner Report")
    lines.append("")
    lines.append(f"- Mode: `{report.mode}`")
    lines.append(f"- Repo Root: `{report.repo_root}`")
    lines.append(f"- Generated At (UTC): `{report.generated_at_utc}`")
    lines.append(f"- Files Scanned: {report.files_scanned}")
    lines.append(f"- Files With Hits: {report.files_with_hits}")
    lines.append(f"- Total Hits: {report.total_hits}")
    lines.append("")

    if not report.results:
        lines.append("## Result")
        lines.append("")
        lines.append("No stale references found. All clear.")
        lines.append("")
        return "\n".join(lines)

    lines.append("## Stale References Found")
    lines.append("")

    for fr in report.results:
        lines.append(f"### `{fr.file}`")
        if fr.patched:
            lines.append(f"  - **PATCHED** (backup: `{fr.backup}`)")
        elif fr.patch_error:
            lines.append(f"  - **PATCH ERROR**: {fr.patch_error}")
        lines.append("")

        for h in fr.hits:
            lines.append(f"  Line {h.line_number}:")
            lines.append(f"  ```")
            lines.append(f"  {h.line}")
            lines.append(f"  ```")
            lines.append(f"  Replace: `{h.old_path}` → `{h.new_path}`")
            lines.append("")

    if report.notes:
        lines.append("## Notes")
        lines.append("")
        for note in report.notes:
            lines.append(f"- {note}")
        lines.append("")

    return "\n".join(lines)


def print_summary(report: ScanReport) -> None:
    W = 72
    print()
    print("=" * W)
    print(f"  AllMight Repo Ref Scanner  |  mode={report.mode}")
    print(f"  Root: {report.repo_root}")
    print("-" * W)
    print(f"  Files scanned:     {report.files_scanned}")
    print(f"  Files with hits:   {report.files_with_hits}")
    print(f"  Total hits:        {report.total_hits}")
    print("-" * W)

    if not report.results:
        print("  All clear -- no stale references found.")
    else:
        for fr in report.results:
            status = "PATCHED" if fr.patched else ("ERROR" if fr.patch_error else "NEEDS FIX")
            print(f"  [{status}] {fr.file}  ({len(fr.hits)} hit(s))")
            for h in fr.hits:
                print(f"    L{h.line_number}: {h.old_path} -> {h.new_path}")
        if report.mode == "scan":
            print()
            print("  Run with --fix to auto-patch these references.")
            print("  Backups will be written alongside each modified file.")

    print("=" * W)
    print()


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan for stale path references after repo_reorg_surface_phase --apply."
    )
    parser.add_argument("--root",  type=str, default=".", help="Repo root (default: cwd)")
    parser.add_argument("--json",  action="store_true",   help="Print JSON report to stdout")
    parser.add_argument("--fix",   action="store_true",   help="Patch stale references in-place (writes .bak backups)")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.root).resolve()

    if not repo_root.exists() or not repo_root.is_dir():
        print(f"[FATAL] {SCRIPT_NAME}: repo root not found: {repo_root}", file=sys.stderr)
        return 1

    mode = "fix" if args.fix else "scan"
    report = ScanReport(
        generated_at_utc=utc_now_iso(),
        repo_root=str(repo_root),
        mode=mode,
    )

    # Collect all scannable files
    all_files = [
        p for p in repo_root.rglob("*")
        if p.is_file()
        and p.suffix in SCAN_EXTENSIONS
        and not should_skip(p)
    ]
    report.files_scanned = len(all_files)

    # Scan
    for path in sorted(all_files):
        hits = scan_file(path, repo_root)
        if not hits:
            continue
        fr = FileResult(file=path.relative_to(repo_root).as_posix(), hits=hits)
        if args.fix:
            patch_file(path, fr)
        report.results.append(fr)

    report.files_with_hits = len(report.results)
    report.total_hits = sum(len(fr.hits) for fr in report.results)

    report.notes.append("Only exact old_path substrings are patched -- review complex require() remappings manually.")
    if args.fix:
        report.notes.append("Backup files (.bak) written alongside each patched file.")
        report.notes.append("After verifying patches, remove .bak files and commit.")

    if args.json:
        print(json.dumps(asdict(report), indent=2))
        return 0

    print_summary(report)

    if report.results:
        print(build_markdown_report(report))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
