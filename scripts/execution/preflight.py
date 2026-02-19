#!/usr/bin/env python3
"""
Preflight Module - Phase 2.4.1

Deterministic accept/reject filter for arbitrage opportunities.
Operates on validated MarketSnapshotV1 objects.

Pure function: same inputs → same outputs
No network I/O, no hidden state

Author: Allmight System
Phase: 2.4.1 - Preflight Module
"""

from dataclasses import dataclass
from typing import Optional, Literal
import logging

logger = logging.getLogger('Allmight.Preflight')


@dataclass
class PreflightDecision:
    """
    Preflight decision output
    
    Fields:
        result: Accept/reject decision
        rejection_reason_code: Canonical code (if rejected)
        net_edge_bps: Net edge after costs
        safety_buffer_bps: Calculated safety buffer
        confidence_level: Decision confidence
        min_profit_wei: Minimum expected profit (placeholder)
        max_gas_wei: Maximum gas cost (placeholder)
    """
    result: Literal["REJECT", "ACCEPT_SIM_ONLY", "ACCEPT_BUNDLE"]
    rejection_reason_code: Optional[str]
    net_edge_bps: float
    safety_buffer_bps: float
    confidence_level: Literal["LOW", "MED", "HIGH"]
    min_profit_wei: int = 0  # Placeholder for now
    max_gas_wei: int = 0     # Placeholder for now


