from __future__ import annotations

from typing import Any, Dict, List

from .base import AdapterContext


class PaperAdapter:
    name = "paper"

    def build_steps(self, intent: Dict[str, Any], mode: str, ctx: AdapterContext) -> List[Dict[str, Any]]:
        # Dry-run only: no network, no signing, no RPC.
        # Keep it explicit so future adapters can't get clever.
        return [
            {
                "type": "DRY_RUN",
                "detail": f"would_execute_mode={mode}",
                "intent_ref": intent.get("intent_id"),
                "asof": ctx.asof,
                "adapter": ctx.adapter,
            }
        ]
