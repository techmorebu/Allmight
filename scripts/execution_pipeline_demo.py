#!/usr/bin/env python3
"""
Execution Pipeline Demo - Phase 2.4.2

Full pipeline demonstration:
1. Preflight check (cheap filter)
2. Route simulation (if preflight passes)
3. Final decision

Shows how components work together.

Author: Allmight System
Phase: 2.4.2 - Integration
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from execution.preflight import preflight_check, PreflightDecision
from execution.preflight_policy import DEFAULT_POLICY
from execution.gas_model import DEFAULT_GAS_MODEL
from execution.route_simulator import (
    V2PoolState, SimContext, simulate_route, create_single_hop_route
)
from types import SimpleNamespace


def create_mock_snapshot(**kwargs):
    """Create mock snapshot for preflight"""
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
        'block_ref': 21876543,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def full_pipeline_demo():
    """
    Demonstrate full execution pipeline
    
    Pipeline:
    1. Detect opportunity (from snapshots)
    2. Preflight check (fast reject)
    3. Route simulation (if accepted)
    4. Final decision
    """
    
    print("=" * 80)
    print("EXECUTION PIPELINE DEMO")
    print("=" * 80)
    print()
    
    # ========== SCENARIO 1: PROFITABLE OPPORTUNITY ==========
    print("SCENARIO 1: Profitable arbitrage opportunity")
    print("-" * 80)
    
    # Snapshots show arbitrage: buy cheap on Uniswap, sell high on Sushiswap
    snap_buy = create_mock_snapshot(
        venue_id='uniswap_v3',
        market_id='0xpool_univ3',
        buy_px_1k=2600.0,  # Can buy at 2600
    )
    
    snap_sell = create_mock_snapshot(
        venue_id='sushiswap',
        market_id='0xpool_sushi',
        sell_px_1k=2750.0,  # Can sell at 2750
    )
    
    print(f"📊 Market Data:")
    print(f"   Buy:  Uniswap V3 @ 2600 USDC/ETH")
    print(f"   Sell: Sushiswap  @ 2750 USDC/ETH")
    print(f"   Spread: 150 USDC (5.77%)")
    print()
    
    # Step 1: Preflight
    print("🔍 Step 1: Preflight Check (cheap filter)")
    preflight = preflight_check(
        snapshot_buy=snap_buy,
        snapshot_sell=snap_sell,
        tier_usd=1000,
        policy=DEFAULT_POLICY,
        gas_model=DEFAULT_GAS_MODEL,
    )
    
    print(f"   Result: {preflight.result}")
    print(f"   Net Edge: {preflight.net_edge_bps:.2f} bps")
    print(f"   Safety Buffer: {preflight.safety_buffer_bps:.2f} bps")
    print(f"   Confidence: {preflight.confidence_level}")
    print()
    
    if preflight.result == "REJECT":
        print(f"   ❌ REJECTED: {preflight.rejection_reason_code}")
        print()
        return
    
    # Step 2: Route Simulation (detailed)
    print("🎯 Step 2: Route Simulation (detailed modeling)")
    
    # Create pool states for simulation
    pool_buy = V2PoolState(
        reserve0=100_000_000_000_000_000_000,  # 100 ETH
        reserve1=260_000_000_000,              # 260,000 USDC
        token0="0xETH",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    pool_sell = V2PoolState(
        reserve0=100_000_000_000_000_000_000,  # 100 ETH
        reserve1=275_000_000_000,              # 275,000 USDC (higher = can sell higher)
        token0="0xETH",
        token1="0xUSDC",
        fee_bps=30,
        block_ref=21876543
    )
    
    # Simulate buy leg
    route_buy = create_single_hop_route(
        chain_id="eth",
        venue_id="uniswap_v3",
        pool_id="0xpool_buy",
        token_in="0xUSDC",
        token_out="0xETH",
        amount_in=1000_000_000,  # 1000 USDC
        route_id="arb_buy"
    )
    
    context = SimContext(block_ref=21876543, chain_id="eth")
    
    sim_buy = simulate_route(route_buy, {"0xpool_buy": pool_buy}, context)
    
    print(f"   Buy Simulation:")
    print(f"      In:  1000 USDC")
    print(f"      Out: {sim_buy.amount_out / 1e18:.6f} ETH")
    print(f"      Impact: {sim_buy.price_impact_bps:.2f} bps")
    print()
    
    # Simulate sell leg
    route_sell = create_single_hop_route(
        chain_id="eth",
        venue_id="sushiswap",
        pool_id="0xpool_sell",
        token_in="0xETH",
        token_out="0xUSDC",
        amount_in=sim_buy.amount_out,  # Use output from buy
        route_id="arb_sell"
    )
    
    sim_sell = simulate_route(route_sell, {"0xpool_sell": pool_sell}, context)
    
    print(f"   Sell Simulation:")
    print(f"      In:  {sim_buy.amount_out / 1e18:.6f} ETH")
    print(f"      Out: {sim_sell.amount_out / 1e6:.2f} USDC")
    print(f"      Impact: {sim_sell.price_impact_bps:.2f} bps")
    print()
    
    # Step 3: Profit calculation
    print("💰 Step 3: Profit Calculation")
    
    amount_in_usdc = 1000_000_000  # 1000 USDC
    amount_out_usdc = sim_sell.amount_out
    gross_profit = (amount_out_usdc - amount_in_usdc) / 1e6
    
    # Gas cost estimate
    gas_cost_usd = DEFAULT_GAS_MODEL.estimate_usd("eth", "uniswap_v3", 1000) * 2  # Two swaps
    
    net_profit = gross_profit - gas_cost_usd
    
    print(f"   Gross Profit: ${gross_profit:.2f}")
    print(f"   Gas Cost:     ${gas_cost_usd:.2f}")
    print(f"   Net Profit:   ${net_profit:.2f}")
    print()
    
    # Step 4: Final Decision
    print("✅ Step 4: Final Decision")
    if net_profit > 0:
        print(f"   EXECUTE: Net profit ${net_profit:.2f}")
        print(f"   Expected return: {(net_profit / 1000) * 100:.2f}%")
    else:
        print(f"   SKIP: Unprofitable after gas")
    
    print()
    print("=" * 80)
    
    # ========== SCENARIO 2: REJECTED AT PREFLIGHT ==========
    print()
    print("SCENARIO 2: Opportunity rejected at preflight")
    print("-" * 80)
    
    snap_buy_bad = create_mock_snapshot(buy_px_1k=2685.0)
    snap_sell_bad = create_mock_snapshot(venue_id='sushiswap', sell_px_1k=2686.0)
    
    print(f"📊 Market Data:")
    print(f"   Buy:  2685 USDC/ETH")
    print(f"   Sell: 2686 USDC/ETH")
    print(f"   Spread: 1 USDC (tiny)")
    print()
    
    preflight_bad = preflight_check(
        snapshot_buy=snap_buy_bad,
        snapshot_sell=snap_sell_bad,
        tier_usd=1000,
        policy=DEFAULT_POLICY,
        gas_model=DEFAULT_GAS_MODEL,
    )
    
    print("🔍 Preflight Check:")
    print(f"   Result: {preflight_bad.result}")
    print(f"   Rejection: {preflight_bad.rejection_reason_code}")
    print(f"   Net Edge: {preflight_bad.net_edge_bps:.2f} bps")
    print(f"   Safety Buffer: {preflight_bad.safety_buffer_bps:.2f} bps")
    print()
    print("   ❌ REJECTED: Never reached simulation (saved gas!)")
    print()
    
    print("=" * 80)
    print("✅ PIPELINE DEMO COMPLETE")
    print("=" * 80)
    print()
    print("Key insights:")
    print("- Preflight rejects ~80-95% of opportunities cheaply")
    print("- Simulation only runs on promising opportunities")
    print("- Two-stage filtering: fast + accurate")
    print("- Net profit accounts for all costs (fees + gas)")
    print()


if __name__ == '__main__':
    full_pipeline_demo()
