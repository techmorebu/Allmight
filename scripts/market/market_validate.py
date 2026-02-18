#!/usr/bin/env python3
"""
MarketSnapshot Validation - Invariant enforcement

Validates all MarketSnapshot invariants with structured results for telemetry.

Author: Allmight System
Phase: 2.4.0 - Telemetry Integration (Refactored)
"""

from typing import List, Optional
from dataclasses import dataclass
import logging

logger = logging.getLogger('Allmight.MarketValidation')


class ValidationError(Exception):
    """Raised when snapshot violates invariants (backward compatibility)"""
    pass


@dataclass
class ValidationResult:
    """
    Structured validation result
    
    Fields:
        ok: True if snapshot usable (no hard errors)
        warnings: List of warning codes (sorted, unique)
        errors: List of error codes (sorted, unique)
    """
    ok: bool
    warnings: List[str]
    errors: List[str]


def validate_snapshot(snapshot) -> ValidationResult:
    """
    Validate all invariants for MarketSnapshotV1
    
    Returns:
        ValidationResult with ok, warnings, errors
        
    Note: Does NOT raise. Returns structured result for telemetry.
    """
    errors = []
    warnings = []
    
    # Null check
    if snapshot is None:
        return ValidationResult(
            ok=False,
            warnings=[],
            errors=["ERR_SNAPSHOT_NULL"]
        )
    
    # === IDENTIFIER VALIDATION ===
    if not snapshot.chain_id:
        errors.append("ERR_CHAIN_ID_EMPTY")
    
    if not snapshot.venue_id:
        errors.append("ERR_VENUE_ID_EMPTY")
    
    if not snapshot.market_id:
        errors.append("ERR_MARKET_ID_EMPTY")
    
    if snapshot.ts_ms <= 0:
        errors.append("ERR_TS_NONPOSITIVE")
    
    # === TOKEN VALIDATION ===
    if not snapshot.base_token.symbol:
        errors.append("ERR_BASE_SYMBOL_EMPTY")
    
    if not snapshot.quote_token.symbol:
        errors.append("ERR_QUOTE_SYMBOL_EMPTY")
    
    # === PRICE VALIDATION ===
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
            errors.append(f"ERR_{field_name.upper()}_NEGATIVE")
        if price > 1e15:
            errors.append(f"ERR_{field_name.upper()}_OUT_OF_RANGE")
    
    # Mid price zero is warning (dead market)
    if snapshot.mid_px == 0:
        warnings.append("WARN_MIDPX_ZERO")
    
    # === TIERED PRICE SANITY ===
    # Buy prices should increase with size (more slippage)
    if not (snapshot.buy_px_1k <= snapshot.buy_px_5k <= snapshot.buy_px_10k):
        errors.append("ERR_BUY_MONOTONICITY")
    
    # Sell prices should decrease with size (more slippage)
    if not (snapshot.sell_px_1k >= snapshot.sell_px_5k >= snapshot.sell_px_10k):
        errors.append("ERR_SELL_MONOTONICITY")
    
    # Buy price < sell price is anomaly (potential arb or data error)
    tier_checks = [
        (1000, snapshot.buy_px_1k, snapshot.sell_px_1k),
        (5000, snapshot.buy_px_5k, snapshot.sell_px_5k),
        (10000, snapshot.buy_px_10k, snapshot.sell_px_10k),
    ]
    
    for tier, buy, sell in tier_checks:
        if buy < sell:
            warnings.append(f"WARN_BUY_LT_SELL_{tier}")
    
    # === SPREAD & SLIPPAGE VALIDATION ===
    if snapshot.spread_bps_1k < 0:
        errors.append("ERR_SPREAD_NEGATIVE")
    
    if snapshot.spread_bps_1k > 10000:
        warnings.append("WARN_SPREAD_EXTREME")
    
    # Slippage checks
    if snapshot.slippage_bps_1k < 0:
        errors.append("ERR_SLIPPAGE_1K_NEGATIVE")
    if snapshot.slippage_bps_5k < 0:
        errors.append("ERR_SLIPPAGE_5K_NEGATIVE")
    if snapshot.slippage_bps_10k < 0:
        errors.append("ERR_SLIPPAGE_10K_NEGATIVE")
    
    if snapshot.slippage_bps_1k > 10000:
        warnings.append("WARN_SLIPPAGE_1K_EXTREME")
    if snapshot.slippage_bps_5k > 10000:
        warnings.append("WARN_SLIPPAGE_5K_EXTREME")
    if snapshot.slippage_bps_10k > 10000:
        warnings.append("WARN_SLIPPAGE_10K_EXTREME")
    
    # Slippage should increase with size
    if not (snapshot.slippage_bps_1k <= snapshot.slippage_bps_5k <= snapshot.slippage_bps_10k):
        warnings.append("WARN_SLIPPAGE_NON_MONOTONIC")
    
    # === LIQUIDITY VALIDATION ===
    if snapshot.depth_usd_1pct < 0:
        errors.append("ERR_DEPTH_NEGATIVE")
    
    if snapshot.tvl_usd is not None and snapshot.tvl_usd < 0:
        errors.append("ERR_TVL_NEGATIVE")
    
    if snapshot.volume_usd_24h is not None and snapshot.volume_usd_24h < 0:
        errors.append("ERR_VOLUME_NEGATIVE")
    
    # === COST VALIDATION ===
    if snapshot.swap_fee_bps < 0:
        errors.append("ERR_SWAP_FEE_NEGATIVE")
    
    if snapshot.swap_fee_bps > 10000:
        errors.append("ERR_SWAP_FEE_RANGE")
    
    if snapshot.gas_cost_usd < 0:
        errors.append("ERR_GAS_NEGATIVE")
    
    if snapshot.latency_ms_est < 0:
        errors.append("ERR_LATENCY_NEGATIVE")
    
    # === QUALITY SCORE VALIDATION ===
    if snapshot.auth_score is not None:
        if not (0 <= snapshot.auth_score <= 10):
            errors.append("ERR_AUTH_SCORE_RANGE")
    
    if snapshot.competition_density is not None:
        if not (0 <= snapshot.competition_density <= 1):
            errors.append("ERR_COMPETITION_RANGE")
    
    if snapshot.recent_tx_count_60s is not None:
        if snapshot.recent_tx_count_60s < 0:
            errors.append("ERR_TX_COUNT_NEGATIVE")
    
    # Determine ok status
    ok = len(errors) == 0
    
    return ValidationResult(
        ok=ok,
        warnings=sorted(set(warnings)),
        errors=sorted(set(errors))
    )


def validate_snapshot_strict(snapshot) -> None:
    """
    Backward-compatible strict validation (raises on error)
    
    Use this for code that expects the old behavior.
    New code should use validate_snapshot() for structured results.
    
    Raises:
        ValidationError: If any invariant is violated
    """
    result = validate_snapshot(snapshot)
    
    if not result.ok:
        error_msg = (
            f"MarketSnapshot validation failed ({len(result.errors)} errors):\n" +
            "\n".join(f"  - {err}" for err in result.errors)
        )
        raise ValidationError(error_msg)


def validate_snapshots_batch(snapshots: List) -> List:
    """
    Validate a batch of snapshots (backward compatible)
    
    Returns:
        List of valid snapshots (invalid ones are logged and skipped)
    """
    valid = []
    
    for snapshot in snapshots:
        try:
            validate_snapshot_strict(snapshot)
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
