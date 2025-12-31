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


# ---------------------------
# Phase 9 allowlist scaffolding (read-only, fail-closed)
# ---------------------------
from pathlib import Path
import json

def _load_phase9_allowlist_v0() -> dict:
    """
    Load Phase 9 network allowlist config.
    Default deny if missing or invalid.
    """
    path = Path("config/phase9/network_allowlist_v0.json")
    try:
        raw = path.read_text(encoding="utf-8")
        return json.loads(raw)
    except Exception:
        return {"version": "v0", "entries": []}

def _is_allowlisted(adapter_id: str, capability: str, domain: str) -> bool:
    cfg = _load_phase9_allowlist_v0()
    entries = cfg.get("entries", []) or []
    for e in entries:
        if (
            e.get("adapter_id") == adapter_id
            and e.get("capability") == capability
            and e.get("domain") == domain
        ):
            return True
    return False

def _deny_not_allowlisted(adapter_id: str, capability: str, domain: str) -> RuntimeError:
    # Do not include secrets; keep message minimal + redaction-friendly.
    return RuntimeError(f"DENY_NOT_ALLOWLISTED_DOMAIN adapter={adapter_id} cap={capability} domain={domain}")

# If the class exists in this module, we attach a method without changing its constructor.
try:
    NetworkGate
except NameError:
    NetworkGate = None

if NetworkGate is not None and not hasattr(NetworkGate, "assert_domain_allowed"):

    def assert_domain_allowed(self, *, adapter_id: str, capability: str, domain: str) -> None:
        """
        Phase 9: allowlist enforcement (deny-first).
        This check MUST NOT depend on network enabled/disabled; it is a policy gate, not an egress gate.
        """
        from pathlib import Path
        import json
        from allmight.security.redaction import redact_sensitive

        allowlist_path = Path("config/phase9/network_allowlist_v0.json")
        if not allowlist_path.exists():
            raise RuntimeError(redact_sensitive("DENY_ALLOWLIST_MISSING (phase 9)."))

        data = json.loads(allowlist_path.read_text(encoding="utf-8"))
        entries = data.get("allowlist", [])

        # Exact match only: (adapter_id, capability, domain). No wildcards.
        for ent in entries:
            if (
                ent.get("adapter_id") == adapter_id
                and ent.get("capability") == capability
                and ent.get("domain") == domain
            ):
                return

        raise RuntimeError(
            redact_sensitive(
                f"DENY_NOT_ALLOWLISTED_DOMAIN (phase 9). adapter={adapter_id} capability={capability} domain={domain}"
            )
        )


    setattr(NetworkGate, "assert_domain_allowed", assert_domain_allowed)
