#!/usr/bin/env python3
"""
Replay-relative Institutional Pressure (L1)

Implements the Phase0 sheet logic from:
  02_Institutional_Pressure_L1 (A..N)

Replay-relative semantics:
- All rows are positional (Active Grid order)
- No rolling state, no lookahead
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, List, Dict, Any

import pandas as pd


@dataclass(frozen=True)
class PressureRow:
    asset: str
    timeframe: str

    structure_bias: str
    ssp_total_structure_score: float

    last_close: float
    prev_close: float
    atr_14: float

    return_pct: Optional[float]
    trend_alignment_score: int
    move_vs_atr_score: int
    trend_gate: int
    vol_spike_gate: int
    conflict_penalty: int
    pressure_score: int


def _safe_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        if isinstance(x, str) and x.strip() == "":
            return None
        v = float(x)
        if pd.isna(v):
            return None
        return v
    except Exception:
        return None


def _trend_gate_from_trend_simple(trend_simple: Any) -> int:
    if isinstance(trend_simple, str):
        t = trend_simple.strip().upper()
        return 1 if t in {"UP", "DOWN"} else 0
    return 0


def _trend_alignment(structure_bias: str, return_pct: Optional[float]) -> int:
    if return_pct is None:
        return 0
    b = (structure_bias or "").strip().upper()
    if b == "NEUTRAL":
        return 0
    if b == "LONG" and return_pct > 0:
        return 2
    if b == "SHORT" and return_pct < 0:
        return 2
    return 0


def _move_vs_atr_score(last_close: float, prev_close: float, atr_14: float) -> int:
    if atr_14 is None or atr_14 == 0:
        return 0
    diff = abs(last_close - prev_close)
    if diff >= 2.0 * atr_14:
        return 3
    if diff >= 1.0 * atr_14:
        return 2
    if diff >= 0.5 * atr_14:
        return 1
    return 0


def _conflict_penalty(trend_alignment_score: int, ssp_total_structure_score: float) -> int:
    try:
        d = float(ssp_total_structure_score)
    except Exception:
        return 0
    if trend_alignment_score == 2 and d <= 1:
        return 2
    if trend_alignment_score == 0 and d >= 2:
        return 1
    return 0


def _pressure_score(mva: int, ta: int, tg: int, vsg: int, cp: int) -> int:
    score = (
        int(mva >= 2) +
        int(ta == 2) +
        int(tg == 1) +
        int(vsg >= 2) -
        int(cp >= 2)
    )
    if score < 0:
        score = 0
    return min(3, score)


def calc_pressure_l1_replay(
    shared_inputs_df: pd.DataFrame,
    structure_l0_df: pd.DataFrame,
    active_grid: List[Dict[str, str]],
    *,
    strict_excel_bug_compat: bool = False,
) -> pd.DataFrame:

    rows: List[PressureRow] = []

    for idx, ag in enumerate(active_grid):
        si = shared_inputs_df.iloc[idx]
        l0 = structure_l0_df.iloc[idx]

        last_close = _safe_float(si.get("Last_Close"))
        prev_close = _safe_float(si.get("Prev_Close"))
        atr_14 = _safe_float(si.get("ATR_14"))

        trend_simple = si.get("TrendSimple")
        vol_spike_flag = si.get("VolSpikeFlag")

        structure_bias = str(l0.get("StructureBias", "") or "")
        ssp_score = _safe_float(l0.get("SSP_TotalStructureScore")) or 0.0

        if last_close is None or prev_close is None or prev_close == 0:
            return_pct = None
        else:
            return_pct = (last_close - prev_close) / prev_close

        ta = _trend_alignment(structure_bias, return_pct)

        mva = 0
        if last_close is not None and prev_close is not None and atr_14 is not None:
            mva = _move_vs_atr_score(last_close, prev_close, atr_14)

        tg = _trend_gate_from_trend_simple(trend_simple)

        if strict_excel_bug_compat and idx >= 1:
            vsg = 0
        else:
            vsg = 2 if bool(vol_spike_flag) else 0

        cp = _conflict_penalty(ta, ssp_score)
        ps = _pressure_score(mva, ta, tg, vsg, cp)

        rows.append(
            PressureRow(
                asset=ag["asset"],
                timeframe=ag["timeframe"],
                structure_bias=structure_bias,
                ssp_total_structure_score=float(ssp_score),
                last_close=float(last_close) if last_close is not None else float("nan"),
                prev_close=float(prev_close) if prev_close is not None else float("nan"),
                atr_14=float(atr_14) if atr_14 is not None else float("nan"),
                return_pct=return_pct,
                trend_alignment_score=ta,
                move_vs_atr_score=mva,
                trend_gate=tg,
                vol_spike_gate=vsg,
                conflict_penalty=cp,
                pressure_score=ps,
            )
        )

    return pd.DataFrame([r.__dict__ for r in rows])
