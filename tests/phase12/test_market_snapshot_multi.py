# tests/phase12/test_market_snapshot_multi.py
import pytest

from allmight.adapters.broker import AdapterBroker
from allmight.adapters.market_snapshot import MarketSnapshot


@pytest.fixture
def broker():
    # Create without __init__ to avoid requiring network_gate/secrets/declarations.
    b = AdapterBroker.__new__(AdapterBroker)

    calls = []

    def fake_call(*, adapter_id, operation, **kwargs):
        calls.append({"adapter_id": adapter_id, "operation": operation, "kwargs": dict(kwargs)})

        # Phase 12 invariant: all live reads use this operation.
        assert operation == "market_snapshot_live"

        # Deterministic adapter behaviors
        if adapter_id == "ok":
            sym = (kwargs.get("symbols") or ["BTC-USD"])[0]
            return MarketSnapshot(pair=sym, bid=100.0, ask=101.0, last=100.5, source="ok")

        if adapter_id == "refuse":
            raise PermissionError("refused")

        if adapter_id == "invalid":
            sym = (kwargs.get("symbols") or ["BTC-USD"])[0]
            # invalid snapshot: bid > ask
            return MarketSnapshot(pair=sym, bid=105.0, ask=100.0, last=102.0, source="invalid")

        raise KeyError(f"unknown adapter_id: {adapter_id}")

    b.call = fake_call
    b._test_calls = calls
    return b


def test_multi_snapshot_happy_path(broker):
    out, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["ok", "ok"],
        merge_policy="median",
        audit=True,
    )

    assert out is not None
    assert audit["pair"] == "BTC-USD"
    assert audit["merge_policy"] == "median"
    assert audit["inputs_used_count"] == 2
    assert [r["status"] for r in audit["results"]] == ["ok", "ok"]

    assert [c["adapter_id"] for c in broker._test_calls] == ["ok", "ok"]
    assert all(c["operation"] == "market_snapshot_live" for c in broker._test_calls)


def test_multi_snapshot_with_refusal(broker):
    out, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["ok", "refuse"],
        merge_policy="median",
        audit=True,
    )

    assert out is not None
    assert audit["inputs_used_count"] == 1
    assert audit["results"][0]["status"] == "ok"
    assert audit["results"][1]["status"] == "refused"


def test_multi_snapshot_all_refuse(broker):
    with pytest.raises(PermissionError):
        broker.market_snapshot_multi(
            pair="BTC-USD",
            adapter_ids=["refuse", "refuse"],
            merge_policy="median",
            audit=False,
        )


def test_multi_snapshot_filters_invalid(broker):
    out, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["ok", "invalid"],
        merge_policy="median",
        audit=True,
    )

    assert out is not None
    assert audit["inputs_used_count"] == 1
    assert audit["results"][0]["status"] == "ok"
    assert audit["results"][1]["status"] == "invalid"


def test_adapter_order_preserved(broker):
    _, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["invalid", "ok"],
        merge_policy="median",
        audit=True,
    )

    assert [r["adapter_id"] for r in audit["results"]] == ["invalid", "ok"]
