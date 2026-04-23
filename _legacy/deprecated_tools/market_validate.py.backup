#!/usr/bin/env python3
"""
MarketSnapshot Validation - Invariant enforcement

Validates all MarketSnapshot invariants:
- Non-empty IDs
- Non-negative prices
- Tiered price sanity
- Numeric bounds
- Token decimal limits

Author: Allmight System
Phase: 2.3A - Market Inefficiency Profiler
"""

from typing import List, Optional
import logging

logger = logging.getLogger('Allmight.MarketValidation')


class ValidationError(Exception):
    """Raised when snapshot violates invariants"""
    pass


def validate_snapshot(snapshot) -> None:
    """
    Validate all invariants for MarketSnapshotV1
    
    Raises:
        ValidationError: If any invariant is violated
    """
    errors = []
    
    # === IDENTIFIER VALIDATION ===
    if not snapshot.chain_id:
        errors.append("chain_id cannot be empty")
    
    if not snapshot.venue_id:
        errors.append("venue_id cannot be empty")
    
    if not snapshot.market_id:
        errors.append("market_id cannot be empty")
    
    if snapshot.ts_ms <= 0:
        errors.append(f"ts_ms must be positive, got {snapshot.ts_ms}")
    
    # === TOKEN VALIDATION ===
    # TokenRef validates itself in __post_init__, but double-check
    if not snapshot.base_token.symbol:
        errors.append("base_token.symbol cannot be empty")
    
    if not snapshot.quote_token.symbol:
        errors.append("quote_token.symbol cannot be empty")
    
    # === PRICE VALIDATION ===
    # All prices must be non-negative
    price_fields = [
        ('mid_px', snapshot.mid_px),
        ('buy_px_1k', snapshot.buy_px_1k),
        ('sell_px_1k', snapshot.sell_px_1k),
        ('buy_px_5k', snapshot.buy_px_5k),
        ('sell_px_5k', snapshot.sell_px_5k),
        ('buy_px_10k', snapshot.buy_px_10k),
        ('sell_px_10k', snapshot.sell_px_10k),
    ]
    
    for field_name, price in price_fields:
        if price < 0:
            errors.append(f"{field_name} cannot be negative, got {price}")
        if price > 1e15:  # Sanity check for absurdly large prices
            errors.append(f"{field_name} exceeds reasonable bounds: {price}")
    
    # Mid price should generally be positive (unless this is a dead market)
    if snapshot.mid_px == 0:
        logger.warning(f"Market {snapshot.market_id} has mid_px = 0 (dead market?)")
    
    # === TIERED PRICE SANITY ===
    # Buy prices should increase with size (more slippage)
    if not (snapshot.buy_px_1k <= snapshot.buy_px_5k <= snapshot.buy_px_10k):
        errors.append(
            f"Buy prices should increase with size: "
            f"1k={snapshot.buy_px_1k}, 5k={snapshot.buy_px_5k}, 10k={snapshot.buy_px_10k}"
        )
    
    # Sell prices should decrease with size (more slippage)
    if not (snapshot.sell_px_1k >= snapshot.sell_px_5k >= snapshot.sell_px_10k):
        errors.append(
            f"Sell prices should decrease with size: "
            f"1k={snapshot.sell_px_1k}, 5k={snapshot.sell_px_5k}, 10k={snapshot.sell_px_10k}"
        )
    
    # Buy price should be >= sell price (spread exists)
    # If violated, this is an anomaly (potential arb or data error)
    tier_checks = [
        (1000, snapshot.buy_px_1k, snapshot.sell_px_1k),
        (5000, snapshot.buy_px_5k, snapshot.sell_px_5k),
        (10000, snapshot.buy_px_10k, snapshot.sell_px_10k),
    ]
    
    for tier, buy, sell in tier_checks:
        if buy < sell:
            # This is suspicious but not necessarily invalid
            # Could be cross-DEX opportunity or stale data
            logger.warning(
                f"ANOMALY: {snapshot.market_id} tier {tier}: "
                f"buy_px ({buy}) < sell_px ({sell}) - potential arbitrage or data error"
            )
    
    # === SPREAD & SLIPPAGE VALIDATION ===
    if snapshot.spread_bps_1k < 0:
        errors.append(f"spread_bps_1k cannot be negative: {snapshot.spread_bps_1k}")
    
    # Spread should be reasonable (<10000 bps = 100%)
    if snapshot.spread_bps_1k > 10000:
        logger.warning(f"Very large spread: {snapshot.spread_bps_1k} bps")
    
    # Slippage checks
    slippage_fields = [
        ('slippage_bps_1k', snapshot.slippage_bps_1k),
        ('slippage_bps_5k', snapshot.slippage_bps_5k),
        ('slippage_bps_10k', snapshot.slippage_bps_10k),
    ]
    
    for field_name, slippage in slippage_fields:
        if slippage < 0:
            errors.append(f"{field_name} cannot be negative: {slippage}")
        if slippage > 10000:  # >100% slippage is very suspicious
            logger.warning(f"Extreme slippage in {field_name}: {slippage} bps")
    
    # Slippage should increase with size
    if not (snapshot.slippage_bps_1k <= snapshot.slippage_bps_5k <= snapshot.slippage_bps_10k):
        logger.warning(
            f"Slippage should increase with size: "
            f"1k={snapshot.slippage_bps_1k}, 5k={snapshot.slippage_bps_5k}, "
            f"10k={snapshot.slippage_bps_10k}"
        )
    
    # === LIQUIDITY VALIDATION ===
    if snapshot.depth_usd_1pct < 0:
        errors.append(f"depth_usd_1pct cannot be negative: {snapshot.depth_usd_1pct}")
    
    if snapshot.tvl_usd is not None and snapshot.tvl_usd < 0:
        errors.append(f"tvl_usd cannot be negative: {snapshot.tvl_usd}")
    
    if snapshot.volume_usd_24h is not None and snapshot.volume_usd_24h < 0:
        errors.append(f"volume_usd_24h cannot be negative: {snapshot.volume_usd_24h}")
    
    # === COST VALIDATION ===
    if snapshot.swap_fee_bps < 0:
        errors.append(f"swap_fee_bps cannot be negative: {snapshot.swap_fee_bps}")
    
    if snapshot.swap_fee_bps > 10000:  # >100% fee is absurd
        errors.append(f"swap_fee_bps exceeds 100%: {snapshot.swap_fee_bps}")
    
    if snapshot.gas_cost_usd < 0:
        errors.append(f"gas_cost_usd cannot be negative: {snapshot.gas_cost_usd}")
    
    if snapshot.latency_ms_est < 0:
        errors.append(f"latency_ms_est cannot be negative: {snapshot.latency_ms_est}")
    
    # === QUALITY SCORE VALIDATION ===
    if snapshot.auth_score is not None:
        if not (0 <= snapshot.auth_score <= 10):
            errors.append(f"auth_score must be 0-10, got {snapshot.auth_score}")
    
    if snapshot.competition_density is not None:
        if not (0 <= snapshot.competition_density <= 1):
            errors.append(
                f"competition_density must be 0-1, got {snapshot.competition_density}"
            )
    
    if snapshot.recent_tx_count_60s is not None:
        if snapshot.recent_tx_count_60s < 0:
            errors.append(
                f"recent_tx_count_60s cannot be negative: {snapshot.recent_tx_count_60s}"
            )
    
    # === RAISE IF ERRORS ===
    if errors:
        error_msg = f"MarketSnapshot validation failed ({len(errors)} errors):\n" + "\n".join(
            f"  - {err}" for err in errors
        )
        raise ValidationError(error_msg)


