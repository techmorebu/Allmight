from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from allmight.security.redaction import redact_sensitive


@dataclass(frozen=True)
class AllowlistRule:
    adapter_id: str
    capability: str
    domain: str


class NetworkGate:
    """
    Phase 8/9 NetworkGate:
      - Default deny when disabled.
      - Exact allowlist enforcement: (adapter_id, capability, domain) no wildcards.
      - No secrets in errors (redacted).
      - Phase 9 adds minimal, safe HTTP GET-bytes helper (still deny-first, no retries).
    """

    def __init__(
        self,
        *,
        enabled: bool,
        allowlist_path: Optional[str] = None,
    ) -> None:
        self.enabled = bool(enabled)
        self._allowlist_path = allowlist_path or "config/phase9/network_allowlist_v0.json"
        self._cache: Optional[Set[Tuple[str, str, str]]] = None

    def _load_allowlist(self) -> Set[Tuple[str, str, str]]:
        if self._cache is not None:
            return self._cache

        path = Path(self._allowlist_path)
        if not path.exists():
            # If allowlist file is missing, deny everything.
            self._cache = set()
            return self._cache

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            # Malformed config => deny everything.
            self._cache = set()
            return self._cache

        rules = set()
        for item in (data.get("allowlist") or []):
            if not isinstance(item, dict):
                continue
            a = str(item.get("adapter_id") or "").strip()
            c = str(item.get("capability") or "").strip()
            d = str(item.get("domain") or "").strip()
            if a and c and d:
                rules.add((a, c, d))

        self._cache = rules
        return self._cache

    def assert_domain_allowed(self, *, adapter_id: str, capability: str, domain: str) -> None:
        """
        Phase 9: deny-first allowlist enforcement.
        NOTE: This does NOT imply network is enabled. It only enforces allowlist.
        """
        rules = self._load_allowlist()
        key = (str(adapter_id), str(capability), str(domain))
        if key not in rules:
            raise RuntimeError(
                redact_sensitive(
                    f"DENY_NOT_ALLOWLISTED_DOMAIN (phase 9). adapter={adapter_id} capability={capability} domain={domain}"
                )
            )

    def require_allowed(self, *, adapter_id: str, operation: str, destination: Optional[str] = None) -> None:
        """
        Phase 8/9: generic operation gate.
        - If network disabled => deny.
        - If destination provided, it should be a domain and must be allowlisted for this adapter+operation.
          For Phase 9, callers should prefer assert_domain_allowed with explicit capability tokens.
        """
        if not self.enabled:
            raise RuntimeError(redact_sensitive("DENY_NETWORK_DISABLED (phase 9)."))

        # If a destination is given, treat operation as a capability-like string for allowlist purposes.
        if destination:
            self.assert_domain_allowed(adapter_id=adapter_id, capability=operation, domain=destination)

    def http_get_bytes(
        self,
        *,
        url: str,
        adapter_id: str,
        capability: str,
        timeout_s: float = 5.0,
        max_bytes: int = 262144,
    ) -> bytes:
        """
        Phase 9: minimal, safe HTTP GET (bytes) egress.
        - Fail-closed if network disabled.
        - Enforces exact allowlist (adapter_id, capability, domain).
        - No retries, no background work.
        - Caps response size to max_bytes.
        """
        from urllib.parse import urlparse
        import urllib.request

        if not self.enabled:
            raise RuntimeError(redact_sensitive("DENY_NETWORK_DISABLED (phase 9)."))

        u = urlparse(url)
        if u.scheme not in ("http", "https"):
            raise RuntimeError(redact_sensitive(f"DENY_UNSAFE_URL_SCHEME (phase 9). scheme={u.scheme}"))

        domain = (u.netloc or "").split(":")[0].strip()
        if not domain:
            raise RuntimeError(redact_sensitive("DENY_MISSING_DOMAIN (phase 9)."))

        # Allowlist deny-first (no wildcards)
        self.assert_domain_allowed(adapter_id=adapter_id, capability=capability, domain=domain)

        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "AllmightPhase9/0"})
        try:
            with urllib.request.urlopen(req, timeout=timeout_s) as resp:
                data = resp.read(max_bytes + 1)
        except Exception as e:
            raise RuntimeError(redact_sensitive(f"DENY_HTTP_ERROR (phase 9). err={e}"))

        if len(data) > max_bytes:
            raise RuntimeError(redact_sensitive("DENY_RESPONSE_TOO_LARGE (phase 9)."))

        return data
