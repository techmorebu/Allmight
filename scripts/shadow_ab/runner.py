from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .contracts import DecisionRecord, Snapshot
from .io import (
    append_anomaly,
    ensure_run_dir,
    make_run_id,
    merge_decisions,
    write_decisions,
    write_manifest,
    write_merged,
    write_metrics_detail,
    write_onepage_metrics,
)
from .metrics import compute_metrics, format_onepage
from .pipelines import BaselinePipeline, CandidatePipeline, PipelineMeta

@dataclass(frozen=True)
class RunConfig:
    baseline_version: str = "baseline_stub_v0"
    candidate_version: str = "candidate_stub_v0"
    baseline_config_hash: str = "baseline_config_stub"
    candidate_config_hash: str = "candidate_config_stub"
    artifacts_root: Path = Path("artifacts/shadow_ab")
    latency_budget_ms: float = 9999.0  # skeleton default; tighten later

def run_shadow_ab(
    snaps: List[Snapshot],
    cfg: RunConfig,
    run_id: Optional[str] = None,
) -> Path:
    """Run Baseline vs Candidate on identical snapshots.

    This function is intentionally read-only: it does not connect to execution endpoints.
    """
    rid = run_id or make_run_id()
    run_dir = ensure_run_dir(rid, root=cfg.artifacts_root)

    # Always emit anomalies.log (even if empty) to satisfy smoke-test invariants.
    (run_dir / "anomalies.log").touch(exist_ok=True)

    baseline = BaselinePipeline(PipelineMeta(cfg.baseline_version, cfg.baseline_config_hash))
    candidate = CandidatePipeline(PipelineMeta(cfg.candidate_version, cfg.candidate_config_hash))

    baseline_out: List[DecisionRecord] = []
    candidate_out: List[DecisionRecord] = []

    timings_ms: List[float] = []
    for s in snaps:
        t0 = time.perf_counter()
        a = baseline.decide(s)
        b = candidate.decide(s)
        dt_ms = (time.perf_counter() - t0) * 1000.0
        timings_ms.append(dt_ms)

        if dt_ms > cfg.latency_budget_ms:
            append_anomaly(run_dir, f"LATENCY_BUDGET_EXCEEDED ts={s.ts} symbol={s.symbol} ms={dt_ms:.2f}")

        baseline_out.append(a)
        candidate_out.append(b)

    # Write artifacts
    write_manifest(
        run_dir,
        {
            "run_id": rid,
            "n_snapshots": len(snaps),
            "baseline": {"model_version": cfg.baseline_version, "config_hash": cfg.baseline_config_hash},
            "candidate": {"model_version": cfg.candidate_version, "config_hash": cfg.candidate_config_hash},
            "latency": {
                "avg_ms": sum(timings_ms) / max(1, len(timings_ms)),
                "max_ms": max(timings_ms) if timings_ms else 0.0,
            },
            "mode": "REPLAY_SHADOW",
            "notes": "skeleton harness; no execution authority",
        },
    )

    write_decisions(run_dir, "baseline", baseline_out)
    write_decisions(run_dir, "candidate", candidate_out)
    merged = merge_decisions(baseline_out, candidate_out)
    write_merged(run_dir, merged)

    detail = compute_metrics(baseline_out, candidate_out)
    # Include latency detail
    detail["operational"] = {
        "avg_ms": sum(timings_ms) / max(1, len(timings_ms)),
        "max_ms": max(timings_ms) if timings_ms else 0.0,
        "budget_ms": cfg.latency_budget_ms,
    }
    write_metrics_detail(run_dir, detail)
    write_onepage_metrics(run_dir, format_onepage(detail))

    return run_dir
