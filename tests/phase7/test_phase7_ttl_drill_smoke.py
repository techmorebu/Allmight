from __future__ import annotations

import subprocess
import sys


def test_ttl_drill_denies_stale() -> None:
    p = subprocess.run(
        [sys.executable, "scripts/phase7/run_phase7_ttl_drill.py"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert "EXPECTED_DENY: E_ARMING_STALE" in (p.stdout + p.stderr)
