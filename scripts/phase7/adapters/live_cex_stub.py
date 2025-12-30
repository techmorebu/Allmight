from __future__ import annotations

from typing import Any, Dict

from scripts.phase7.adapters.base import PreparedAction


class LiveCexStubAdapter:
    """
    Prepare-only stub for a future live CEX adapter.
    - No network
    - No side effects
    - Never executes orders (Phase-7 runner is NOT_RUN)
    """
    name = "live_cex_stub"

    def prepare(self, plan: Dict[str, Any]) -> PreparedAction:
        plan_id = str(plan.get("plan_id"))
        action = plan.get("action", {}) or {}
        payload = {
            "symbol": action.get("symbol"),
            "side": action.get("side"),
            "qty": action.get("qty"),
            "note": "prepare-only stub (no network, no execution)",
        }
        return PreparedAction(adapter=self.name, plan_id=plan_id, payload=payload)
