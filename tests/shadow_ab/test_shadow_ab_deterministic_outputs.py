from __future__ import annotations

from pathlib import Path
import hashlib
import json

from scripts.shadow_ab.contracts import Snapshot
from scripts.shadow_ab.runner import RunConfig, run_shadow_ab


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def _normalize_metrics_detail(path: Path) -> str:
    """Normalize metrics_detail.json for determinism checks.

    Operational timing fields (avg_ms/max_ms) are inherently nondeterministic
    because they measure wall-clock runtime. We strip them but keep everything else strict.
    """
    obj = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(obj, dict):
        op = obj.get("operational")
        if isinstance(op, dict):
            op.pop("avg_ms", None)
            op.pop("max_ms", None)
            # Keep budget_ms as it is config-derived (deterministic).
    return json.dumps(obj, sort_keys=True, separators=(",", ":"))

def test_shadow_ab_outputs_deterministic(tmp_path: Path) -> None:
    cfg = RunConfig(artifacts_root=tmp_path / "artifacts" / "shadow_ab", latency_budget_ms=9999.0)

    snaps = [
        Snapshot(ts="2026-01-01T00:00:00Z", symbol="BTC-USD", price=100.0, volume=1.0, spread=0.1),
        Snapshot(ts="2026-01-01T00:01:00Z", symbol="BTC-USD", price=101.0, volume=1.2, spread=0.1),
        Snapshot(ts="2026-01-01T00:02:00Z", symbol="BTC-USD", price=99.5, volume=0.9, spread=0.2),
    ]

    # Run twice with different run IDs but identical inputs.
    r1 = run_shadow_ab(snaps, cfg, run_id="det_run_1")
    r2 = run_shadow_ab(snaps, cfg, run_id="det_run_2")

    # Files that should be content-deterministic given identical snapshots + stub pipelines.
    # NOTE: inputs_manifest.json includes run_id, so we do not compare it.
    deterministic = [
        "baseline_decisions.jsonl",
        "candidate_decisions.jsonl",
        "merged_decisions.jsonl",
        "metrics_detail.json",
        "metrics_onepage.txt",
        "anomalies.log",
    ]

    for name in deterministic:
        p1 = r1 / name
        p2 = r2 / name
        assert p1.exists(), f"missing in run1: {name}"
        assert p2.exists(), f"missing in run2: {name}"
        if name == "metrics_detail.json":
            assert _normalize_metrics_detail(p1) == _normalize_metrics_detail(p2), f"non-deterministic (normalized) content for: {name}"
        else:
            assert _sha256(p1) == _sha256(p2), f"non-deterministic content for: {name}"
