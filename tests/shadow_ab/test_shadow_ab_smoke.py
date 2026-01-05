from __future__ import annotations

from pathlib import Path
import json

from scripts.shadow_ab.contracts import Snapshot
from scripts.shadow_ab.runner import RunConfig, run_shadow_ab

def test_shadow_ab_smoke(tmp_path: Path) -> None:
    # Use temp artifacts root to keep repo clean during tests
    cfg = RunConfig(artifacts_root=tmp_path / "artifacts" / "shadow_ab", latency_budget_ms=9999.0)

    snaps = [
        Snapshot(ts="2026-01-01T00:00:00Z", symbol="BTC-USD", price=100.0, volume=1.0, spread=0.1),
        Snapshot(ts="2026-01-01T00:01:00Z", symbol="BTC-USD", price=101.0, volume=1.2, spread=0.1),
        Snapshot(ts="2026-01-01T00:02:00Z", symbol="BTC-USD", price=99.5, volume=0.9, spread=0.2),
    ]

    run_dir = run_shadow_ab(snaps, cfg, run_id="test_run")
    assert run_dir.exists()

    # Minimal artifact assertions
    required = [
        "inputs_manifest.json",
        "baseline_decisions.jsonl",
        "candidate_decisions.jsonl",
        "merged_decisions.jsonl",
        "metrics_onepage.txt",
        "metrics_detail.json",
        "anomalies.log",
    ]
    for name in required:
        assert (run_dir / name).exists(), f"missing artifact: {name}"

    # Validate JSON parse
    manifest = json.loads((run_dir / "inputs_manifest.json").read_text())
    assert manifest["run_id"] == "test_run"
