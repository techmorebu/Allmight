from pathlib import Path
import pytest

from scripts.phase4.run_phase4_control_layer import load_phase4_configs


def test_phase4_configs_exist_and_validate():
    cfg_dir = Path("config/phase4")
    assert (cfg_dir / "weights.yaml").exists()
    assert (cfg_dir / "normalization.yaml").exists()
    assert (cfg_dir / "execution_matrix.yaml").exists()

    cfgs = load_phase4_configs(cfg_dir)
    assert isinstance(cfgs.weights, dict)
    assert isinstance(cfgs.normalization, dict)
    assert isinstance(cfgs.execution_matrix, dict)


def test_weights_sum_to_one_enforced(tmp_path: Path):
    # Copy configs, then break weights sum deterministically
    cfg_dir = tmp_path / "phase4"
    cfg_dir.mkdir(parents=True, exist_ok=True)

    (cfg_dir / "weights.yaml").write_text(
        """schema_version: 1
policy:
  sum_to_one: true
  allow_negative: false
weights:
  a: 0.6
  b: 0.6
""",
        encoding="utf-8",
    )
    (cfg_dir / "normalization.yaml").write_text(
        """schema_version: 1
components:
  a: {method: range, min: 0.0, max: 1.0, invert: false}
  b: {method: range, min: 0.0, max: 1.0, invert: false}
""",
        encoding="utf-8",
    )
    (cfg_dir / "execution_matrix.yaml").write_text(
        """schema_version: 1
bands:
  NORMAL:
    allow_directional: true
    allow_flashloan: true
    allow_arbitrage: true
confidence:
  enabled: false
risk_penalty:
  enabled: false
""",
        encoding="utf-8",
    )

    with pytest.raises(ValueError):
        load_phase4_configs(cfg_dir)
