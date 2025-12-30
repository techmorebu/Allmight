from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from scripts.phase7.run_phase7 import run_phase7
from scripts.phase7.tools.compact_receipts import compact_receipts


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="phase7", description="AllMight Phase-7 guarded execution (receipts-only)")
    p.add_argument("--plans", required=True, help="Path to outputs/phase6/{asof}/phase6_execution_plans.json (or fixture)")
    p.add_argument("--asof", required=True, choices=["last", "i60"], help="Temporal horizon selector")
    p.add_argument("--adapter", required=True, help="Explicit adapter name")
    p.add_argument("--mode", required=True, help="Execution mode (paper/live/etc.)")
    p.add_argument("--armed", action="store_true", help="Explicit arming flag (required for unsafe/unknown adapters)")
    p.add_argument("--arming-token", default=None, help="Arming token for live actions (must match env var per policy)")
    p.add_argument("--plan-id", default=None, help="Execute a single plan_id (default: first plan in file)")
    p.add_argument("--outdir", required=True, help="Output directory root (e.g., outputs)")
    p.add_argument("--explain", action="store_true", help="Print prepared action payload (if available)")
    p.add_argument("--batch", action="store_true", help="Process all plans in the file (guarded, receipts-only)")
    p.add_argument("--limit", type=int, default=None, help="Limit number of plans processed in batch mode")
    p.add_argument("--halt-after", type=int, default=None, help="Stop batch after N DENY/HALT decisions")
    p.add_argument("--status-filter", default="all", choices=["all", "allowed", "suppressed"], help="Batch filter by plan status")
    p.add_argument("--compact-receipts", action="store_true", help="After batch, compact receipts file (explicit)")
    p.add_argument("--keep-last", type=int, default=5, help="When compacting receipts, keep last N per plan_id (default: 5)")
    return p


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)
    # --- LIVE ARMING ENFORCEMENT (policy-driven, default DENY)
    live_attempt = (str(args.mode).lower() == "live") or str(args.adapter).lower().startswith("live_")
    if live_attempt:
        policy_path = Path("config/phase7/live_arming_policy_v0.json")
        if not policy_path.exists():
            print("ERROR: live attempt denied: missing config/phase7/live_arming_policy_v0.json", file=sys.stderr)
            return 2

        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        if policy.get("default_deny", True) is not False:
            # default_deny True means live requires explicit allowlist + token gates
            pass

        arming = policy.get("arming", {})
        require_armed = bool(arming.get("require_armed_flag", True))
        require_token = bool(arming.get("require_token", True))
        token_env_var = str(arming.get("token_env_var", "ALLMIGHT_ARMING_TOKEN"))

        if require_armed and not bool(args.armed):
            print("ERROR: live attempt denied: requires --armed", file=sys.stderr)
            return 2

        if require_token and not args.arming_token:
            print("ERROR: live attempt denied: requires --arming-token", file=sys.stderr)
            return 2

        if require_token:
            env_token = os.environ.get(token_env_var)
            if not env_token:
                print(f"ERROR: live attempt denied: missing env var {token_env_var}", file=sys.stderr)
                return 2
            if str(args.arming_token) != str(env_token):
                print("ERROR: live attempt denied: token mismatch", file=sys.stderr)
                return 2

        allowed_modes = [str(x).lower() for x in policy.get("allowed_live_modes", [])]
        if str(args.mode).lower() not in allowed_modes:
            print("ERROR: live attempt denied: mode not allowlisted by policy", file=sys.stderr)
            return 2

        # Only enforce adapter allowlist for adapters in the live namespace
        if str(args.adapter).lower().startswith("live_"):
            allowed_adapters = [str(x).lower() for x in policy.get("allowed_live_adapters", [])]
            if str(args.adapter).lower() not in allowed_adapters:
                print("ERROR: live attempt denied: adapter not allowlisted by policy", file=sys.stderr)
                return 2

        # Marker for tests / grepping
        LIVE_ARMING_POLICY = True

    # Batch mode: iterate plan_ids from the plans file
    if args.batch:
        plans_data = json.loads(Path(args.plans).read_text(encoding="utf-8"))
        plans = plans_data.get("plans", [])
        sf = str(args.status_filter).lower()
        if sf != "all":
            plans = [pp for pp in plans if str(pp.get("status","")).lower() == sf]
        plan_ids = [str(p.get("plan_id")) for p in plans if p.get("plan_id") is not None]

        if args.limit is not None:
            plan_ids = plan_ids[: max(0, int(args.limit))]

        deny_or_halt = 0
        processed = 0
        summary_items = []

        for pid in plan_ids:
            res = run_phase7(
                plans_path=args.plans,
                asof=args.asof,
                adapter=args.adapter,
                mode=args.mode,
                armed=bool(args.armed),
                plan_id=pid,
                outdir=Path(args.outdir),
            )
            r = res["receipts"][0]
            processed += 1
            if r["decision"] in ("DENY", "HALT"):
                deny_or_halt += 1

            summary_items.append({
                "plan_id": r.get("plan_id"),
                "decision": r.get("decision"),
                "reason_codes": r.get("reason_codes", []),
                "idempotency_key": r.get("idempotency_key"),
            })

            if args.explain:
                prepared = r.get("result", {}).get("details", {}).get("prepared")
                print(f"plan_id={r['plan_id']} decision={r['decision']} reasons={','.join(r['reason_codes']) if r['reason_codes'] else 'NONE'}")
                print(f"receipt_idem_key={r['idempotency_key']}")
                print("prepared:")
                if prepared is None:
                    print("  (none)")
                else:
                    print(f"  adapter={prepared.get('adapter')}")
                    print(f"  plan_id={prepared.get('plan_id')}")
                    print(f"  payload={prepared.get('payload')}")
                print("---")
            else:
                print(f"plan_id={r['plan_id']} decision={r['decision']} reasons={','.join(r['reason_codes']) if r['reason_codes'] else 'NONE'}")

            if args.halt_after is not None and deny_or_halt >= int(args.halt_after):
                print(f"HALT: halt-after reached (deny_or_halt={deny_or_halt})")
                break

        print(f"batch_processed={processed}")
        outp = Path(args.outdir) / 'phase7' / args.asof
        summ = {
            "asof": args.asof,
            "adapter": args.adapter,
            "mode": args.mode,
            "armed": bool(args.armed),
            "status_filter": args.status_filter,
            "limit": args.limit,
            "halt_after": args.halt_after,
            "processed": processed,
            "deny_or_halt": deny_or_halt,
            "items": summary_items,
        }
        (outp / 'phase7_batch_summary.json').write_text(json.dumps(summ, indent=2) + "\n", encoding='utf-8')
        print(f"outputs={outp}")
        if args.compact_receipts:
            receipts_path = outp / "phase7_execution_receipts.json"
            compact_receipts(receipts_path, keep_last_n=int(args.keep_last))
            print(f"compacted_receipts_keep_last={int(args.keep_last)}")

        return 0

    # Single plan mode
    res = run_phase7(
        plans_path=args.plans,
        asof=args.asof,
        adapter=args.adapter,
        mode=args.mode,
        armed=bool(args.armed),
        plan_id=args.plan_id,
        outdir=Path(args.outdir),
    )

    r = res["receipts"][0]
    if args.explain:
        prepared = r.get("result", {}).get("details", {}).get("prepared")
        print("prepared:")
        if prepared is None:
            print("  (none)")
        else:
            print(f"  adapter={prepared.get('adapter')}")
            print(f"  plan_id={prepared.get('plan_id')}")
            print(f"  payload={prepared.get('payload')}")
    print(f"plan_id={r['plan_id']} decision={r['decision']} reasons={','.join(r['reason_codes']) if r['reason_codes'] else 'NONE'}")
    print(f"receipt_idem_key={r['idempotency_key']}")
    print(f"outputs={Path(args.outdir) / 'phase7' / args.asof}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
