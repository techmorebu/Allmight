from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


POLICY_PATH = Path("config/phase8/audit_sink_policy_v0.json")
ENV_SINK_PATH = "ALLMIGHT_AUDIT_SINK_PATH"
SCHEMA_VERSION = "AUDIT_SINK_V0"


@dataclass(frozen=True)
class AuditSinkPolicy:
    sink_path: Path

    @staticmethod
    def load(path: Path = POLICY_PATH) -> "AuditSinkPolicy":
        data = json.loads(path.read_text(encoding="utf-8"))
        sink_path = Path(data.get("sink_path", "outputs/audit/allmight_audit.jsonl"))
        return AuditSinkPolicy(sink_path=sink_path)


def _git_head_short() -> str:
    try:
        out = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
        return out
    except Exception:
        return "UNKNOWN"


def resolve_sink_path(policy: Optional[AuditSinkPolicy] = None) -> Path:
    # Hermetic override for tests / operator drills:
    # If ALLMIGHT_AUDIT_SINK_PATH is set, it wins.
    v = os.environ.get(ENV_SINK_PATH)
    if v:
        return Path(v)

    pol = policy or AuditSinkPolicy.load()
    return pol.sink_path


def write_audit_event(event: Dict[str, Any], *, sink_path: Optional[Path] = None) -> Dict[str, Any]:
    """Write a single canonical JSONL audit record (append-only).

    Behavior:
    - Adds schema_version, ts, ts_unix, git_head
    - Appends to the canonical sink path
    - Creates parent dirs if needed
    """
    sp = sink_path or resolve_sink_path()

    now = datetime.now(timezone.utc)
    rec: Dict[str, Any] = dict(event)
    rec["schema_version"] = SCHEMA_VERSION
    rec["ts"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    rec["ts_unix"] = int(time.time())
    rec["git_head"] = _git_head_short()

    sp.parent.mkdir(parents=True, exist_ok=True)
    with sp.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")

    return rec
