from __future__ import annotations

from dataclasses import dataclass
from typing import List, Protocol

from .contracts import DecisionRecord, Snapshot

class Pipeline(Protocol):
    def decide(self, snap: Snapshot) -> DecisionRecord:
        ...

@dataclass(frozen=True)
class PipelineMeta:
    model_version: str
    config_hash: str

class BaselinePipeline:
    """Stub baseline pipeline.

    Replace decide() with calls into your real strategy stack later.
    """
    def __init__(self, meta: PipelineMeta):
        self.meta = meta

    def decide(self, snap: Snapshot) -> DecisionRecord:
        # Minimal placeholder logic: always NO_TRADE with neutral regime.
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
    """Stub candidate pipeline (Latent/JEPA-ready).

    This must remain SHADOW ONLY until activation gates are passed.
    """
    def __init__(self, meta: PipelineMeta):
        self.meta = meta

    def decide(self, snap: Snapshot) -> DecisionRecord:
        # Placeholder: candidate emits PROPOSE_* but never executes.
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
