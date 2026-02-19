#!/usr/bin/env python3
"""
Opportunity Detector v0 - Phase 2.5

Simple cross-venue arbitrage detector:
- Same pair, same chain
- Buy on venue A, sell on venue B
- Tier 1000 USD only (for now)
- Low threshold → let preflight do the real rejection

Author: Allmight System
Phase: 2.5 - Real Opportunity Detection
"""

from typing import List, Tuple, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger('Allmight.OpportunityDetector')


@dataclass
class OpportunityCandidate:
    """
    Raw opportunity candidate (before preflight)
    
    Just the basic facts: buy here, sell there, at what price.
    Preflight will decide if it's actually good.
    """
    opportunity_id: str
    chain_id: str
    
    # Buy side
    buy_venue_id: str
    buy_market_id: str
    buy_price: float  # Price to buy (USDC per ETH, for example)
    
    # Sell side
    sell_venue_id: str
    sell_market_id: str
    sell_price: float  # Price to sell
    
    # Token pair
    base_token: str   # e.g., "ETH"
    quote_token: str  # e.g., "USDC"
    
    # Tier
    tier_usd: int = 1000
    
    # Metrics (pre-cost)
    gross_edge_bps: float = 0.0
    
    # References to snapshots
    buy_snapshot: Optional[object] = None
    sell_snapshot: Optional[object] = None


class OpportunityDetectorV0:
    """
    Simple cross-venue opportunity detector
    
    Strategy:
    - Same token pair, same chain
    - Buy on venue A, sell on venue B
    - Tier 1000 only
    - Low threshold (50 bps gross edge minimum)
    """
    
    def __init__(self, min_gross_edge_bps: float = 50.0):
        """
        Initialize detector
        
        Args:
            min_gross_edge_bps: Minimum gross edge to consider (bps)
                               Set low - let preflight do real filtering
        """
        self.min_gross_edge_bps = min_gross_edge_bps
        logger.info(f"OpportunityDetector initialized (min_edge={min_gross_edge_bps} bps)")
    
    def detect_opportunities(self, snapshots: List) -> List[OpportunityCandidate]:
        """
        Detect cross-venue arbitrage opportunities
        
        Args:
            snapshots: List of MarketSnapshotV1 objects
        
        Returns:
            List of OpportunityCandidate objects
        """
        opportunities = []
        
        # Group snapshots by (chain_id, base_token, quote_token)
        pairs = self._group_by_pair(snapshots)
        
        # For each pair, find cross-venue opportunities
        for pair_key, pair_snapshots in pairs.items():
            if len(pair_snapshots) < 2:
                continue  # Need at least 2 venues
            
            # Find best buy and best sell
            opps = self._find_cross_venue_opps(pair_key, pair_snapshots)
            opportunities.extend(opps)
        
        logger.info(f"Detected {len(opportunities)} opportunities from {len(snapshots)} snapshots")
        
        return opportunities
    
    def _group_by_pair(self, snapshots: List) -> dict:
        """
        Group snapshots by token pair
        
        Returns:
            {(chain_id, base, quote): [snapshots]}
        """
        pairs = {}
        
        for snap in snapshots:
            # Extract token symbols
            base = snap.base_token.symbol
            quote = snap.quote_token.symbol
            
            key = (snap.chain_id, base, quote)
            
            if key not in pairs:
                pairs[key] = []
            
            pairs[key].append(snap)
        
        return pairs
    
    def _find_cross_venue_opps(
        self, 
        pair_key: Tuple[str, str, str],
        snapshots: List
    ) -> List[OpportunityCandidate]:
        """
        Find cross-venue opportunities for a token pair
        
        Strategy: For each venue, check if we can buy there and sell elsewhere
        """
        chain_id, base_token, quote_token = pair_key
        opportunities = []
        
        # Try all venue pairs
        for i, snap_buy in enumerate(snapshots):
            for j, snap_sell in enumerate(snapshots):
                if i == j:
                    continue  # Same venue
                
                # Check if there's an arbitrage
                opp = self._check_arbitrage(
                    snap_buy, snap_sell, chain_id, base_token, quote_token
                )
                
                if opp:
                    opportunities.append(opp)
        
        return opportunities
    
    def _check_arbitrage(
        self,
        snap_buy,
        snap_sell,
        chain_id: str,
        base_token: str,
        quote_token: str
    ) -> Optional[OpportunityCandidate]:
        """
        Check if there's an arbitrage between two snapshots
        
        Returns:
            OpportunityCandidate if arbitrage exists, None otherwise
        """
        
        # Use tier 1k prices
        buy_price = snap_buy.buy_px_1k
        sell_price = snap_sell.sell_px_1k
        
        if buy_price <= 0 or sell_price <= 0:
            return None  # Invalid prices
        
        # Calculate gross edge (before costs)
        # We buy at buy_price, sell at sell_price
        # Edge = (sell - buy) / buy * 10000
        gross_edge_bps = ((sell_price - buy_price) / buy_price) * 10000.0
        
        # Check threshold
        if gross_edge_bps < self.min_gross_edge_bps:
            return None
        
        # Generate opportunity ID
        opp_id = self._generate_opp_id(
            chain_id, snap_buy.venue_id, snap_sell.venue_id, 
            base_token, quote_token
        )
        
        return OpportunityCandidate(
            opportunity_id=opp_id,
            chain_id=chain_id,
            buy_venue_id=snap_buy.venue_id,
            buy_market_id=snap_buy.market_id,
            buy_price=buy_price,
            sell_venue_id=snap_sell.venue_id,
            sell_market_id=snap_sell.market_id,
            sell_price=sell_price,
            base_token=base_token,
            quote_token=quote_token,
            tier_usd=1000,
            gross_edge_bps=gross_edge_bps,
            buy_snapshot=snap_buy,
            sell_snapshot=snap_sell,
        )
    
    def _generate_opp_id(
        self,
        chain_id: str,
        venue_buy: str,
        venue_sell: str,
        base: str,
        quote: str
    ) -> str:
        """
        Generate stable opportunity ID
        
        Format: opp_{chain}_{base}{quote}_{venue1}_{venue2}
        """
        return f"opp_{chain_id}_{base}{quote}_{venue_buy}_{venue_sell}"


