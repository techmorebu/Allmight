from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Literal, Optional
import json
import hashlib

PipelineName = Literal["baseline", "candidate"]

Action = Literal[
    "BUY",
    "SELL",
    "HOLD",
    "NO_TRADE",
    "VETO",
    "PROPOSE_BUY",
    "PROPOSE_SELL",
]

@dataclass(frozen=True)
class Snapshot:
    """Minimal input snapshot contract.

    Keep this intentionally small; expand later only when you have a stable schema.
    """
    ts: str
    symbol: str
    # Minimal numeric features. Add fields only when needed.
    price: float | None = None
    volume: float | None = None
    spread: float | None = None
    extra: Optional[Dict[str, Any]] = None

    def features_hash(self) -> str:
        payload = json.dumps(
            {
                "ts": self.ts,
                "symbol": self.symbol,
                "price": self.price,
                "volume": self.volume,
                "spread": self.spread,
                "extra": self.extra or {},
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


@dataclass(frozen=True)
class DecisionRecord:
    """Normalized output contract for A/B comparisons."""
    ts: str
    symbol: str
    pipeline: PipelineName
    regime: str
    confidence: float
    action: Action
    risk_flags: List[str]
    model_version: str
    config_hash: str
    features_hash: str
    notes: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
