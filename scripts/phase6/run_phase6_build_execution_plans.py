#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple


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
    intents = doc.get("intents")
    _ensure(isinstance(intents, list), "intents must be list")

    plans = []
    trace = []

    for idx, intent in enumerate(intents):
        eff_modes, reasons = resolve_effective_allowed_modes(intent)

        plan_id = _sha256_json({
            "asof": asof,
            "adapter": adapter,
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
                "steps": [{"type": "DRY_RUN"}],
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

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
