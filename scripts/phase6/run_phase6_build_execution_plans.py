#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path as _Path

# Ensure repo root is importable when running as a script:
# python scripts/phase6/run_phase6_build_execution_plans.py ...
REPO_ROOT = _Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from scripts.phase6.adapters.base import AdapterContext
from scripts.phase6.adapters.registry import get_adapter


class Phase6Error(RuntimeError):
    pass


def _sha256_json(obj: Any) -> str:
    blob = json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        raise Phase6Error(f"Missing required input: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _ensure(cond: bool, msg: str) -> None:
    if not cond:
        raise Phase6Error(msg)


def resolve_effective_allowed_modes(intent: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    reasons: List[str] = []

    status = (intent.get("status") or "").upper()
    allowed_modes = intent.get("allowed_modes")

    if allowed_modes is None:
        raise Phase6Error("Intent missing required field: allowed_modes")

    _ensure(isinstance(allowed_modes, list), "allowed_modes must be list[str]")

    if status in {"SUPPRESSED", "BLOCKED", "DENY"}:
        return [], [f"intent_status={status}"]

    policy = intent.get("execution_policy") or {}
    eff = list(allowed_modes)

    if "allowed_modes" in policy:
        eff = [m for m in eff if m in policy["allowed_modes"]]
        reasons.append("policy_allowed_modes_restricted")

    if "blocked_modes" in policy:
        eff = [m for m in eff if m not in policy["blocked_modes"]]
        reasons.append("policy_blocked_modes_restricted")

    _ensure(set(eff).issubset(set(allowed_modes)), "policy attempted to enable modes")

    if not reasons:
        reasons.append("allowed_by_phase5_and_policy")

    return eff, reasons


def build_plans(doc: Dict[str, Any], asof: str, adapter: str) -> Dict[str, Any]:
    schema_name = "phase6_execution_plans_v0"
    intents = doc.get("intents")
    meta = doc.get("meta") or {}
    policy_version = meta.get("execution_policy_version") or meta.get("policy_version") or "unknown"
    _ensure(isinstance(intents, list), "intents must be list")

    plans = []
    trace = []

    adapter_impl = get_adapter(adapter)
    adapter_version = getattr(adapter_impl, 'adapter_version', 'v0')
    ctx = AdapterContext(adapter=adapter, asof=asof)

    for idx, intent in enumerate(intents):
        eff_modes, reasons = resolve_effective_allowed_modes(intent)

        plan_id = _sha256_json({
            "asof": asof,
            "adapter": adapter,
            "schema_name": schema_name,
            "policy_version": policy_version,
            "adapter_version": adapter_version,
            "intent": intent,
        })

        intent_ref = intent.get("intent_id", f"intent_index:{idx}")

        if not eff_modes:
            plans.append({
                "plan_id": plan_id,
                "intent_ref": intent_ref,
                "status": "SUPPRESSED",
                "mode": None,
                "steps": [],
                "requires_network": False,
                "reasons": reasons,
            })
            trace.append({"plan_id": plan_id, "event": "suppressed"})
            continue

        for mode in eff_modes:
            plans.append({
                "plan_id": plan_id,
                "intent_ref": intent_ref,
                "status": "PLANNED",
                "mode": mode,
                "steps": adapter_impl.build_steps(intent, mode, ctx),
                "requires_network": False,
                "reasons": reasons,
            })
            trace.append({"plan_id": plan_id, "event": "planned", "mode": mode})

    return {
        "meta": {
            "phase": 6,
            "asof": asof,
            "adapter": adapter,
            "dry_run": True,
            "deterministic": True,
        },
        "plans": plans,
        "trace": trace,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--asof", required=True, choices=["last", "i60"])
    ap.add_argument("--adapter", default="paper")
    ap.add_argument("--phase5-root", default="outputs/phase5")
    ap.add_argument("--out-root", default="outputs/phase6")
    args = ap.parse_args()

    phase5_path = Path(args.phase5_root) / args.asof / "phase5_execution_intents.json"
    doc = _load_json(phase5_path)

    out = build_plans(doc, args.asof, args.adapter)

    out_dir = Path(args.out_root) / args.asof
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "phase6_execution_plans.json").write_text(
        json.dumps(out, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    # Human-readable audit (deterministic, no timestamps)
    audit_lines = [
        "PHASE 6 AUDIT (DRY-RUN)",
        f"asof={args.asof}",
        f"adapter={args.adapter}",
        f"phase5_input={phase5_path}",
        f"plans={len(out.get('plans', []))}",
        f"trace_events={len(out.get('trace', []))}",
        "invariant: never enable modes outside Phase-5 allowed_modes",
        "invariant: execution_policy may restrict, never enable",
        "invariant: no network side effects",
        "",
    ]
    (out_dir / "phase6_audit.txt").write_text("\n".join(audit_lines), encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
