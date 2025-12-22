#!/usr/bin/env python3
import argparse
import subprocess
import sys

def run(cmd: list[str]) -> int:
    print(">>", " ".join(cmd))
    return subprocess.call(cmd)

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--assets", required=True, help="Comma-separated assets, e.g. BTC,ETH,XRP,XAU")
    p.add_argument("--timeframe", required=True, help="e.g. 15m")
    p.add_argument("--asof-index", required=True, type=int, help="0-based asof index")
    args = p.parse_args()

    assets = [a.strip() for a in args.assets.split(",") if a.strip()]
    if not assets:
        print("No assets provided.", file=sys.stderr)
        return 2

    # Phase 1 LOCKED scripts (do not modify them)
    shared_inputs = ["./.venv/bin/python", "scripts/shared_inputs/calc_shared_inputs_replay.py"]
    structure_l0  = ["./.venv/bin/python", "scripts/structure/calc_structure_l0_replay.py"]
    pressure_l1   = ["./.venv/bin/python", "scripts/pressure/calc_pressure_replay.py"]

    for asset in assets:
        print(f"\n=== GRID: {asset} {args.timeframe} asof={args.asof_index} ===")
        base = ["--asset", asset, "--timeframe", args.timeframe, "--asof-index", str(args.asof_index)]

        rc = run(shared_inputs + base)
        if rc != 0: return rc

        rc = run(structure_l0 + base)
        if rc != 0: return rc

        rc = run(pressure_l1 + base)
        if rc != 0: return rc

    print("\nGRID replay completed successfully.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
