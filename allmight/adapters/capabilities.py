from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Capability:
    """Static capability declaration for adapter operations.

    Phase 8: capabilities exist for gating; execution-like capabilities do not exist.
    """

    name: str

    def __str__(self) -> str:
        return self.name
