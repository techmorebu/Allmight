import json
from pathlib import Path
import subprocess
import sys


def test_flip_aware_confidence_gate_records_prev_curr_and_uses_on_flip_threshold():
    # Run phase4 (asof last)
    cmd = [sys.executable, "scripts/phase4/run_phase4_control_layer.py", "--asof", "last"]
    subprocess.check_call(cmd)

    out_path = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_last.json")
    obj = json.loads(out_path.read_text(encoding="utf-8"))

    # Pull configured on_flip threshold from config file via output override fields
    for asset, payload in obj["assets"].items():
        assert payload.get("activation_band_prev") is not None, "Expected prev band for flip-aware gating"
        assert payload.get("activation_band_flip") is True, "Expected flip=True in current replay slice"

        overrides = payload.get("overrides_applied") or []
        # must suppress due to low confidence and use the on_flip threshold
        floor = [o for o in overrides if o.get("type") == "confidence_floor"]
        assert floor, f"Missing confidence_floor override for {asset}"
        o = floor[0]

        # audit fields must exist
        assert o.get("band_prev") == payload.get("activation_band_prev")
        assert o.get("band_curr") == payload.get("activation_band")
        assert o.get("band_flip") is True

        thr_used = float(o.get("min_confidence"))
        # Hard-coded from patched execution_matrix default; if config changes, update this test explicitly.
        assert abs(thr_used - 0.35) < 1e-12, f"Expected on_flip threshold 0.35, got {thr_used}"
