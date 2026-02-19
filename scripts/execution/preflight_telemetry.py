#!/usr/bin/env python3
"""
Preflight with Telemetry Integration - Phase 2.4.1

Adds telemetry logging to preflight checks.
Every preflight decision emits a PreflightResultEvent.

Author: Allmight System
Phase: 2.4.1 - Preflight + Telemetry
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from execution.preflight import preflight_check, PreflightDecision
from execution.preflight_policy import PreflightPolicyV1
from execution.gas_model import GasModelV1


def preflight_with_telemetry(
    snapshot_buy,
    snapshot_sell,
    tier_usd: int,
    policy: PreflightPolicyV1,
    gas_model: GasModelV1,
    telemetry,
    opportunity_id: str = "",
    route_id: str = "",
) -> PreflightDecision:
    """
    Run preflight check and emit telemetry event
    
    Args:
        snapshot_buy: MarketSnapshotV1 (buy venue)
        snapshot_sell: MarketSnapshotV1 (sell venue)
        tier_usd: Trade size (1000, 5000, 10000)
        policy: PreflightPolicyV1
        gas_model: GasModelV1
        telemetry: TelemetryLogger instance
        opportunity_id: Opportunity identifier (optional)
        route_id: Route identifier (optional)
    
    Returns:
        PreflightDecision
    """
    # Run preflight
    decision = preflight_check(
        snapshot_buy=snapshot_buy,
        snapshot_sell=snapshot_sell,
        tier_usd=tier_usd,
        policy=policy,
        gas_model=gas_model,
    )
    
    # Emit telemetry event
    telemetry.log_preflight_result(
        opportunity_id=opportunity_id,
        chain_id=snapshot_buy.chain_id,
        venue_id=snapshot_buy.venue_id,
        market_id=snapshot_buy.market_id,
        route_id=route_id,
        notional_usd=float(tier_usd),
        block_ref=getattr(snapshot_buy, 'block_ref', 0),
        block_target=None,  # Preflight doesn't know target yet
        result=decision.result,
        rejection_reason_code=decision.rejection_reason_code,
        confidence_level=decision.confidence_level,
        net_edge_bps=decision.net_edge_bps,
        safety_buffer_bps=decision.safety_buffer_bps,
        min_profit_wei=decision.min_profit_wei,
        max_gas_wei=decision.max_gas_wei,
    )
    
    return decision


if __name__ == '__main__':
    """Demo with telemetry"""
    from telemetry.execution_telemetry import TelemetryLogger
    from types import SimpleNamespace
    
    print("=" * 80)
    print("PREFLIGHT WITH TELEMETRY DEMO")
    print("=" * 80)
    print()
    
    # Initialize telemetry
    telemetry = TelemetryLogger()
    print(f"Telemetry initialized: run_id={telemetry.run_id}")
    print()
    
    # Import after sys.path modification
    from execution.preflight_policy import DEFAULT_POLICY
    from execution.gas_model import DEFAULT_GAS_MODEL
    
    def create_snapshot(**kwargs):
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
    
    # Test 1: Accepted opportunity
    print("Test 1: ACCEPT - Large edge")
    snap_buy = create_snapshot(buy_px_1k=2600.0)
    snap_sell = create_snapshot(venue_id='sushiswap', sell_px_1k=2750.0)
    
    decision = preflight_with_telemetry(
        snapshot_buy=snap_buy,
        snapshot_sell=snap_sell,
        tier_usd=1000,
        policy=DEFAULT_POLICY,
        gas_model=DEFAULT_GAS_MODEL,
        telemetry=telemetry,
        opportunity_id="opp_test_accept",
        route_id="ETH/USDC_univ3_sushi",
    )
    
    print(f"  Result: {decision.result}")
    print(f"  Net Edge: {decision.net_edge_bps:.2f} bps")
    print()
    
    # Test 2: Rejected opportunity
    print("Test 2: REJECT - Small edge")
    snap_buy = create_snapshot()
    snap_sell = create_snapshot(venue_id='sushiswap', sell_px_1k=2685.0)
    
    decision = preflight_with_telemetry(
        snapshot_buy=snap_buy,
        snapshot_sell=snap_sell,
        tier_usd=1000,
        policy=DEFAULT_POLICY,
        gas_model=DEFAULT_GAS_MODEL,
        telemetry=telemetry,
        opportunity_id="opp_test_reject",
        route_id="ETH/USDC_univ3_sushi",
    )
    
    print(f"  Result: {decision.result}")
    print(f"  Rejection: {decision.rejection_reason_code}")
    print(f"  Net Edge: {decision.net_edge_bps:.2f} bps")
    print()
    
    # Test 3: High slippage
    print("Test 3: REJECT - High slippage")
    snap_buy = create_snapshot(slippage_bps_1k=800.0, buy_px_1k=2600.0)
    snap_sell = create_snapshot(venue_id='sushiswap', sell_px_1k=2750.0)
    
    decision = preflight_with_telemetry(
        snapshot_buy=snap_buy,
        snapshot_sell=snap_sell,
        tier_usd=1000,
        policy=DEFAULT_POLICY,
        gas_model=DEFAULT_GAS_MODEL,
        telemetry=telemetry,
        opportunity_id="opp_test_slippage",
        route_id="ETH/USDC_univ3_sushi",
    )
    
    print(f"  Result: {decision.result}")
    print(f"  Rejection: {decision.rejection_reason_code}")
    print()
    
    print("=" * 80)
    print("✅ TELEMETRY DEMO COMPLETE")
    print("=" * 80)
    print()
    print(f"Check telemetry: data/telemetry/{telemetry.run_id[:8]}/preflight_results.jsonl")
    print()
