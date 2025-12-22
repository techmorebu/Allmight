#!/usr/bin/env python3
import argparse
import os
import pandas as pd
import subprocess

from scripts.structure.calc_structure_l0_replay import calc_structure_l0_replay
from scripts.pressure.calc_pressure_replay import calc_pressure_l1_replay

def run(cmd):
    # Small helper to make failures loud
    r = subprocess.run(cmd, check=False, text=True, capture_output=True)
    if r.returncode != 0:
        print("CMD FAILED:", " ".join(cmd))
        print(r.stdout)
        print(r.stderr)
        raise SystemExit(r.returncode)
    return r.stdout.strip()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets", required=True, help="Comma list, e.g. BTC,ETH,XRP,PAXG")
    ap.add_argument("--timeframe", default="15m")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--asof-index", type=int, default=None, help="As-of index within replay (0..n-1). Default: n-1")
    ap.add_argument("--i60-offset", type=int, default=60)
    args = ap.parse_args()

    assets = [a.strip() for a in args.assets.split(",") if a.strip()]
    tf = args.timeframe
    n = args.n
    asof_last = (n - 1) if args.asof_index is None else args.asof_index
    asof_i60 = asof_last - args.i60_offset
    if asof_i60 < 0:
        raise SystemExit(f"i60 index would be negative: {asof_i60}. Increase n or reduce offset.")

    os.makedirs("outputs/replay", exist_ok=True)

    si_last_rows = []
    si_i60_rows = []

    for asset in assets:
        # 1) replay window
        run(["python","-m","scripts.data.replay_ohlcv_window","--asset",asset,"--timeframe",tf,"--n",str(n)])
        replay_path = f"data/processed/replay/ohlcv_replay_{asset}_{tf}.csv"

        # 2) shared inputs last / i60
        out_last = f"outputs/replay/shared_inputs_{asset}_{tf}_last.csv"
        out_i60  = f"outputs/replay/shared_inputs_{asset}_{tf}_i60.csv"

        run(["python","-m","scripts.shared_inputs.calc_shared_inputs_replay","--input",replay_path,"--asof-index",str(asof_last),"--output",out_last])
        run(["python","-m","scripts.shared_inputs.calc_shared_inputs_replay","--input",replay_path,"--asof-index",str(asof_i60),"--output",out_i60])

        si_last_rows.append(pd.read_csv(out_last))
        si_i60_rows.append(pd.read_csv(out_i60))

    si_last = pd.concat(si_last_rows, ignore_index=True)
    si_i60  = pd.concat(si_i60_rows, ignore_index=True)

    grid_tag = "_".join(assets)
    si_last_path = f"outputs/replay/shared_inputs_GRID_{grid_tag}_{tf}_last.csv"
    si_i60_path  = f"outputs/replay/shared_inputs_GRID_{grid_tag}_{tf}_i60.csv"
    si_last.to_csv(si_last_path, index=False)
    si_i60.to_csv(si_i60_path, index=False)

    active_grid = [{"asset": r["AssetID"], "timeframe": r["Timeframe"]} for _, r in si_last.iterrows()]

    l0_last = calc_structure_l0_replay(si_last)
    l0_i60  = calc_structure_l0_replay(si_i60)

    l0_last_in = l0_last.rename(columns={"structure_bias":"StructureBias","ssp_total_structure_score":"SSP_TotalStructureScore"})
    l0_i60_in  = l0_i60.rename(columns={"structure_bias":"StructureBias","ssp_total_structure_score":"SSP_TotalStructureScore"})

    p_last = calc_pressure_l1_replay(si_last, l0_last_in, active_grid)
    p_i60  = calc_pressure_l1_replay(si_i60,  l0_i60_in,  active_grid)

    l0_last.to_csv(f"outputs/replay/structure_l0_GRID_{grid_tag}_{tf}_last.csv", index=False)
    l0_i60.to_csv(f"outputs/replay/structure_l0_GRID_{grid_tag}_{tf}_i60.csv", index=False)
    p_last.to_csv(f"outputs/replay/pressure_l1_GRID_{grid_tag}_{tf}_last.csv", index=False)
    p_i60.to_csv(f"outputs/replay/pressure_l1_GRID_{grid_tag}_{tf}_i60.csv", index=False)

    cols = ["asset","timeframe","structure_bias","ssp_total_structure_score","trend_gate","vol_spike_gate","pressure_score"]
    print("\nL1 last:")
    print(p_last[cols].to_string(index=False))
    print("\nL1 i60:")
    print(p_i60[cols].to_string(index=False))

    print("\nDelta pressure_score (last - i60):")
    print(pd.DataFrame({"asset": p_last["asset"], "delta": (p_last["pressure_score"] - p_i60["pressure_score"])}))

    print("\nSaved artifacts under outputs/replay/ with GRID tag:", grid_tag)

if __name__ == "__main__":
    main()
