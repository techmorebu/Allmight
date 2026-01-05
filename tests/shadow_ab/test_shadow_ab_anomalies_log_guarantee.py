from __future__ import annotations

from pathlib import Path
import pytest

from scripts.shadow_ab.contracts import Snapshot
from scripts.shadow_ab.runner import RunConfig, run_shadow_ab


def test_anomalies_log_exists_even_on_exception(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    # Use temp artifacts root to keep repo clean during tests
    cfg = RunConfig(artifacts_root=tmp_path / "artifacts" / "shadow_ab", latency_budget_ms=9999.0)

    snaps = [
        Snapshot(ts="2026-01-01T00:00:00Z", symbol="BTC-USD", price=100.0, volume=1.0, spread=0.1),
    ]

    # Force an exception during baseline decide() to simulate mid-run failure.
    from scripts.shadow_ab import pipelines as pl

    def boom(self, snap):  # type: ignore[no-untyped-def]
        raise RuntimeError("synthetic failure for anomalies.log guarantee test")

    monkeypatch.setattr(pl.BaselinePipeline, "decide", boom)

    run_id = "test_run_exception"
    with pytest.raises(RuntimeError):
        run_shadow_ab(snaps, cfg, run_id=run_id)

    run_dir = cfg.artifacts_root / run_id
    assert run_dir.exists(), "run dir should exist even if run fails after creation"
    assert (run_dir / "anomalies.log").exists(), "anomalies.log must exist even on exception"
