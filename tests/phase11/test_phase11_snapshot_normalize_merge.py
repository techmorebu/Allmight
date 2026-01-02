import pytest
from allmight.adapters.market_snapshot import MarketSnapshot
from allmight.adapters.snapshot_normalize_merge import normalize_and_merge


def _snap(price: float, source: str = "s", pair: str = "BTC-USD", ts: int = 1) -> MarketSnapshot:
    return MarketSnapshot(pair=pair, price=float(price), ts_unix=int(ts), source=source)


def test_normalize_and_merge_refuses_empty():
    with pytest.raises(Exception) as e:
        normalize_and_merge([])
    assert "REFUSE_EMPTY_SNAPSHOTS" in str(e.value)


def test_normalize_and_merge_filters_invalid_and_merges():
    nan = float("nan")
    snaps = [
        _snap(nan, "badnan"),
        _snap(0.0, "bad0"),
        _snap(100.0, "a"),
        _snap(101.0, "b"),
        _snap(99.0, "c"),
    ]
    out = normalize_and_merge(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.05)
    assert 99.0 <= out.price <= 101.0
    assert out.source in {"a", "b", "c"}


def test_normalize_and_merge_refuses_all_invalid():
    nan = float("nan")
    snaps = [_snap(nan, "badnan"), _snap(0.0, "bad0"), _snap(-1.0, "badneg")]
    with pytest.raises(Exception) as e:
        normalize_and_merge(snaps, policy="median")
    assert "REFUSE_ALL_INVALID" in str(e.value)


def test_normalize_and_merge_refuses_pair_mismatch_when_required():
    snaps = [
        _snap(100.0, "a", pair="BTC-USD"),
        _snap(101.0, "b", pair="ETH-USD"),
        _snap(99.0, "c", pair="BTC-USD"),
    ]
    with pytest.raises(Exception) as e:
        normalize_and_merge(snaps, policy="median")
    assert "REFUSE_PAIR_MISMATCH" in str(e.value)


def test_normalize_and_merge_allows_pair_mismatch_when_not_required():
    snaps = [
        _snap(100.0, "a", pair="BTC-USD"),
        _snap(101.0, "b", pair="ETH-USD"),
        _snap(99.0, "c", pair="BTC-USD"),
    ]
    out = normalize_and_merge(snaps, policy="median", require_same_pair=False)
    assert 99.0 <= out.price <= 101.0
