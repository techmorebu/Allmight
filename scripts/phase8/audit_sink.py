from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Dict, Optional


def _now() -> tuple[str, int]:
    ts_unix = int(time.time())
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts_unix))
    return ts, ts_unix


def _git_head() -> str:
    try:
        head = Path(".git/HEAD").read_text().strip()
        if head.startswith("ref:"):
            ref = head.split(" ", 1)[1]
            p = Path(".git") / ref
            if p.exists():
                return p.read_text().strip()[:12]
        return head[:12]
    except Exception:
        return "UNKNOWN"


def write_audit_event(event: Dict[str, Any]) -> None:
    cfg = Path("config/phase8/audit_sink_policy_v0.json")
    if not cfg.exists():
        return

    pol = json.loads(cfg.read_text())
    if not pol.get("enabled", True):
        return

    ts, ts_unix = _now()
    out = dict(event)
    out.setdefault("schema_version", pol.get("schema_version", "AUDIT_SINK_V0"))
    out.setdefault("ts", ts)
    out.setdefault("ts_unix", ts_unix)
    out.setdefault("git_head", _git_head())

    sink = Path(pol["sink_path"])
    sink.parent.mkdir(parents=True, exist_ok=True)

    try:
        with sink.open("a", encoding="utf-8") as f:
            f.write(json.dumps(out, sort_keys=True) + "\n")
    except Exception:
        # Fail-closed: never allow logging failure to alter behavior
        return
