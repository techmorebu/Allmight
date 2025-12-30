from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

from scripts.phase7.run_phase7 import run_phase7
from scripts.phase7.phase7_preflight import preflight
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
        # --- LIVE ARMING ENFORCEMENT (delegated to preflight; no drift)
    if str(args.mode).lower() == "live":
        res = preflight(
            plans_path=Path(args.plans),
            asof=args.asof,
            adapter=args.adapter,
            mode=args.mode,
            armed=bool(args.armed),
            arming_token=args.arming_token,
            plan_id=args.plan_id,
        )
        if not res.get("eligible"):
            # Keep message human-readable and stable for operators
            reasons_list = [str(x) for x in (res.get("reasons", []) or [])]
            # Human-friendly phrasing for operator stability (keep legacy expectations)
            phrases = []
            if "missing_armed_flag" in reasons_list:
                phrases.append("requires --armed")
            if "missing_arming_token" in reasons_list:
                phrases.append("requires --arming-token")
            if "missing_env_token" in reasons_list:
                phrases.append("missing env token")
            if "token_mismatch" in reasons_list:
                phrases.append("token mismatch")
            if "adapter_not_allowlisted" in reasons_list:
                phrases.append("adapter not allowlisted")
            if "mode_not_allowlisted" in reasons_list:
                phrases.append("mode not allowlisted")
            if "missing_live_policy" in reasons_list:
                phrases.append("missing live policy")
            if "plan_id_not_found" in reasons_list:
                phrases.append("plan id not found")

            human = ", ".join(phrases) if phrases else "denied"
            codes = ", ".join(reasons_list) if reasons_list else "unknown"
            print(f"ERROR: live attempt denied: {human} (codes=[{codes}])", file=sys.stderr)
            return 2

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
