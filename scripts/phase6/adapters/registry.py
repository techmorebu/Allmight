from __future__ import annotations

from typing import Dict

from .paper import PaperAdapter
from .base import Phase6Adapter


def get_registry() -> Dict[str, Phase6Adapter]:
    # Deterministic registry: explicit map, stable order by construction.
    paper = PaperAdapter()
    return {
        paper.name: paper,
    }


def get_adapter(name: str) -> Phase6Adapter:
    reg = get_registry()
    if name not in reg:
        raise ValueError(f"Unknown adapter: {name}. Known: {sorted(reg.keys())}")
    return reg[name]
