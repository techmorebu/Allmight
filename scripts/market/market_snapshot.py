#!/usr/bin/env python3
"""
MarketSnapshot V1 - Canonical market data structure

The spine of the entire system. All downstream scoring uses this object only.

Design Invariants:
- One snapshot = one market, one time, normalized
- Supports both AMM and Orderbook venues
- Tiered notional quoting (spread meaningless without size)
- Deterministic serialization for replay/audit
- No special casing in downstream logic

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

from dataclasses import dataclass, asdict
from typing import Dict, Optional
import json

from market_types import TokenRef, MarketType, STANDARD_NOTIONAL_TIERS


@dataclass
class MarketSnapshotV1:
    """
    Canonical market snapshot - normalized across all chains/venues
    
    CRITICAL INVARIANTS:
    - market_id must be stable across time
    - Tiered prices always present for standard tiers
    - buy_px[tier] >= sell_px[tier] (if violated, flag as anomaly)
    - All prices non-negative
    - Deterministic serialization (stable key order)
    """
    
    # ===== IDENTIFIERS =====
    ts_ms: int                    # Epoch milliseconds
    chain_id: str                 # e.g., "eth", "base", "arb", "sol"
    venue_id: str                 # e.g., "uniswap_v3", "raydium", "phoenix"
    market_id: str                # Stable ID (pool address, pair id, orderbook address)
    market_type: MarketType       # AMM | CLMM | ORDERBOOK | VAULT
    
    # ===== TOKENS =====
    base_token: TokenRef          # Token being quoted
    quote_token: TokenRef         # Token used for pricing
    
    # ===== PRICING (TIERED) =====
    # Key: Effective prices at different notional sizes
    # Includes fees + price impact
    mid_px: float                           # Mid price (orderbook mid or AMM mid)
    buy_px_1k: float                        # Effective price to buy $1k of base
    sell_px_1k: float                       # Effective price to sell $1k of base
    buy_px_5k: float                        # Effective price to buy $5k of base
    sell_px_5k: float                       # Effective price to sell $5k of base
    buy_px_10k: float                       # Effective price to buy $10k of base
    sell_px_10k: float                      # Effective price to sell $10k of base
    
    # ===== SPREADS & SLIPPAGE =====
    spread_bps_1k: float                    # Spread at $1k tier (bps)
    slippage_bps_1k: float                  # Slippage vs mid at $1k
    slippage_bps_5k: float                  # Slippage vs mid at $5k
    slippage_bps_10k: float                 # Slippage vs mid at $10k
    
    # ===== LIQUIDITY & DEPTH =====
    depth_usd_1pct: float                   # Liquidity within ±1% of mid
    tvl_usd: Optional[float] = None         # Total value locked (if available)
    volume_usd_24h: Optional[float] = None  # 24h volume (if available)
    
    # ===== COSTS & LATENCY =====
    swap_fee_bps: float                     # Venue swap fee
    gas_cost_usd: float                     # Estimated gas cost in USD
    latency_ms_est: int                     # Estimated execution latency
    
    # ===== QUALITY & COMPETITION =====
    auth_score: Optional[float] = None             # Volume authenticity score (0-10)
    recent_tx_count_60s: Optional[int] = None      # Recent transaction count
    competition_density: Optional[float] = None    # Competition estimate (0-1)
    
    def __post_init__(self):
        """Validate invariants on construction"""
        from market_validate import validate_snapshot
        validate_snapshot(self)
    
    def to_dict(self, stable_keys: bool = True) -> Dict:
        """
        Convert to dictionary with deterministic serialization
        
        Args:
            stable_keys: If True, sort keys for deterministic output
        
        Returns:
            Dictionary representation
        """
        data = asdict(self)
        
        # Convert enums to strings
        data['market_type'] = self.market_type.value
        
        # Convert TokenRef to dict
        data['base_token'] = {
            'address': self.base_token.address,
            'symbol': self.base_token.symbol,
            'decimals': self.base_token.decimals
        }
        data['quote_token'] = {
            'address': self.quote_token.address,
            'symbol': self.quote_token.symbol,
            'decimals': self.quote_token.decimals
        }
        
        if stable_keys:
            # Sort keys for deterministic output
            return dict(sorted(data.items()))
        
        return data
    
    def to_json(self, **kwargs) -> str:
        """
        Serialize to JSON with stable output
        
        Default kwargs ensure deterministic serialization:
        - sort_keys=True
        - separators=(',', ':') (compact)
        """
        return json.dumps(
            self.to_dict(stable_keys=True),
            sort_keys=True,
            separators=(',', ':'),
            **kwargs
        )
    
    def get_tiered_prices(self) -> Dict[int, Dict[str, float]]:
        """
        Get tiered prices in structured format
        
        Returns:
            {
                1000: {'buy': 1945.2, 'sell': 1944.8},
                5000: {'buy': 1946.1, 'sell': 1943.9},
                10000: {'buy': 1947.3, 'sell': 1942.7}
            }
        """
        return {
            1000: {'buy': self.buy_px_1k, 'sell': self.sell_px_1k},
            5000: {'buy': self.buy_px_5k, 'sell': self.sell_px_5k},
            10000: {'buy': self.buy_px_10k, 'sell': self.sell_px_10k}
        }
    
    def compute_edge_bps(self, tier: int = 1000) -> float:
        """
        Compute raw edge (before costs) at given tier
        
        Edge = (sell - buy) / mid * 10000
        
        Positive edge means you can buy and immediately sell for profit
        (before accounting for fees, gas, slippage)
        """
        prices = self.get_tiered_prices()
        
        if tier not in prices:
            raise ValueError(f"Tier {tier} not available")
        
        buy = prices[tier]['buy']
        sell = prices[tier]['sell']
        
        if self.mid_px == 0:
            return 0.0
        
        # Edge = how much you gain by buying at buy price and selling at sell price
        # Normalized to mid price
        edge = ((sell - buy) / self.mid_px) * 10000
        
        return edge
    
    def __str__(self) -> str:
        """Human-readable representation"""
        return (
            f"MarketSnapshot("
            f"{self.venue_id} {self.base_token.symbol}/{self.quote_token.symbol}, "
            f"mid=${self.mid_px:.2f}, "
            f"spread={self.spread_bps_1k:.1f}bps)"
        )


def create_snapshot_from_dict(data: Dict) -> MarketSnapshotV1:
    """
    Create MarketSnapshotV1 from dictionary
    
    Handles deserialization of nested objects
    """
    # Convert string market_type back to enum
    if isinstance(data.get('market_type'), str):
        data['market_type'] = MarketType(data['market_type'])
    
    # Convert token dicts back to TokenRef
    if isinstance(data.get('base_token'), dict):
        data['base_token'] = TokenRef(**data['base_token'])
    
    if isinstance(data.get('quote_token'), dict):
        data['quote_token'] = TokenRef(**data['quote_token'])
    
    return MarketSnapshotV1(**data)


def create_snapshot_from_json(json_str: str) -> MarketSnapshotV1:
    """Create MarketSnapshotV1 from JSON string"""
    data = json.loads(json_str)
    return create_snapshot_from_dict(data)
