#!/usr/bin/env python3
"""
repo_reorg_surface_phase.py

Controlled repo reorganization utility for the current AllMight
Surface Discovery & Classification phase.

Design goals:
- deterministic
- safe by default
- dry-run first
- no deletions
- no overwrites
- no guessing about unknown files
- machine-readable + human-readable reports

Usage:
    python scripts/tools/repo_reorg_surface_phase.py --plan
    python scripts/tools/repo_reorg_surface_phase.py --apply
    python scripts/tools/repo_reorg_surface_phase.py --plan --root /path/to/repo
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Sequence


SCRIPT_NAME = "repo_reorg_surface_phase.py"


# -----------------------------
# Data models
# -----------------------------

@dataclass(frozen=True)
class MoveSpec:
    source: str
    destination_dir: str
    category: str


@dataclass
class Report:
    mode: str
    repo_root: str
    generated_at_utc: str
    directories_created: List[str] = field(default_factory=list)
    directories_already_present: List[str] = field(default_factory=list)
    files_created: List[str] = field(default_factory=list)
    files_already_present: List[str] = field(default_factory=list)
    files_moved: List[Dict[str, str]] = field(default_factory=list)
    skipped_missing: List[Dict[str, str]] = field(default_factory=list)
    skipped_conflict: List[Dict[str, str]] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


# -----------------------------
# Planned structure
# -----------------------------

DIRECTORIES_TO_CREATE: Sequence[str] = (
    "docs/current",
    "docs/handoffs",
    "docs/architecture",
    "docs/archive",
    "docs/archive/legacy_strategy",
    "docs/archive/superseded_handoffs",
    "docs/archive/old_phase_summaries",
    "docs/archive/quarantine",
    "scripts/discovery",
    "scripts/validators",
    "reports/reorg",
)

FILE_STUBS: Dict[str, str] = {
    "docs/current/PROJECT_STATE_CURRENT.md": """# PROJECT STATE CURRENT

Status: CURRENT
Last Reviewed: TBD
Supersedes: implicit repo assumptions

## Current Phase
Surface Discovery & Classification (Pre-Execution)

## Primary Chain
Arbitrum

## Current Objective
Build a surface inventory framework that scans, classifies, and ranks candidate pools/venues without adding execution logic.

## Core Insight
Edge appears when price moves into pre-existing liquidity zones, not from assuming that new LP events create edge by themselves.

## Best Current Research Target
ARB/USDC UniV3 vs Camelot V3

## Current Blocker
Liquidity / active-tick depth

## In Scope
- discovery
- pool inventory
- fast classification
- validation routing
- ranking candidate surfaces
- selective fetcher hardening only when directly justified

## Out of Scope
- execution logic
- contract rewrites
- broad chain expansion
- capital deployment
- vault logic

## Next Build Target
Surface Inventory Framework
""",
    "docs/current/NEXT_ACTIONS.md": """# NEXT ACTIONS

Status: CURRENT

1. Establish repo operator map
2. Group discovery helpers
3. Group validator helpers
4. Build Surface Inventory Framework
5. Feed best candidates into existing validation stack
6. Harden only the fetchers that directly block discovery quality
""",
    "docs/current/ACTIVE_TOOLING_INDEX.md": """# ACTIVE TOOLING INDEX

Status: CURRENT

| Path | Category | Status | Purpose | Safe To Edit |
|---|---|---|---|---|
| scripts/master-fetcher.js | runner | ACTIVE | master fetch loop | cautious |
| scripts/analysis/breakeven_engine.js | analysis | ACTIVE | breakeven math | cautious |
| scripts/tools/breakeven_report.js | reporting | ACTIVE | surface reporting | cautious |
| scripts/tools/rpc_benchmark.js | infra | ACTIVE | provider benchmarking | yes |
| utils/provider_factory.js | infra | ACTIVE | provider selection/routing | cautious |
| scripts/data_collection/masterFetcher/arbitrumFetcher.js | fetcher | ACTIVE | Arbitrum pool collection | cautious |

