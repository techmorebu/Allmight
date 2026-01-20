from __future__ import annotations

from typing import Any, Dict

from scripts.phase5.adapters.live_base import LiveAdapter, LiveAction


class CoinbaseSpotLiveV0(LiveAdapter):
    """Placeholder live adapter for Phase 5.

    This adapter intentionally does NOT perform network I/O yet.
    It exists so the system can instantiate ONE live adapter under envelope gating.
    """

    adapter_id = "COINBASE_SPOT_LIVE_V0"

    def describe(self) -> Dict[str, Any]:
        return {
            "adapter_id": self.adapter_id,
            "venue": "coinbase",
            "market": "spot",
            "version": "v0",
            "io": "DISABLED_UNTIL_PHASE5_AUTHORIZED",
        }

    def execute(self, live_action: LiveAction) -> Dict[str, Any]:
        # Phase 5: remain non-IO until explicitly authorized later.
        return {
            "status": "NOOP",
            "adapter_id": self.adapter_id,
            "action": live_action.action,
            "payload": live_action.payload,
            "reason": "Live I/O disabled in Phase 5 scaffold adapter.",
        }
