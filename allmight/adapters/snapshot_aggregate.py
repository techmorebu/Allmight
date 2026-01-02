from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from allmight.adapters.market_snapshot import MarketSnapshot
from allmight.adapters.snapshot_normalize_merge import normalize_and_merge


@dataclass(frozen=True)
class SnapshotAggregateResult:
    merged: MarketSnapshot
    audit: Dict[str, object]


def aggregate_snapshots(
    snaps: List[MarketSnapshot],
    *,
    policy: str = "median",
    outlier_band_pct: float = 0.10,
    min_sources: int = 3,
    max_spread_pct: float = 0.02,
    require_same_pair: bool = True,
) -> SnapshotAggregateResult:
    sources_in = [s.source for s in snaps]
    pair_set = sorted({s.pair for s in snaps}) if snaps else []

    merged = normalize_and_merge(
        snaps,
        policy=policy,
        outlier_band_pct=outlier_band_pct,
        min_sources=min_sources,
        max_spread_pct=max_spread_pct,
        require_same_pair=require_same_pair,
    )

    audit: Dict[str, object] = {
        "policy": policy,
        "require_same_pair": require_same_pair,
        "pair_set": pair_set,
        "sources_in": sources_in,
        "sources_out": merged.source,
        "n_in": len(snaps),
    }
    return SnapshotAggregateResult(merged=merged, audit=audit)
