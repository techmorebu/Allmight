#!/usr/bin/env python3
"""
Preflight Demo - Phase 2.4.1

Demonstrates preflight module with various scenarios:
- Profitable opportunities (accept)
- Various rejection scenarios
- Different tiers
- Policy variations

Author: Allmight System
Phase: 2.4.1 - Preflight Module
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from execution.preflight import preflight_check
from execution.preflight_policy import DEFAULT_POLICY, CONSERVATIVE_POLICY, AGGRESSIVE_POLICY
from execution.gas_model import DEFAULT_GAS_MODEL
from types import SimpleNamespace


def create_snapshot(**kwargs):
    """Create mock snapshot with defaults"""
    defaults = {
        'chain_id': 'eth',
        'venue_id': 'uniswap_v3',
        'market_id': '0xpool',
        'mid_px': 2684.50,
        'buy_px_1k': 2685.20,
        'sell_px_1k': 2683.80,
        'buy_px_5k': 2686.40,
        'sell_px_5k': 2682.60,
        'buy_px_10k': 2687.80,
        'sell_px_10k': 2681.20,
        'slippage_bps_1k': 26.0,
        'slippage_bps_5k': 70.0,
        'slippage_bps_10k': 120.0,
        'swap_fee_bps': 30.0,
        'latency_ms_est': 150,
        'competition_density': 0.3,
        'base_token': SimpleNamespace(symbol='ETH'),
        'quote_token': SimpleNamespace(symbol='USDC'),
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def print_decision(decision, scenario):
    """Pretty print a preflight decision"""
    print(f"\n{'='*80}")
    print(f"SCENARIO: {scenario}")
    print(f"{'='*80}")
    print(f"Result:           {decision.result}")
    print(f"Rejection Code:   {decision.rejection_reason_code or 'N/A'}")
    print(f"Net Edge:         {decision.net_edge_bps:>8.2f} bps")
    print(f"Safety Buffer:    {decision.safety_buffer_bps:>8.2f} bps")
    print(f"Margin:           {decision.net_edge_bps - decision.safety_buffer_bps:>8.2f} bps")
    print(f"Confidence:       {decision.confidence_level}")


def demo_profitable_opportunity():
    """Demo: Profitable opportunity that passes preflight"""
    snap_buy = create_snapshot(
        venue_id='uniswap_v3',
        market_id='0xpool_uniswap',
        buy_px_1k=2600.0,  # Buy low
    )
    
    snap_sell = create_snapshot(
        venue_id='sushiswap',
        market_id='0xpool_sushi',
        sell_px_1k=2750.0,  # Sell high - big spread
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
    print_decision(decision, "PROFITABLE - Large spread (buy 2600, sell 2750)")


def demo_small_edge():
    """Demo: Small edge - rejected (below buffer)"""
    snap_buy = create_snapshot(
        venue_id='uniswap_v3',
        buy_px_1k=2685.20,
    )
    
    snap_sell = create_snapshot(
        venue_id='sushiswap',
        sell_px_1k=2685.50,  # Tiny spread
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
    print_decision(decision, "REJECTED - Edge too small (below safety buffer)")


def demo_high_slippage():
    """Demo: High slippage rejection"""
    snap_buy = create_snapshot(
        slippage_bps_1k=800.0,  # 8% slippage - very high
        buy_px_1k=2600.0,
    )
    
    snap_sell = create_snapshot(
        sell_px_1k=2750.0,
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
    print_decision(decision, "REJECTED - Slippage too high (800 bps)")


def demo_high_competition():
    """Demo: High competition rejection"""
    snap_buy = create_snapshot(
        competition_density=0.9,  # 90% competition
        buy_px_1k=2600.0,
    )
    
    snap_sell = create_snapshot(
        sell_px_1k=2750.0,
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
    print_decision(decision, "REJECTED - Competition density too high (0.9)")


def demo_chain_mismatch():
    """Demo: Chain mismatch - simulation failed"""
    snap_buy = create_snapshot(
        chain_id='eth',
        buy_px_1k=2600.0,
    )
    
    snap_sell = create_snapshot(
        chain_id='arbitrum',  # Different chain!
        sell_px_1k=2750.0,
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
    print_decision(decision, "REJECTED - Chain mismatch (simulation failed)")


def demo_tier_comparison():
    """Demo: Same opportunity across different tiers"""
    snap_buy = create_snapshot(
        buy_px_1k=2600.0,
        buy_px_5k=2605.0,
        buy_px_10k=2610.0,
    )
    
    snap_sell = create_snapshot(
        sell_px_1k=2750.0,
        sell_px_5k=2745.0,
        sell_px_10k=2740.0,
    )
    
    print(f"\n{'='*80}")
    print("SCENARIO: Same opportunity at different tiers")
    print(f"{'='*80}")
    
    for tier in [1000, 5000, 10000]:
        decision = preflight_check(snap_buy, snap_sell, tier, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
        print(f"\nTier ${tier}:")
        print(f"  Result:        {decision.result}")
        print(f"  Net Edge:      {decision.net_edge_bps:>8.2f} bps")
        print(f"  Safety Buffer: {decision.safety_buffer_bps:>8.2f} bps")
        print(f"  Confidence:    {decision.confidence_level}")


def demo_policy_comparison():
    """Demo: Same opportunity under different policies"""
    snap_buy = create_snapshot(
        buy_px_1k=2650.0,
    )
    
    snap_sell = create_snapshot(
        sell_px_1k=2700.0,
    )
    
    print(f"\n{'='*80}")
    print("SCENARIO: Same opportunity under different policies")
    print(f"{'='*80}")
    
    policies = [
        ('AGGRESSIVE', AGGRESSIVE_POLICY),
        ('DEFAULT', DEFAULT_POLICY),
        ('CONSERVATIVE', CONSERVATIVE_POLICY),
    ]
    
    for name, policy in policies:
        decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
        print(f"\n{name} Policy:")
        print(f"  Result:        {decision.result}")
        print(f"  Net Edge:      {decision.net_edge_bps:>8.2f} bps")
        print(f"  Safety Buffer: {decision.safety_buffer_bps:>8.2f} bps")
        print(f"  Margin:        {decision.net_edge_bps - decision.safety_buffer_bps:>8.2f} bps")


def demo_accept_levels():
    """Demo: Different accept levels based on edge size"""
    print(f"\n{'='*80}")
    print("SCENARIO: Accept levels based on edge size")
    print(f"{'='*80}")
    
    # Test different edge sizes
    edges = [
        (2680.0, "Small edge"),
        (2700.0, "Medium edge"),
        (2750.0, "Large edge"),
        (2800.0, "Huge edge"),
    ]
    
    for sell_px, desc in edges:
        snap_buy = create_snapshot(buy_px_1k=2650.0)
        snap_sell = create_snapshot(sell_px_1k=sell_px)
        
        decision = preflight_check(snap_buy, snap_sell, 1000, DEFAULT_POLICY, DEFAULT_GAS_MODEL)
        
        print(f"\n{desc} (sell @ {sell_px}):")
        print(f"  Result:     {decision.result}")
        print(f"  Net Edge:   {decision.net_edge_bps:>8.2f} bps")
        print(f"  Confidence: {decision.confidence_level}")


if __name__ == '__main__':
    print()
    print("=" * 80)
    print("PREFLIGHT MODULE DEMO")
    print("Phase 2.4.1 - Deterministic Accept/Reject Filter")
    print("=" * 80)
    
    # Run demos
    demo_profitable_opportunity()
    demo_small_edge()
    demo_high_slippage()
    demo_high_competition()
    demo_chain_mismatch()
    demo_tier_comparison()
    demo_policy_comparison()
    demo_accept_levels()
    
    print()
    print("=" * 80)
    print("✅ DEMO COMPLETE")
    print("=" * 80)
    print()
    print("Key takeaways:")
    print("- Preflight is deterministic (same inputs → same outputs)")
    print("- Rejects 80-95% of opportunities cheaply")
    print("- Net edge = gross edge - fees - gas")
    print("- Safety buffer adapts to risk (slippage, latency, competition)")
    print("- Accept levels: BUNDLE (high confidence) vs SIM_ONLY (lower confidence)")
    print("- Policy tunable (aggressive vs conservative)")
    print()
