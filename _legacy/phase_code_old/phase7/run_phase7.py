from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from scripts.phase7.adapters import ADAPTERS


Reason = str


def _sha256_json(obj: Any) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _idempotency_key(asof: str, plan_id: str, adapter: str, mode: str, plan_sha256: str) -> str:
    raw = f"{asof}|{plan_id}|{adapter}|{mode}|{plan_sha256}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load_adapter_caps() -> Dict[str, Dict[str, Any]]:
    p = Path("config/phase7/adapter_capabilities.json")
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _adapter_is_safe(adapter: str, caps: Dict[str, Dict[str, Any]]) -> bool:
    info = caps.get(adapter)
    if info is None:
        # safe-by-default: unknown adapters are NOT safe
        return False
    return (info.get("side_effects") is False) and (info.get("network_required") is False)


def _is_suppressed(plan: Dict[str, Any]) -> bool:
    return str(plan.get("status", "")).upper() == "SUPPRESSED"


def _read_receipts(receipts_path: Path) -> Dict[str, Any]:
    if receipts_path.exists():
        return json.loads(receipts_path.read_text(encoding="utf-8"))
    return {"receipts": []}


def _append_receipt(receipts_path: Path, receipt: Dict[str, Any]) -> None:
    payload = _read_receipts(receipts_path)
    payload.setdefault("receipts", []).append(receipt)
    receipts_path.parent.mkdir(parents=True, exist_ok=True)
    receipts_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _write_trace(trace_path: Path, plan_id: str, event: Dict[str, Any]) -> None:
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    if trace_path.exists():
        data = json.loads(trace_path.read_text(encoding="utf-8"))
    else:
        data = {"plan_id": plan_id, "events": []}
    data["events"].append(event)
    trace_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def run_phase7(
    plans_path: Union[str, Path],
    asof: str,
    adapter: str,
    mode: str,
    armed: bool,
    plan_id: Optional[str],
    outdir: Union[str, Path],
) -> Dict[str, Any]:
    """
    Phase-7 (guarded, minimal): consumes Phase-6 plans and emits receipts + traces.
    Executes nothing.

    Properties:
    - idempotency blocks reruns (checked BEFORE other gates)
    - suppressed plans denied
    - unknown/unsafe adapters require armed
    - adapter.prepare() enriches receipt with deterministic prepared action (no execution)
    - always writes per-plan trace
    """
    plans_path = Path(plans_path)
    outdir = Path(outdir)

    data = json.loads(plans_path.read_text(encoding="utf-8"))
    plans = data.get("plans", [])

    # select plan
    selected: Optional[Dict[str, Any]] = None
    if plan_id is None:
        selected = plans[0] if plans else None
    else:
        for p in plans:
            if p.get("plan_id") == plan_id:
                selected = p
                break

    if selected is None:
        raise ValueError(f"plan_id not found: {plan_id}")

    pid = str(selected.get("plan_id"))
    plan_sha = _sha256_json(selected)

    phase7_dir = outdir / "phase7" / str(asof)
    receipts_path = phase7_dir / "phase7_execution_receipts.json"
    trace_path = phase7_dir / "traces" / f"{pid}.json"

    idem_key = _idempotency_key(str(asof), pid, str(adapter), str(mode), plan_sha)

    # --- Idempotency FIRST: block reruns if FINAL receipt already exists for idem_key
    existing = _read_receipts(receipts_path)
    for r in existing.get("receipts", []):
        if r.get("idempotency_key") == idem_key and r.get("final") is True:
            now = _utc_now_iso()
            receipt = {
                "asof": str(asof),
                "plan_id": pid,
                "plan_sha256": plan_sha,
                "adapter": str(adapter),
                "mode": str(mode),
                "armed": bool(armed),
                "decision": "DENY",
                "reason_codes": ["IDEMPOTENT_ALREADY_FINAL"],
                "gating_chain": selected.get("gating_chain", []),
                "started_at": now,
                "finished_at": now,
                "result": {"status": "NOT_RUN", "details": {}},
                "idempotency_key": idem_key,
                "final": True,
            }
            _write_trace(trace_path, pid, {
                "ts": now,
                "event": "DENY",
                "reason_codes": receipt["reason_codes"],
                "idempotency_key": idem_key,
            })
            return {"receipts": [receipt]}

    # --- Gates
    decision = "ALLOW"
    reasons: List[Reason] = []

    plan_asof = str(selected.get("asof"))
    if plan_asof != str(asof):
        decision = "HALT"
        reasons = ["ASOF_MISMATCH"]

    if decision != "HALT" and _is_suppressed(selected):
        decision = "DENY"
        reasons = ["SUPPRESSED_PLAN"]

    caps = _load_adapter_caps()
    safe = _adapter_is_safe(str(adapter), caps)

    if decision == "ALLOW" and (not safe) and (not armed):
        decision = "DENY"
        reasons = ["NOT_ARMED"]

    now = _utc_now_iso()
    receipt = {
        "asof": str(asof),
        "plan_id": pid,
        "plan_sha256": plan_sha,
        "adapter": str(adapter),
        "mode": str(mode),
        "armed": bool(armed),
        "decision": decision,
        "reason_codes": list(reasons),
        "gating_chain": selected.get("gating_chain", []),
        "started_at": now,
        "finished_at": now,
        "result": {"status": "NOT_RUN", "details": {}},
        "idempotency_key": idem_key,
        "final": True,
    }

    # Adapter prepare (no execution): attach deterministic prepared action when available
    adapter_obj = ADAPTERS.get(str(adapter))
    if adapter_obj is not None and receipt["decision"] != "HALT":
        prepared = adapter_obj.prepare(selected)
        receipt["result"]["details"]["prepared"] = {
            "adapter": prepared.adapter,
            "plan_id": prepared.plan_id,
            "payload": prepared.payload,
        }

    # Persist + trace
    _append_receipt(receipts_path, receipt)
    _write_trace(trace_path, pid, {
        "ts": now,
        "event": decision,
        "reason_codes": receipt["reason_codes"],
        "idempotency_key": idem_key,
    })

    return {"receipts": [receipt]}
