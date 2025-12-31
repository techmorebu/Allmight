from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SecretHandle:
    """Opaque reference to a secret (never the secret itself)."""
    key: str
    scope: str = "UNSCOPED"


class SecretsBoundary:
    """Secrets boundary.

    Phase 8: resolution is refused by default. No real keys, no live credentials.
    """

    def __init__(self, allow_resolution: bool = False):
        self._allow_resolution = bool(allow_resolution)

    def resolve(self, handle: SecretHandle) -> str:
        # Phase 8: never resolve real secrets.
        raise RuntimeError(f"REFUSE: secrets resolution forbidden (phase 8). key={handle.key} scope={handle.scope}")
