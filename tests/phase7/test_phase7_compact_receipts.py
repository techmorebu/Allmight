import json
from pathlib import Path

from scripts.phase7.run_phase7 import run_phase7
from scripts.phase7.tools.compact_receipts import compact_receipts


FIX = "tests/fixtures/phase7/phase6_execution_plans_last.json"

def test_compact_receipts_keeps_last_n(tmp_path):
    outdir = tmp_path / "outputs"

    # Create many UNIQUE receipts for the same plan_id by varying mode each time.
    # This bypasses idempotency collisions intentionally for this compaction test.
    for i in range(12):
        run_phase7(FIX, "last", "paper", f"paper_mode_{i}", False, "plan_OK_001", outdir)

    receipts_path = outdir / "phase7" / "last" / "phase7_execution_receipts.json"
    before = json.loads(receipts_path.read_text(encoding="utf-8"))
    assert len(before["receipts"]) == 12

    compact_receipts(receipts_path, keep_last_n=5)

    after = json.loads(receipts_path.read_text(encoding="utf-8"))
    assert len(after["receipts"]) == 5
    assert all(r["plan_id"] == "plan_OK_001" for r in after["receipts"])
