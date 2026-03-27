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


# ─────────────────────────────────────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# Planned structure
# ─────────────────────────────────────────────────────────────────────────────

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

    "docs/current/PROJECT_STATE_CURRENT.md": """\
# PROJECT STATE CURRENT

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->
<!-- Supersedes: all prior architecture or execution planning docs -->

## Current Phase
Surface Discovery & Classification (Pre-Execution)

## Primary Chain
Arbitrum mainnet

## Current Objective
Build a surface inventory framework that scans, classifies, and ranks candidate
pools/venues without adding execution logic.

## Core Insight
Edge appears when price moves into pre-existing liquidity zones (tick map),
not from assuming that new LP events create edge by themselves.

## Best Current Research Target
ARB/USDC UniV3 vs Camelot V3

## Validated Surfaces (breakeven engine v1)

| Surface                              | Avg Spread | Fee Burden | Avg Net   | Classification     |
|--------------------------------------|-----------|------------|-----------|-------------------|
| ETH/USDC:univ3-camelotv2             | 0.0594%   | 0.3500%    | -0.2906%  | BLOCKED_FEE       |
| ARB/USD:univ3-direct-vs-synthetic    | 0.0715%   | 0.1500%    | -0.0785%  | BLOCKED_FEE       |
| ARB/USDC:univ3-camelotv3-direct      | 0.1110%   | 0.0749%    | +0.0361%  | BLOCKED_LIQUIDITY |
| WBTC/USD:univ3-direct-vs-synthetic   | 0.0276%   | 0.1500%    | -0.1224%  | BLOCKED_FEE       |

## Current Blocker
**ARB/USDC active-tick depth** — UniV3 ARB/USDC = $3,090 (too thin).
Camelot V3 = $56,016 (deep). Need a second deep venue to complete the surface.

## In Scope
- discovery
- pool inventory and active-tick depth measurement (L x sqrtP)
- fast classification via breakeven engine
- validation routing (8-step sequence)
- ranking candidate surfaces
- selective fetcher hardening only when directly justified

## Out of Scope
- execution logic (frozen)
- flash loan orchestration (frozen)
- contract rewrites (frozen)
- broad chain expansion (frozen -- Arbitrum only)
- capital deployment / vault logic (frozen)

## Next Build Target
Surface Inventory Framework -- scan candidate venues, classify by depth + fee,
feed only passing surfaces into the existing validation stack.

## Priority Queue (Boss-approved 2026-03-19)
1. PRIORITY 1 -- Fix ARB/USDC blocked_liquidity
   - Target: venue with active-tick depth > $10k, fee <= 0.10%
   - NOT UniV3 ARB/USDC (confirmed $3,090)
   - native USDC (0xaf88..) preferred
   - Candidates: SushiSwap V3, Ramses V2, UniV3 alt fee tiers
2. PRIORITY 2 -- WBTC blocked_fee investigation
   - Research 1-hop WBTC/USDC venue <= 0.05%
   - Or test WBTC/WETH at different time window (burst-trading noted)

## Hard Rules (session 2026-03-19, Boss-approved)
1. Same-block anchoring mandatory -- tag every measurement with block number
2. Active-tick depth = L x sqrtP -- NEVER use GeckoTerminal TVL as proxy
3. Fee burden checked before excitement
4. Blocker classes are distinct: blocked_fee / blocked_liquidity / blocked_slippage
5. Always verify on-disk state before patching
6. Promise.all only within single rpc.call() on same contract

## Key Addresses (Arbitrum mainnet)
    ARB:           0x912CE59144191C1204E64559FE8253a0e49E6548  (18 dec)
    native USDC:   0xaf88d065e77c8cC2239327C5EDb3A432268e5831  (6 dec)   <- USE THIS
    USDCe:         0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8  (6 dec)   <- AVOID
    WETH:          0x82aF49447D8a07e3bd95BD0d56f35241523fBab1  (18 dec)
    WBTC:          0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f  (8 dec)

## Health Check Commands
    node -r dotenv/config scripts/data_collection/masterFetcher/arbitrumFetcher.js
    # expect: status=success partial=false success=9 failed=0

    node scripts/tools/breakeven_report.js
    # expect: 4 surfaces, ARB/USDC = BLOCKED_LIQUIDITY, rest = BLOCKED_FEE
""",

    "docs/current/NEXT_ACTIONS.md": """\
# NEXT ACTIONS

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Ordered queue. Do not reorder without Boss approval.

## 1 -- Repo Hygiene (IN PROGRESS)
- [x] Boss ruling received (2026-03-27)
- [x] Reorg script written: scripts/tools/repo_reorg_surface_phase.py
- [ ] Run --plan and verify output
- [ ] Run --apply and commit
- [ ] Run path-reference scanner: scripts/tools/repo_reorg_ref_scanner.py
- [ ] Fix any broken require() / import references
- [ ] Commit 1: repo: establish current-phase operator map and archive structure
- [ ] Commit 2: repo: group discovery and validator helpers

## 2 -- Surface Inventory Framework
- [ ] Deploy surface_inventory_scanner.js to scripts/tools/
- [ ] Run scan -- collect depth measurements for SushiSwap V3, Ramses V2, UniV3 alt tiers
- [ ] Report all classifications to Boss before proceeding

## 3 -- PRIORITY 1: Resolve ARB/USDC blocked_liquidity
- [ ] Identify venue with active-tick depth > $10k, fee <= 0.10%
- [ ] Run standard 8-step validation sequence (see VALIDATION_PIPELINE.md)
- [ ] Add to breakeven_report.js, run engine, report to Boss -- await ruling

## 4 -- PRIORITY 2: WBTC blocked_fee
- [ ] Research 1-hop WBTC/USDC <= 0.05% (SushiSwap V3, UniV3)
- [ ] Or test WBTC/WETH at different time window (burst-trading pattern)

## DO NOT START
- Execution logic
- Contract work
- Chain expansion
- Rewriting working fetchers, breakeven engine, or provider factory
""",

    "docs/current/ACTIVE_TOOLING_INDEX.md": """\
# ACTIVE TOOLING INDEX

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Statuses: ACTIVE | ACTIVE_MIXED | LEGACY | DORMANT | UNVERIFIED

## ACTIVE -- Do not rewrite, do not bypass

| Path | Category | Status | Purpose | Safe To Edit |
|---|---|---|---|---|
| scripts/data_collection/masterFetcher/arbitrumFetcher.js | fetcher | ACTIVE | Primary Arbitrum pool fetcher | cautious -- add pools with TOKEN-ORDER-GUARD only |
| scripts/analysis/breakeven_engine.js | analysis | ACTIVE | Surface classification engine | no -- Boss ruling required |
| scripts/tools/breakeven_report.js | reporting | ACTIVE | Run surface classification report | cautious -- add SURFACES[] entries only |
| scripts/tools/rpc_benchmark.js | infra | ACTIVE | Endpoint health benchmarking | yes |
| utils/provider_factory.js | infra | ACTIVE | Canonical RPC layer | no -- do not bypass |
| utils/rpc_provider.js | infra | ACTIVE | Compatibility shim (temporary) | no -- do not remove |
| scripts/master-fetcher.js | runner | ACTIVE | Orchestrates all fetchers | no -- do not restructure |

## ACTIVE -- Discovery helpers (moved to scripts/discovery/ after reorg)

| Path | Purpose |
|---|---|
| scripts/tools/find_arb_usdc_pools.js | ARB/USDC pool discovery |
| scripts/tools/arb_pool_smoke_test.js | Pool probe smoke test |
| scripts/tools/arb_pool_smoke_test_p2.js | Pool probe smoke test part 2 |

## ACTIVE -- Validators (moved to scripts/validators/ after reorg)

| Path | Purpose |
|---|---|
| scripts/tools/arb_direct_validator.js | ARB direct-vs-direct spread validator |
| scripts/tools/arb_synthetic_validator.js | ARB synthetic route validator |
| scripts/tools/wbtc_spread_validator.js | WBTC spread validator |
| scripts/tools/arb_slippage_model.js | ARB slippage notional model |
| scripts/tools/spread_validator.js | Same-block spread validation |
| scripts/tools/rpc_healthcheck.py | RPC endpoint health check |

## ACTIVE_MIXED -- Inspect before editing (fetcher fleet, not uniformly hardened)

| Path | Notes |
|---|---|
| scripts/data_collection/masterFetcher/uniswapV3Fetcher.js | v2.0 partial migration confirmed |
| scripts/data_collection/masterFetcher/sushiswapFetcher.js | inspect before use |
| scripts/data_collection/masterFetcher/curveFetcherArbitrum.js | patched -- verify |
| scripts/data_collection/masterFetcher/balancerFetcherArbitrum.js | patched -- verify |
| scripts/data_collection/masterFetcher/gasPriceOracle.js | check provider pattern |
| scripts/data_collection/masterFetcher/baseFetcher.js | non-primary chain |
| scripts/data_collection/masterFetcher/optimismFetcher.js | non-primary chain |
| scripts/data_collection/masterFetcher/unichainFetcher.js | non-primary chain |

## UNVERIFIED -- Not yet assessed

| Path | Why |
|---|---|
| scripts/data_collection/surfaces/arbSyntheticFetcher.js | surface-specific, status unknown |
| scripts/data_collection/surfaces/arbUsdtFetcher.js | surface-specific, status unknown |
| scripts/data_collection/surfaces/camelotV2Fetcher.js | surface-specific, status unknown |
| scripts/analysis/arb_window_activator.js | may be active activator -- verify |
| scripts/analysis/arb_tick_liquidity_map.js | may be useful for depth measurement |

## DORMANT -- Future phases, do not activate now

| Area | Location |
|---|---|
| Execution engine | scripts/execution/ |
| Flash loan / contract layer | scripts/ (various) |
| Phase 5-9 runners | scripts/phase5/ through scripts/phase9/ |
| Shadow A/B | scripts/shadow_ab/ |
| Regime layer | scripts/regime/ |
| Audit sink | scripts/phase8/, scripts/phase9/ |
""",

    "docs/current/VALIDATION_PIPELINE.md": """\
# VALIDATION PIPELINE

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Standard 8-step sequence for any new pool/surface.
Do not skip steps. Do not reorder.

## Step 1 -- On-chain smoke test
    node -r dotenv/config -e "
      // probe: slot0() or globalState(), liquidity(), token0(), token1()
      // confirm: price sane, token addresses match known tokens
      // confirm: native USDC (0xaf88..) not USDCe (0xFF97..)
    "

## Step 2 -- Add to arbitrumFetcher.js
- Include TOKEN-ORDER-GUARD (sanityMin / sanityMax bounds)
- For Algebra pools (Camelot V3, Ramses): use fetchCamelotV3Pool() path
- Do NOT merge Algebra logic with UniV3 logic

## Step 3 -- Run arbitrum fetcher
    node -r dotenv/config scripts/data_collection/masterFetcher/arbitrumFetcher.js
    # expect: status=success partial=false success=N failed=0

## Step 4 -- Run master fetcher
    node -r dotenv/config scripts/master-fetcher.js

## Step 5 -- Run spread validator (10 samples, same-block)
- Every sample must be tagged with block number
- Cross-session comparisons are invalid (5-14x inflation artifact)

## Step 6 -- Measure active-tick depth (L x sqrtP)
    activeTick_usd = (L x sqrtP / 10^dec1) x 2

- Measure for BOTH venues before classifying surface quality
- Reference: UniV3 ARB/USDC = $3,090 | Camelot V3 ARB/USDC = $56,016
- NEVER use GeckoTerminal TVL as proxy

## Step 7 -- Add to breakeven_report.js and run
    node scripts/tools/breakeven_report.js

## Step 8 -- Report to Boss
State: classification, blocker, active-tick depth, fee burden.
Await Boss ruling before any further work on that surface.

## Blocker Classes (distinct -- treat separately)

| Class | Meaning | Next Action |
|---|---|---|
| blocked_fee | fee > spread | find lower-fee venue or reduce hop count |
| blocked_liquidity | thin active-tick depth | find deeper venue (same pair, NOT higher TVL) |
| blocked_slippage | notional too large | reduce size or wait for depth increase |
| monitored | conditions not met yet | watch, do not force-expand |
""",

    "docs/current/REPO_STATUS_MATRIX.md": """\
# REPO STATUS MATRIX

<!-- STATUS: CURRENT | Last Reviewed: 2026-03-27 -->

Anti-confusion reference. Check here before touching anything.

| Area | Current Status | Authority Source | Action Required | Owner |
|---|---|---|---|---|
| Surface discovery | ACTIVE | session_handoff_2026-03-19.md | Continue -- find deeper ARB/USDC venue | CPT |
| Breakeven classification | ACTIVE | scripts/analysis/breakeven_engine.js | Add surfaces only, do not rewrite | CPT |
| Arbitrum fetcher | ACTIVE | arbitrumFetcher.js | Add pools with TOKEN-ORDER-GUARD only | CPT |
| Provider layer | ACTIVE | utils/provider_factory.js | Do not bypass or rewrite | Locked |
| Validators | ACTIVE | scripts/tools/ | Use as-is per validation pipeline | CPT |
| Ethereum mainnet | SECONDARY | provider_factory.js | Token registry issue pending | CPT |
| Fetcher fleet | ACTIVE_MIXED | session notes | Inspect before editing; label status | CPT |
| Execution engine | FROZEN | Boss ruling | Do not touch | Boss gate |
| Flash loan / contracts | FROZEN | Boss ruling | Do not touch | Boss gate |
| Phase 5-9 code | DORMANT | Historical phases | Preserve, do not activate | Preserve |
| Docs / appendices | MULTI-GEN | This reorg | Separating active vs archive | CPT |
| New chain expansion | FROZEN | Boss ruling | Arbitrum only for now | Boss gate |
| Surface inventory scanner | BUILT, PARKED | CPT session 2026-03-27 | Deploy after reorg complete | CPT |
""",

    "docs/archive/README.md": """\
# ARCHIVE

<!-- STATUS: ARCHIVE | Last Reviewed: 2026-03-27 -->

## Purpose
Historical material no longer part of the active operator flow.
Preserved for context, traceability, and future reference.

## What belongs here
- Handoffs that describe execution as active (execution is now frozen)
- Architecture docs for flash loans, vaults, capital policy, XRPL
- Older strategic planning docs and consolidated master docs
- Phase build notes from completed or frozen phases (Phase 0-14)
- Chat-derived artifacts used for memory, not current engineering

## What does NOT belong here
- The March 2026 session handoff (governs current work)
- Active fetcher code, provider factory, breakeven engine
- Current governance or safety rules

## Sub-folders

| Folder | Contents |
|---|---|
| legacy_strategy/ | Old broad architecture, vault/capital docs |
| superseded_handoffs/ | Handoffs from phases before surface discovery |
| old_phase_summaries/ | Phase 0-14 summaries that are complete/frozen |
| quarantine/ | Files under review -- status uncertain |

## Rule
Do not delete from archive without explicit Boss ruling.
""",

    "docs/handoffs/HANDOFF_INDEX.md": """\
# HANDOFF INDEX

<!-- STATUS: HANDOFF | Last Reviewed: 2026-03-27 -->

## Active Handoffs (govern current work)

| File | Date | Phase | Notes |
|---|---|---|---|
| session_handoff_2026-03-19.md (repo root) | 2026-03-19 | Surface Discovery | PRIMARY -- governs all current work |

## Archived Handoffs
See docs/archive/superseded_handoffs/ for handoffs describing
execution or prior phases as active.

## Handoff Protocol
Each session wrap-up produces: HANDOFF_YYYY-MM-DD_<topic>.md

Required fields:
- current phase
- in-scope / out-of-scope
- hard rules learned this session
- next session directive (Boss-approved)
- health check commands
- key addresses / file map
""",

}