if __name__ == '__main__':
    """Demo with mock data"""
    from types import SimpleNamespace
    
    print("=" * 80)
    print("OPPORTUNITY DETECTOR V0 DEMO")
    print("=" * 80)
    print()
    
    # Create mock snapshots
    snapshots = [
        # Uniswap: Can buy ETH at 2685
        SimpleNamespace(
            chain_id='eth',
            venue_id='uniswap_v3',
            market_id='0xpool_univ3',
            base_token=SimpleNamespace(symbol='ETH'),
            quote_token=SimpleNamespace(symbol='USDC'),
            buy_px_1k=2685.0,
            sell_px_1k=2683.0,
            mid_px=2684.0,
        ),
        # Sushiswap: Can sell ETH at 2700
        SimpleNamespace(
            chain_id='eth',
            venue_id='sushiswap',
            market_id='0xpool_sushi',
            base_token=SimpleNamespace(symbol='ETH'),
            quote_token=SimpleNamespace(symbol='USDC'),
            buy_px_1k=2702.0,
            sell_px_1k=2700.0,
            mid_px=2701.0,
        ),
        # Curve: Lower prices (no arb)
        SimpleNamespace(
            chain_id='eth',
            venue_id='curve',
            market_id='0xpool_curve',
            base_token=SimpleNamespace(symbol='ETH'),
            quote_token=SimpleNamespace(symbol='USDC'),
            buy_px_1k=2684.0,
            sell_px_1k=2682.0,
            mid_px=2683.0,
        ),
    ]
    
    # Detect opportunities
    detector = OpportunityDetectorV0(min_gross_edge_bps=50.0)
    opportunities = detector.detect_opportunities(snapshots)
    
    print(f"Found {len(opportunities)} opportunities:")
    print()
    
    for opp in opportunities:
        print(f"Opportunity: {opp.opportunity_id}")
        print(f"  Buy:  {opp.buy_venue_id} @ {opp.buy_price:.2f}")
        print(f"  Sell: {opp.sell_venue_id} @ {opp.sell_price:.2f}")
        print(f"  Gross Edge: {opp.gross_edge_bps:.2f} bps")
        print()
    
    print("=" * 80)
    print("✅ DETECTOR DEMO COMPLETE")
    print("=" * 80)
    print()
    print("Note: These are RAW opportunities (before preflight)")
    print("Preflight will filter out ~80-95% based on net edge, gas, etc.")
