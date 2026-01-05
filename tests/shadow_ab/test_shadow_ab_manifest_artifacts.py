from __future__ import annotations

from pathlib import Path
import json

from scripts.shadow_ab.contracts import Snapshot
from scripts.shadow_ab.runner import RunConfig, run_shadow_ab
from scripts.shadow_ab.io import required_artifacts


def test_manifest_lists_required_artifacts(tmp_path: Path) -> None:
    cfg = RunConfig(artifacts_root=tmp_path / "artifacts" / "shadow_ab", latency_budget_ms=9999.0)

    snaps = [
        Snapshot(ts="2026-01-01T00:00:00Z", symbol="BTC-USD", price=100.0, volume=1.0, spread=0.1),
        Snapshot(ts="2026-01-01T00:01:00Z", symbol="BTC-USD", price=101.0, volume=1.2, spread=0.1),
    ]

    out_dir = run_shadow_ab(snaps, cfg, run_id="manifest_artifacts_test")
    m = json.loads((out_dir / "inputs_manifest.json").read_text(encoding="utf-8"))

    arts = (m.get("artifacts") or {})
    assert arts.get("required") == required_artifacts()
    # "written" must include at least all required artifacts (some may be added later, but required should be present).
    written = set(arts.get("written") or [])
    for name in required_artifacts():
        assert name in written, f"manifest missing written artifact: {name}"
    assert arts.get("anomalies_log_present") is True