MOVES: Sequence[MoveSpec] = (
    MoveSpec("find_arb_usdc_pools.js",     "scripts/discovery",  "discovery"),
    MoveSpec("arb_pool_smoke_test.js",     "scripts/discovery",  "discovery"),
    MoveSpec("arb_pool_smoke_test_p2.js",  "scripts/discovery",  "discovery"),
    MoveSpec("spread_validator.js",        "scripts/validators", "validator"),
    MoveSpec("arb_direct_validator.js",    "scripts/validators", "validator"),
    MoveSpec("arb_synthetic_validator.js", "scripts/validators", "validator"),
    MoveSpec("wbtc_spread_validator.js",   "scripts/validators", "validator"),
    MoveSpec("arb_slippage_model.js",      "scripts/validators", "validator"),
)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Controlled repo reorganization utility for AllMight surface phase."
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--plan", action="store_true",
        help="Dry run only. Print and report what would happen.",
    )
    mode.add_argument(
        "--apply", action="store_true",
        help="Apply filesystem changes.",
    )
    parser.add_argument(
        "--root", type=str, default=".",
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
    if path.exists():
        return False
    if apply:
        path.mkdir(parents=True, exist_ok=True)
    return True


def create_stub_if_needed(path: Path, content: str, apply: bool) -> bool:
    if path.exists():
        return False
    if apply:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_text_file(path, content)
    return True


def move_file_safely(src: Path, dst: Path, apply: bool) -> str:
    if not src.exists():
        return "missing"
    if dst.exists():
        return "conflict"
    if apply:
        dst.parent.mkdir(parents=True, exist_ok=True)
        src.rename(dst)
    return "moved"


def find_source(repo_root: Path, filename: str) -> "Path | None":
    """
    Deterministic search for the first matching filename under repo root.
    Picks shortest relative path, then lexicographically -- stays deterministic.
    """
    candidates = [p for p in repo_root.rglob(filename) if p.is_file()]
    if not candidates:
        return None
    return sorted(
        candidates,
        key=lambda p: (
            len(p.relative_to(repo_root).as_posix()),
            p.relative_to(repo_root).as_posix(),
        )
    )[0]


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
    md_path   = report_dir / "repo_reorg_report.md"

    report_json = json.dumps(asdict(report), indent=2, sort_keys=True)
    report_md   = build_markdown_report(report)

    if apply:
        write_text_file(json_path, report_json + "\n")
        write_text_file(md_path,   report_md   + "\n")
    else:
        report.notes.append(
            f"Plan mode only: reports would be written to "
            f"{json_path.relative_to(repo_root).as_posix()} "
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


# ─────────────────────────────────────────────────────────────────────────────
# Main logic
# ─────────────────────────────────────────────────────────────────────────────

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
                "category":    spec.category,
                "source":      spec.source,
                "destination": normalize_relpath(dst, repo_root),
                "reason":      "source_not_found",
            })
            continue

        if src.resolve() == dst.resolve():
            report.skipped_conflict.append({
                "category":    spec.category,
                "source":      normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
                "reason":      "already_in_destination",
            })
            continue

        result = move_file_safely(src, dst, apply=apply)

        if result == "moved":
            report.files_moved.append({
                "category":    spec.category,
                "source":      normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
            })
        elif result == "missing":
            report.skipped_missing.append({
                "category":    spec.category,
                "source":      normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
                "reason":      "resolved_source_missing_before_move",
            })
        elif result == "conflict":
            report.skipped_conflict.append({
                "category":    spec.category,
                "source":      normalize_relpath(src, repo_root),
                "destination": normalize_relpath(dst, repo_root),
                "reason":      "destination_exists",
            })
        else:
            raise RuntimeError(f"Unexpected move result: {result}")

    report.directories_created         = sorted_unique(report.directories_created)
    report.directories_already_present = sorted_unique(report.directories_already_present)
    report.files_created               = sorted_unique(report.files_created)
    report.files_already_present       = sorted_unique(report.files_already_present)

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

    write_reports(repo_root, report, apply=apply)

    return report


def main() -> int:
    args = parse_args()
    apply = bool(args.apply)
    repo_root = Path(args.root).resolve()

    try:
        ensure_repo_root(repo_root)
        report = run(repo_root=repo_root, apply=apply)
        print_summary(report)

        if not apply:
            print(build_markdown_report(report))

        return 0

    except Exception as exc:
        print(f"[FATAL] {SCRIPT_NAME}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
