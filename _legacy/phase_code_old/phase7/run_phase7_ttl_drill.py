from __future__ import annotations

import json
import time
from pathlib import Path

from scripts.phase6.arming_guard import require_recent_arming, ArmingDeny


def _write_policy(ttl: int) -> None:
    p = Path("config/phase6/arming_policy_v0.json")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"arming_ttl_seconds": ttl}, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _write_arming(ts_unix: float) -> Path:
    p = Path("outputs/phase6/arming/phase6_arming.jsonl")
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"event": "PHASE6_ARMING_CEREMONY", "ts_unix": ts_unix}) + "\n", encoding="utf-8")
    return p


def main() -> int:
    ttl = 2
    _write_policy(ttl=ttl)

    # Write a stale record (older than ttl)
    arming_path = _write_arming(ts_unix=time.time() - 9999)

    try:
        require_recent_arming()
        print("UNEXPECTED: allowed")
        return 2
    except ArmingDeny as e:
        print(f"EXPECTED_DENY: {e.code} :: {e.message}")
        print("META:", e.meta)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
