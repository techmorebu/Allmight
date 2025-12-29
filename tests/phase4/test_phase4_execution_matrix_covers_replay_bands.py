from pathlib import Path
import json

import yaml

from scripts.phase4.run_phase4_control_layer import _find_activation_bands


def test_execution_matrix_covers_all_bands_in_last_replay():
    regime_path = Path("outputs/replay/regime_state_GRID_BTC_ETH_XRP_XAU_15m_last.json")
    assert regime_path.exists(), f"Missing {regime_path}"

    obj = json.loads(regime_path.read_text(encoding="utf-8"))
    bands_by_asset = _find_activation_bands(obj)
    bands = sorted(set(bands_by_asset.values()))
    assert bands, "No activation_band values found in regime_state JSON"

    cfg_path = Path("config/phase4/execution_matrix.yaml")
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    band_cfg = cfg.get("bands") or {}

    missing = [b for b in bands if b not in band_cfg]
    assert not missing, f"execution_matrix.yaml missing bands: {missing}"
