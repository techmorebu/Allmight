#!/usr/bin/env python3
import pandas as pd
from scripts.structure.calc_structure_l0_replay import calc_structure_l0_replay
from scripts.pressure.calc_pressure_replay import calc_pressure_l1_replay

def main():
    last_path = "outputs/replay/shared_inputs_BTC_15m_last.csv"
    i60_path  = "outputs/replay/shared_inputs_BTC_15m_i60.csv"

    si_last = pd.read_csv(last_path)
    si_i60  = pd.read_csv(i60_path)

    active_grid = [{"asset": r["AssetID"], "timeframe": r["Timeframe"]} for _, r in si_last.iterrows()]

    l0_last = calc_structure_l0_replay(si_last)
    l0_i60  = calc_structure_l0_replay(si_i60)

    # L1 expects StructureBias + SSP_TotalStructureScore columns
    l0_last_in = l0_last.rename(columns={"structure_bias":"StructureBias","ssp_total_structure_score":"SSP_TotalStructureScore"})
    l0_i60_in  = l0_i60.rename(columns={"structure_bias":"StructureBias","ssp_total_structure_score":"SSP_TotalStructureScore"})

    p_last = calc_pressure_l1_replay(si_last, l0_last_in, active_grid)
    p_i60  = calc_pressure_l1_replay(si_i60,  l0_i60_in,  active_grid)

    l0_last.to_csv("outputs/replay/structure_l0_BTC_15m_last.csv", index=False)
    l0_i60.to_csv("outputs/replay/structure_l0_BTC_15m_i60.csv", index=False)
    p_last.to_csv("outputs/replay/pressure_l1_BTC_15m_last.csv", index=False)
    p_i60.to_csv("outputs/replay/pressure_l1_BTC_15m_i60.csv", index=False)

    print("L0 last:")
    print(l0_last[["asset","timeframe","market_structure_state","structure_bias","ssp_total_structure_score"]].to_string(index=False))
    print("\nL0 i60:")
    print(l0_i60[["asset","timeframe","market_structure_state","structure_bias","ssp_total_structure_score"]].to_string(index=False))

    print("\nL1 last:")
    print(p_last[["asset","timeframe","structure_bias","ssp_total_structure_score","pressure_score"]].to_string(index=False))
    print("\nL1 i60:")
    print(p_i60[["asset","timeframe","structure_bias","ssp_total_structure_score","pressure_score"]].to_string(index=False))

if __name__ == "__main__":
    main()
