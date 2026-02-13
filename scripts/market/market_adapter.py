#!/usr/bin/env python3
"""
Market Adapter Interface - How DEXs/chains plug into MarketSnapshot system

Every venue adapter must implement fetch_market_snapshot()
No scoring, no filtering - only truthful normalization

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

from abc import ABC, abstractmethod
from typing import List, Optional
import logging

from market_types import MarketRef, STANDARD_NOTIONAL_TIERS
from market_snapshot import MarketSnapshotV1

logger = logging.getLogger('Allmight.MarketAdapter')


class MarketAdapter(ABC):
    """
    Abstract base class for market adapters
    
    Each DEX/chain implements this interface to provide normalized snapshots
    
    Architecture rule: Adapters do ONLY:
    1. Pull raw data
    2. Compute mid price
    3. Compute tiered effective prices
    4. Fill cost/latency placeholders
    5. Return snapshot
    
    NO scoring, NO filtering, NO execution logic
    """
    
    def __init__(self, chain_id: str, venue_id: str):
        self.chain_id = chain_id
        self.venue_id = venue_id
        self.logger = logging.getLogger(f'Allmight.Adapter.{venue_id}')
    
    @abstractmethod
    def fetch_market_snapshot(
        self,
        market: MarketRef,
        tiers: Optional[List[int]] = None
    ) -> MarketSnapshotV1:
        """
        Fetch a single market snapshot
        
        Args:
            market: Market reference to fetch
            tiers: Notional tiers to quote (defaults to STANDARD_NOTIONAL_TIERS)
        
        Returns:
            MarketSnapshotV1 with all fields populated
        
        Raises:
            AdapterError: If fetch fails
        """
        pass
    
    @abstractmethod
    def fetch_all_markets(
        self,
        tiers: Optional[List[int]] = None
    ) -> List[MarketSnapshotV1]:
        """
        Fetch all available markets from this venue
        
        Args:
            tiers: Notional tiers to quote
        
        Returns:
            List of MarketSnapshotV1
        """
        pass
    
    @abstractmethod
    def get_available_markets(self) -> List[MarketRef]:
        """
        Get list of all available markets on this venue
        
        Returns:
            List of MarketRef objects
        """
        pass
    
    def _compute_effective_price(
        self,
        base_amount: float,
        quote_amount: float,
        direction: str  # 'buy' or 'sell'
    ) -> float:
        """
        Compute effective price including slippage
        
        For buy: how much quote you pay per unit base
        For sell: how much quote you receive per unit base
        
        Args:
            base_amount: Amount of base token
            quote_amount: Amount of quote token
            direction: 'buy' or 'sell'
        
        Returns:
            Effective price
        """
        if base_amount == 0:
            return 0.0
        
        return quote_amount / base_amount
    
    def _compute_slippage_bps(
        self,
        mid_price: float,
        effective_price: float,
        direction: str
    ) -> float:
        """
        Compute slippage in basis points
        
        Slippage = how much worse than mid price
        
        For buy: positive slippage means paying more than mid
        For sell: positive slippage means receiving less than mid
        """
        if mid_price == 0:
            return 0.0
        
        if direction == 'buy':
            # Paying more than mid is positive slippage
            slippage = ((effective_price - mid_price) / mid_price) * 10000
        else:  # sell
            # Receiving less than mid is positive slippage
            slippage = ((mid_price - effective_price) / mid_price) * 10000
        
        return max(0, slippage)  # Slippage can't be negative


class AdapterError(Exception):
    """Raised when adapter fails to fetch data"""
    pass


class AdapterRegistry:
    """
    Registry of all available adapters
    
    Manages adapter lifecycle and provides unified access
    """
    
    def __init__(self):
        self.adapters = {}
        self.logger = logging.getLogger('Allmight.AdapterRegistry')
    
    def register(self, adapter: MarketAdapter) -> None:
        """Register an adapter"""
        key = f"{adapter.chain_id}:{adapter.venue_id}"
        self.adapters[key] = adapter
        self.logger.info(f"Registered adapter: {key}")
    
    def get(self, chain_id: str, venue_id: str) -> Optional[MarketAdapter]:
        """Get adapter by chain and venue"""
        key = f"{chain_id}:{venue_id}"
        return self.adapters.get(key)
    
    def fetch_all_snapshots(
        self,
        tiers: Optional[List[int]] = None
    ) -> List[MarketSnapshotV1]:
        """
        Fetch snapshots from all registered adapters
        
        Returns:
            List of all snapshots across all venues
        """
        all_snapshots = []
        
        for key, adapter in self.adapters.items():
            try:
                snapshots = adapter.fetch_all_markets(tiers)
                all_snapshots.extend(snapshots)
                self.logger.info(f"Fetched {len(snapshots)} snapshots from {key}")
            except Exception as e:
                self.logger.error(f"Failed to fetch from {key}: {e}")
        
        return all_snapshots
    
    def list_adapters(self) -> List[str]:
        """List all registered adapters"""
        return list(self.adapters.keys())
