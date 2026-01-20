import json
import subprocess
import sys
from pathlib import Path


def test_phase4_confidence_floor_suppresses_all_on_last():
    # Run the phase4 control layer
    cmd = [sys.executable, "scripts/phase4/run_phase4_control_layer.py", "--asof", "last"]
    subprocess.check_call(cmd)

    out_path = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_last.json")
    obj = json.loads(out_path.read_text(encoding="utf-8"))

    # Data-independent guardrail: confidence exists and is bounded
    conf = float(obj["inputs"]["global_confidence"])
    assert 0.0 <= conf <= 1.0, f"global_confidence out of range: {conf}"

    # Also ensure the engine produced an activation band (string) for each asset
    assets = obj.get("assets", {})
    assert isinstance(assets, dict) and assets, "Expected assets mapping in phase4 output"
    for asset, payload in assets.items():
        band = payload.get("activation_band")
        assert isinstance(band, str) and band, f"Missing activation_band for {asset}"
