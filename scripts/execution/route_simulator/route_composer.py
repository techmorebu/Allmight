#!/usr/bin/env python3
"""
Route Composer - Phase 2.4.2

Composes multi-hop routes by chaining V2 swaps.
Example: ETH -> WBTC -> USDC (two legs)

Author: Allmight System
Phase: 2.4.2 - Route Simulator
"""

from typing import List, Dict
import logging

from .types import (
    Route, RouteLeg, SimContext, SimResult, 
    V2PoolState, SimFailureCode
)
from .v2_simulator import simulate_v2_swap

logger = logging.getLogger('Allmight.RouteComposer')


def simulate_route(
    route: Route,
    pool_states: Dict[str, V2PoolState],
    context: SimContext
) -> SimResult:
    """
    Simulate a multi-hop route
    
    Chains together multiple swaps, passing output of one as input to next.
    
    Args:
        route: Route with one or more legs
        pool_states: Dict of {pool_id: V2PoolState}
        context: SimContext
    
    Returns:
        SimResult with final outcome
    
    Deterministic: same route + same pools → same output
    """
    
    if not route.legs:
        return SimResult(
            ok=False,
            failure_code=SimFailureCode.INVALID_POOL_STATE,
            failure_detail="Route has no legs"
        )
    
    # Track amounts through the route
    current_amount = route.legs[0].amount_in
    total_price_impact = 0.0
    
    # Execute each leg in sequence
    for i, leg in enumerate(route.legs):
        # Get pool state
        pool = pool_states.get(leg.pool_id)
        if pool is None:
            return SimResult(
                ok=False,
                failure_code=SimFailureCode.INVALID_POOL_STATE,
                failure_detail=f"Missing pool state for {leg.pool_id}"
            )
        
        # Simulate this leg
        leg_result = simulate_v2_swap(
            pool_state=pool,
            amount_in=current_amount,
            token_in=leg.token_in,
            context=context
        )
        
        # Check if leg failed
        if not leg_result.ok:
            return SimResult(
                ok=False,
                failure_code=leg_result.failure_code,
                failure_detail=f"Leg {i} failed: {leg_result.failure_detail}"
            )
        
        # Accumulate price impact
        total_price_impact += leg_result.price_impact_bps
        
        # Output becomes next input
        current_amount = leg_result.amount_out
        
        logger.debug(
            f"Leg {i}: {leg.token_in} -> {leg.token_out}, "
            f"in={leg_result.amount_in}, out={leg_result.amount_out}, "
            f"impact={leg_result.price_impact_bps:.2f} bps"
        )
    
    # Final result
    final_amount_in = route.legs[0].amount_in
    final_amount_out = current_amount
    
    # Check if any leg exceeded slippage
    slippage_exceeded = total_price_impact > context.slippage_tolerance_bps
    
    # Compute effective price (output/input)
    effective_price = final_amount_out / final_amount_in if final_amount_in > 0 else 0.0
    
    return SimResult(
        ok=True,
        amount_in=final_amount_in,
        amount_out=final_amount_out,
        effective_price=effective_price,
        price_impact_bps=total_price_impact,
        slippage_exceeded=slippage_exceeded,
        revert_risk=False,
    )


def create_single_hop_route(
    chain_id: str,
    venue_id: str,
    pool_id: str,
    token_in: str,
    token_out: str,
    amount_in: int,
    route_id: str
) -> Route:
    """
    Create a simple single-hop route
    
    Args:
        chain_id: Chain identifier
        venue_id: DEX identifier
        pool_id: Pool address
        token_in: Input token
        token_out: Output token
        amount_in: Amount to swap (wei)
        route_id: Route identifier
    
    Returns:
        Route with single leg
    """
    leg = RouteLeg(
        venue_id=venue_id,
        pool_id=pool_id,
        token_in=token_in,
        token_out=token_out,
        amount_in=amount_in,
        dex_type="v2"
    )
    
    return Route(
        legs=[leg],
        chain_id=chain_id,
        route_id=route_id
    )


def create_two_hop_route(
    chain_id: str,
    # First hop
    venue_id_1: str,
    pool_id_1: str,
    token_in: str,
    token_mid: str,
    amount_in: int,
    # Second hop
    venue_id_2: str,
    pool_id_2: str,
    token_out: str,
    route_id: str
) -> Route:
    """
    Create a two-hop route (A -> B -> C)
    
    Args:
        chain_id: Chain identifier
        venue_id_1: First DEX
        pool_id_1: First pool
        token_in: Input token (A)
        token_mid: Middle token (B)
        amount_in: Initial amount
        venue_id_2: Second DEX
        pool_id_2: Second pool
        token_out: Output token (C)
        route_id: Route identifier
    
    Returns:
        Route with two legs
        
    Note: Amount for second leg will be determined during simulation
    """
    leg1 = RouteLeg(
        venue_id=venue_id_1,
        pool_id=pool_id_1,
        token_in=token_in,
        token_out=token_mid,
        amount_in=amount_in,
        dex_type="v2"
    )
    
    leg2 = RouteLeg(
        venue_id=venue_id_2,
        pool_id=pool_id_2,
        token_in=token_mid,
        token_out=token_out,
        amount_in=0,  # Will be set during simulation
        dex_type="v2"
    )
    
    return Route(
        legs=[leg1, leg2],
        chain_id=chain_id,
        route_id=route_id
    )
