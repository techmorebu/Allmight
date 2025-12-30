import json
from pathlib import Path
import subprocess
import sys


def test_phase4_confidence_floor_suppresses_all_on_last():
    # Run the phase4 control layer
    cmd = [sys.executable, "scripts/phase4/run_phase4_control_layer.py", "--asof", "last"]
    subprocess.check_call(cmd)

    out_path = Path("outputs/phase4/phase4_control_GRID_BTC_ETH_XRP_XAU_15m_last.json")
    obj = json.loads(out_path.read_text(encoding="utf-8"))

    conf = float(obj["inputs"]["global_confidence"])
    assert conf < 0.25, "This test assumes current replay has low confidence; update test if replay changes."

    for asset, payload in obj["assets"].items():
        perms = payload["permissions"]
        assert perms["allow_arbitrage"] is False
        assert perms["allow_flashloan"] is False
        assert perms["allow_directional"] is False

        overrides = payload.get("overrides_applied") or []
        assert any(o.get("type") == "confidence_floor" for o in overrides), f"Missing confidence override for {asset}"
