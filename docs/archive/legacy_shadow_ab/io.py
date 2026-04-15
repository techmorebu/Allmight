from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from .contracts import DecisionRecord, Snapshot

LogFn = Callable[[str], None]

def _now_ts() -> str:
    # ISO-ish, stable enough for filenames (no spaces)
    return time.strftime("%Y%m%dT%H%M%S", time.gmtime())

def make_run_id(prefix: str = "shadow_ab") -> str:
    return f"{prefix}_{_now_ts()}"

def ensure_run_dir(run_id: str, root: Path = Path("artifacts/shadow_ab")) -> Path:
    run_dir = root / run_id
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir

def write_manifest(run_dir: Path, manifest: Dict[str, Any]) -> None:
    (run_dir / "inputs_manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")

def required_artifacts() -> List[str]:
    """Canonical artifact list for a shadow_ab run.

    Phase 14 intent: operator-safe, predictable outputs.
    Keep this list stable; update only with corresponding test updates.
    """
    return [
        "inputs_manifest.json",
        "baseline_decisions.jsonl",
        "candidate_decisions.jsonl",
        "merged_decisions.jsonl",
        "metrics_onepage.txt",
        "metrics_detail.json",
        "anomalies.log",
    ]

def list_written_artifacts(run_dir: Path) -> List[str]:
    """List known artifacts that exist in run_dir, stable-sorted."""
    out: List[str] = []
    for name in required_artifacts():
        if (run_dir / name).exists():
            out.append(name)
    return out

def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")

def write_decisions(run_dir: Path, name: str, decisions: List[DecisionRecord]) -> None:
    write_jsonl(run_dir / f"{name}_decisions.jsonl", [d.to_dict() for d in decisions])

def append_anomaly(run_dir: Path, line: str) -> None:
    p = run_dir / "anomalies.log"
    with p.open("a", encoding="utf-8") as f:
        f.write(line.rstrip() + "\n")

def write_onepage_metrics(run_dir: Path, text: str) -> None:
    (run_dir / "metrics_onepage.txt").write_text(text.rstrip() + "\n")

def write_metrics_detail(run_dir: Path, detail: Dict[str, Any]) -> None:
    (run_dir / "metrics_detail.json").write_text(json.dumps(detail, indent=2, sort_keys=True) + "\n")

def load_snapshots_jsonl(path: Path, limit: Optional[int] = None) -> List[Snapshot]:
    out: List[Snapshot] = []
    with path.open("r", encoding="utf-8") as f:
        for idx, line in enumerate(f):
            if limit is not None and idx >= limit:
                break
            row = json.loads(line)
            out.append(
                Snapshot(
                    ts=row["ts"],
                    symbol=row["symbol"],
                    price=row.get("price"),
                    volume=row.get("volume"),
                    spread=row.get("spread"),
                    extra=row.get("extra"),
                )
            )
    return out

def _key(d: DecisionRecord) -> Tuple[str, str]:
    return (d.ts, d.symbol)

def merge_decisions_keyed(
    baseline: List[DecisionRecord],
    candidate: List[DecisionRecord],
    log_fn: Optional[LogFn] = None,
) -> List[Dict[str, Any]]:
    """Merge by (ts, symbol). Logs mismatches and duplicates.

    Why: index-based merges silently lie when streams differ.
    This makes A/B comparisons robust immediately.
    """
    b_map: Dict[Tuple[str, str], DecisionRecord] = {}
    c_map: Dict[Tuple[str, str], DecisionRecord] = {}

    # Build baseline map with duplicate detection
    for d in baseline:
        k = _key(d)
        if k in b_map and log_fn:
            log_fn(f"DUPLICATE_BASELINE key={k}")
        b_map[k] = d

    # Build candidate map with duplicate detection
    for d in candidate:
        k = _key(d)
        if k in c_map and log_fn:
            log_fn(f"DUPLICATE_CANDIDATE key={k}")
        c_map[k] = d

    keys = sorted(set(b_map.keys()) | set(c_map.keys()))
    merged: List[Dict[str, Any]] = []

    for k in keys:
        b = b_map.get(k)
        c = c_map.get(k)

        if b is None and log_fn:
            log_fn(f"MISSING_BASELINE key={k}")
        if c is None and log_fn:
            log_fn(f"MISSING_CANDIDATE key={k}")

        merged.append(
            {
                "key": {"ts": k[0], "symbol": k[1]},
                "baseline": b.to_dict() if b else None,
                "candidate": c.to_dict() if c else None,
            }
        )

    return merged