def preflight_check(
    snapshot_buy,
    snapshot_sell,
    tier_usd: int,
    policy,
    gas_model,
) -> PreflightDecision:
    """
    Deterministic preflight check
    
    Args:
        snapshot_buy: MarketSnapshotV1 (where we buy)
        snapshot_sell: MarketSnapshotV1 (where we sell)
        tier_usd: Trade size (1000, 5000, or 10000)
        policy: PreflightPolicyV1
        gas_model: GasModelV1
    
    Returns:
        PreflightDecision with result and metrics
    
    Rejection taxonomy (evaluated in order):
        1. POLICY_FORBIDDEN
        2. SIMULATION_FAILED
        3. SLIPPAGE_TOO_HIGH
        4. GAS_TOO_HIGH
        5. NETEDGE_BELOW_BUFFER
        6. STATE_DRIFT_RISK
        7. COMPETITION_DENSITY_HIGH
    """
    
    # === RULE 1: POLICY_FORBIDDEN ===
    
    # Check tier allowed
    if tier_usd not in policy.allowed_tiers:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_POLICY_FORBIDDEN",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # Check venue denylist
    if (snapshot_buy.venue_id in policy.denied_venues or
        snapshot_sell.venue_id in policy.denied_venues):
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_POLICY_FORBIDDEN",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # Check token denylist
    buy_tokens = {snapshot_buy.base_token.symbol, snapshot_buy.quote_token.symbol}
    sell_tokens = {snapshot_sell.base_token.symbol, snapshot_sell.quote_token.symbol}
    
    if (buy_tokens & policy.denied_tokens) or (sell_tokens & policy.denied_tokens):
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_POLICY_FORBIDDEN",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # Check market denylist
    if (snapshot_buy.market_id in policy.denied_markets or
        snapshot_sell.market_id in policy.denied_markets):
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_POLICY_FORBIDDEN",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # === RULE 2: SIMULATION_FAILED ===
    
    # Check chain match
    if snapshot_buy.chain_id != snapshot_sell.chain_id:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_SIMULATION_FAILED",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # Get tier-specific prices
    tier_prices = _get_tier_prices(snapshot_buy, snapshot_sell, tier_usd)
    
    if tier_prices is None:
        # Missing required tier fields
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_SIMULATION_FAILED",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    buy_px, sell_px, slip_buy_bps, slip_sell_bps = tier_prices
    
    # Calculate reference mid
    mid_ref = (snapshot_buy.mid_px + snapshot_sell.mid_px) / 2.0
    
    if mid_ref <= 0:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_SIMULATION_FAILED",
            net_edge_bps=0.0,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # === CALCULATE NET EDGE ===
    
    # Gross edge (bps)
    gross_edge_bps = ((sell_px - buy_px) / mid_ref) * 10000.0
    
    # Fee costs (bps)
    fee_bps = snapshot_buy.swap_fee_bps + snapshot_sell.swap_fee_bps
    
    # Gas costs (bps)
    gas_cost_usd = gas_model.estimate_usd(
        chain_id=snapshot_buy.chain_id,
        venue_id=snapshot_buy.venue_id,
        tier_usd=tier_usd
    )
    gas_bps = (gas_cost_usd / tier_usd) * 10000.0
    
    # Net edge (bps)
    net_edge_bps = gross_edge_bps - fee_bps - gas_bps
    
    # === RULE 3: SLIPPAGE_TOO_HIGH ===
    
    max_slippage = max(slip_buy_bps, slip_sell_bps)
    
    if max_slippage > policy.max_slippage_bps:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_SLIPPAGE_TOO_HIGH",
            net_edge_bps=net_edge_bps,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # === RULE 4: GAS_TOO_HIGH ===
    
    if gas_bps > policy.max_gas_bps:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_GAS_TOO_HIGH",
            net_edge_bps=net_edge_bps,
            safety_buffer_bps=0.0,
            confidence_level="LOW"
        )
    
    # === CALCULATE SAFETY BUFFER ===
    
    # Get latency estimate
    latency_ms = getattr(snapshot_buy, 'latency_ms_est', policy.default_latency_ms)
    if latency_ms is None or latency_ms < 0:
        latency_ms = policy.default_latency_ms
    
    # Get competition density
    comp_density_buy = getattr(snapshot_buy, 'competition_density', 0.0) or 0.0
    comp_density_sell = getattr(snapshot_sell, 'competition_density', 0.0) or 0.0
    competition_density = max(comp_density_buy, comp_density_sell)
    
    # Calculate safety buffer
    safety_buffer_bps = (
        policy.base_buffer_bps
        + policy.k_slippage * max_slippage
        + policy.k_latency * (latency_ms / 1000.0)
        + policy.k_competition * competition_density
    )
    
    # === RULE 6: NETEDGE_BELOW_BUFFER ===
    
    if net_edge_bps <= safety_buffer_bps:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_NETEDGE_BELOW_BUFFER",
            net_edge_bps=net_edge_bps,
            safety_buffer_bps=safety_buffer_bps,
            confidence_level="LOW"
        )
    
    # === RULE 7: STATE_DRIFT_RISK ===
    
    if latency_ms > policy.max_latency_ms:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_STATE_DRIFT_RISK",
            net_edge_bps=net_edge_bps,
            safety_buffer_bps=safety_buffer_bps,
            confidence_level="LOW"
        )
    
    # === RULE 8: COMPETITION_DENSITY_HIGH ===
    
    if competition_density > policy.max_competition_density:
        return PreflightDecision(
            result="REJECT",
            rejection_reason_code="REJ_COMPETITION_DENSITY_HIGH",
            net_edge_bps=net_edge_bps,
            safety_buffer_bps=safety_buffer_bps,
            confidence_level="LOW"
        )
    
    # === ACCEPT: Determine level and confidence ===
    
    # Calculate margin above buffer
    margin_bps = net_edge_bps - safety_buffer_bps
    
    # Determine confidence
    if margin_bps >= policy.bundle_extra_bps and max_slippage < 100.0:
        confidence = "HIGH"
    elif margin_bps >= policy.bundle_extra_bps * 0.5:
        confidence = "MED"
    else:
        confidence = "LOW"
    
    # Determine accept level
    if margin_bps >= policy.bundle_extra_bps and confidence == "HIGH":
        result = "ACCEPT_BUNDLE"
    else:
        result = "ACCEPT_SIM_ONLY"
    
    return PreflightDecision(
        result=result,
        rejection_reason_code=None,
        net_edge_bps=net_edge_bps,
        safety_buffer_bps=safety_buffer_bps,
        confidence_level=confidence
    )


def _get_tier_prices(snapshot_buy, snapshot_sell, tier_usd: int):
    """
    Extract tier-specific prices from snapshots
    
    Returns:
        (buy_px, sell_px, slip_buy_bps, slip_sell_bps) or None if missing
    """
    tier_fields = {
        1000: ('buy_px_1k', 'sell_px_1k', 'slippage_bps_1k'),
        5000: ('buy_px_5k', 'sell_px_5k', 'slippage_bps_5k'),
        10000: ('buy_px_10k', 'sell_px_10k', 'slippage_bps_10k'),
    }
    
    if tier_usd not in tier_fields:
        return None
    
    buy_field, sell_field, slip_field = tier_fields[tier_usd]
    
    # Get buy price
    buy_px = getattr(snapshot_buy, buy_field, None)
    if buy_px is None or buy_px <= 0:
        return None
    
    # Get sell price
    sell_px = getattr(snapshot_sell, sell_field, None)
    if sell_px is None or sell_px <= 0:
        return None
    
    # Get slippage
    slip_buy_bps = getattr(snapshot_buy, slip_field, 0.0) or 0.0
    slip_sell_bps = getattr(snapshot_sell, slip_field, 0.0) or 0.0
    
    return (buy_px, sell_px, slip_buy_bps, slip_sell_bps)
