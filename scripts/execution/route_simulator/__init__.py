#!/usr/bin/env python3
"""
Route Simulator Package - Phase 2.4.2

Deterministic route simulation engine for arbitrage execution modeling.

Modules:
- types: Core data types
- v2_simulator: Uniswap V2 / Sushiswap constant product
- v3_simulator: Uniswap V3 tick-based (coming soon)

Author: Allmight System
Phase: 2.4.2 - Route Simulator
"""

from .types import (
    RouteLeg,
    Route,
    SimContext,
    SimResult,
    V2PoolState,
    V3PoolState,
    SimFailureCode,
)

from .v2_simulator import (
    simulate_v2_swap,
    compute_amount_out,
    compute_price_impact,
    estimate_v2_gas,
)

__all__ = [
    # Types
    'RouteLeg',
    'Route',
    'SimContext',
    'SimResult',
    'V2PoolState',
    'V3PoolState',
    'SimFailureCode',
    
    # V2 Simulator
    'simulate_v2_swap',
    'compute_amount_out',
    'compute_price_impact',
    'estimate_v2_gas',
]
