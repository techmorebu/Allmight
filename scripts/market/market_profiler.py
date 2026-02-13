#!/usr/bin/env python3
"""
Market Inefficiency Profiler - Proves edge exists before expansion

Analyzes market snapshots to answer:
- How often does spread exceed X bps?
- How long does mispricing persist?
- What notional survives slippage?
- What is decay time of edge?
- How many competing txs appear?
- Realized vs quoted slippage?

Output: EdgeScore ranking to guide expansion strategy

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

import time
import logging
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
from collections import defaultdict
import statistics

logger = logging.getLogger('Allmight.InefficacyProfiler')


@dataclass
class MarketProfile:
    """
    Inefficiency profile for a single market
    
    Answers the question: "Is there exploitable edge here?"
    """
    market_id: str
    venue: str
    pair: str
    
    # Spread statistics
    avg_spread_bps: float
    p50_spread_bps: float
    p95_spread_bps: float
    max_spread_bps: float
    
    # Persistence (how long does edge last?)
    avg_persistence_ms: float
    p95_persistence_ms: float
    
    # Slippage at different sizes
    avg_slippage_1k_bps: float
    avg_slippage_5k_bps: float
    avg_slippage_10k_bps: float
    
    # Volume & liquidity
    avg_depth_1pct: float
    avg_volume_24h: Optional[float]
    
    # Opportunity frequency
    opportunities_per_hour: float
    pct_time_with_edge: float
    
    # Competition indicators
    avg_tx_count_60s: Optional[float]
    
    # THE SCORE
    edge_score: float  # 0-100 composite score
    
    # Status
    status: str  # "STRONG" | "VIABLE" | "WEAK" | "NONE"
    
    def __str__(self) -> str:
        return (
            f"{self.pair:20s} | "
            f"Spread: {self.avg_spread_bps:5.1f} bps (95p: {self.p95_spread_bps:5.1f}) | "
            f"Persist: {self.avg_persistence_ms:6.0f}ms | "
            f"Slip@5k: {self.avg_slippage_5k_bps:5.1f} bps | "
            f"EdgeScore: {self.edge_score:5.1f} | "
            f"{self.status}"
        )


class MarketInefficacyProfiler:
    """
    Analyzes market snapshots to find structural inefficiencies
    
    NOT just volatility - looking for EXPLOITABLE mispricing
    """
    
    def __init__(self, config: Optional[Dict] = None):
        self.config = config or {}
        
        # Thresholds for edge detection
        self.min_edge_bps = self.config.get('min_edge_bps', 10)  # 0.1% minimum
        self.min_persistence_ms = self.config.get('min_persistence_ms', 500)
        
        # EdgeScore weights
        self.weights = {
            'spread': 0.30,        # How big is the spread?
            'persistence': 0.25,   # How long does it last?
            'frequency': 0.20,     # How often does it appear?
            'slippage': 0.15,      # Can notional survive?
            'depth': 0.10          # Is there liquidity?
        }
    
    def profile_market(self, snapshots: List) -> MarketProfile:
        """
        Profile a single market from its snapshots
        
        Args:
            snapshots: List of MarketSnapshotV1 for same market, time-ordered
        
        Returns:
            MarketProfile with all statistics
        """
        if not snapshots:
            raise ValueError("No snapshots to profile")
        
        # Sort by timestamp
        snapshots = sorted(snapshots, key=lambda s: s.ts_ms)
        
        market_id = snapshots[0].market_id
        venue = snapshots[0].venue_id
        pair = f"{snapshots[0].base_token.symbol}/{snapshots[0].quote_token.symbol}"
        
        logger.info(f"Profiling {venue} {pair} ({len(snapshots)} snapshots)")
        
        # === SPREAD ANALYSIS ===
        spreads = [s.spread_bps_1k for s in snapshots]
        
        avg_spread = statistics.mean(spreads)
        p50_spread = statistics.median(spreads)
        p95_spread = self._percentile(spreads, 95)
        max_spread = max(spreads)
        
        # === PERSISTENCE ANALYSIS ===
        persistence_times = self._analyze_persistence(snapshots)
        
        if persistence_times:
            avg_persistence = statistics.mean(persistence_times)
            p95_persistence = self._percentile(persistence_times, 95)
        else:
            avg_persistence = 0
            p95_persistence = 0
        
        # === SLIPPAGE ANALYSIS ===
        slippage_1k = [s.slippage_bps_1k for s in snapshots]
        slippage_5k = [s.slippage_bps_5k for s in snapshots]
        slippage_10k = [s.slippage_bps_10k for s in snapshots]
        
        avg_slippage_1k = statistics.mean(slippage_1k)
        avg_slippage_5k = statistics.mean(slippage_5k)
        avg_slippage_10k = statistics.mean(slippage_10k)
        
        # === DEPTH & VOLUME ===
        depths = [s.depth_usd_1pct for s in snapshots]
        avg_depth = statistics.mean(depths)
        
        volumes = [s.volume_usd_24h for s in snapshots if s.volume_usd_24h is not None]
        avg_volume = statistics.mean(volumes) if volumes else None
        
        # === OPPORTUNITY FREQUENCY ===
        edge_snapshots = [s for s in snapshots if s.spread_bps_1k >= self.min_edge_bps]
        
        duration_hours = (snapshots[-1].ts_ms - snapshots[0].ts_ms) / 3600000
        opportunities_per_hour = len(edge_snapshots) / duration_hours if duration_hours > 0 else 0
        pct_time_with_edge = (len(edge_snapshots) / len(snapshots)) * 100
        
        # === COMPETITION ===
        tx_counts = [s.recent_tx_count_60s for s in snapshots if s.recent_tx_count_60s is not None]
        avg_tx_count = statistics.mean(tx_counts) if tx_counts else None
        
        # === COMPUTE EDGE SCORE ===
        edge_score = self._compute_edge_score(
            avg_spread=avg_spread,
            p95_spread=p95_spread,
            avg_persistence=avg_persistence,
            opportunities_per_hour=opportunities_per_hour,
            pct_time_with_edge=pct_time_with_edge,
            avg_slippage_5k=avg_slippage_5k,
            avg_depth=avg_depth
        )
        
        # === DETERMINE STATUS ===
        if edge_score >= 8.0:
            status = "STRONG"
        elif edge_score >= 4.0:
            status = "VIABLE"
        elif edge_score >= 1.0:
            status = "WEAK"
        else:
            status = "NONE"
        
        return MarketProfile(
            market_id=market_id,
            venue=venue,
            pair=pair,
            avg_spread_bps=avg_spread,
            p50_spread_bps=p50_spread,
            p95_spread_bps=p95_spread,
            max_spread_bps=max_spread,
            avg_persistence_ms=avg_persistence,
            p95_persistence_ms=p95_persistence,
            avg_slippage_1k_bps=avg_slippage_1k,
            avg_slippage_5k_bps=avg_slippage_5k,
            avg_slippage_10k_bps=avg_slippage_10k,
            avg_depth_1pct=avg_depth,
            avg_volume_24h=avg_volume,
            opportunities_per_hour=opportunities_per_hour,
            pct_time_with_edge=pct_time_with_edge,
            avg_tx_count_60s=avg_tx_count,
            edge_score=edge_score,
            status=status
        )
    
    def _analyze_persistence(self, snapshots: List) -> List[float]:
        """
        Analyze how long edge persists
        
        Returns:
            List of persistence times in milliseconds
        """
        persistence_times = []
        
        i = 0
        while i < len(snapshots):
            snapshot = snapshots[i]
            
            # Check if this snapshot has edge
            if snapshot.spread_bps_1k < self.min_edge_bps:
                i += 1
                continue
            
            # Found edge - measure how long it persists
            start_ts = snapshot.ts_ms
            j = i + 1
            
            while j < len(snapshots):
                if snapshots[j].spread_bps_1k < self.min_edge_bps:
                    break
                j += 1
            
            # Persistence = time from start to when edge disappeared
            if j < len(snapshots):
                end_ts = snapshots[j].ts_ms
                persistence_ms = end_ts - start_ts
                persistence_times.append(persistence_ms)
            
            i = j
        
        return persistence_times
    
    def _compute_edge_score(
        self,
        avg_spread: float,
        p95_spread: float,
        avg_persistence: float,
        opportunities_per_hour: float,
        pct_time_with_edge: float,
        avg_slippage_5k: float,
        avg_depth: float
    ) -> float:
        """
        Compute composite EdgeScore (0-100)
        
        Higher score = more exploitable edge
        """
        # Spread component (0-100)
        # Good spread: 50+ bps avg, 100+ bps at p95
        spread_score = min(100, (avg_spread / 50) * 50 + (p95_spread / 100) * 50)
        
        # Persistence component (0-100)
        # Good persistence: 1000+ ms avg
        persistence_score = min(100, (avg_persistence / 1000) * 100)
        
        # Frequency component (0-100)
        # Good frequency: 10+ opportunities/hour, 50%+ of time
        freq_score = min(100, (opportunities_per_hour / 10) * 50 + (pct_time_with_edge / 50) * 50)
        
        # Slippage component (0-100)
        # Lower slippage is better
        # Good: <20 bps slippage at $5k
        slippage_score = max(0, 100 - (avg_slippage_5k / 20) * 100)
        
        # Depth component (0-100)
        # Good: $50k+ depth within 1%
        depth_score = min(100, (avg_depth / 50000) * 100)
        
        # Weighted composite
        edge_score = (
            self.weights['spread'] * spread_score +
            self.weights['persistence'] * persistence_score +
            self.weights['frequency'] * freq_score +
            self.weights['slippage'] * slippage_score +
            self.weights['depth'] * depth_score
        )
        
        # Scale to 0-10 for easier interpretation
        return edge_score / 10
    
    def _percentile(self, data: List[float], p: float) -> float:
        """Compute percentile"""
        if not data:
            return 0.0
        sorted_data = sorted(data)
        index = int((p / 100) * len(sorted_data))
        return sorted_data[min(index, len(sorted_data) - 1)]
    
    def generate_report(self, profiles: List[MarketProfile]) -> str:
        """
        Generate human-readable report
        
        Returns:
            Formatted report string
        """
        # Sort by EdgeScore descending
        profiles = sorted(profiles, key=lambda p: p.edge_score, reverse=True)
        
        report = []
        report.append("=" * 120)
        report.append("🔬 MARKET INEFFICIENCY PROFILER REPORT")
        report.append("=" * 120)
        report.append("")
        
        # Summary stats
        total = len(profiles)
        strong = len([p for p in profiles if p.status == "STRONG"])
        viable = len([p for p in profiles if p.status == "VIABLE"])
        weak = len([p for p in profiles if p.status == "WEAK"])
        none = len([p for p in profiles if p.status == "NONE"])
        
        report.append(f"📊 SUMMARY:")
        report.append(f"   Total markets analyzed: {total}")
        report.append(f"   STRONG edge (score ≥8.0): {strong}")
        report.append(f"   VIABLE edge (score 4.0-8.0): {viable}")
        report.append(f"   WEAK edge (score 1.0-4.0): {weak}")
        report.append(f"   NO edge (score <1.0): {none}")
        report.append("")
        
        if strong + viable > 0:
            report.append(f"✅ Edge exists! Proceed with expansion to similar markets")
        elif weak > 0:
            report.append(f"⚠️  Marginal edge. Consider execution optimization before expansion")
        else:
            report.append(f"❌ No exploitable edge found. Focus on execution, not expansion")
        
        report.append("")
        report.append("=" * 120)
        report.append("📈 DETAILED MARKET RANKINGS")
        report.append("=" * 120)
        report.append("")
        
        # Header
        report.append(
            f"{'Market':<25s} | "
            f"{'AvgSpread':>9s} | "
            f"{'95p Spread':>10s} | "
            f"{'Persist(ms)':>11s} | "
            f"{'Slip@5k':>8s} | "
            f"{'EdgeScore':>9s} | "
            f"{'Status':>8s}"
        )
        report.append("-" * 120)
        
        for profile in profiles:
            report.append(
                f"{profile.pair:<25s} | "
                f"{profile.avg_spread_bps:8.1f}  | "
                f"{profile.p95_spread_bps:9.1f}  | "
                f"{profile.avg_persistence_ms:10.0f}  | "
                f"{profile.avg_slippage_5k_bps:7.1f}  | "
                f"{profile.edge_score:8.1f}  | "
                f"{profile.status:>8s}"
            )
        
        report.append("")
        report.append("=" * 120)
        report.append("💡 RECOMMENDATIONS")
        report.append("=" * 120)
        report.append("")
        
        # Generate recommendations
        if strong > 0:
            report.append("1. STRONG markets found - these are your moneymakers!")
            report.append(f"   Focus: {', '.join(p.pair for p in profiles if p.status == 'STRONG')}")
            report.append("")
        
        if viable > 0:
            report.append("2. VIABLE markets - worth executing on")
            report.append(f"   Execute: {', '.join(p.pair for p in profiles if p.status == 'VIABLE')}")
            report.append("")
        
        if weak > 0:
            report.append("3. WEAK markets - may become viable with execution optimization")
            report.append("")
        
        # Expansion guidance
        best_venue = max(profiles, key=lambda p: p.edge_score)
        report.append(f"🚀 EXPANSION GUIDANCE:")
        report.append(f"   Best performing venue: {best_venue.venue}")
        report.append(f"   Best performing pair: {best_venue.pair}")
        report.append("")
        
        if strong + viable >= 3:
            report.append("   ✅ Expand to Base/Arbitrum with similar pairs")
        elif strong + viable >= 1:
            report.append("   ⚠️  Selective expansion only - focus on best pairs")
        else:
            report.append("   ❌ Do NOT expand - optimize current execution first")
        
        report.append("")
        report.append("=" * 120)
        
        return "\n".join(report)


def run_profiler_demo():
    """Demo/test of the profiler"""
    from market_snapshot import MarketSnapshotV1
    from market_types import TokenRef, MarketType
    import random
    
    # Generate mock snapshots
    eth = TokenRef("0x0", "ETH", 18)
    usdc = TokenRef("0x1", "USDC", 6)
    
    base_time = int(time.time() * 1000)
    
    snapshots = []
    for i in range(100):
        # Simulate varying spread
        spread = 20 + random.gauss(15, 10)
        spread = max(5, spread)
        
        mid = 1945.0
        buy = mid * (1 + spread / 20000)
        sell = mid * (1 - spread / 20000)
        
        snapshot = MarketSnapshotV1(
            ts_ms=base_time + i * 60000,  # 1 min apart
            chain_id="eth",
            venue_id="uniswap_v3",
            market_id="0xabc",
            market_type=MarketType.CLMM,
            base_token=eth,
            quote_token=usdc,
            mid_px=mid,
            buy_px_1k=buy,
            sell_px_1k=sell,
            buy_px_5k=buy * 1.001,
            sell_px_5k=sell * 0.999,
            buy_px_10k=buy * 1.002,
            sell_px_10k=sell * 0.998,
            spread_bps_1k=spread,
            slippage_bps_1k=10,
            slippage_bps_5k=15,
            slippage_bps_10k=20,
            depth_usd_1pct=50000,
            tvl_usd=1000000,
            swap_fee_bps=30,
            gas_cost_usd=2.0,
            latency_ms_est=100
        )
        snapshots.append(snapshot)
    
    # Profile
    profiler = MarketInefficacyProfiler()
    profile = profiler.profile_market(snapshots)
    
    print(profile)
    print()
    print(profiler.generate_report([profile]))


if __name__ == '__main__':
    run_profiler_demo()
