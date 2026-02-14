#!/usr/bin/env python3
"""
Telemetry Integration Example

Shows how to add Phase 2.4.0 telemetry to existing code

Author: Allmight System
"""

from execution_telemetry import (
    TelemetryLogger,
    StageTimer,
    generate_opportunity_id,
    RejectionCode
)

# ===== EXAMPLE 1: SNAPSHOT COLLECTION =====

def collect_snapshots_with_telemetry():
    """Example: Add telemetry to snapshot collection"""
    
    # Initialize telemetry
    telemetry = TelemetryLogger()
    
    # Your existing snapshot collection code
    markets = [
        {"chain": "eth", "venue": "uniswap_v3", "market": "0xabc..."},
        {"chain": "eth", "venue": "sushiswap", "market": "0xdef..."}
    ]
    
    for market in markets:
        # Generate opportunity ID
        opp_id = generate_opportunity_id(
            chain_id=market["chain"],
            venue_id=market["venue"],
            market_id=market["market"],
            route_id="snapshot_collection",
            notional_tier=0,
            block_ref=0  # Current block
        )
        
        # Use StageTimer to automatically log timing
        with StageTimer(
            telemetry=telemetry,
            stage="SNAPSHOT_FETCH",
            opportunity_id=opp_id,
            chain_id=market["chain"],
            venue_id=market["venue"],
            market_id=market["market"],
            route_id="snapshot_collection",
            notional_usd=0.0,
            block_ref=0,
            stage_seq=1
        ):
            # Your existing code
            # snapshot = fetch_snapshot(market)
            pass
        
        print(f"✅ Logged snapshot collection for {market['venue']}")


# ===== EXAMPLE 2: PREFLIGHT DECISION =====

def preflight_with_telemetry():
    """Example: Add telemetry to preflight decisions"""
    
    telemetry = TelemetryLogger()
    
    # Your opportunity data
    opp_id = generate_opportunity_id(
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_tier=1000,
        block_ref=21876543
    )
    
    # Your preflight logic
    net_edge_bps = 1.7
    safety_buffer_bps = 3.5
    
    # Decision
    if net_edge_bps < safety_buffer_bps:
        result = "REJECT"
        rejection_code = RejectionCode.NETEDGE_BELOW_BUFFER
    else:
        result = "ACCEPT_BUNDLE"
        rejection_code = None
    
    # Log the decision
    telemetry.log_preflight_result(
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=1000.0,
        block_ref=21876543,
        block_target=21876544,
        result=result,
        rejection_reason_code=rejection_code,
        confidence_level="MED",
        net_edge_bps=net_edge_bps,
        safety_buffer_bps=safety_buffer_bps,
        min_profit_wei=0,
        max_gas_wei=0
    )
    
    print(f"✅ Logged preflight decision: {result}")


# ===== EXAMPLE 3: MULTI-STAGE PIPELINE =====

def full_pipeline_with_telemetry():
    """Example: Complete pipeline with telemetry at each stage"""
    
    telemetry = TelemetryLogger()
    
    opp_id = generate_opportunity_id(
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_tier=5000,
        block_ref=21876543
    )
    
    # Stage 1: Detection
    with StageTimer(
        telemetry=telemetry,
        stage="DETECT",
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=5000.0,
        block_ref=21876543,
        block_target=21876544,
        stage_seq=1
    ):
        # Your detection logic
        spread_bps = 45.0
    
    # Stage 2: Preflight
    with StageTimer(
        telemetry=telemetry,
        stage="PREFLIGHT",
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=5000.0,
        block_ref=21876543,
        block_target=21876544,
        stage_seq=2
    ):
        # Your preflight logic
        net_edge_bps = 12.5
        safety_buffer_bps = 5.0
    
    # Log preflight result
    telemetry.log_preflight_result(
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=5000.0,
        block_ref=21876543,
        block_target=21876544,
        result="ACCEPT_BUNDLE",
        rejection_reason_code=None,
        confidence_level="HIGH",
        net_edge_bps=net_edge_bps,
        safety_buffer_bps=safety_buffer_bps,
        min_profit_wei=50000000000000000,  # 0.05 ETH
        max_gas_wei=10000000000000000      # 0.01 ETH
    )
    
    # Stage 3: Route Simulation
    with StageTimer(
        telemetry=telemetry,
        stage="ROUTE_SIM",
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=5000.0,
        block_ref=21876543,
        block_target=21876544,
        stage_seq=3
    ):
        # Your simulation logic
        pass
    
    # Stage 4: Bundle Build
    with StageTimer(
        telemetry=telemetry,
        stage="BUNDLE_BUILD",
        opportunity_id=opp_id,
        chain_id="eth",
        venue_id="uniswap_v3",
        market_id="0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640",
        route_id="ETH->USDC_v3_500",
        notional_usd=5000.0,
        block_ref=21876543,
        block_target=21876544,
        stage_seq=4
    ):
        # Your bundle building logic
        pass
    
    print(f"✅ Full pipeline logged for opportunity {opp_id}")


if __name__ == '__main__':
    print("=== Example 1: Snapshot Collection ===")
    collect_snapshots_with_telemetry()
    
    print("\n=== Example 2: Preflight Decision ===")
    preflight_with_telemetry()
    
    print("\n=== Example 3: Full Pipeline ===")
    full_pipeline_with_telemetry()
    
    print("\n✅ All examples complete! Check data/telemetry/")
