from __future__ import annotations
from scripts.tools.repo_files import iter_repo_files

from pathlib import Path


def _git_root() -> Path:
    # tests/.. -> repo root
    return Path(__file__).resolve().parents[2]


def test_unified_master_markdown_locations_are_restricted() -> None:
    """
    Guardrail:
      - The ONLY authoritative master is docs/specs/UNIFIED_MASTER_CANONICAL.md
      - Any other UNIFIED_MASTER*.md must be historical and live under docs/_archive/
      - No other UNIFIED_MASTER*.md files may exist anywhere else in the repo.

    Rationale:
      Prevent authority drift and accidental edits to legacy masters.
    """
    root = _git_root()

    # Find any markdown files matching UNIFIED_MASTER*.md anywhere in repo.
    matches = sorted([root / rel for rel in iter_repo_files(root) if rel.suffix == ".md" and rel.name.startswith("UNIFIED_MASTER")])

    allowed_exact = {
        (root / "docs/specs/UNIFIED_MASTER_CANONICAL.md").resolve(),
    }
    allowed_prefixes = {
        (root / "docs/_archive").resolve(),
    }

    offenders: list[str] = []
    for p in matches:
        rp = p.resolve()
        if rp in allowed_exact:
            continue
        if any(str(rp).startswith(str(prefix) + "/") or rp == prefix for prefix in allowed_prefixes):
            continue
        offenders.append(str(p.relative_to(root)))

    if offenders:
        msg = (
            "Found forbidden UNIFIED_MASTER*.md files outside allowed locations.\n\n"
            "Allowed:\n"
            "  - docs/specs/UNIFIED_MASTER_CANONICAL.md\n"
            "  - docs/_archive/ (historical only)\n\n"
            "Offenders:\n  - " + "\n  - ".join(offenders) + "\n\n"
            "Fix: move legacy masters into docs/_archive/ or rename them to avoid the UNIFIED_MASTER*.md pattern."
        )
        raise AssertionError(msg)
