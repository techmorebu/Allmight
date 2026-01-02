import pytest
from allmight.adapters.market_snapshot import MarketSnapshot
from allmight.adapters.snapshot_aggregate import aggregate_snapshots


def _snap(price: float, source: str = "s", pair: str = "BTC-USD", ts: int = 1) -> MarketSnapshot:
    return MarketSnapshot(pair=pair, price=float(price), ts_unix=int(ts), source=source)


def test_aggregate_includes_audit_sources_and_pair_set():
    snaps = [_snap(100.0, "a"), _snap(101.0, "b"), _snap(99.0, "c")]
    out = aggregate_snapshots(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.05)

    assert 99.0 <= out.merged.price <= 101.0
    assert out.merged.source in {"a", "b", "c"}
    assert out.audit["sources_in"] == ["a", "b", "c"]
    assert out.audit["pair_set"] == ["BTC-USD"]
    assert out.audit["policy"] == "median_strict"
    assert out.audit["n_in"] == 3


def test_aggregate_bubbles_refusal_codes():
    snaps = [_snap(100.0, "a"), _snap(130.0, "b"), _snap(160.0, "c")]
    with pytest.raises(Exception) as e:
        aggregate_snapshots(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.10)
    assert "REFUSE_MEDIAN_STRICT_SPREAD" in str(e.value)
