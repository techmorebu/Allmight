from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

def _load_arming_policy() -> dict[str, Any]:
    p = Path("config/phase6/arming_policy_v0.json")
    if not p.exists():
        # fail-closed
        return {"arming_ttl_seconds": 0}
    try:
        obj = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(obj, dict):
            return {"arming_ttl_seconds": 0}
        return obj
    except Exception:
        return {"arming_ttl_seconds": 0}




class ArmingDeny(Exception):
    def __init__(self, code: str, message: str, meta: dict[str, Any] | None = None) -> None:
        super().__init__(code, message, meta or {})
        self.code = code
        self.message = message
        self.meta = meta or {}


def _read_last_jsonl(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    lines = [ln.strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    if not lines:
        return None
    try:
        return json.loads(lines[-1])
    except json.JSONDecodeError:
        return None


def require_recent_arming(
    path: Path = Path("outputs/phase6/arming/phase6_arming.jsonl"),
    max_age_seconds: int = 15 * 60,
) -> dict[str, Any]:
    """Fail-closed: require a recent Phase 6 arming ceremony record."""
    rec = _read_last_jsonl(path)
    if rec is None:
        raise ArmingDeny("E_ARMING_REQUIRED", "No arming record found; run Phase 6 arming ceremony first.", {"path": str(path)})

    # TTL policy (fail-closed): if caller didn't explicitly pass max_age_seconds, use policy TTL
    policy = _load_arming_policy()
    ttl = int(policy.get("arming_ttl_seconds", 0) or 0)
    if ttl <= 0 and max_age_seconds == 15 * 60:
        # caller used default; policy missing/invalid => fail-closed
        raise ArmingDeny("E_ARMING_POLICY_INVALID", "Arming policy missing/invalid; fail-closed.", {"policy_path": "config/phase6/arming_policy_v0.json"})
    effective_max = int(max_age_seconds)
    if effective_max == 15 * 60:
        # only override when default was used
        effective_max = ttl if ttl > 0 else effective_max

    # Prefer event timestamp if present; else fall back to file mtime
    ts_unix = rec.get("ts_unix") if isinstance(rec, dict) else None
    if isinstance(ts_unix, (int, float)):
        age = int(time.time() - float(ts_unix))
    else:
        mtime = path.stat().st_mtime
        age = int(time.time() - mtime)
    if age > int(effective_max):
        raise ArmingDeny("E_ARMING_STALE", "Arming record is stale; rerun Phase 6 arming ceremony.", {"path": str(path), "age_seconds": age, "max_age_seconds": int(effective_max)})

    return rec
