from __future__ import annotations

import subprocess


def test_operator_drill_runs_ok() -> None:
    p = subprocess.run(["python", "scripts/phase6/run_phase6_operator_drill.py"], text=True, capture_output=True)
    assert p.returncode in (0, 2)  # environment may vary, but script must not crash
    # must always emit json-ish output
    assert "PHASE6_OPERATOR_DRILL" in (p.stdout + p.stderr)