## Mixed-State Candidates
Fill this section in after repo review:
- uniswapV3Fetcher.js
- sushiswapFetcher.js
- curveFetcherArbitrum.js
- balancerFetcherArbitrum.js
- gasPriceOracle.js
""",
    "docs/current/VALIDATION_PIPELINE.md": """# VALIDATION PIPELINE

Status: CURRENT

1. Probe candidate on-chain
2. Confirm token ordering / quote correctness
3. Add candidate to discovery/fetcher coverage where needed
4. Run fetcher
5. Run master fetcher
6. Run validator
7. Measure active-tick depth / liquidity quality
8. Run breakeven / classification
9. Rank or reject candidate
""",
    "docs/current/REPO_STATUS_MATRIX.md": """# REPO STATUS MATRIX

Status: CURRENT

| Area | Current Status | Authority Source | Action Required | Owner |
|---|---|---|---|---|
| discovery | active | current handoff | organize + extend | TBD |
| validators | active | current handoff | group + verify paths | TBD |
| fetchers | mixed-state | repo review | label + selectively normalize | TBD |
| provider layer | active | repo review | benchmark + preserve | TBD |
| execution | frozen | current handoff | none | TBD |
| docs | mixed | repo reality | reorganize | TBD |
| governance | present | governance docs | keep visible | TBD |
""",
    "docs/archive/README.md": """# ARCHIVE README

Status: ARCHIVE

This directory stores materials that are:

- superseded
- historical
- dormant
- not part of the current operator flow
- retained for context, traceability, or future review

Archive rules:
- do not delete by default
- do not treat archived files as current instructions
- move only when clearly no longer part of active operator guidance
- preserve filenames unless there is a strong reason to normalize them
""",
    "docs/handoffs/HANDOFF_INDEX.md": """# HANDOFF INDEX

Status: HANDOFF

Use this index to track the currently relevant handoff files.

