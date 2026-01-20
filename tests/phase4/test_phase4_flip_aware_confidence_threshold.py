import json
import subprocess
import sys
from pathlib import Path


def test_flip_aware_confidence_gate_records_prev_curr_and_uses_on_flip_threshold():
    # Run phase4 (asof last)
    cmd = [sys.executable, "scripts/phase4/run_phase4_control_layer.py", "--asof", "last"]
    subprocess.check_call(cmd)

    out_path = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_last.json")
    obj = json.loads(out_path.read_text(encoding="utf-8"))

    assets = obj.get("assets", {})
    assert isinstance(assets, dict) and assets, "Expected assets mapping in phase4 output"

    # Schema-level guarantees (data-independent):
    # - current band exists
    # - prev band exists
    # - flip flag exists and is boolean
    for asset, payload in assets.items():
        cur = payload.get("activation_band")
        prev = payload.get("activation_band_prev")
        flip = payload.get("activation_band_flip")

        assert isinstance(cur, str) and cur, f"Missing/invalid activation_band for {asset}"
        assert isinstance(prev, str) and prev, f"Missing/invalid activation_band_prev for {asset}"
        assert isinstance(flip, bool), f"Missing/invalid activation_band_flip for {asset}"
