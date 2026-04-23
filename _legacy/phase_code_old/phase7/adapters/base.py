from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Protocol


@dataclass(frozen=True)
class PreparedAction:
    adapter: str
    plan_id: str
    payload: Dict[str, Any]


class Adapter(Protocol):
    name: str

    def prepare(self, plan: Dict[str, Any]) -> PreparedAction:
        ...