Suggested contents:
- latest active master handoff
- latest active review handoff
- continuation prompt for the next chat
- superseded handoffs should move to docs/archive/superseded_handoffs
""",
}

MOVES: Sequence[MoveSpec] = (
    MoveSpec("find_arb_usdc_pools.js", "scripts/discovery", "discovery"),
    MoveSpec("arb_pool_smoke_test.js", "scripts/discovery", "discovery"),
    MoveSpec("arb_pool_smoke_test_p2.js", "scripts/discovery", "discovery"),
    MoveSpec("spread_validator.js", "scripts/validators", "validator"),
    MoveSpec("arb_direct_validator.js", "scripts/validators", "validator"),
    MoveSpec("arb_synthetic_validator.js", "scripts/validators", "validator"),
    MoveSpec("wbtc_spread_validator.js", "scripts/validators", "validator"),
    MoveSpec("arb_slippage_model.js", "scripts/validators", "validator"),
)


# -----------------------------
# Helpers
# -----------------------------

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Controlled repo reorganization utility for AllMight surface phase."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--plan",
        action="store_true",
        help="Dry run only. Print and report what would happen.",
    )
    mode.add_argument(
        "--apply",
        action="store_true",
        help="Apply filesystem changes.",
    )
    parser.add_argument(
        "--root",
        type=str,
        default=".",
        help="Repository root. Defaults to current working directory.",
    )
    return parser.parse_args()


def ensure_repo_root(repo_root: Path) -> None:
    if not repo_root.exists():
        raise FileNotFoundError(f"Repo root does not exist: {repo_root}")
    if not repo_root.is_dir():
        raise NotADirectoryError(f"Repo root is not a directory: {repo_root}")


def normalize_relpath(path: Path, repo_root: Path) -> str:
    return path.resolve().relative_to(repo_root.resolve()).as_posix()


def sorted_unique(values: Sequence[str]) -> List[str]:
    return sorted(set(values))


def write_text_file(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")


def mkdir_if_needed(path: Path, apply: bool) -> bool:
    """
    Returns True if directory was created, False if it already existed.
    """
    if path.exists():
        return False
    if apply:
        path.mkdir(parents=True, exist_ok=True)
    return True


def create_stub_if_needed(path: Path, content: str, apply: bool) -> bool:
    """
    Returns True if file was created, False if it already existed.
    """
    if path.exists():
        return False
    if apply:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_text_file(path, content)
    return True


def move_file_safely(src: Path, dst: Path, apply: bool) -> str:
    """
    Returns one of:
    - moved
    - missing
    - conflict
    """
    if not src.exists():
        return "missing"
    if dst.exists():
        return "conflict"
    if apply:
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
    return "moved"


def find_source(repo_root: Path, filename: str) -> Path | None:
    """
    Deterministic search for the first matching filename under repo root.

    Safety notes:
    - We do not guess by fuzzy names.
    - We allow recursive exact-filename search because many of the targeted
      helper scripts may live in different folders in different repo snapshots.
    - If multiple candidates exist, we pick the shortest relative path, then
      lexicographically, so behavior stays deterministic.
    """
    candidates = [
        p for p in repo_root.rglob(filename)
        if p.is_file()
    ]
    if not candidates:
        return None

    candidates_sorted = sorted(
        candidates,
        key=lambda p: (len(p.relative_to(repo_root).as_posix()), p.relative_to(repo_root).as_posix())
    )
    return candidates_sorted[0]


def build_markdown_report(report: Report) -> str:
    lines: List[str] = []
    lines.append("# Repo Reorg Report")
    lines.append("")
    lines.append(f"- Mode: `{report.mode}`")
    lines.append(f"- Repo Root: `{report.repo_root}`")
    lines.append(f"- Generated At (UTC): `{report.generated_at_utc}`")
    lines.append("")

    def add_list_section(title: str, items: Sequence[str]) -> None:
        lines.append(f"## {title}")
        lines.append("")
        if not items:
            lines.append("_None_")
            lines.append("")
            return
        for item in items:
            lines.append(f"- `{item}`")
        lines.append("")

    def add_dict_list_section(title: str, items: Sequence[Dict[str, str]]) -> None:
        lines.append(f"## {title}")
        lines.append("")
        if not items:
            lines.append("_None_")
            lines.append("")
            return
        for item in items:
            details = ", ".join(f"{k}=`{v}`" for k, v in sorted(item.items()))
            lines.append(f"- {details}")
        lines.append("")

    add_list_section("Directories Created", report.directories_created)
    add_list_section("Directories Already Present", report.directories_already_present)
    add_list_section("Files Created", report.files_created)
    add_list_section("Files Already Present", report.files_already_present)
    add_dict_list_section("Files Moved", report.files_moved)
    add_dict_list_section("Skipped Missing", report.skipped_missing)
    add_dict_list_section("Skipped Conflict", report.skipped_conflict)
    add_list_section("Notes", report.notes)

    return "\n".join(lines)


def write_reports(repo_root: Path, report: Report, apply: bool) -> None:
    report_dir = repo_root / "reports" / "reorg"
    if apply:
        report_dir.mkdir(parents=True, exist_ok=True)

    json_path = report_dir / "repo_reorg_report.json"
    md_path = report_dir / "repo_reorg_report.md"

    report_json = json.dumps(asdict(report), indent=2, sort_keys=True)
    report_md = build_markdown_report(report)

    if apply:
        write_text_file(json_path, report_json + "\n")
        write_text_file(md_path, report_md + "\n")
    else:
        # In plan mode, still print where reports WOULD be written.
        report.notes.append(
            f"Plan mode only: reports would be written to {json_path.relative_to(repo_root).as_posix()} "
            f"and {md_path.relative_to(repo_root).as_posix()}"
        )


def print_summary(report: Report) -> None:
    print("\n=== Repo Reorg Summary ===")
    print(f"Mode: {report.mode}")
    print(f"Repo root: {report.repo_root}")
    print(f"Generated at (UTC): {report.generated_at_utc}")
    print(f"Directories created: {len(report.directories_created)}")
    print(f"Directories already present: {len(report.directories_already_present)}")
    print(f"Files created: {len(report.files_created)}")
    print(f"Files already present: {len(report.files_already_present)}")
    print(f"Files moved: {len(report.files_moved)}")
    print(f"Skipped missing: {len(report.skipped_missing)}")
    print(f"Skipped conflict: {len(report.skipped_conflict)}")
    print("==========================\n")


# -----------------------------
# Main logic
# -----------------------------

def run(repo_root: Path, apply: bool) -> Report:
    report = Report(
        mode="apply" if apply else "plan",
        repo_root=str(repo_root.resolve()),
        generated_at_utc=utc_now_iso(),
    )

    # 1) Create directories
    for rel_dir in sorted(DIRECTORIES_TO_CREATE):
        abs_dir = repo_root / rel_dir
        created = mkdir_if_needed(abs_dir, apply=apply)
        if created:
            report.directories_created.append(rel_dir)
        else:
            report.directories_already_present.append(rel_dir)

    # 2) Create stub files
    for rel_file in sorted(FILE_STUBS):
        abs_file = repo_root / rel_file
        created = create_stub_if_needed(abs_file, FILE_STUBS[rel_file], apply=apply)
        if created:
            report.files_created.append(rel_file)
        else:
            report.files_already_present.append(rel_file)

    # 3) Move approved files only
    for spec in sorted(MOVES, key=lambda m: (m.category, m.source, m.destination_dir)):
        src = find_source(repo_root, spec.source)
        dst = repo_root / spec.destination_dir / spec.source

        if src is None:
            report.skipped_missing.append({
                "category": spec.category,
                "source": spec.source,
                "destination": normalize_relpath(dst, repo_root),
                "reason": "source_not_found",
            })
            continue

        # If the source is already in the destination, treat as already organized.
        if src.resolve() == dst.resolve():
            report.skipped_conflict.append({
                "category": spec.category,
                "source": normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
                "reason": "already_in_destination",
            })
            continue

        result = move_file_safely(src, dst, apply=apply)

        if result == "moved":
            report.files_moved.append({
                "category": spec.category,
                "source": normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
            })
        elif result == "missing":
            report.skipped_missing.append({
                "category": spec.category,
                "source": normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
                "reason": "resolved_source_missing_before_move",
            })
        elif result == "conflict":
            report.skipped_conflict.append({
                "category": spec.category,
                "source": normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
                "reason": "destination_exists",
            })
        else:
            raise RuntimeError(f"Unexpected move result: {result}")

    report.directories_created = sorted_unique(report.directories_created)
    report.directories_already_present = sorted_unique(report.directories_already_present)
    report.files_created = sorted_unique(report.files_created)
    report.files_already_present = sorted_unique(report.files_already_present)

    report.files_moved = sorted(
        report.files_moved,
        key=lambda x: (x["category"], x["source"], x["destination"])
    )
    report.skipped_missing = sorted(
        report.skipped_missing,
        key=lambda x: (x["category"], x["source"], x["destination"])
    )
    report.skipped_conflict = sorted(
        report.skipped_conflict,
        key=lambda x: (x["category"], x["source"], x["destination"])
    )

    report.notes.append("No files were deleted.")
    report.notes.append("No existing destination files were overwritten.")
    report.notes.append("Unknown files were not moved or classified automatically.")

    # 4) Reports
    write_reports(repo_root, report, apply=apply)

    # In apply mode, make sure the report files themselves exist in the report.
    if apply:
        # The report directory should already exist at this point.
        pass

    return report


def main() -> int:
    args = parse_args()
    apply = bool(args.apply)
    repo_root = Path(args.root).resolve()

    try:
        ensure_repo_root(repo_root)
        report = run(repo_root=repo_root, apply=apply)
        print_summary(report)

        # In plan mode, echo the markdown report to stdout for immediate review.
        if not apply:
            print(build_markdown_report(report))

        return 0

    except Exception as exc:
        print(f"[FATAL] {SCRIPT_NAME}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
