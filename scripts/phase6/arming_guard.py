from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any


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

    # best-effort parse of ts_unix not present; use file mtime as conservative approximation
    mtime = path.stat().st_mtime
    age = int(time.time() - mtime)

    if age > int(max_age_seconds):
        raise ArmingDeny("E_ARMING_STALE", "Arming record is stale; rerun Phase 6 arming ceremony.", {"path": str(path), "age_seconds": age, "max_age_seconds": int(max_age_seconds)})

    return rec
