import pytest
from allmight.adapters.market_snapshot import MarketSnapshot

from allmight.adapters.snapshot_merge import merge_snapshots


def _snap(price: float, source: str = "s", pair: str = "BTC-USD", ts: int = 1) -> MarketSnapshot:
    return MarketSnapshot(pair=pair, price=float(price), ts_unix=int(ts), source=source)


def test_merge_refuses_empty():
    with pytest.raises(Exception) as e:
        merge_snapshots([])
    assert "REFUSE_EMPTY_SNAPSHOTS" in str(e.value)


def test_merge_pick_first_is_deterministic():
    out = merge_snapshots([_snap(100, "a"), _snap(200, "b")], policy="pick_first")
    assert out.price == 100.0
    assert out.source == "a"


def test_merge_pick_first_valid_skips_invalid_and_picks_first_valid():
    # invalid: price <= 0
    # invalid: NaN
    # valid: price finite > 0
    nan = float("nan")
    snaps = [
        _snap(0.0, "bad0"),
        _snap(nan, "badnan"),
        _snap(123.0, "good"),
        _snap(999.0, "later"),
    ]
    out = merge_snapshots(snaps, policy="pick_first_valid")
    assert out.price == 123.0
    assert out.source == "good"


def test_merge_pick_first_valid_refuses_if_none_valid():
    nan = float("nan")
    snaps = [
        _snap(0.0, "bad0"),
        _snap(-1.0, "badneg"),
        _snap(nan, "badnan"),
    ]
    with pytest.raises(Exception) as e:
        merge_snapshots(snaps, policy="pick_first_valid")
    assert "REFUSE_FIRST_VALID_NOT_FOUND" in str(e.value)


def test_merge_median_odd():
    out = merge_snapshots([_snap(100,"a"), _snap(300,"b"), _snap(200,"c")], policy="median")
    assert out.price == 200.0


def test_merge_median_even():
    out = merge_snapshots([_snap(100,"a"), _snap(300,"b")], policy="median")
    assert out.price == 200.0


def test_merge_reject_outliers_keeps_center_mass():
    snaps = [_snap(100,"a"), _snap(101,"b"), _snap(99,"c"), _snap(5000,"toxic")]
    out = merge_snapshots(snaps, policy="reject_outliers", outlier_band_pct=0.10)
    assert 99.0 <= out.price <= 101.0
    assert out.source in {"a","b","c"}  # toxic must not win


def test_merge_reject_outliers_refuses_if_all_rejected():
    snaps = [_snap(100,"a"), _snap(1000,"b")]
    with pytest.raises(Exception) as e:
        merge_snapshots(snaps, policy="reject_outliers", outlier_band_pct=0.0001)
    assert "REFUSE_ALL_REJECTED" in str(e.value)


def test_merge_refuses_unknown_policy():
    with pytest.raises(Exception) as e:
        merge_snapshots([_snap(100,"a")], policy="nope")
    assert "REFUSE_UNKNOWN_POLICY" in str(e.value)

def test_merge_median_strict_accepts_tight_cluster():
    snaps = [_snap(100, "a"), _snap(101, "b"), _snap(99, "c")]
    out = merge_snapshots(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.05)
    assert 99.0 <= out.price <= 101.0
    assert out.source in {"a", "b", "c"}


def test_merge_median_strict_refuses_too_few_sources():
    snaps = [_snap(100, "a"), _snap(101, "b")]
    with pytest.raises(Exception) as e:
        merge_snapshots(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.10)
    assert "REFUSE_MEDIAN_STRICT_TOO_FEW_SOURCES" in str(e.value)


def test_merge_median_strict_refuses_when_spread_too_wide():
    snaps = [_snap(100, "a"), _snap(130, "b"), _snap(160, "c")]
    with pytest.raises(Exception) as e:
        merge_snapshots(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.10)
    assert "REFUSE_MEDIAN_STRICT_SPREAD" in str(e.value)


def test_merge_median_strict_ignores_invalid_but_still_requires_min_sources():
    nan = float("nan")
    snaps = [_snap(100, "a"), _snap(nan, "badnan"), _snap(101, "b"), _snap(99, "c")]
    out = merge_snapshots(snaps, policy="median_strict", min_sources=3, max_spread_pct=0.05)
    assert 99.0 <= out.price <= 101.0
    assert out.source in {"a", "b", "c"}

