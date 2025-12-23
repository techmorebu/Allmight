from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Literal

RegimeLabel = Literal[
    "RISK_ON",
    "RISK_OFF_SOFT",
    "RISK_OFF_STRONG",
    "PANIC",
    "UNKNOWN",
]

ActivationBand = Literal[
    "ARB+YIELD_ONLY",
    "LIGHT_DIRECTIONAL",
    "FULL_DIRECTIONAL",
    "FLASHLOAN_CLUSTER",
]

@dataclass(frozen=True)
class RegimeAssetContribution:
    symbol: str
    # Signed driver strength: positive pushes toward RISK_ON, negative toward RISK_OFF
    driver: float
    structure_bias: str
    structure_score: float
    pressure_score: float
    bias_source: str
    asset_role: str

@dataclass(frozen=True)
class InstitutionalRegimeState:
    asof_index: int
    regime: RegimeLabel
    confidence: float  # 0..1
    # Phase 0 MCS aggregator fields (Excel-faithful)
    activation_band: ActivationBand
    mcs_total: float
    macro_score: float
    risk_penalty: float
    # Deterministic ordering must match Active Grid ordering
    dominant_drivers: List[RegimeAssetContribution]
    # Downstream flags
    allow_directional: bool
    allow_flashloan: bool
    suppress_execution: bool
    # Audit fields (must be emitted for debugging/replay validation)
    audit: Dict[str, float]
