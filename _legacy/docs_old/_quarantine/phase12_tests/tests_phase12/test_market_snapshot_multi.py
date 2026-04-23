# tests/phase12/test_market_snapshot_multi.py
import pytest


# NOTE:
# We deliberately rely on the repository's existing AdapterBroker fixture and
# its known test adapters (e.g., "dummy", "dummy_toxic") rather than constructing
# AdapterBroker directly. This preserves Phase 9/10 boundary wiring:
# - network gate default-deny
# - declarations capability scoping
# - refusal/redaction semantics
#
# This file is Phase 12: multi-source read-only orchestration + deterministic merge.


def test_multi_snapshot_happy_path(broker):
    out, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["dummy", "dummy"],
        merge_policy="median",
        audit=True,
    )

    assert out is not None
    assert audit["pair"] == "BTC-USD"
    assert audit["merge_policy"] == "median"
    assert audit["inputs_used_count"] == 2

    assert len(audit["results"]) == 2
    assert audit["results"][0]["adapter_id"] == "dummy"
    assert audit["results"][1]["adapter_id"] == "dummy"
    assert audit["results"][0]["status"] == "ok"
    assert audit["results"][1]["status"] == "ok"


def test_multi_snapshot_with_toxic_refusal_or_redaction(broker):
    out, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["dummy", "dummy_toxic"],
        merge_policy="median",
        audit=True,
    )

    # We expect the toxic path to NOT contribute usable input.
    assert out is not None
    assert audit["inputs_used_count"] == 1

    assert len(audit["results"]) == 2
    assert audit["results"][0]["adapter_id"] == "dummy"
    assert audit["results"][1]["adapter_id"] == "dummy_toxic"

    # Status vocabulary is defined by Phase 12 implementation, but must be explicit.
    assert audit["results"][0]["status"] == "ok"
    assert audit["results"][1]["status"] in {"refused", "redacted", "invalid", "error"}


def test_multi_snapshot_all_toxic_refuse(broker):
    # When all inputs are unusable, this should hard-fail (no silent None).
    with pytest.raises(Exception):
        broker.market_snapshot_multi(
            pair="BTC-USD",
            adapter_ids=["dummy_toxic", "dummy_toxic"],
            merge_policy="median",
            audit=False,
        )


def test_adapter_order_preserved(broker):
    _, audit = broker.market_snapshot_multi(
        pair="BTC-USD",
        adapter_ids=["dummy_toxic", "dummy"],
        merge_policy="median",
        audit=True,
    )

    assert [r["adapter_id"] for r in audit["results"]] == ["dummy_toxic", "dummy"]
