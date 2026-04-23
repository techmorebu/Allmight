from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


def _run(cmd: list[str]) -> tuple[int, str]:
    p = subprocess.run(cmd, text=True, capture_output=True)
    out = (p.stdout + p.stderr).strip()
    return p.returncode, out


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 6: Operator drill (proof sequence).")
    ap.add_argument("--symbol", default="BTC/USD")
    ap.add_argument("--side", default="buy", choices=["buy", "sell"])
    ap.add_argument("--usd-notional", type=float, default=2.0)
    ap.add_argument("--ack", default="I ACKNOWLEDGE")
    args = ap.parse_args()

    steps: list[dict[str, Any]] = []
    arming_path = Path("outputs/phase6/arming/phase6_arming.jsonl")

    # Step 0: remove arming record (local outputs only; untracked)
    if arming_path.exists():
        arming_path.unlink()

    # 1) Expect deny: no arming record
    rc, out = _run([
        "python", "scripts/phase5/run_phase5_live_order.py",
        "--symbol", args.symbol, "--side", args.side, "--usd-notional", str(args.usd_notional),
        "--dry-run", "--i-acknowledge-live-risk", "--ack", args.ack
    ])
    steps.append({"step": "deny_without_arming", "rc": rc, "out": out})

    # 2) Run arming ceremony
    rc, out = _run(["python", "scripts/phase6/arming_ceremony.py", "--i-acknowledge-live-risk", "--ack", args.ack])
    steps.append({"step": "arming_ceremony", "rc": rc, "out": out})

    # 3) Dry-run order should pass guard (still DRY_RUN)
    rc, out = _run([
        "python", "scripts/phase5/run_phase5_live_order.py",
        "--symbol", args.symbol, "--side", args.side, "--usd-notional", str(args.usd_notional),
        "--dry-run", "--i-acknowledge-live-risk", "--ack", args.ack
    ])
    steps.append({"step": "dry_run_after_arming", "rc": rc, "out": out})

    # 4) Kill switch deny path
    ks = Path("config/phase5/KILL_SWITCH")
    ks.parent.mkdir(parents=True, exist_ok=True)
    ks.write_text("KILL", encoding="utf-8")

    rc, out = _run([
        "python", "scripts/phase5/run_phase5_live_order.py",
        "--symbol", args.symbol, "--side", args.side, "--usd-notional", str(args.usd_notional),
        "--dry-run", "--i-acknowledge-live-risk", "--ack", args.ack
    ])
    steps.append({"step": "deny_with_kill_switch", "rc": rc, "out": out})

    try:
        ks.unlink()
    except FileNotFoundError:
        pass

    report = {
        "event": "PHASE6_OPERATOR_DRILL",
        "steps": steps,
        "result": "OK" if (
            ("E_ARMING_REQUIRED" in steps[0]["out"]) and
            (steps[1]["rc"] == 0) and
            ("DRY_RUN" in steps[2]["out"]) and
            ("E_KILL_SWITCH_ACTIVE" in steps[3]["out"])
        ) else "FAIL"
    }

    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report["result"] == "OK" else 2


if __name__ == "__main__":
    raise SystemExit(main())
