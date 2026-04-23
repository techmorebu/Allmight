from __future__ import annotations

from typing import Any, Dict, List

from .base import AdapterContext


class CexStubAdapter:
    """
    Dry-run only. No SDK imports. No network. No signing.
    This adapter exists to validate multi-adapter planning paths.
    """
    name = "cex_stub"
    adapter_version = "v0"

    def build_steps(self, intent: Dict[str, Any], mode: str, ctx: AdapterContext) -> List[Dict[str, Any]]:
        return [
            {
                "type": "DRY_RUN",
                "detail": f"would_execute_cex_stub_mode={mode}",
                "venue": "CEX_STUB",
                "intent_ref": intent.get("intent_id"),
                "asof": ctx.asof,
                "adapter": ctx.adapter,
                "requires_network": False,
            }
        ]
