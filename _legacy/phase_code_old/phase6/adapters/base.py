from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Protocol


@dataclass(frozen=True)
class AdapterContext:
    adapter: str
    asof: str


class Phase6Adapter(Protocol):
    name: str

    def build_steps(self, intent: Dict[str, Any], mode: str, ctx: AdapterContext) -> List[Dict[str, Any]]:
        ...
