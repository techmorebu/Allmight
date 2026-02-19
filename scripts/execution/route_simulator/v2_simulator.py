#!/usr/bin/env python3
"""
V2 Simulator - Phase 2.4.2A

Uniswap V2 / Sushiswap constant product formula simulator.

Formula: x * y = k (constant)
amount_out = (amount_in * (1 - fee) * reserve_out) / (reserve_in + amount_in * (1 - fee))

Pure, deterministic, no I/O.

Author: Allmight System
Phase: 2.4.2A - Route Simulator (V2)
"""

from typing import Tuple
import logging

from .types import (
    RouteLeg, SimResult, V2PoolState, SimContext, SimFailureCode
)

logger = logging.getLogger('Allmight.V2Simulator')


def simulate_v2_swap(
    pool_state: V2PoolState,
    amount_in: int,
    token_in: str,
    context: SimContext
) -> SimResult:
    """
    Simulate a V2 swap (constant product)
    
    Args:
        pool_state: V2PoolState at block_ref
        amount_in: Input amount (wei)
        token_in: Input token address
        context: SimContext (for slippage tolerance)
    
    Returns:
        SimResult with outcome
    
    Deterministic: same inputs → same output
    """
    
    # Validate inputs
    if amount_in <= 0:
        return SimResult(
            ok=False,
            failure_code=SimFailureCode.ZERO_AMOUNT,
            failure_detail=f"amount_in must be positive: {amount_in}"
        )
    
    if pool_state.reserve0 <= 0 or pool_state.reserve1 <= 0:
        return SimResult(
            ok=False,
            failure_code=SimFailureCode.NEGATIVE_RESERVES,
            failure_detail=f"Invalid reserves: {pool_state.reserve0}, {pool_state.reserve1}"
        )
    
    # Determine which direction (0->1 or 1->0)
    if token_in == pool_state.token0:
        reserve_in = pool_state.reserve0
        reserve_out = pool_state.reserve1
        zero_for_one = True
    elif token_in == pool_state.token1:
        reserve_in = pool_state.reserve1
        reserve_out = pool_state.reserve0
        zero_for_one = False
    else:
        return SimResult(
            ok=False,
            failure_code=SimFailureCode.INVALID_POOL_STATE,
            failure_detail=f"token_in {token_in} not in pool"
        )
    
    # Compute output amount (constant product formula)
    amount_out = compute_amount_out(
        amount_in=amount_in,
        reserve_in=reserve_in,
        reserve_out=reserve_out,
        fee_bps=pool_state.fee_bps
    )
    
    if amount_out <= 0:
        return SimResult(
            ok=False,
            failure_code=SimFailureCode.INSUFFICIENT_LIQUIDITY,
            failure_detail=f"Output amount <= 0: {amount_out}"
        )
    
    if amount_out >= reserve_out:
        return SimResult(
            ok=False,
            failure_code=SimFailureCode.RESERVES_DEPLETED,
            failure_detail=f"Output {amount_out} >= reserve {reserve_out}"
        )
    
    # Compute price impact
    price_impact_bps = compute_price_impact(
        amount_in=amount_in,
        amount_out=amount_out,
        reserve_in=reserve_in,
        reserve_out=reserve_out
    )
    
    # Check slippage tolerance
    slippage_exceeded = price_impact_bps > context.slippage_tolerance_bps
    
    # Compute effective price
    effective_price = amount_out / amount_in if amount_in > 0 else 0.0
    
    return SimResult(
        ok=True,
        amount_in=amount_in,
        amount_out=amount_out,
        effective_price=effective_price,
        price_impact_bps=price_impact_bps,
        revert_risk=False,
        slippage_exceeded=slippage_exceeded,
    )


def compute_amount_out(
    amount_in: int,
    reserve_in: int,
    reserve_out: int,
    fee_bps: int
) -> int:
    """
    Uniswap V2 constant product formula
    
    Formula:
        amount_in_with_fee = amount_in * (10000 - fee_bps)
        amount_out = (amount_in_with_fee * reserve_out) / 
                     (reserve_in * 10000 + amount_in_with_fee)
    
    Args:
        amount_in: Input amount (wei)
        reserve_in: Input reserve (wei)
        reserve_out: Output reserve (wei)
        fee_bps: Fee in basis points (30 for 0.3%)
    
    Returns:
        Output amount (wei)
    
    Deterministic, pure function.
    """
    # Apply fee (e.g., 30 bps = 0.3% fee = 99.7% goes to swap)
    amount_in_with_fee = amount_in * (10000 - fee_bps)
    
    # Constant product formula
    numerator = amount_in_with_fee * reserve_out
    denominator = (reserve_in * 10000) + amount_in_with_fee
    
    if denominator == 0:
        return 0
    
    amount_out = numerator // denominator
    
    return amount_out


def compute_price_impact(
    amount_in: int,
    amount_out: int,
    reserve_in: int,
    reserve_out: int
) -> float:
    """
    Compute price impact in basis points
    
    Price impact = how much worse the execution price is vs spot price
    
    spot_price = reserve_out / reserve_in
    effective_price = amount_out / amount_in
    impact = (1 - effective_price / spot_price) * 10000
    
    Args:
        amount_in: Input amount
        amount_out: Output amount
        reserve_in: Input reserve
        reserve_out: Output reserve
    
    Returns:
        Price impact in basis points
    """
    if amount_in == 0 or reserve_in == 0:
        return 0.0
    
    # Spot price (before trade)
    spot_price = reserve_out / reserve_in
    
    # Effective price (actual execution)
    effective_price = amount_out / amount_in
    
    # Impact (positive = worse execution than spot)
    impact_ratio = 1.0 - (effective_price / spot_price)
    impact_bps = impact_ratio * 10000.0
    
    return impact_bps


def estimate_v2_gas() -> int:
    """
    Conservative gas estimate for V2 swap
    
    Returns:
        Gas units (conservative)
    """
    return 120_000  # Typical V2 swap
