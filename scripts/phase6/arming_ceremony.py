from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any


def _sh(cmd: list[str]) -> str:
    return subprocess.check_output(cmd, text=True).strip()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def build_arming_snapshot(envelope_path: Path) -> dict[str, Any]:
    head = _sh(["git", "rev-parse", "HEAD"])
    live_env = os.environ.get("ALLMIGHT_LIVE", "UNSET")
    kill_switch = Path("config/phase5/KILL_SWITCH").exists()

    snapshot: dict[str, Any] = {
        "git_head": head,
        "env_ALLMIGHT_LIVE": live_env,
        "kill_switch_active": bool(kill_switch),
        "envelope_path": str(envelope_path),
        "envelope_sha256": _sha256_file(envelope_path) if envelope_path.exists() else None,
    }
    return snapshot


def main() -> int:
    ap = argparse.ArgumentParser(description="Phase 6: arming ceremony (fail-closed).")
    ap.add_argument("--envelope", default="config/phase5/live_execution_envelope_v0.json")
    ap.add_argument("--i-acknowledge-live-risk", action="store_true")
    ap.add_argument("--ack", default=None)
    ap.add_argument("--out", default="outputs/phase6/arming/phase6_arming.jsonl")
    args = ap.parse_args()

    envelope = Path(args.envelope)

    # Fail-closed: require explicit operator flag + ack phrase (optional but recommended)
    if not args.i_acknowledge_live_risk:
        print("DENY: E_FLAG_REQUIRED :: Missing required operator flag.")
        return 2

    if args.ack is None or "ACKNOWLEDGE" not in args.ack.upper():
        print("DENY: E_ACK_REQUIRED :: Missing/weak ack string (must contain 'ACKNOWLEDGE').")
        return 2

    snap = build_arming_snapshot(envelope)

    record = {
        "event": "PHASE6_ARMING_CEREMONY",
        "ts": _sh(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"]),
        "snapshot": snap,
        "note": "Ceremony does not enable allow_live; it records intent + environment state only.",
        "result": "OK",
    }

    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(record, sort_keys=True) + "\n", encoding="utf-8") if not outp.exists() else outp.write_text(outp.read_text(encoding="utf-8") + json.dumps(record, sort_keys=True) + "\n", encoding="utf-8")

    print(json.dumps(record, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
