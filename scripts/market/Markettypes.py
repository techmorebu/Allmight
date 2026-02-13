#!/usr/bin/env python3
"""
Market Types - Core type definitions for MarketSnapshot system

Defines:
- MarketType enum
- ChainId enum
- TokenRef dataclass
- MarketRef dataclass

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class MarketType(Enum):
    """Type of market/venue"""
    AMM = "AMM"                    # Constant product AMM (Uniswap V2, Sushiswap)
    CLMM = "CLMM"                  # Concentrated liquidity (Uniswap V3, Orca)
    ORDERBOOK = "ORDERBOOK"        # Order book DEX (Phoenix, dYdX)
    VAULT = "VAULT"                # Vault-based (Balancer, Meteora)


class ChainId(Enum):
    """Supported chains"""
    ETH = "eth"
    BASE = "base"
    ARB = "arb"
    AVAX = "avax"
    SOL = "sol"
    OPTIMISM = "optimism"
    POLYGON = "polygon"


@dataclass(frozen=True)
class TokenRef:
    """
    Immutable token reference
    
    Invariants:
    - address must be non-empty
    - decimals must be 0-18 for EVM, 0-9 for Solana
    - symbol must be non-empty
    """
    address: str      # Token address/mint
    symbol: str       # Token symbol (e.g., "ETH", "USDC")
    decimals: int     # Token decimals
    
    def __post_init__(self):
        """Validate invariants"""
        if not self.address:
            raise ValueError("Token address cannot be empty")
        if not self.symbol:
            raise ValueError("Token symbol cannot be empty")
        if not (0 <= self.decimals <= 18):
            raise ValueError(f"Token decimals must be 0-18, got {self.decimals}")
    
    def __str__(self) -> str:
        return f"{self.symbol} ({self.address[:8]}...)"


@dataclass(frozen=True)
class MarketRef:
    """
    Reference to a specific market
    
    Used for fetching snapshots
    """
    chain_id: str
    venue_id: str
    market_id: str
    base_token: TokenRef
    quote_token: TokenRef
    market_type: MarketType
    
    def __post_init__(self):
        """Validate invariants"""
        if not self.chain_id:
            raise ValueError("Chain ID cannot be empty")
        if not self.venue_id:
            raise ValueError("Venue ID cannot be empty")
        if not self.market_id:
            raise ValueError("Market ID cannot be empty")
    
    def __str__(self) -> str:
        return f"{self.venue_id}:{self.base_token.symbol}/{self.quote_token.symbol}"


# Standard notional tiers for quoting (USD)
STANDARD_NOTIONAL_TIERS = [1000, 5000, 10000]
