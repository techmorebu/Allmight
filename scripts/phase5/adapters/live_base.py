from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass(frozen=True)
class LiveAction:
    """A minimal, auditable representation of a live action request.

    Phase 5 scope: this is a *request*, not an execution guarantee.
    """
    action: str  # e.g. "PING", "PLACE_ORDER"
    payload: Dict[str, Any]


class LiveAdapter:
    """Minimal live adapter interface for Phase 5.

    Implementations must remain manual/operator-controlled.
    No retries, no autonomous logic, no scaling.
    """

    adapter_id: str

    def describe(self) -> Dict[str, Any]:
        raise NotImplementedError

    def build_action(self, *, action: str, payload: Dict[str, Any]) -> LiveAction:
        return LiveAction(action=action, payload=payload)

    def execute(self, live_action: LiveAction) -> Dict[str, Any]:
        """Execute a live action.

        Phase 5: actual exchange I/O is still forbidden until explicitly authorized
        by envelope allow_live + allowlist + env + ack and later appendix approval.
        """
        raise NotImplementedError