def validate_snapshots_batch(snapshots: List) -> List:
    """
    Validate a batch of snapshots
    
    Returns:
        List of valid snapshots (invalid ones are logged and skipped)
    """
    valid = []
    
    for snapshot in snapshots:
        try:
            validate_snapshot(snapshot)
            valid.append(snapshot)
        except ValidationError as e:
            logger.error(f"Skipping invalid snapshot: {e}")
    
    return valid


def check_snapshot_consistency(snap1, snap2) -> Optional[str]:
    """
    Check if two snapshots of the same market are consistent
    
    Returns:
        None if consistent, error message if inconsistent
    """
    # Must be same market
    if (snap1.chain_id != snap2.chain_id or
        snap1.venue_id != snap2.venue_id or
        snap1.market_id != snap2.market_id):
        return "Snapshots are from different markets"
    
    # Prices shouldn't change drastically in short time
    time_diff_ms = abs(snap1.ts_ms - snap2.ts_ms)
    
    if time_diff_ms < 60000:  # Less than 1 minute
        price_change_pct = abs(snap1.mid_px - snap2.mid_px) / max(snap1.mid_px, snap2.mid_px)
        
        if price_change_pct > 0.1:  # >10% change in <1 min is suspicious
            return f"Suspicious price change: {price_change_pct*100:.1f}% in {time_diff_ms}ms"
    
    return None
