from __future__ import annotations

import pytest

from scripts.phase6.adapters.registry import get_registry, get_adapter
from scripts.phase6.adapters.base import AdapterContext


def test_registry_is_deterministic_and_includes_paper():
    reg = get_registry()
    assert list(reg.keys()) == ["paper"]


def test_unknown_adapter_halts():
    with pytest.raises(ValueError):
        get_adapter("cex_spot")


def test_paper_adapter_builds_dry_run_steps():
    a = get_adapter("paper")
    ctx = AdapterContext(adapter="paper", asof="i60")
    steps = a.build_steps({"intent_id": "X"}, mode="paper", ctx=ctx)
    assert isinstance(steps, list) and len(steps) == 1
    assert steps[0]["type"] == "DRY_RUN"
