from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class LiveDeny(Exception):
    code: str
    message: str
    details: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {"status": "DENY", "code": self.code, "message": self.message, "details": self.details}


def _read_json(p: Path) -> Any:
    return json.loads(p.read_text(encoding="utf-8"))


def _append_jsonl(path: Path, obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(obj, sort_keys=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_envelope(config_path: str | Path = "config/phase5/live_execution_envelope_v0.json") -> Dict[str, Any]:
    p = Path(config_path)
    if not p.exists():
        raise LiveDeny("E_NO_ENVELOPE", "Live execution envelope file not found.", {"config_path": str(p)})
    data = _read_json(p)
    if not isinstance(data, dict):
        raise LiveDeny("E_BAD_ENVELOPE", "Live execution envelope must be a JSON object.", {"config_path": str(p)})
    if data.get("schema") != "live_execution_envelope_v0":
        raise LiveDeny("E_ENVELOPE_SCHEMA", "Unexpected live envelope schema.", {"schema": data.get("schema")})
    if data.get("phase") != 5:
        raise LiveDeny("E_ENVELOPE_PHASE", "Live envelope must be phase==5.", {"phase": data.get("phase")})
    return data


def deny_if_kill_switch(envelope: Dict[str, Any]) -> None:
    ks = envelope.get("kill_switch") or {}
    if not isinstance(ks, dict):
        return
    if not ks.get("halt_on_exists"):
        return
    p = Path(str(ks.get("path") or ""))
    if str(p) and p.exists():
        raise LiveDeny("E_KILL_SWITCH_ACTIVE", "Kill switch file exists; live execution denied.", {"kill_switch_path": str(p)})


def _require_env(envelope: Dict[str, Any]) -> None:
    req = envelope.get("required_env") or {}
    if not isinstance(req, dict):
        return
    for k, v in req.items():
        key = str(k)
        expected = str(v)
        actual = os.environ.get(key)
        if actual != expected:
            raise LiveDeny("E_ENV_NOT_SET", "Required environment variable not set for live execution.", {"required": {key: expected}, "actual": actual})


def _require_adapter_allowed(envelope: Dict[str, Any], adapter_id: str) -> None:
    allowed = envelope.get("allowed_adapters")
    if not isinstance(allowed, list):
        raise LiveDeny("E_ALLOWED_ADAPTERS", "allowed_adapters must be a list.", {"type": type(allowed).__name__})
    if adapter_id not in [str(x) for x in allowed]:
        raise LiveDeny("E_ADAPTER_NOT_ALLOWED", "Adapter is not allowlisted for live execution.", {"adapter_id": adapter_id, "allowed_adapters": allowed})


def _require_operator_ack(envelope: Dict[str, Any], ack: Optional[str]) -> None:
    oa = envelope.get("operator_ack") or {}
    if not isinstance(oa, dict):
        return
    if not oa.get("required"):
        return
    phrase = str(oa.get("phrase") or "")
    if (ack or "") != phrase:
        raise LiveDeny("E_OPERATOR_ACK", "Operator acknowledgement missing or incorrect.", {"required_phrase": phrase})


def assert_live_allowed(adapter_id: str, *, ack: Optional[str], config_path: str | Path = "config/phase5/live_execution_envelope_v0.json") -> Dict[str, Any]:
    env = load_envelope(config_path)
    if not env.get("allow_live"):
        raise LiveDeny("E_LIVE_DISABLED", "Live execution is disabled by envelope.", {"allow_live": False})
    deny_if_kill_switch(env)
    _require_env(env)
    _require_adapter_allowed(env, adapter_id)
    _require_operator_ack(env, ack)
    return env


def emit_live_audit_event(envelope: Dict[str, Any], event: Dict[str, Any]) -> None:
    audit = envelope.get("audit") or {}
    if not isinstance(audit, dict):
        return
    d = Path(str(audit.get("dir") or "outputs/phase5/live_audit"))
    p = d / "phase5_live_audit.jsonl"
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "ts_unix": int(time.time()),
        **{k: event[k] for k in sorted(event.keys())},
    }
    _append_jsonl(p, rec)
