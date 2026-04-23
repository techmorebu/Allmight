from __future__ import annotations

from typing import Any, Dict

from scripts.phase7.adapters.base import PreparedAction


class PaperAdapter:
    name = "paper"

    def prepare(self, plan: Dict[str, Any]) -> PreparedAction:
        # Deterministic: only echo normalized fields.
        plan_id = str(plan.get("plan_id"))
        action = plan.get("action", {})
        payload = {
            "symbol": action.get("symbol"),
            "side": action.get("side"),
            "qty": action.get("qty"),
        }
        return PreparedAction(adapter=self.name, plan_id=plan_id, payload=payload)
