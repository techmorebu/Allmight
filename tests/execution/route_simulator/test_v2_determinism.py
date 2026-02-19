#!/usr/bin/env python3
"""
V2 Simulator Determinism Test - Phase 2.4.2

Verifies V2 simulator is deterministic and produces correct outputs.

Author: Allmight System
Phase: 2.4.2A - Route Simulator
"""

import sys
import os

# Add scripts directory to path
scripts_path = os.path.join(os.path.dirname(__file__), '../..', '..', 'scripts')
sys.path.insert(0, scripts_path)

from execution.route_simulator import (
    V2PoolState,
    SimContext,
    simulate_v2_swap,
    compute_amount_out,
    compute_price_impact,
)


def test_determinism():
    """Test that same inputs produce same outputs"""
    print("Testing V2 simulator determinism...")
    
    # Create pool state (ETH/USDC with realistic reserves)
    pool = V2PoolState(
        reserve0=100_000_000_000_000_000_000,  # 100 ETH
        reserve1=250_000_000_000,              # 250,000 USDC (6 decimals)
        token0="0xETH",
        token1="0xUSDC",
        fee_bps=30,  # 0.3% fee
        block_ref=21876543
    )
    
    amount_in = 1_000_000_000_000_000_000  # 1 ETH
    
    context = SimContext(
        block_ref=21876543,
        chain_id="eth",
        slippage_tolerance_bps=100.0  # 1%
    )
    
    # Run simulation 10 times
    results = []
    for _ in range(10):
        result = simulate_v2_swap(pool, amount_in, "0xETH", context)
        results.append(result)
    
    # Verify all identical
    first = results[0]
    for i, result in enumerate(results[1:], start=1):
        assert result.ok == first.ok, f"Run {i}: ok mismatch"
        assert result.amount_out == first.amount_out, f"Run {i}: amount_out mismatch"
        assert abs(result.price_impact_bps - first.price_impact_bps) < 0.001, \
            f"Run {i}: price_impact mismatch"
    
    print(f"  ✅ Determinism verified (10 runs)")
    print(f"     Input: 1 ETH")
    print(f"     Output: {first.amount_out / 1e6:.2f} USDC")
    print(f"     Price impact: {first.price_impact_bps:.2f} bps")


def test_constant_product_math():
    """Test constant product formula with known values"""
    print("\nTesting constant product formula...")
    
    # Simple case: equal reserves, no fee
    amount_out = compute_amount_out(
        amount_in=1000,
        reserve_in=10000,
        reserve_out=10000,
        fee_bps=0
    )
    
    # With equal reserves and no fee:
    # amount_out = (1000 * 10000) / (10000 + 1000) = 10000000 / 11000 = 909
    expected = 909
    assert amount_out == expected, f"Expected {expected}, got {amount_out}"
    
    print(f"  ✅ Constant product correct")
    print(f"     Input: 1000, reserves: 10000/10000")
    print(f"     Output: {amount_out} (expected {expected})")


def test_price_impact():
    """Test price impact calculation"""
    print("\nTesting price impact calculation...")
    
    # Test case: small trade, low impact
    impact = compute_price_impact(
        amount_in=1000,
        amount_out=909,
        reserve_in=10000,
        reserve_out=10000
    )
    
    # Spot price = 10000/10000 = 1.0
    # Effective price = 909/1000 = 0.909
    # Impact = (1 - 0.909/1.0) * 10000 = 910 bps
    expected = 910.0
    assert abs(impact - expected) < 1.0, f"Expected {expected}, got {impact}"
    
    print(f"  ✅ Price impact correct")
    print(f"     Impact: {impact:.2f} bps (expected ~{expected:.2f})")


def test_large_trade():
    """Test behavior with large trade (high impact)"""
    print("\nTesting large trade (high impact)...")
    
    pool = V2PoolState(
        reserve0=100_000_000_000_000_000_000,  # 100 ETH
        reserve1=250_000_000_000,              # 250,000 USDC
        token0="0xETH",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    # Large trade: 10 ETH (10% of reserves)
    amount_in = 10_000_000_000_000_000_000  # 10 ETH
    
    context = SimContext(
        block_ref=21876543,
        chain_id="eth",
        slippage_tolerance_bps=100.0
    )
    
    result = simulate_v2_swap(pool, amount_in, "0xETH", context)
    
    assert result.ok, "Large trade should succeed"
    assert result.price_impact_bps > 100, "Should have significant impact"
    assert result.slippage_exceeded, "Should exceed 1% slippage tolerance"
    
    print(f"  ✅ Large trade handled correctly")
    print(f"     Input: 10 ETH")
    print(f"     Output: {result.amount_out / 1e6:.2f} USDC")
    print(f"     Price impact: {result.price_impact_bps:.2f} bps")
    print(f"     Slippage exceeded: {result.slippage_exceeded}")


def test_insufficient_liquidity():
    """Test that invalid pool state (zero reserves) fails"""
    print("\nTesting invalid pool state...")
    
    # Pool with zero reserves (invalid)
    pool = V2PoolState(
        reserve0=0,  # Invalid!
        reserve1=2_500_000_000,
        token0="0xETH",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    amount_in = 1_000_000_000_000_000_000  # 1 ETH
    
    context = SimContext(
        block_ref=21876543,
        chain_id="eth",
    )
    
    result = simulate_v2_swap(pool, amount_in, "0xETH", context)
    
    assert not result.ok, "Should fail with invalid reserves"
    assert result.failure_code == "SIM_NEGATIVE_RESERVES"
    
    print(f"  ✅ Invalid pool state detected")
    print(f"     Failure: {result.failure_code}")


if __name__ == '__main__':
    print("=" * 80)
    print("V2 SIMULATOR DETERMINISM TESTS")
    print("=" * 80)
    print()
    
    test_determinism()
    test_constant_product_math()
    test_price_impact()
    test_large_trade()
    test_insufficient_liquidity()
    
    print()
    print("=" * 80)
    print("✅ ALL V2 SIMULATOR TESTS PASSED")
    print("=" * 80)
