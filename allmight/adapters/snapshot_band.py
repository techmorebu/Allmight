from typing import Iterable, List
import statistics


def _as_list(prices: Iterable[float]) -> List[float]:
    return [float(x) for x in prices]


def spread_pct(prices: Iterable[float]) -> float:
    vals = _as_list(prices)
    if not vals:
        raise RuntimeError("REFUSE_EMPTY_PRICES")
    med = float(statistics.median(vals))
    if med <= 0:
        raise RuntimeError("REFUSE_NONPOSITIVE_MEDIAN")
    lo = min(vals)
    hi = max(vals)
    return (hi - lo) / med


def within_spread(prices: Iterable[float], *, max_spread_pct: float) -> bool:
    if max_spread_pct < 0:
        raise RuntimeError("REFUSE_NEGATIVE_MAX_SPREAD")
    return spread_pct(prices) <= float(max_spread_pct)
