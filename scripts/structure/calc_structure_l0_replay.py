#!/usr/bin/env python3
"""
Replay-relative Structure (L0): SSP_Structure_L0

Rebuilds the key outputs used by Institutional Pressure (L1):
- StructureBias
- SSP_TotalStructureScore

Based on Phase0 sheet: 01_SSP_Structure_L0 (columns P,Q,R)

This module intentionally replaces Excel's ambiguous numeric "Notes"/trend-code input
(Shared_Inputs!J in the workbook) with a deterministic code derived from TrendSimple:
- UP/DOWN => 1
- FLAT/other/blank => 0
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Any, List, Dict

import pandas as pd


@dataclass(frozen=True)
class StructureRowL0:
    asset: str
    timeframe: str

    last_close: float
    prev_close: float
    swinghigh_20: float
    swinglow_20: float
    atr_14: float
    trend_simple: str

    breakout_flag: bool          # J
    breakout_dir: str            # K: UP/DOWN/NONE
    breakout_strength: int       # L: 0..3

    countertrend_flag: bool      # M
    countertrend_dir: str        # N: UP/DOWN/NONE
    countertrend_strength: int   # O: 0..2

    market_structure_state: str  # P: EXPANSION / MARKDOWN / ACCUM / DISTRIBUTION / NEUTRAL
    structure_bias: str          # Q: LONG/SHORT/NEUTRAL
    ssp_total_structure_score: int  # R: 0..3


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


def _trend_code_from_trend_simple(trend_simple: Any) -> int:
    # Excel expects a numeric value in L0's I column for (I>=1).
    # We derive it from TrendSimple.
    if isinstance(trend_simple, str):
        t = trend_simple.strip().upper()
        return 1 if t in {"UP", "DOWN"} else 0
    return 0


def calc_structure_l0_replay(shared_inputs_df: pd.DataFrame) -> pd.DataFrame:
    rows: List[StructureRowL0] = []

    for _, r in shared_inputs_df.iterrows():
        asset = str(r.get("AssetID"))
        tf = str(r.get("Timeframe"))

        C = _safe_float(r.get("Last_Close"))
        D = _safe_float(r.get("Prev_Close"))
        E = _safe_float(r.get("SwingHigh_20"))
        F = _safe_float(r.get("SwingLow_20"))
        G = _safe_float(r.get("ATR_14"))
        H = r.get("TrendSimple")

        trend_code = _trend_code_from_trend_simple(H)

        # Guard missing
        Cn = C if C is not None else float("nan")
        Dn = D if D is not None else float("nan")
        En = E if E is not None else float("nan")
        Fn = F if F is not None else float("nan")
        Gn = G if G is not None else float("nan")
        Hs = str(H) if H is not None else ""

        # J: breakout flag
        breakout_flag = False
        breakout_dir = "NONE"
        breakout_strength = 0

        if C is not None and E is not None and F is not None:
            breakout_flag = (C > E) or (C < F)
            if breakout_flag:
                breakout_dir = "UP" if (C > E) else ("DOWN" if (C < F) else "NONE")

        # L: breakout strength (uses ATR multiples of abs(C-D))
        if breakout_flag and C is not None and D is not None and G is not None and G != 0:
            diff = abs(C - D)
            if diff >= 2 * G:
                breakout_strength = 3
            elif diff >= 1 * G:
                breakout_strength = 2
            else:
                breakout_strength = 1

        # M: countertrend flag
        countertrend_flag = False
        if isinstance(H, str):
            ht = H.strip().upper()
            if ht != "FLAT" and C is not None and D is not None:
                if ht == "UP" and C < D:
                    countertrend_flag = True
                elif ht == "DOWN" and C > D:
                    countertrend_flag = True

        # N: countertrend direction (flip)
        countertrend_dir = "NONE"
        if countertrend_flag and isinstance(H, str):
            ht = H.strip().upper()
            if ht == "UP":
                countertrend_dir = "DOWN"
            elif ht == "DOWN":
                countertrend_dir = "UP"

        # O: countertrend strength
        countertrend_strength = 0
        if countertrend_flag and C is not None and D is not None and G is not None and G != 0:
            diff = abs(C - D)
            countertrend_strength = 2 if diff >= 1 * G else 1

        # P: market structure state
        if breakout_dir == "UP":
            mss = "EXPANSION"
        elif breakout_dir == "DOWN":
            mss = "MARKDOWN"
        else:
            if countertrend_dir == "UP":
                mss = "ACCUM"
            elif countertrend_dir == "DOWN":
                mss = "DISTRIBUTION"
            else:
                mss = "NEUTRAL"

        # Q: StructureBias
        if mss == "EXPANSION":
            bias = "LONG"
        elif mss == "MARKDOWN":
            bias = "SHORT"
        else:
            bias = "NEUTRAL"

        # R: SSP total structure score
        score = min(
            3,
            int(breakout_strength >= 2) +
            int(countertrend_strength == 2) +
            int(trend_code >= 1),
        )

        rows.append(
            StructureRowL0(
                asset=asset,
                timeframe=tf,
                last_close=Cn,
                prev_close=Dn,
                swinghigh_20=En,
                swinglow_20=Fn,
                atr_14=Gn,
                trend_simple=Hs,
                breakout_flag=bool(breakout_flag),
                breakout_dir=breakout_dir,
                breakout_strength=int(breakout_strength),
                countertrend_flag=bool(countertrend_flag),
                countertrend_dir=countertrend_dir,
                countertrend_strength=int(countertrend_strength),
                market_structure_state=mss,
                structure_bias=bias,
                ssp_total_structure_score=int(score),
            )
        )

    return pd.DataFrame([x.__dict__ for x in rows])
