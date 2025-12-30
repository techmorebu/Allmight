from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def _load_policy() -> Dict[str, Any]:
    p = Path("config/phase7/live_arming_policy_v0.json")
    if not p.exists():
        return {"_missing": True}
    return json.loads(p.read_text(encoding="utf-8"))


def _plan_exists(plans_path: Path, plan_id: str) -> bool:
    data = json.loads(plans_path.read_text(encoding="utf-8"))
    for p in data.get("plans", []):
        if str(p.get("plan_id")) == str(plan_id):
            return True
    return False


def preflight(
    plans_path: Path,
    asof: str,
    adapter: str,
    mode: str,
    armed: bool,
    arming_token: Optional[str],
    plan_id: Optional[str],
) -> Dict[str, Any]:
    reasons: List[str] = []

    # basic plan existence check (optional)
    if plan_id is not None:
        if not _plan_exists(plans_path, plan_id):
            reasons.append("plan_id_not_found")

    mode_l = str(mode).lower()
    adapter_l = str(adapter).lower()

    if mode_l != "live":
        # Non-live mode: eligible without arming ceremony
        return {
            "eligible": len(reasons) == 0,
            "mode": mode,
            "adapter": adapter,
            "asof": asof,
            "reasons": reasons,
        }

    # Live mode: enforce policy + ceremony
    policy = _load_policy()
    if policy.get("_missing"):
        reasons.append("missing_live_policy")
        return {"eligible": False, "mode": mode, "adapter": adapter, "asof": asof, "reasons": reasons}

    allowed_modes = [str(x).lower() for x in policy.get("allowed_live_modes", [])]
    if mode_l not in allowed_modes:
        reasons.append("mode_not_allowlisted")

    allowed_adapters = [str(x).lower() for x in policy.get("allowed_live_adapters", [])]
    if adapter_l not in allowed_adapters:
        reasons.append("adapter_not_allowlisted")

    arming = policy.get("arming", {})
    require_armed = bool(arming.get("require_armed_flag", True))
    require_token = bool(arming.get("require_token", True))
    token_env_var = str(arming.get("token_env_var", "ALLMIGHT_ARMING_TOKEN"))

    if require_armed and not armed:
        reasons.append("missing_armed_flag")

    if require_token and not arming_token:
        reasons.append("missing_arming_token")

    if require_token:
        env_token = os.environ.get(token_env_var)
        if not env_token:
            reasons.append("missing_env_token")
        elif arming_token is not None and str(arming_token) != str(env_token):
            reasons.append("token_mismatch")

    return {
        "eligible": len(reasons) == 0,
        "mode": mode,
        "adapter": adapter,
        "asof": asof,
        "reasons": reasons,
        "policy_version": policy.get("version"),
    }


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Phase-7 preflight (eligibility checker; no receipts/traces)")
    p.add_argument("--plans", required=True)
    p.add_argument("--asof", required=True, choices=["last", "i60"])
    p.add_argument("--adapter", required=True)
    p.add_argument("--mode", required=True)
    p.add_argument("--armed", action="store_true")
    p.add_argument("--arming-token", default=None)
    p.add_argument("--plan-id", default=None)
    return p


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)
    res = preflight(
        plans_path=Path(args.plans),
        asof=args.asof,
        adapter=args.adapter,
        mode=args.mode,
        armed=bool(args.armed),
        arming_token=args.arming_token,
        plan_id=args.plan_id,
    )
    print(json.dumps(res, indent=2))
    return 0 if res.get("eligible") else 2


if __name__ == "__main__":
    raise SystemExit(main())
