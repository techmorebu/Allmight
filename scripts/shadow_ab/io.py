from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from .contracts import DecisionRecord, Snapshot

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

def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")

def write_decisions(run_dir: Path, name: str, decisions: List[DecisionRecord]) -> None:
    write_jsonl(run_dir / f"{name}_decisions.jsonl", [d.to_dict() for d in decisions])

def merge_decisions(
    baseline: List[DecisionRecord],
    candidate: List[DecisionRecord],
) -> List[Dict[str, Any]]:
    # Simple merge by index; later you can align by (ts, symbol)
    merged: List[Dict[str, Any]] = []
    n = min(len(baseline), len(candidate))
    for i in range(n):
        merged.append(
            {
                "baseline": baseline[i].to_dict(),
                "candidate": candidate[i].to_dict(),
            }
        )
    return merged

def write_merged(run_dir: Path, merged: List[Dict[str, Any]]) -> None:
    write_jsonl(run_dir / "merged_decisions.jsonl", merged)

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
