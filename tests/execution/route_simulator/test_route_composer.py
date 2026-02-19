#!/usr/bin/env python3
"""
Route Composer Test - Phase 2.4.2

Tests multi-hop route simulation.

Author: Allmight System
Phase: 2.4.2 - Route Simulator
"""

import sys
import os

# Add scripts directory to path
scripts_path = os.path.join(os.path.dirname(__file__), '../..', '..', 'scripts')
sys.path.insert(0, scripts_path)

from execution.route_simulator import (
    V2PoolState,
    SimContext,
    Route,
    RouteLeg,
)
from execution.route_simulator.route_composer import (
    simulate_route,
    create_single_hop_route,
    create_two_hop_route,
)


def test_single_hop():
    """Test single-hop route (same as direct swap)"""
    print("Testing single-hop route...")
    
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
    
    result = simulate_route(route, pool_states, context)
    
    assert result.ok, "Single hop should succeed"
    assert result.amount_in == 1_000_000_000_000_000_000
    assert result.amount_out > 0
    
    print(f"  ✅ Single-hop route working")
    print(f"     Input: 1 ETH")
    print(f"     Output: {result.amount_out / 1e6:.2f} USDC")
    print(f"     Price impact: {result.price_impact_bps:.2f} bps")


def test_two_hop():
    """Test two-hop route (ETH -> WBTC -> USDC)"""
    print("\nTesting two-hop route...")
    
    # Pool 1: ETH -> WBTC
    pool1 = V2PoolState(
        reserve0=100_000_000_000_000_000_000,  # 100 ETH
        reserve1=500_000_000,                   # 5 WBTC (8 decimals)
        token0="0xETH",
        token1="0xWBTC",
        fee_bps=30,
        block_ref=21876543
    )
    
    # Pool 2: WBTC -> USDC
    pool2 = V2PoolState(
        reserve0=500_000_000,                   # 5 WBTC
        reserve1=250_000_000_000,               # 250,000 USDC
        token0="0xWBTC",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    # Create two-hop route
    route = create_two_hop_route(
        chain_id="eth",
        venue_id_1="uniswap_v2",
        pool_id_1="0xpool_eth_wbtc",
        token_in="0xETH",
        token_mid="0xWBTC",
        amount_in=1_000_000_000_000_000_000,  # 1 ETH
        venue_id_2="sushiswap",
        pool_id_2="0xpool_wbtc_usdc",
        token_out="0xUSDC",
        route_id="eth_wbtc_usdc"
    )
    
    context = SimContext(
        block_ref=21876543,
        chain_id="eth",
    )
    
    pool_states = {
        "0xpool_eth_wbtc": pool1,
        "0xpool_wbtc_usdc": pool2
    }
    
    result = simulate_route(route, pool_states, context)
    
    assert result.ok, "Two-hop should succeed"
    assert result.amount_in == 1_000_000_000_000_000_000
    assert result.amount_out > 0
    assert result.price_impact_bps > 0  # Should have compounding impact
    
    print(f"  ✅ Two-hop route working")
    print(f"     Route: ETH -> WBTC -> USDC")
    print(f"     Input: 1 ETH")
    print(f"     Output: {result.amount_out / 1e6:.2f} USDC")
    print(f"     Total impact: {result.price_impact_bps:.2f} bps")


def test_two_hop_determinism():
    """Test that two-hop routes are deterministic"""
    print("\nTesting two-hop determinism...")
    
    # Create pools
    pool1 = V2PoolState(
        reserve0=100_000_000_000_000_000_000,
        reserve1=500_000_000,
        token0="0xETH",
        token1="0xWBTC",
        fee_bps=30,
        block_ref=21876543
    )
    
    pool2 = V2PoolState(
        reserve0=500_000_000,
        reserve1=250_000_000_000,
        token0="0xWBTC",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    route = create_two_hop_route(
        chain_id="eth",
        venue_id_1="uniswap_v2",
        pool_id_1="0xpool1",
        token_in="0xETH",
        token_mid="0xWBTC",
        amount_in=1_000_000_000_000_000_000,
        venue_id_2="sushiswap",
        pool_id_2="0xpool2",
        token_out="0xUSDC",
        route_id="test"
    )
    
    context = SimContext(block_ref=21876543, chain_id="eth")
    pool_states = {"0xpool1": pool1, "0xpool2": pool2}
    
    # Run 5 times
    results = []
    for _ in range(5):
        result = simulate_route(route, pool_states, context)
        results.append(result)
    
    # Verify all identical
    first = results[0]
    for i, result in enumerate(results[1:], start=1):
        assert result.amount_out == first.amount_out, \
            f"Run {i}: amount_out mismatch"
        assert abs(result.price_impact_bps - first.price_impact_bps) < 0.001, \
            f"Run {i}: price_impact mismatch"
    
    print(f"  ✅ Two-hop determinism verified (5 runs)")
    print(f"     Output: {first.amount_out / 1e6:.2f} USDC")


def test_missing_pool():
    """Test that missing pool state causes failure"""
    print("\nTesting missing pool detection...")
    
    route = create_single_hop_route(
        chain_id="eth",
        venue_id="uniswap_v2",
        pool_id="0xmissing",
        token_in="0xETH",
        token_out="0xUSDC",
        amount_in=1_000_000_000_000_000_000,
        route_id="test"
    )
    
    context = SimContext(block_ref=21876543, chain_id="eth")
    pool_states = {}  # Empty!
    
    result = simulate_route(route, pool_states, context)
    
    assert not result.ok, "Should fail with missing pool"
    assert result.failure_code == "SIM_INVALID_POOL_STATE"
    
    print(f"  ✅ Missing pool detected")
    print(f"     Failure: {result.failure_code}")


if __name__ == '__main__':
    print("=" * 80)
    print("ROUTE COMPOSER TESTS")
    print("=" * 80)
    print()
    
    test_single_hop()
    test_two_hop()
    test_two_hop_determinism()
    test_missing_pool()
    
    print()
    print("=" * 80)
    print("✅ ALL ROUTE COMPOSER TESTS PASSED")
    print("=" * 80)
