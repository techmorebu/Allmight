#!/usr/bin/env python3
"""
Preflight Rejection Ordering Test - Phase 2.4.1

Verifies that when multiple rejection conditions are true,
the FIRST rule in the canonical taxonomy wins.

Canonical order:
1. POLICY_FORBIDDEN
2. SIMULATION_FAILED
3. SLIPPAGE_TOO_HIGH
4. GAS_TOO_HIGH
5. NETEDGE_BELOW_BUFFER
6. STATE_DRIFT_RISK
7. COMPETITION_DENSITY_HIGH

Author: Allmight System
Phase: 2.4.1 - Preflight Module
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..', 'scripts'))

from execution.preflight import preflight_check
from execution.preflight_policy import PreflightPolicyV1
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


def test_rule_1_policy_forbidden():
    """Rule 1: POLICY_FORBIDDEN beats everything"""
    print("Testing Rule 1: POLICY_FORBIDDEN")
    
    policy = PreflightPolicyV1(
        denied_venues={'banned_dex'},
        max_slippage_bps=10.0,  # Will also trigger SLIPPAGE_TOO_HIGH
    )
    
    snap_buy = create_snapshot(
        venue_id='banned_dex',  # POLICY_FORBIDDEN
        slippage_bps_1k=500.0,  # Also exceeds threshold
    )
    snap_sell = create_snapshot()
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_POLICY_FORBIDDEN"
    print(f"  ✅ {decision.rejection_reason_code} (correct, beats SLIPPAGE_TOO_HIGH)")


def test_rule_2_simulation_failed():
    """Rule 2: SIMULATION_FAILED beats rules 3-8"""
    print("Testing Rule 2: SIMULATION_FAILED")
    
    policy = PreflightPolicyV1(
        max_slippage_bps=10.0,  # Will also trigger
    )
    
    snap_buy = create_snapshot(chain_id='eth')
    snap_sell = create_snapshot(
        chain_id='arbitrum',  # SIMULATION_FAILED (chain mismatch)
        slippage_bps_1k=500.0,  # Also exceeds threshold
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_SIMULATION_FAILED"
    print(f"  ✅ {decision.rejection_reason_code} (correct, beats SLIPPAGE_TOO_HIGH)")


def test_rule_3_slippage_too_high():
    """Rule 3: SLIPPAGE_TOO_HIGH beats rules 4-8"""
    print("Testing Rule 3: SLIPPAGE_TOO_HIGH")
    
    policy = PreflightPolicyV1(
        max_slippage_bps=10.0,   # Very low threshold
        max_gas_bps=1.0,          # Will also trigger
        base_buffer_bps=10000.0,  # Will also trigger NETEDGE_BELOW_BUFFER
    )
    
    snap_buy = create_snapshot(
        slippage_bps_1k=500.0,  # SLIPPAGE_TOO_HIGH
    )
    snap_sell = create_snapshot(sell_px_1k=2690.0)  # Small edge
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_SLIPPAGE_TOO_HIGH"
    print(f"  ✅ {decision.rejection_reason_code} (correct, beats GAS_TOO_HIGH and NETEDGE)")


def test_rule_4_gas_too_high():
    """Rule 4: GAS_TOO_HIGH beats rules 5-8"""
    print("Testing Rule 4: GAS_TOO_HIGH")
    
    policy = PreflightPolicyV1(
        max_gas_bps=1.0,          # Impossibly low (will trigger)
        base_buffer_bps=10000.0,  # Will also trigger NETEDGE_BELOW_BUFFER
    )
    
    snap_buy = create_snapshot()
    snap_sell = create_snapshot(sell_px_1k=2690.0)  # Small edge
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_GAS_TOO_HIGH"
    print(f"  ✅ {decision.rejection_reason_code} (correct, beats NETEDGE_BELOW_BUFFER)")


def test_rule_6_netedge_below_buffer():
    """Rule 6: NETEDGE_BELOW_BUFFER beats rules 7-8"""
    print("Testing Rule 6: NETEDGE_BELOW_BUFFER")
    
    policy = PreflightPolicyV1(
        base_buffer_bps=500.0,      # High buffer (will trigger)
        max_latency_ms=1,           # Will also trigger STATE_DRIFT_RISK
        max_competition_density=0.0,  # Will also trigger COMPETITION_DENSITY_HIGH
    )
    
    snap_buy = create_snapshot(
        latency_ms_est=10000,    # Exceeds max_latency_ms
        competition_density=0.9,  # Exceeds max_competition_density
    )
    snap_sell = create_snapshot(sell_px_1k=2684.0)  # Very small edge
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_NETEDGE_BELOW_BUFFER"
    print(f"  ✅ {decision.rejection_reason_code} (correct, beats STATE_DRIFT and COMPETITION)")


def test_rule_7_state_drift_risk():
    """Rule 7: STATE_DRIFT_RISK beats rule 8"""
    print("Testing Rule 7: STATE_DRIFT_RISK")
    
    policy = PreflightPolicyV1(
        base_buffer_bps=0.1,         # Very low (won't trigger)
        max_latency_ms=100,          # Will trigger
        max_competition_density=0.0,  # Will also trigger
    )
    
    snap_buy = create_snapshot(
        latency_ms_est=10000,    # STATE_DRIFT_RISK
        competition_density=0.9,  # Also exceeds
        buy_px_1k=2600.0,        # Buy low
    )
    snap_sell = create_snapshot(
        sell_px_1k=2800.0,       # Sell high - huge edge (clears buffer)
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_STATE_DRIFT_RISK"
    print(f"  ✅ {decision.rejection_reason_code} (correct, beats COMPETITION_DENSITY_HIGH)")


def test_rule_8_competition_density_high():
    """Rule 8: COMPETITION_DENSITY_HIGH (last rule)"""
    print("Testing Rule 8: COMPETITION_DENSITY_HIGH")
    
    policy = PreflightPolicyV1(
        base_buffer_bps=0.1,         # Won't trigger
        max_competition_density=0.2,  # Will trigger
    )
    
    snap_buy = create_snapshot(
        competition_density=0.9,  # COMPETITION_DENSITY_HIGH
        buy_px_1k=2600.0,        # Buy low
    )
    snap_sell = create_snapshot(
        sell_px_1k=2800.0,       # Sell high - huge edge
    )
    
    decision = preflight_check(snap_buy, snap_sell, 1000, policy, DEFAULT_GAS_MODEL)
    
    assert decision.result == "REJECT"
    assert decision.rejection_reason_code == "REJ_COMPETITION_DENSITY_HIGH"
    print(f"  ✅ {decision.rejection_reason_code} (correct, last rule)")


if __name__ == '__main__':
    print("=" * 80)
    print("PREFLIGHT REJECTION ORDERING TESTS")
    print("=" * 80)
    print()
    print("Verifying canonical rejection taxonomy (first match wins):")
    print()
    
    test_rule_1_policy_forbidden()
    test_rule_2_simulation_failed()
    test_rule_3_slippage_too_high()
    test_rule_4_gas_too_high()
    test_rule_6_netedge_below_buffer()
    test_rule_7_state_drift_risk()
    test_rule_8_competition_density_high()
    
    print()
    print("=" * 80)
    print("✅ ALL REJECTION ORDERING TESTS PASSED")
    print("=" * 80)
    print()
    print("Canonical order verified:")
    print("1. POLICY_FORBIDDEN")
    print("2. SIMULATION_FAILED")
    print("3. SLIPPAGE_TOO_HIGH")
    print("4. GAS_TOO_HIGH")
    print("6. NETEDGE_BELOW_BUFFER")
    print("7. STATE_DRIFT_RISK")
    print("8. COMPETITION_DENSITY_HIGH")
