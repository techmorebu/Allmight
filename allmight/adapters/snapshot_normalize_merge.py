import math
from typing import List, Optional

from allmight.adapters.market_snapshot import MarketSnapshot
from allmight.adapters.snapshot_merge import merge_snapshots


def _is_valid_price(p: float) -> bool:
    try:
        return math.isfinite(float(p)) and float(p) > 0.0
    except Exception:
        return False


def normalize_and_merge(
    snaps: List[MarketSnapshot],
    *,
    policy: str = "median",
    outlier_band_pct: float = 0.10,
    min_sources: int = 3,
    max_spread_pct: float = 0.02,
    require_same_pair: bool = True,
) -> MarketSnapshot:
    # Keep refusal semantics explicit and stable.
    if not snaps:
        raise RuntimeError("REFUSE_EMPTY_SNAPSHOTS")

    valid = [s for s in snaps if _is_valid_price(s.price)]
    if not valid:
        raise RuntimeError("REFUSE_ALL_INVALID")

    if require_same_pair:
        pairs = {s.pair for s in valid}
        if len(pairs) != 1:
            raise RuntimeError("REFUSE_PAIR_MISMATCH")

    # Delegate policy/refusal behavior to the merge layer.
    return merge_snapshots(
        valid,
        policy=policy,
        outlier_band_pct=outlier_band_pct,
        min_sources=min_sources,
        max_spread_pct=max_spread_pct,
    )
