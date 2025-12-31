from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class NetworkDecision:
    allowed: bool
    reason: str


class NetworkGate:
    """Default-deny network gate.

    Phase 8: network is effectively disabled; this gate makes denials explicit.
    """

    def __init__(self, enabled: bool = False):
        self._enabled = bool(enabled)

    @property
    def enabled(self) -> bool:
        return self._enabled

    def require_allowed(self, *, adapter_id: str, operation: str, destination: Optional[str] = None) -> None:
        if not self._enabled:
            raise RuntimeError(f"REFUSE: network disabled (phase 8). adapter={adapter_id} op={operation}")
        # Even if enabled flag is True, Phase 8 still expects explicit allowlists later.
        # For now, refuse unless explicitly expanded in a later phase.
        raise RuntimeError(f"REFUSE: network denied (phase 8). adapter={adapter_id} op={operation} dest={destination}")
