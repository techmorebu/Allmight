from __future__ import annotations


from pathlib import Path
PHASE0_CONSTANTS_PATH = Path("scripts/regime/phase0_regime_constants.json")

def _load_phase0_constants() -> dict:
    if not PHASE0_CONSTANTS_PATH.exists():
        raise FileNotFoundError(f"Missing constants: {PHASE0_CONSTANTS_PATH}")
    return json.loads(PHASE0_CONSTANTS_PATH.read_text(encoding="utf-8"))

def _activation_band(mcs_total: float, thresholds: list[dict]) -> str:
    # thresholds are ordered; first match wins
    for t in thresholds:
        if "lt" in t and mcs_total < float(t["lt"]):
            return str(t["band"])
        if t.get("else") is True:
            return str(t["band"])
    # should never happen if else exists
    return "ARB+YIELD_ONLY"

def _regime_from_band(band: str) -> str:
    # Deterministic mapping (bootstrap). This will be replaced once Tabs 40–45 are fully extracted.
    if band == "ARB+YIELD_ONLY":
        return "RISK_OFF_STRONG"
    if band == "LIGHT_DIRECTIONAL":
        return "RISK_OFF_SOFT"
    if band == "FULL_DIRECTIONAL":
        return "RISK_ON"
    if band == "FLASHLOAN_CLUSTER":
        return "RISK_ON"
    return "UNKNOWN"

import json
from typing import Dict, List

from scripts.regime.regime_types import (
    InstitutionalRegimeState,
    RegimeAssetContribution,
    RegimeLabel,
)

# ---------------------------------------------------------------------
# Phase 2 regime logic (v0)
# - replay-relative
# - no lookahead
# - deterministic grid ordering
# - auditable intermediate fields
# ---------------------------------------------------------------------

# Default thresholds (v0). Easy to swap later when we extract Phase 0 formulas.
DEFAULTS = {
    # v1: breadth + confirmation thresholds (explicit, deterministic)
    "RISK_SUM_ON_MIN": 0.4,
    "RISK_SUM_OFF_MAX": -0.4,
    "RISK_SUM_PANIC_MAX": -0.8,
    "BREADTH_MIN": 0.66,
    "CONF_SCALE": 1.5,
}

SAFE_ASSETS = {"XAU", "PAXG"}  # gold proxy symbols


def _sign_from_bias(bias: str) -> float:
    b = (bias or "").upper()
    if "UP" in b or "BULL" in b:
        return 1.0
    if "DOWN" in b or "BEAR" in b:
        return -1.0
    return 0.0


def _driver_for_asset(symbol: str, structure_bias: str, structure_score: float, pressure_score: float) -> float:
    """
    Signed driver per asset.
    + => pushes RISK_ON
    - => pushes RISK_OFF

    Deterministic, monotonic, no smoothing.
    """
    sgn = _sign_from_bias(structure_bias)

    # Normalize structure into ~[0,1] using Phase 0 bounds 0..3
    struct_norm = max(0.0, min(3.0, float(structure_score))) / 3.0

    # Normalize pressure into ~[0,1] using Phase 0 bounds 0..10
    pres_norm = max(0.0, min(10.0, float(pressure_score))) / 10.0

    base = sgn * (0.7 * struct_norm + 0.3 * pres_norm)

    # Safe asset inversion: gold strength often corresponds to risk-off
    sym = symbol.upper()
    if sym in SAFE_ASSETS:
        base = -base

    return base


