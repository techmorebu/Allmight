from __future__ import annotations

import math
from typing import List

from allmight.adapters.market_snapshot import MarketSnapshot
from allmight.adapters.snapshot_band import within_spread
from allmight.security.redaction import redact_sensitive


def _is_valid_price(x: float) -> bool:
    try:
        if x is None:
            return False
        if isinstance(x, bool):
            return False
        if not math.isfinite(float(x)):
            return False
        return float(x) > 0.0
    except Exception:
        return False


def _valid_snaps(snaps: List[MarketSnapshot]) -> List[MarketSnapshot]:
    return [s for s in snaps if _is_valid_price(s.price)]


def _median_from_sorted(sorted_snaps: List[MarketSnapshot]) -> MarketSnapshot:
    # sorted_snaps must be non-empty
    n = len(sorted_snaps)
    mid = n // 2
    if n % 2 == 1:
        return sorted_snaps[mid]
    # even: average the two center prices; retain pair + ts from first center; source is merged
    lo = sorted_snaps[mid - 1]
    hi = sorted_snaps[mid]
    price = (float(lo.price) + float(hi.price)) / 2.0
    return MarketSnapshot(pair=lo.pair, price=price, ts_unix=lo.ts_unix, source="merged:median")


def merge_snapshots(
    snaps: List[MarketSnapshot],
    policy: str = "median",
    outlier_band_pct: float = 0.10,
    *,
    min_sources: int = 3,
    max_spread_pct: float = 0.02,
) -> MarketSnapshot:
    """Pure snapshot merge policies (Phase 11).

    Policies:
      - pick_first: return first snapshot as-is
      - pick_first_valid: return first snapshot with finite price > 0
      - median: median price (even -> average)
      - reject_outliers: compute median; keep values within +/- outlier_band_pct; median of kept
      - median_strict: require >= min_sources valid; require spread <= max_spread_pct; then median

    Refusals:
      - REFUSE_EMPTY_SNAPSHOTS
      - REFUSE_UNKNOWN_POLICY
      - REFUSE_FIRST_VALID_NOT_FOUND
      - REFUSE_ALL_REJECTED
      - REFUSE_MEDIAN_STRICT_TOO_FEW_SOURCES
      - REFUSE_MEDIAN_STRICT_SPREAD
    """
    if snaps is None or len(snaps) == 0:
        raise RuntimeError(redact_sensitive("REFUSE_EMPTY_SNAPSHOTS (phase 11)."))

    policy = str(policy or "").strip()
    if not policy:
        policy = "median"

    if policy == "pick_first":
        return snaps[0]

    if policy == "pick_first_valid":
        for s in snaps:
            if _is_valid_price(s.price):
                return s
        raise RuntimeError(redact_sensitive("REFUSE_FIRST_VALID_NOT_FOUND (phase 11)."))

    valid = _valid_snaps(snaps)
    if len(valid) == 0:
        # For policies that need prices, treat as empty/invalid input.
        raise RuntimeError(redact_sensitive("REFUSE_FIRST_VALID_NOT_FOUND (phase 11)."))

    # Sort once (ascending)
    valid_sorted = sorted(valid, key=lambda s: float(s.price))

    if policy == "median":
        return _median_from_sorted(valid_sorted)

    if policy == "reject_outliers":
        # center mass by median
        med_snap = _median_from_sorted(valid_sorted)
        med_price = float(med_snap.price)
        band = abs(float(outlier_band_pct))
        if band <= 0.0:
            # if band is 0, only exact matches to median survive
            kept = [s for s in valid_sorted if float(s.price) == med_price]
        else:
            lo = med_price * (1.0 - band)
            hi = med_price * (1.0 + band)
            kept = [s for s in valid_sorted if lo <= float(s.price) <= hi]

        if len(kept) == 0:
            raise RuntimeError(redact_sensitive("REFUSE_ALL_REJECTED (phase 11)."))

        kept_sorted = sorted(kept, key=lambda s: float(s.price))
        # IMPORTANT: source must be a real surviving source when possible (tests enforce toxic can't win)
        return _median_from_sorted(kept_sorted) if len(kept_sorted) % 2 == 0 else kept_sorted[len(kept_sorted)//2]

    if policy == "median_strict":
        ms = int(min_sources)
        if ms < 1:
            ms = 1

        if len(valid_sorted) < ms:
            raise RuntimeError(redact_sensitive("REFUSE_MEDIAN_STRICT_TOO_FEW_SOURCES (phase 11)."))

        med = _median_from_sorted(valid_sorted)
        med_price = float(med.price)
        lo = float(valid_sorted[0].price)
        hi = float(valid_sorted[-1].price)

        # Spread relative to median (fail closed on near-zero median, though median should be >0 if valid)
        if med_price <= 0.0:
            raise RuntimeError(redact_sensitive("REFUSE_MEDIAN_STRICT_SPREAD (phase 11)."))

        spread = (hi - lo) / med_price
        if spread > float(max_spread_pct):
            raise RuntimeError(redact_sensitive("REFUSE_MEDIAN_STRICT_SPREAD (phase 11)."))

        return med

    raise RuntimeError(redact_sensitive(f"REFUSE_UNKNOWN_POLICY (phase 11). policy={policy}"))
