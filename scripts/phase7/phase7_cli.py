from __future__ import annotations

import argparse
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
    return p


def main(argv=None) -> int:
    args = _build_parser().parse_args(argv)

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
    print(f"plan_id={r['plan_id']} decision={r['decision']} reasons={','.join(r['reason_codes']) if r['reason_codes'] else 'NONE'}")
    print(f"receipt_idem_key={r['idempotency_key']}")
    print(f"outputs={Path(args.outdir) / 'phase7' / args.asof}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
