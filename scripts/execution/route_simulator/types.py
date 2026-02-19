#!/usr/bin/env python3
"""
Route Simulator Types - Phase 2.4.2

Core data types for route simulation:
- RouteLeg (single swap)
- Route (multi-hop)
- SimContext (deterministic inputs)
- SimResult (outputs)
- PoolState types (V2 and V3)

Author: Allmight System
Phase: 2.4.2 - Route Simulator
"""

from dataclasses import dataclass
from typing import List, Optional, Dict, Literal


# ===== ROUTE TYPES =====

@dataclass
class RouteLeg:
    """
    Single swap step in a route
    
    Represents one swap on one DEX pool.
    """
    venue_id: str          # "uniswap_v3", "sushiswap", etc.
    pool_id: str           # Pool/pair address
    token_in: str          # Input token address
    token_out: str         # Output token address
    amount_in: int         # Amount in (wei)
    fee_tier: Optional[int] = None  # Fee tier for V3 (500/3000/10000)
    dex_type: Literal["v2", "v3"] = "v2"


@dataclass
class Route:
    """
    Multi-leg route (can be single or multi-hop)
    
    Example single-hop: ETH -> USDC on Uniswap V3
    Example multi-hop: ETH -> WBTC -> USDC (two legs)
    """
    legs: List[RouteLeg]
    chain_id: str
    route_id: str  # Stable identifier for telemetry


# ===== SIMULATION CONTEXT =====

@dataclass
class SimContext:
    """
    Simulation context - all deterministic inputs
    
    Everything needed to reproduce a simulation.
    """
    block_ref: int           # Block number for state
    chain_id: str            # Chain identifier
    slippage_tolerance_bps: float = 50.0  # Max acceptable slippage (0.5%)


# ===== SIMULATION RESULT =====

@dataclass
class SimResult:
    """
    Simulation outcome
    
    Contains all outputs from simulating a route.
    """
    ok: bool                    # True if simulation succeeded
    
    # Amounts
    amount_in: int = 0          # Total input (wei)
    amount_out: int = 0         # Total output (wei)
    
    # Profitability
    gross_profit_wei: int = 0   # Output - input (if arbitrage)
    net_profit_wei: int = 0     # After gas costs
    gas_used_est_wei: int = 0   # Estimated gas cost
    
    # Pricing
    effective_price: float = 0.0     # Actual execution price
    price_impact_bps: float = 0.0    # Price impact in bps
    
    # Risk flags
    revert_risk: bool = False        # Could revert
    slippage_exceeded: bool = False  # Slippage above tolerance
    
    # Failure info (if ok=False)
    failure_code: Optional[str] = None
    failure_detail: Optional[str] = None


# ===== POOL STATE TYPES =====

@dataclass
class V2PoolState:
    """
    Uniswap V2 style pool state
    
    Constant product: x * y = k
    """
    reserve0: int       # Reserve of token0 (wei)
    reserve1: int       # Reserve of token1 (wei)
    token0: str         # Token0 address (sorted)
    token1: str         # Token1 address (sorted)
    fee_bps: int        # Swap fee in basis points (30 = 0.3%)
    block_ref: int      # Block number of this state


@dataclass
class V3PoolState:
    """
    Uniswap V3 style pool state
    
    Concentrated liquidity with tick-based pricing.
    """
    sqrt_price_x96: int     # Current price (Q64.96 format)
    tick: int               # Current tick
    liquidity: int          # Active liquidity
    fee_tier: int           # Fee tier (500/3000/10000 bps)
    token0: str             # Token0 address
    token1: str             # Token1 address
    block_ref: int          # Block number of this state
    
    # Optional: tick data for exact simulation
    # For simplified simulation, we assume infinite liquidity in current tick
    tick_data: Optional[Dict[int, int]] = None  # {tick: liquidityNet}


# ===== FAILURE CODES =====

class SimFailureCode:
    """Canonical simulation failure codes (deterministic)"""
    
    INSUFFICIENT_LIQUIDITY = "SIM_INSUFFICIENT_LIQUIDITY"
    PRICE_IMPACT_TOO_HIGH = "SIM_PRICE_IMPACT_TOO_HIGH"
    SLIPPAGE_EXCEEDED = "SIM_SLIPPAGE_EXCEEDED"
    INVALID_POOL_STATE = "SIM_INVALID_POOL_STATE"
    RESERVES_DEPLETED = "SIM_RESERVES_DEPLETED"
    UNKNOWN_DEX_TYPE = "SIM_UNKNOWN_DEX_TYPE"
    ZERO_AMOUNT = "SIM_ZERO_AMOUNT"
    NEGATIVE_RESERVES = "SIM_NEGATIVE_RESERVES"
