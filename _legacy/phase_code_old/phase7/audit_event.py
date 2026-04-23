from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def utc_now_unix() -> int:
    return int(time.time())


@dataclass(frozen=True)
class AuditEvent:
    phase: str
    event: str
    adapter_id: str
    action: Optional[str] = None
    result: str = "INFO"            # INFO|OK|DENY|ERROR
    deny_code: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None

    def to_record(self) -> Dict[str, Any]:
        rec: Dict[str, Any] = {
            "ts": utc_now_iso(),
            "ts_unix": utc_now_unix(),
            "phase": self.phase,
            "event": self.event,
            "adapter_id": self.adapter_id,
            "result": self.result,
        }
        if self.action is not None:
            rec["action"] = self.action
        if self.deny_code is not None:
            rec["deny_code"] = self.deny_code
        if self.payload:
            rec.update(self.payload)
        return rec


def append_jsonl(path: Path, rec: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")


def emit_phase5_audit(
    *,
    event: str,
    adapter_id: str,
    action: Optional[str] = None,
    result: str = "INFO",
    deny_code: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    audit_path: str = "outputs/phase5/live_audit/phase5_live_audit.jsonl",
) -> None:
    ev = AuditEvent(
        phase="5",
        event=event,
        adapter_id=adapter_id,
        action=action,
        result=result,
        deny_code=deny_code,
        payload=payload,
    )
    append_jsonl(Path(audit_path), ev.to_record())
