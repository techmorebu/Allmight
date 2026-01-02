import pytest
from allmight.adapters.snapshot_band import spread_pct, within_spread


def test_spread_pct_refuses_empty():
    with pytest.raises(Exception) as e:
        spread_pct([])
    assert "REFUSE_EMPTY_PRICES" in str(e.value)


def test_spread_pct_basic_math():
    # prices: [99, 100, 101] median=100, range=2 => 0.02
    out = spread_pct([99, 100, 101])
    assert abs(out - 0.02) < 1e-12


def test_within_spread_true_and_false():
    assert within_spread([99, 100, 101], max_spread_pct=0.03) is True
    assert within_spread([99, 100, 101], max_spread_pct=0.01) is False


def test_within_spread_refuses_negative_threshold():
    with pytest.raises(Exception) as e:
        within_spread([99, 100, 101], max_spread_pct=-0.1)
    assert "REFUSE_NEGATIVE_MAX_SPREAD" in str(e.value)
