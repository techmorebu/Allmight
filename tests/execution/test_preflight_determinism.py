#!/usr/bin/env python3
"""
Preflight Determinism Test - Phase 2.4.1

Verifies that preflight is deterministic:
- Same inputs → same outputs (always)
- No hidden state
- Reproducible results

Author: Allmight System
Phase: 2.4.1 - Preflight Module
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..', 'scripts'))

from execution.preflight import preflight_check
from execution.preflight_policy import DEFAULT_POLICY
from execution.gas_model import DEFAULT_GAS_MODEL
from types import SimpleNamespace


def create_mock_snapshot(
    chain_id="eth",
    venue_id="uniswap_v3",
    market_id="0xpool",
    mid_px=2684.50,
    buy_px_1k=2685.20,
    sell_px_1k=2683.80,
    buy_px_5k=2686.40,
    sell_px_5k=2682.60,
    buy_px_10k=2687.80,
    sell_px_10k=2681.20,
    slippage_bps_1k=26.0,
    slippage_bps_5k=70.0,
    slippage_bps_10k=120.0,
    swap_fee_bps=30.0,
):
    """Create a mock snapshot for testing"""
    return SimpleNamespace(
        chain_id=chain_id,
        venue_id=venue_id,
        market_id=market_id,
        mid_px=mid_px,
        buy_px_1k=buy_px_1k,
        sell_px_1k=sell_px_1k,
        buy_px_5k=buy_px_5k,
        sell_px_5k=sell_px_5k,
        buy_px_10k=buy_px_10k,
        sell_px_10k=sell_px_10k,
        slippage_bps_1k=slippage_bps_1k,
        slippage_bps_5k=slippage_bps_5k,
        slippage_bps_10k=slippage_bps_10k,
        swap_fee_bps=swap_fee_bps,
        latency_ms_est=150,
        competition_density=0.3,
        base_token=SimpleNamespace(symbol="ETH"),
        quote_token=SimpleNamespace(symbol="USDC"),
    )


def test_determinism_accept():
    """Test that accepted opportunities are deterministic"""
    
    # Create snapshots with good edge
    snap_buy = create_mock_snapshot(
        venue_id="uniswap_v3",
        market_id="0xpool_buy",
        sell_px_1k=2700.00,  # Buy at 2683.80, sell at 2700.00 = good edge
    )
    
    snap_sell = create_mock_snapshot(
        venue_id="sushiswap",
        market_id="0xpool_sell",
        buy_px_1k=2700.00,
        sell_px_1k=2700.00,
    )
    
    # Run preflight 10 times
    results = []
    for _ in range(10):
        decision = preflight_check(
            snapshot_buy=snap_buy,
            snapshot_sell=snap_sell,
            tier_usd=1000,
            policy=DEFAULT_POLICY,
            gas_model=DEFAULT_GAS_MODEL,
        )
        results.append(decision)
    
    # Verify all results identical
    first = results[0]
    for i, result in enumerate(results[1:], start=1):
        assert result.result == first.result, \
            f"Result mismatch at run {i}: {result.result} != {first.result}"
        assert result.rejection_reason_code == first.rejection_reason_code, \
            f"Rejection code mismatch at run {i}"
        assert abs(result.net_edge_bps - first.net_edge_bps) < 0.001, \
            f"Net edge mismatch at run {i}: {result.net_edge_bps} != {first.net_edge_bps}"
        assert abs(result.safety_buffer_bps - first.safety_buffer_bps) < 0.001, \
            f"Safety buffer mismatch at run {i}"
        assert result.confidence_level == first.confidence_level, \
            f"Confidence mismatch at run {i}"
    
    print(f"✅ Determinism test (ACCEPT): {first.result}, net_edge={first.net_edge_bps:.2f}")


def test_determinism_reject():
    """Test that rejected opportunities are deterministic"""
    
    # Create snapshots with poor edge
    snap_buy = create_mock_snapshot(
        venue_id="uniswap_v3",
        market_id="0xpool_buy",
    )
    
    snap_sell = create_mock_snapshot(
        venue_id="sushiswap",
        market_id="0xpool_sell",
        sell_px_1k=2683.90,  # Very small edge
    )
    
    # Run preflight 10 times
    results = []
    for _ in range(10):
        decision = preflight_check(
            snapshot_buy=snap_buy,
            snapshot_sell=snap_sell,
            tier_usd=1000,
            policy=DEFAULT_POLICY,
            gas_model=DEFAULT_GAS_MODEL,
        )
        results.append(decision)
    
    # Verify all results identical
    first = results[0]
    for i, result in enumerate(results[1:], start=1):
        assert result.result == first.result, \
            f"Result mismatch at run {i}: {result.result} != {first.result}"
        assert result.rejection_reason_code == first.rejection_reason_code, \
            f"Rejection code mismatch at run {i}: {result.rejection_reason_code} != {first.rejection_reason_code}"
        assert abs(result.net_edge_bps - first.net_edge_bps) < 0.001, \
            f"Net edge mismatch at run {i}"
    
    print(f"✅ Determinism test (REJECT): {first.rejection_reason_code}, net_edge={first.net_edge_bps:.2f}")


def test_tier_determinism():
    """Test that same opportunity at different tiers is deterministic"""
    
    snap_buy = create_mock_snapshot()
    snap_sell = create_mock_snapshot(venue_id="sushiswap", sell_px_1k=2690.00)
    
    # Test each tier multiple times
    for tier in [1000, 5000, 10000]:
        results = []
        for _ in range(5):
            decision = preflight_check(
                snapshot_buy=snap_buy,
                snapshot_sell=snap_sell,
                tier_usd=tier,
                policy=DEFAULT_POLICY,
                gas_model=DEFAULT_GAS_MODEL,
            )
            results.append(decision)
        
        # Verify determinism within tier
        first = results[0]
        for result in results[1:]:
            assert result.result == first.result
            assert abs(result.net_edge_bps - first.net_edge_bps) < 0.001
        
        print(f"✅ Tier {tier} determinism: net_edge={first.net_edge_bps:.2f} bps")


if __name__ == '__main__':
    print("=" * 80)
    print("PREFLIGHT DETERMINISM TESTS")
    print("=" * 80)
    print()
    
    test_determinism_accept()
    test_determinism_reject()
    test_tier_determinism()
    
    print()
    print("=" * 80)
    print("✅ ALL DETERMINISM TESTS PASSED")
    print("=" * 80)
