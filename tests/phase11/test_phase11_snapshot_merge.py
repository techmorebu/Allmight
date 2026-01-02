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
