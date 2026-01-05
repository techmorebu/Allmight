from __future__ import annotations

import argparse
from pathlib import Path

from .io import load_snapshots_jsonl
from .runner import RunConfig, run_shadow_ab

def main() -> int:
    ap = argparse.ArgumentParser(description="AllMight Shadow A/B Harness (skeleton, inert)")
    ap.add_argument("--snapshots", required=True, help="Path to snapshots.jsonl")
    ap.add_argument("--limit", type=int, default=200, help="Limit number of snapshots (default 200)")
    ap.add_argument("--run-id", default=None, help="Optional explicit run id")
    args = ap.parse_args()

    snaps = load_snapshots_jsonl(Path(args.snapshots), limit=args.limit)
    cfg = RunConfig()
    out_dir = run_shadow_ab(snaps, cfg, run_id=args.run_id)
    print(str(out_dir))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
