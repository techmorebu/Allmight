from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol

from .contracts import DecisionRecord, Snapshot

class Pipeline(Protocol):
    def decide(self, snap: Snapshot) -> DecisionRecord:
        ...

@dataclass(frozen=True)
class PipelineMeta:
    model_version: str
    config_hash: str

def _extract_phase2(snap: Snapshot) -> Optional[Dict[str, Any]]:
    """Pull Phase-2 regime fields from Snapshot.extra if present.

    Expected shape (minimal):
    snap.extra = {
      "phase2": {
        "regime": "RISK_ON|RISK_OFF|PANIC|TRANSITION|...",
        "confidence": 0.0-1.0,
        "risk_flags": ["..."]  # optional
      }
    }
    """
    if not isinstance(snap.extra, dict):
        return None
    p2 = snap.extra.get("phase2")
    if isinstance(p2, dict) and "regime" in p2 and "confidence" in p2:
        return p2
    return None

class BaselinePipeline:
    """Baseline pipeline (shadow-only).

    Incremental wiring:
    - If Snapshot.extra includes Phase-2 regime fields, surface them into DecisionRecord.
    - Otherwise, remain inert (NO_TRADE) to avoid false authority.
    """
    def __init__(self, meta: PipelineMeta):
        self.meta = meta

    def decide(self, snap: Snapshot) -> DecisionRecord:
        p2 = _extract_phase2(snap)
        if p2:
            regime = str(p2.get("regime"))
            conf = float(p2.get("confidence"))
            rf = p2.get("risk_flags") or []
            if not isinstance(rf, list):
                rf = [str(rf)]
            # Still shadow-only: NO_TRADE unless you later map regime->advisory actions
            return DecisionRecord(
                ts=snap.ts,
                symbol=snap.symbol,
                pipeline="baseline",
                regime=regime,
                confidence=max(0.0, min(1.0, conf)),
                action="NO_TRADE",
                risk_flags=[str(x) for x in rf],
                model_version=self.meta.model_version,
                config_hash=self.meta.config_hash,
                features_hash=snap.features_hash(),
                notes="baseline wired: phase2 regime surfaced (shadow-only)",
            )

        # Default inert behavior
        return DecisionRecord(
            ts=snap.ts,
            symbol=snap.symbol,
            pipeline="baseline",
            regime="UNKNOWN",
            confidence=0.50,
            action="NO_TRADE",
            risk_flags=[],
            model_version=self.meta.model_version,
            config_hash=self.meta.config_hash,
            features_hash=snap.features_hash(),
            notes="stub baseline",
        )

class CandidatePipeline:
    """Candidate pipeline (Latent/JEPA-ready, shadow-only)."""
    def __init__(self, meta: PipelineMeta):
        self.meta = meta

    def decide(self, snap: Snapshot) -> DecisionRecord:
        return DecisionRecord(
            ts=snap.ts,
            symbol=snap.symbol,
            pipeline="candidate",
            regime="UNKNOWN",
            confidence=0.50,
            action="NO_TRADE",
            risk_flags=[],
            model_version=self.meta.model_version,
            config_hash=self.meta.config_hash,
            features_hash=snap.features_hash(),
            notes="stub candidate (shadow-only)",
        )
