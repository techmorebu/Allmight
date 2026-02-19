#!/usr/bin/env python3
"""
End-to-End Pipeline - Phase 2.5

Complete arbitrage execution pipeline:
1. Detect opportunities (cross-venue)
2. Preflight check (fast filter)
3. Route simulation (detailed)
4. Final decision
5. Telemetry at every step

Author: Allmight System
Phase: 2.5 - Full Integration
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from detection.opportunity_detector import OpportunityDetectorV0
from execution.preflight import preflight_check
from execution.preflight_policy import DEFAULT_POLICY
from execution.gas_model import DEFAULT_GAS_MODEL
from telemetry.execution_telemetry import TelemetryLogger
from types import SimpleNamespace
import logging

logging.basicConfig(
    level=logging.INFO,
    format='[%(levelname)s] %(message)s'
)


def run_full_pipeline():
    """
    Run complete pipeline with telemetry
    
    Steps:
    1. Load market snapshots
    2. Detect opportunities
    3. For each opportunity:
       a. Preflight check
       b. Route simulation (if preflight passes)
       c. Final decision
    4. Produce report
    """
    
    # Initialize telemetry
    telemetry = TelemetryLogger()
    
    print("=" * 80)
    print("END-TO-END ARBITRAGE PIPELINE")
    print(f"Run ID: {telemetry.run_id}")
    print("=" * 80)
    print()
    
    # ========== STEP 1: LOAD MARKET SNAPSHOTS ==========
    print("📊 Step 1: Loading market snapshots...")
    snapshots = create_mock_snapshots()
    print(f"   Loaded {len(snapshots)} market snapshots")
    print()
    
    # ========== STEP 2: DETECT OPPORTUNITIES ==========
    print("🔍 Step 2: Detecting opportunities...")
    detector = OpportunityDetectorV0(min_gross_edge_bps=50.0)
    opportunities = detector.detect_opportunities(snapshots)
    print(f"   Detected {len(opportunities)} raw opportunities")
    print()
    
    # ========== STEP 3: EVALUATE EACH OPPORTUNITY ==========
    print("⚙️  Step 3: Evaluating opportunities...")
    print()
    
    results = {
        'detected': len(opportunities),
        'preflight_accepted': 0,
        'preflight_rejected': 0,
        'rejection_reasons': {},
    }
    
    for i, opp in enumerate(opportunities, 1):
        print(f"Opportunity {i}/{len(opportunities)}: {opp.opportunity_id}")
        print(f"  Gross Edge: {opp.gross_edge_bps:.2f} bps")
        print(f"  Route: {opp.buy_venue_id} → {opp.sell_venue_id}")
        
        # Preflight check
        preflight = preflight_check(
            snapshot_buy=opp.buy_snapshot,
            snapshot_sell=opp.sell_snapshot,
            tier_usd=opp.tier_usd,
            policy=DEFAULT_POLICY,
            gas_model=DEFAULT_GAS_MODEL,
        )
        
        # Log preflight result
        telemetry.log_preflight_result(
            opportunity_id=opp.opportunity_id,
            chain_id=opp.chain_id,
            venue_id=opp.buy_venue_id,
            market_id=opp.buy_market_id,
            route_id=f"{opp.buy_venue_id}_{opp.sell_venue_id}",
            notional_usd=float(opp.tier_usd),
            block_ref=getattr(opp.buy_snapshot, 'block_ref', 0),
            block_target=None,
            result=preflight.result,
            rejection_reason_code=preflight.rejection_reason_code,
            confidence_level=preflight.confidence_level,
            net_edge_bps=preflight.net_edge_bps,
            safety_buffer_bps=preflight.safety_buffer_bps,
            min_profit_wei=0,
            max_gas_wei=0,
        )
        
        if preflight.result == "REJECT":
            print(f"  ❌ PREFLIGHT REJECT: {preflight.rejection_reason_code}")
            print(f"     Net Edge: {preflight.net_edge_bps:.2f} bps")
            print(f"     Buffer: {preflight.safety_buffer_bps:.2f} bps")
            results['preflight_rejected'] += 1
            
            # Track rejection reason
            code = preflight.rejection_reason_code
            results['rejection_reasons'][code] = results['rejection_reasons'].get(code, 0) + 1
        else:
            print(f"  ✅ PREFLIGHT {preflight.result}")
            print(f"     Net Edge: {preflight.net_edge_bps:.2f} bps")
            print(f"     Confidence: {preflight.confidence_level}")
            results['preflight_accepted'] += 1
            
            # TODO: Route simulation would go here
            print(f"     [Route simulation would run here]")
        
        print()
    
    # ========== STEP 4: SUMMARY REPORT ==========
    print("=" * 80)
    print("PIPELINE RESULTS")
    print("=" * 80)
    print(f"Detected: {results['detected']} opportunities")
    print(f"Preflight Accepted: {results['preflight_accepted']} ({results['preflight_accepted']/results['detected']*100:.1f}%)")
    print(f"Preflight Rejected: {results['preflight_rejected']} ({results['preflight_rejected']/results['detected']*100:.1f}%)")
    print()
    
    if results['rejection_reasons']:
        print("Rejection Breakdown:")
        for code, count in sorted(results['rejection_reasons'].items()):
            pct = count / results['preflight_rejected'] * 100
            print(f"  {code}: {count} ({pct:.1f}%)")
    
    print()
    print("=" * 80)
    print(f"✅ PIPELINE COMPLETE")
    print(f"📊 Telemetry: data/telemetry/{telemetry.run_id[:8]}/")
    print("=" * 80)


def create_mock_snapshots():
    """Create realistic mock snapshots for testing"""
    
    return [
        # Market 1: Uniswap V3 - ETH/USDC
        SimpleNamespace(
            chain_id='eth',
            venue_id='uniswap_v3',
            market_id='0xpool_univ3_ethusdc',
            base_token=SimpleNamespace(symbol='ETH'),
            quote_token=SimpleNamespace(symbol='USDC'),
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
            latency_ms_est=150,
            competition_density=0.3,
            block_ref=21876543,
        ),
        
        # Market 2: Sushiswap - ETH/USDC (higher prices = arb opportunity)
        SimpleNamespace(
            chain_id='eth',
            venue_id='sushiswap',
            market_id='0xpool_sushi_ethusdc',
            base_token=SimpleNamespace(symbol='ETH'),
            quote_token=SimpleNamespace(symbol='USDC'),
            mid_px=2700.00,
            buy_px_1k=2702.00,
            sell_px_1k=2700.00,  # Can sell higher here!
            buy_px_5k=2704.00,
            sell_px_5k=2698.00,
            buy_px_10k=2706.00,
            sell_px_10k=2696.00,
            slippage_bps_1k=30.0,
            slippage_bps_5k=75.0,
            slippage_bps_10k=130.0,
            swap_fee_bps=30.0,
            latency_ms_est=180,
            competition_density=0.4,
            block_ref=21876543,
        ),
        
        # Market 3: Curve - ETH/USDC (lower, no arb)
        SimpleNamespace(
            chain_id='eth',
            venue_id='curve',
            market_id='0xpool_curve_ethusdc',
            base_token=SimpleNamespace(symbol='ETH'),
            quote_token=SimpleNamespace(symbol='USDC'),
            mid_px=2682.00,
            buy_px_1k=2683.00,
            sell_px_1k=2681.00,
            buy_px_5k=2684.00,
            sell_px_5k=2680.00,
            buy_px_10k=2685.00,
            sell_px_10k=2679.00,
            slippage_bps_1k=20.0,
            slippage_bps_5k=60.0,
            slippage_bps_10k=110.0,
            swap_fee_bps=4.0,  # Lower fees
            latency_ms_est=120,
            competition_density=0.2,
            block_ref=21876543,
        ),
    ]


if __name__ == '__main__':
    run_full_pipeline()
