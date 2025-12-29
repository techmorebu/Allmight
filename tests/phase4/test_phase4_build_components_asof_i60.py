from __future__ import annotations

import csv
import subprocess
import sys
from pathlib import Path


def test_build_components_asof_i60_produces_expected_csvs():
    subprocess.check_call([sys.executable, "scripts/phase4/build_components_asof.py", "--asof", "i60"])

    base = "outputs/replay"
    expected = [
        f"{base}/sweep_l2_GRID_BTC_ETH_XRP_XAU_15m_i60.csv",
        f"{base}/liquidity_arch_l3_GRID_BTC_ETH_XRP_XAU_15m_i60.csv",
        f"{base}/macro_score_GRID_BTC_ETH_XRP_XAU_15m_i60.csv",
        f"{base}/risk_penalty_GRID_BTC_ETH_XRP_XAU_15m_i60.csv",
    ]
    for p in expected:
        path = Path(p)
        assert path.exists(), f"missing expected component csv: {path}"

        with path.open("r", newline="", encoding="utf-8") as f:
            r = csv.reader(f)
            header = next(r)
        assert header == ["asset", "value", "audit_json"], f"unexpected header in {path}: {header}"
