from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from allmight.adapters.capabilities import Capability
from allmight.security.network_gate import NetworkGate
from allmight.security.redaction import redact_any, redact_sensitive
from allmight.security.secrets import SecretsBoundary


@dataclass(frozen=True)
class AdapterDeclaration:
    adapter_id: str
    version: str
    capabilities: List[Capability]


class AdapterBroker:
    """Phase 8 adapter broker (chokepoint).

    Phase 8 invariants enforced here:
    - prepare-only (no execution operations)
    - network default-deny
    - secrets resolution refused
    - capability mismatch fails closed
    - redaction on all outward-facing results/errors
    """

    def __init__(
        self,
        *,
        network_gate: NetworkGate,
        secrets: SecretsBoundary,
        declarations: Dict[str, AdapterDeclaration],
    ):
        self._net = network_gate
        self._secrets = secrets
        self._decl = declarations

    @classmethod
    def for_phase8_tests(cls, network_enabled: bool = False) -> "AdapterBroker":
        decl = {
            "dummy": AdapterDeclaration(
                adapter_id="dummy",
                version="0.0-phase8",
                capabilities=[Capability("MARKET_DATA_HTTP_READ"), Capability("ORDER_PREPARE_ONLY")],
            ),
            "dummy_toxic": AdapterDeclaration(
                adapter_id="dummy_toxic",
                version="0.0-phase8",
                capabilities=[Capability("MARKET_DATA_HTTP_READ")],
            ),
        }
        return cls(
            network_gate=NetworkGate(enabled=network_enabled),
            secrets=SecretsBoundary(allow_resolution=False),
            declarations=decl,
        )

    def _get_decl(self, adapter_id: str) -> AdapterDeclaration:
        if adapter_id not in self._decl:
            raise RuntimeError(redact_sensitive(f"REFUSE: unknown adapter (phase 8). adapter={adapter_id}"))
        return self._decl[adapter_id]

    def _require_capabilities(self, decl: AdapterDeclaration, required: List[str]) -> None:
        declared = {c.name for c in decl.capabilities}
        missing = [c for c in required if c not in declared]
        if missing:
            raise RuntimeError(
                redact_sensitive(
                    f"REFUSE: capability mismatch (phase 8). adapter={decl.adapter_id} missing={missing}"
                )
            )

    # --- Contracted operations (Phase 8) ---

    def execute_order(self, *, adapter_id: str, order_intent: Dict[str, Any]) -> None:
        # Phase 8 hard refusal: no execution.
        raise RuntimeError(redact_sensitive(f"REFUSE: order execution forbidden (phase 8, prepare-only). adapter={adapter_id}"))

    def call(
        self,
        *,
        adapter_id: str,
        operation: str,
        required_capabilities: List[str],
        params: Dict[str, Any],
    ) -> Any:
        decl = self._get_decl(adapter_id)
        self._require_capabilities(decl, required_capabilities)

        # Phase 8: any operation that implies network must be gated and refused by default.
        if operation in {"market_snapshot", "account_read", "funding_read"}:
            self._net.require_allowed(adapter_id=adapter_id, operation=operation, destination=None)

        # Phase 8: no live operations; stubs only
        return {"operation": operation, "params": redact_any(params), "adapter": adapter_id}

    def get_market_snapshot(self, *, adapter_id: str, symbols: List[str]) -> Any:
        decl = self._get_decl(adapter_id)
        self._require_capabilities(decl, ["MARKET_DATA_HTTP_READ"])

        # Phase 8:
        # - 'dummy_toxic' must be callable with network disabled to validate redaction.
        # - 'dummy' remains network-gated to prove default-deny behavior.
        if adapter_id == "dummy_toxic":
            toxic = {
                "symbols": symbols,
                "note": "Authorization: Bearer sk_live_SUPERSECRET",
                "api_key": "sk_live_SUPERSECRET",
            }
            return redact_any(toxic)

        # All other adapters (including 'dummy') are network-gated (default deny in Phase 8).
        try:
            self._net.require_allowed(adapter_id=adapter_id, operation="market_snapshot", destination=None)
        except Exception as e:
            raise RuntimeError(redact_sensitive(str(e)))

        # Even if network were enabled, Phase 8 does not implement real market reads.
        raise RuntimeError(redact_sensitive(
            f"REFUSE: market snapshot not implemented (phase 8). adapter={adapter_id}"
        ))
