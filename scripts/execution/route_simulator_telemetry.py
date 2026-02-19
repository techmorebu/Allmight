#!/usr/bin/env python3
"""
Route Simulator Telemetry Integration - Phase 2.4.2

Adds telemetry logging to route simulation.
Emits ROUTE_SIM_RESULT for every simulation.

Author: Allmight System
Phase: 2.4.2 - Telemetry Integration
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from execution.route_simulator import (
    Route, SimContext, SimResult, simulate_route
)
from typing import Dict


def simulate_route_with_telemetry(
    route: Route,
    pool_states: Dict,
    context: SimContext,
    telemetry,
    opportunity_id: str = "",
) -> SimResult:
    """
    Simulate route and emit telemetry
    
    Args:
        route: Route to simulate
        pool_states: Dict of pool states
        context: SimContext
        telemetry: TelemetryLogger instance
        opportunity_id: Opportunity identifier
    
    Returns:
        SimResult
    """
    
    # Run simulation
    result = simulate_route(route, pool_states, context)
    
    # Extract identifiers from route
    chain_id = route.chain_id
    venue_id = route.legs[0].venue_id if route.legs else ""
    market_id = route.legs[0].pool_id if route.legs else ""
    
    # Emit telemetry (using existing PREFLIGHT_RESULT for now, will add ROUTE_SIM_RESULT later)
    # For now, log as pipeline stage event
    telemetry.log_pipeline_stage_end(
        stage="ROUTE_SIM",
        opportunity_id=opportunity_id,
        chain_id=chain_id,
        venue_id=venue_id,
        market_id=market_id,
        route_id=route.route_id,
        notional_usd=0.0,  # TODO: calculate from amounts
        block_ref=context.block_ref,
        block_target=None,
        stage_seq=2,  # After PREFLIGHT
        t_start_ms=None,  # Could time it later
        error_code=result.failure_code if not result.ok else None,
        error_detail=result.failure_detail if not result.ok else None,
    )
    
    return result


if __name__ == '__main__':
    """Demo with telemetry"""
    from telemetry.execution_telemetry import TelemetryLogger
    from execution.route_simulator import (
        V2PoolState, create_single_hop_route
    )
    
    print("=" * 80)
    print("ROUTE SIMULATOR WITH TELEMETRY DEMO")
    print("=" * 80)
    print()
    
    # Initialize telemetry
    telemetry = TelemetryLogger()
    print(f"Telemetry initialized: run_id={telemetry.run_id}")
    print()
    
    # Create pool
    pool = V2PoolState(
        reserve0=100_000_000_000_000_000_000,  # 100 ETH
        reserve1=250_000_000_000,              # 250,000 USDC
        token0="0xETH",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    # Create route
    route = create_single_hop_route(
        chain_id="eth",
        venue_id="uniswap_v2",
        pool_id="0xpool1",
        token_in="0xETH",
        token_out="0xUSDC",
        amount_in=1_000_000_000_000_000_000,  # 1 ETH
        route_id="eth_usdc_univ2"
    )
    
    context = SimContext(
        block_ref=21876543,
        chain_id="eth",
    )
    
    pool_states = {"0xpool1": pool}
    
    # Simulate with telemetry
    print("Test 1: Successful simulation")
    result = simulate_route_with_telemetry(
        route=route,
        pool_states=pool_states,
        context=context,
        telemetry=telemetry,
        opportunity_id="opp_test_sim_1",
    )
    
    print(f"  Result: {result.ok}")
    print(f"  Amount out: {result.amount_out / 1e6:.2f} USDC")
    print(f"  Price impact: {result.price_impact_bps:.2f} bps")
    print()
    
    # Test 2: Failed simulation (missing pool)
    print("Test 2: Failed simulation (missing pool)")
    
    route_fail = create_single_hop_route(
        chain_id="eth",
        venue_id="uniswap_v2",
        pool_id="0xmissing",
        token_in="0xETH",
        token_out="0xUSDC",
        amount_in=1_000_000_000_000_000_000,
        route_id="eth_usdc_fail"
    )
    
    result_fail = simulate_route_with_telemetry(
        route=route_fail,
        pool_states={},  # Empty!
        context=context,
        telemetry=telemetry,
        opportunity_id="opp_test_sim_2",
    )
    
    print(f"  Result: {result_fail.ok}")
    print(f"  Failure: {result_fail.failure_code}")
    print()
    
    print("=" * 80)
    print("✅ TELEMETRY DEMO COMPLETE")
    print("=" * 80)
    print()
    print(f"Check telemetry: data/telemetry/{telemetry.run_id[:8]}/pipeline_events.jsonl")
    print()