def calc_institutional_regime_replay(
    *,
    asof_index: int,
    active_grid_symbols: List[str],
    l0_by_symbol: Dict[str, Dict],
    l1_by_symbol: Dict[str, Dict],
    cfg: Dict = None,
) -> InstitutionalRegimeState:
    """
    Inputs must be replay-relative snapshots at the SAME as-of index.

    l0_by_symbol[symbol] expects:
      - StructureBias (str)
      - StructureScore (float)

    l1_by_symbol[symbol] expects:
      - PressureScore (float)

    active_grid_symbols order is authoritative and MUST be preserved.
    """
    cfg = {**DEFAULTS, **(cfg or {})}

    contribs: List[RegimeAssetContribution] = []
    drivers: List[float] = []

    # Deterministic iteration: active grid order
    for sym in active_grid_symbols:
        l0 = l0_by_symbol.get(sym, {})
        l1 = l1_by_symbol.get(sym, {})

        sbias = l0.get("StructureBias", "UNKNOWN")
        sscore = float(l0.get("StructureScore", 0.0))
        pscore = float(l1.get("PressureScore", 0.0))

        d = _driver_for_asset(sym, str(sbias), sscore, pscore)

        contribs.append(
            RegimeAssetContribution(
                symbol=sym,
                driver=d,
                structure_bias=str(sbias),
                structure_score=sscore,
                pressure_score=pscore,
                bias_source=str(l0.get("BiasSource","UNKNOWN")),
                asset_role=str(l0.get("AssetRole","UNKNOWN")),
            )
        )
        drivers.append(d)

    driver_sum = float(sum(drivers))

    # --- Phase 0 Excel-faithful MCS aggregator (Tab 21_MCS_Aggregator) ---
    c = _load_phase0_constants()
    w = c["mcs_weights"]
    thresholds = c["activation_band_thresholds"]
    missing_policy = c["phase2_bootstrap_missing_inputs_policy"]
    missing_val = float(missing_policy.get("missing_inputs_value", 0.0))

    # We have SSP + Pressure from L0/L1 per-asset. Other engines are not replay-produced yet in Phase 2,
    # so we bootstrap them as missing_val (deterministic).
    sweep = float(cfg.get("sweep_score", missing_val))
    liq_arch = float(cfg.get("liquidity_arch_score", missing_val))
    macro_score = float(cfg.get("macro_score", missing_val))
    risk_penalty = float(cfg.get("risk_penalty", missing_val))

    per_asset_mcs: Dict[str, float] = {}
    for ctb in contribs:
        ssp = float(ctb.structure_score)
        pressure = float(ctb.pressure_score)
        per_asset_mcs[ctb.symbol] = (
            ssp * float(w["SSP_Score"])
            + pressure * float(w["PressureScore"])
            + sweep * float(w["SweepScore"])
            + liq_arch * float(w["LiquidityArchScore"])
            + macro_score * float(w["MacroScore"])
            + risk_penalty * float(w["RiskPenalty"])
        )

    # Deterministic grid aggregate: mean MCS_total across active grid
    mcs_total = float(sum(per_asset_mcs.values()) / max(1, len(per_asset_mcs)))

    activation_band = _activation_band(mcs_total, thresholds)
    regime_label = _regime_from_band(activation_band)

    # Downstream flags (Phase 0 semantics)
    allow_directional = activation_band in ("LIGHT_DIRECTIONAL", "FULL_DIRECTIONAL", "FLASHLOAN_CLUSTER")
    allow_flashloan = activation_band == "FLASHLOAN_CLUSTER"

    # Breadth + confirmation (v1)
    risk_drivers = [c.driver for c in contribs if (c.asset_role or "").upper() == "RISK"]
    safe_drivers = [c.driver for c in contribs if (c.asset_role or "").upper() == "SAFE"]

    risk_driver_sum = float(sum(risk_drivers)) if risk_drivers else 0.0
    safe_driver_sum = float(sum(safe_drivers)) if safe_drivers else 0.0

    risk_pos = sum(1 for d in risk_drivers if d > 0.0)
    risk_neg = sum(1 for d in risk_drivers if d < 0.0)
    risk_n = max(1, len(risk_drivers))

    risk_breadth = risk_pos / risk_n
    risk_breadth_neg = risk_neg / risk_n

    # Classification rules (v1: breadth + confirmation)
    regime: RegimeLabel
    if (risk_driver_sum >= cfg["RISK_SUM_ON_MIN"]) and (risk_breadth >= cfg["BREADTH_MIN"]) and (safe_driver_sum <= 0.0):
        regime = "RISK_ON"
    elif (risk_driver_sum <= cfg["RISK_SUM_PANIC_MAX"]) and (risk_breadth_neg == 1.0) and (safe_driver_sum >= 0.0):
        regime = "PANIC"
    elif (risk_driver_sum <= cfg["RISK_SUM_OFF_MAX"]) and (risk_breadth_neg >= cfg["BREADTH_MIN"]) and (safe_driver_sum >= 0.0):
        regime = "RISK_OFF"
    else:
        regime = "TRANSITION"

    # Confidence: scaled distance from 0
    conf = min(1.0, abs(risk_driver_sum) / float(cfg["CONF_SCALE"]))

    # Dominant drivers: abs(driver) desc; ties broken by grid order index
    indexed = list(enumerate(contribs))
    indexed.sort(key=lambda x: (-abs(x[1].driver), x[0]))
    dominant = [c for _, c in indexed[: min(4, len(contribs))]]

    # Downstream flags (v0 policy)
    suppress_execution = regime in ("PANIC",)
    allow_directional = regime in ("RISK_ON", "RISK_OFF") and conf >= 0.35 and not suppress_execution
    allow_flashloan = regime in ("RISK_ON",) and conf >= 0.55 and not suppress_execution

    audit = {
            "activation_band": float({"ARB+YIELD_ONLY":0.0,"LIGHT_DIRECTIONAL":1.0,"FULL_DIRECTIONAL":2.0,"FLASHLOAN_CLUSTER":3.0}.get(activation_band, -1.0)),
            "activation_band_str": activation_band,

        "mcs_total": float(mcs_total),
        "activation_band_code": float({"ARB+YIELD_ONLY":0.0,"LIGHT_DIRECTIONAL":1.0,"FULL_DIRECTIONAL":2.0,"FLASHLOAN_CLUSTER":3.0}.get(activation_band, -1.0)),

        "driver_sum": driver_sum,
        "risk_driver_sum": risk_driver_sum,
        "safe_driver_sum": safe_driver_sum,
        "risk_breadth": float(risk_breadth),
        "risk_breadth_neg": float(risk_breadth_neg),
        "confidence": conf,
        "n_assets": float(len(active_grid_symbols)),
    }

    return InstitutionalRegimeState(
        asof_index=asof_index,
        regime=regime,
        confidence=conf,
            activation_band=activation_band,
            mcs_total=mcs_total,
            macro_score=macro_score,
            risk_penalty=risk_penalty,
        dominant_drivers=dominant,
        allow_directional=allow_directional,
        allow_flashloan=allow_flashloan,
        suppress_execution=suppress_execution,
        audit=audit,
    )
