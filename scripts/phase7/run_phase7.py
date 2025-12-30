from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


Reason = str


def _sha256_json(obj: Any) -> str:
    """
    Stable hash of a JSON-serializable object.
    Must be deterministic: sorted keys, compact separators.
    """
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _utc_now_iso() -> str:
    # For now we allow real timestamps; determinism tightening can come later.
    return datetime.now(timezone.utc).isoformat()


def _load_adapter_caps() -> Dict[str, Dict[str, Any]]:
    p = Path("config/phase7/adapter_capabilities.json")
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def _adapter_is_safe(adapter: str, caps: Dict[str, Dict[str, Any]]) -> bool:
    info = caps.get(adapter)
    if info is None:
        # Safe-by-default: unknown adapters are NOT safe.
        return False
    return (info.get("side_effects") is False) and (info.get("network_required") is False)


def _is_suppressed(plan: Dict[str, Any]) -> bool:
    return str(plan.get("status", "")).upper() == "SUPPRESSED"


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
    Minimal Phase-7 runner used by guardrail tests.

    Contract:
    - consumes Phase-6 plans JSON
    - enforces SUPPRESSED denial
    - enforces NOT_ARMED denial for unknown/unsafe adapters
    - emits receipts structure (v0)
    - does NOT execute anything
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

    # temporal integrity (minimal): plan must match requested asof
    plan_asof = str(selected.get("asof"))
    if plan_asof != str(asof):
        decision = "HALT"
        reasons: List[Reason] = ["ASOF_MISMATCH"]
    else:
        decision = "ALLOW"
        reasons = []

    # Gate 1: suppressed => deny
    if decision != "HALT" and _is_suppressed(selected):
        decision = "DENY"
        reasons = ["SUPPRESSED_PLAN"]

    # Gate 2: arming enforcement (safe-by-default)
    caps = _load_adapter_caps()
    safe = _adapter_is_safe(adapter, caps)

    if decision == "ALLOW" and (not safe) and (not armed):
        decision = "DENY"
        reasons = ["NOT_ARMED"]

    receipt = {
        "asof": str(asof),
        "plan_id": str(selected.get("plan_id")),
        "plan_sha256": _sha256_json(selected),
        "adapter": str(adapter),
        "mode": str(mode),
        "armed": bool(armed),
        "decision": decision,
        "reason_codes": list(reasons),
        "gating_chain": selected.get("gating_chain", []),
        "started_at": _utc_now_iso(),
        "finished_at": _utc_now_iso(),
        "result": {
            "status": "NOT_RUN",
            "details": {},
        },
    }

    # Minimal output folder creation (not required by tests, but useful)
    phase7_dir = outdir / "phase7" / str(asof)
    phase7_dir.mkdir(parents=True, exist_ok=True)
    (phase7_dir / "phase7_execution_receipts.json").write_text(
        json.dumps({"receipts": [receipt]}, indent=2) + "\n",
        encoding="utf-8",
    )

    return {"receipts": [receipt]}
