from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from scripts.phase7.run_phase7 import run_phase7


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="phase7", description="AllMight Phase-7 guarded execution (receipts-only)")
    p.add_argument("--plans", required=True, help="Path to outputs/phase6/{asof}/phase6_execution_plans.json (or fixture)")
    p.add_argument("--asof", required=True, choices=["last", "i60"], help="Temporal horizon selector")
    p.add_argument("--adapter", required=True, help="Explicit adapter name")
    p.add_argument("--mode", required=True, help="Execution mode (paper/live/etc.)")
    p.add_argument("--armed", action="store_true", help="Explicit arming flag (required for unsafe/unknown adapters)")
    p.add_argument("--plan-id", default=None, help="Execute a single plan_id (default: first plan in file)")
    p.add_argument("--outdir", required=True, help="Output directory root (e.g., outputs)")
    p.add_argument("--explain", action="store_true", help="Print prepared action payload (if available)")
    p.add_argument("--batch", action="store_true", help="Process all plans in the file (guarded, receipts-only)")
    p.add_argument("--limit", type=int, default=None, help="Limit number of plans processed in batch mode")
    p.add_argument("--halt-after", type=int, default=None, help="Stop batch after N DENY/HALT decisions")
    p.add_argument("--status-filter", default="all", choices=["all", "allowed", "suppressed"], help="Batch filter by plan status")
    return p


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)

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
