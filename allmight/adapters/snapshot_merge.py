from __future__ import annotations

import math

from dataclasses import replace
from typing import Iterable, List, Optional

from allmight.adapters.market_snapshot import MarketSnapshot
from allmight.security.redaction import redact_sensitive


def _median(values: List[float]) -> float:
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 1:
        return float(s[mid])
    return float((s[mid - 1] + s[mid]) / 2.0)


def merge_snapshots(
    snapshots: Iterable[MarketSnapshot],
    *,
    policy: str = "median",
    outlier_band_pct: float = 0.10,
) -> MarketSnapshot:
    snaps = list(snapshots)
    if not snaps:
        raise RuntimeError(redact_sensitive("REFUSE_EMPTY_SNAPSHOTS (phase 11)."))

    if policy == "pick_first":
        return snaps[0]

    if policy == "pick_first_valid":
        for ss in snaps:
            try:
                pair_ok = isinstance(ss.pair, str) and ss.pair.strip() != ""
                price_ok = isinstance(ss.price, (int, float)) and math.isfinite(float(ss.price)) and float(ss.price) > 0.0
                ts_ok = isinstance(ss.ts_unix, int)
            except Exception:
                pair_ok = price_ok = ts_ok = False

            if pair_ok and price_ok and ts_ok:
                return ss

        raise RuntimeError(redact_sensitive("REFUSE_FIRST_VALID_NOT_FOUND (phase 11)."))

    if policy == "median":
        m = _median([s.price for s in snaps])
        # Keep pair/ts from the first (deterministic), but label source as merged.
        return MarketSnapshot(pair=snaps[0].pair, price=m, ts_unix=snaps[0].ts_unix, source="merged:median")

    if policy == "reject_outliers":
        m = _median([s.price for s in snaps])
        band = abs(m) * float(outlier_band_pct)
        lo, hi = (m - band), (m + band)
        survivors = [s for s in snaps if lo <= s.price <= hi]
        if not survivors:
            raise RuntimeError(redact_sensitive("REFUSE_ALL_REJECTED (phase 11)."))
        m2 = _median([s.price for s in survivors])

        # Attribute source to a real survivor (closest-to-median). Stable tie-break: first in input order.
        best = min(survivors, key=lambda ss: (abs(ss.price - m2),))
        return MarketSnapshot(pair=best.pair, price=m2, ts_unix=best.ts_unix, source=best.source)

    raise RuntimeError(redact_sensitive(f"REFUSE_UNKNOWN_POLICY (phase 11). policy={policy}"))
