from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, Sequence
import subprocess
import os

PRUNE_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "dist",
    "build",
    ".pytest_cache",
    "__pycache__",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".cache",
}

@dataclass(frozen=True)
class RepoFilesConfig:
    tracked_only: bool = True
    prune_dirs: frozenset[str] = frozenset(PRUNE_DIRS)

def iter_tracked_files(repo_root: Path, *, patterns: Sequence[str] | None = None) -> Iterator[Path]:
    """Yield repo files using git ls-files (deterministic; avoids node_modules unless tracked)."""
    cmd = ["git", "ls-files", "-z"]
    if patterns:
        cmd.extend(patterns)

    r = subprocess.run(
        cmd,
        cwd=repo_root,
        check=True,
        capture_output=True,
    )
    for raw in r.stdout.split(b"\x00"):
        if not raw:
            continue
        yield repo_root / raw.decode("utf-8", errors="replace")

def safe_walk_files(repo_root: Path, *, prune_dirs: Iterable[str] = PRUNE_DIRS) -> Iterator[Path]:
    """Filesystem walk with pruning + OSError tolerance."""
    prune = set(prune_dirs)

    def _onerror(err):
        # Never fail scans because some vendor tree or filesystem entry is cursed.
        return

    try:
        for dirpath, dirnames, filenames in os.walk(repo_root, topdown=True, onerror=_onerror, followlinks=False):
            dirnames[:] = [d for d in dirnames if d not in prune]
            for fn in filenames:
                yield Path(dirpath) / fn
    except OSError:
        # Absolute last-resort: do nothing rather than crash.
        return

def iter_repo_files(repo_root: Path, *, config: RepoFilesConfig | None = None, patterns: Sequence[str] | None = None) -> Iterator[Path]:
    """Unified entrypoint. Prefer tracked files; fallback to safe walk if git isn't available."""
    cfg = config or RepoFilesConfig()
    if cfg.tracked_only:
        try:
            yield from iter_tracked_files(repo_root, patterns=patterns)
            return
        except Exception:
            # Fall back if not a git repo or git not available
            pass
    yield from safe_walk_files(repo_root, prune_dirs=cfg.prune_dirs)
