#!/usr/bin/env python3
"""
Snapshot Validation - Phase 2.4.0 Validation Layer

Pure deterministic validator for MarketSnapshotV1
Emits TELEMETRY_WARNING events, never mutates snapshots

Author: Allmight System
Phase: 2.4.0 - Instrumentation
Governance: Phase-0 (Determinism + Audit)
"""

from dataclasses import dataclass
from typing import List, Optional, Dict, Any
import logging

logger = logging.getLogger('Allmight.SnapshotValidation')

# ===== VALIDATION THRESHOLDS =====

MAX_SPREAD_BPS_WARN = 5000  # 50%
MAX_SLIPPAGE_BPS_WARN = 5000  # 50%
MAX_PRICE_DEVIATION_BPS_WARN = 5000  # 50%

# ===== CANONICAL WARNING/ERROR CODES =====

class ValidationCode:
    """Canonical validation codes - stable, never rename without migration"""
    
    # ERRORS (hard failures, ok=False)
    ERR_MIDPRICE_NONPOSITIVE = "ERR_MIDPRICE_NONPOSITIVE"
    ERR_MIDPRICE_MISSING = "ERR_MIDPRICE_MISSING"
    
    # WARNINGS (snapshot usable but abnormal, ok=True)
    WARN_BUY_LT_MID_TIER_1000 = "WARN_BUY_LT_MID_TIER_1000"
    WARN_BUY_LT_MID_TIER_5000 = "WARN_BUY_LT_MID_TIER_5000"
    WARN_BUY_LT_MID_TIER_10000 = "WARN_BUY_LT_MID_TIER_10000"
    
    WARN_SELL_GT_MID_TIER_1000 = "WARN_SELL_GT_MID_TIER_1000"
    WARN_SELL_GT_MID_TIER_5000 = "WARN_SELL_GT_MID_TIER_5000"
    WARN_SELL_GT_MID_TIER_10000 = "WARN_SELL_GT_MID_TIER_10000"
    
    WARN_BUY_NON_MONOTONIC = "WARN_BUY_NON_MONOTONIC"
    WARN_SELL_NON_MONOTONIC = "WARN_SELL_NON_MONOTONIC"
    
    WARN_SPREAD_NEGATIVE = "WARN_SPREAD_NEGATIVE"
    WARN_SPREAD_ABSURD = "WARN_SPREAD_ABSURD"
    
    WARN_SLIPPAGE_NEGATIVE = "WARN_SLIPPAGE_NEGATIVE"
    WARN_SLIPPAGE_ABSURD = "WARN_SLIPPAGE_ABSURD"
    
    WARN_TVL_MISSING = "WARN_TVL_MISSING"
    WARN_VOLUME_MISSING = "WARN_VOLUME_MISSING"


# ===== VALIDATION RESULT =====

@dataclass
class ValidationResult:
    """
    Result of snapshot validation
    
    Pure data - no side effects
    """
    ok: bool
    warnings: List[str]  # Sorted warning codes
    errors: List[str]    # Sorted error codes
    context: Optional[Dict[str, Any]] = None  # Small debug context
    
    def __post_init__(self):
        """Ensure codes are sorted (determinism)"""
        self.warnings = sorted(set(self.warnings))
        self.errors = sorted(set(self.errors))


# ===== VALIDATORS =====

def validate_snapshot(snapshot, tiers=(1000, 5000, 10000)) -> ValidationResult:
    """
    Validate MarketSnapshotV1
    
    Args:
        snapshot: MarketSnapshotV1 instance
        tiers: Notional tiers to validate
    
    Returns:
        ValidationResult with ok, warnings, errors
    
    Deterministic - same snapshot always produces same result
    """
    warnings = []
    errors = []
    context = {}
    
    # Validate pricing
    price_warnings, price_errors, price_context = validate_prices(snapshot, tiers)
    warnings.extend(price_warnings)
    errors.extend(price_errors)
    context.update(price_context)
    
    # Validate monotonicity
    mono_warnings = validate_monotonic(snapshot, tiers)
    warnings.extend(mono_warnings)
    
    # Validate bps ranges
    bps_warnings = validate_bps_ranges(snapshot)
    warnings.extend(bps_warnings)
    
    # Validate completeness
    complete_warnings = validate_completeness(snapshot)
    warnings.extend(complete_warnings)
    
    # Determine ok
    ok = len(errors) == 0
    
    return ValidationResult(
        ok=ok,
        warnings=warnings,
        errors=errors,
        context=context if context else None
    )


def validate_prices(snapshot, tiers) -> tuple:
    """
    Validate price fields
    
    Returns:
        (warnings, errors, context)
    """
    warnings = []
    errors = []
    context = {}
    
    # Check mid price exists and positive
    mid_px = getattr(snapshot, 'mid_price', None)
    
    if mid_px is None:
        errors.append(ValidationCode.ERR_MIDPRICE_MISSING)
        return warnings, errors, context
    
    if mid_px <= 0:
        errors.append(ValidationCode.ERR_MIDPRICE_NONPOSITIVE)
        context['mid_price'] = mid_px
        return warnings, errors, context
    
    context['mid_price'] = mid_px
    
    # Check tiered prices vs mid
    tier_map = {
        1000: ('effective_buy_price_1k', 'effective_sell_price_1k',
               ValidationCode.WARN_BUY_LT_MID_TIER_1000,
               ValidationCode.WARN_SELL_GT_MID_TIER_1000),
        5000: ('effective_buy_price_5k', 'effective_sell_price_5k',
               ValidationCode.WARN_BUY_LT_MID_TIER_5000,
               ValidationCode.WARN_SELL_GT_MID_TIER_5000),
        10000: ('effective_buy_price_10k', 'effective_sell_price_10k',
                ValidationCode.WARN_BUY_LT_MID_TIER_10000,
                ValidationCode.WARN_SELL_GT_MID_TIER_10000),
    }
    
    for tier in tiers:
        if tier not in tier_map:
            continue
        
        buy_field, sell_field, buy_warn, sell_warn = tier_map[tier]
        
        buy_px = getattr(snapshot, buy_field, None)
        sell_px = getattr(snapshot, sell_field, None)
        
        if buy_px is not None:
            # Buy price should typically be >= mid (paying premium)
            if buy_px < mid_px:
                warnings.append(buy_warn)
                context[buy_field] = buy_px
        
        if sell_px is not None:
            # Sell price should typically be <= mid (receiving less)
            if sell_px > mid_px:
                warnings.append(sell_warn)
                context[sell_field] = sell_px
    
    return warnings, errors, context


def validate_monotonic(snapshot, tiers) -> List[str]:
    """
    Validate tiered prices are monotonic
    
    Buy prices should increase with size (worse execution)
    Sell prices should decrease with size (worse execution)
    
    Returns:
        warnings list
    """
    warnings = []
    
    # Buy prices: 1k <= 5k <= 10k (pay more for bigger size)
    buy_1k = getattr(snapshot, 'effective_buy_price_1k', None)
    buy_5k = getattr(snapshot, 'effective_buy_price_5k', None)
    buy_10k = getattr(snapshot, 'effective_buy_price_10k', None)
    
    if all(x is not None for x in [buy_1k, buy_5k, buy_10k]):
        if not (buy_1k <= buy_5k <= buy_10k):
            warnings.append(ValidationCode.WARN_BUY_NON_MONOTONIC)
    
    # Sell prices: 1k >= 5k >= 10k (receive less for bigger size)
    sell_1k = getattr(snapshot, 'effective_sell_price_1k', None)
    sell_5k = getattr(snapshot, 'effective_sell_price_5k', None)
    sell_10k = getattr(snapshot, 'effective_sell_price_10k', None)
    
    if all(x is not None for x in [sell_1k, sell_5k, sell_10k]):
        if not (sell_1k >= sell_5k >= sell_10k):
            warnings.append(ValidationCode.WARN_SELL_NON_MONOTONIC)
    
    return warnings


def validate_bps_ranges(snapshot) -> List[str]:
    """
    Validate bps fields are reasonable
    
    Returns:
        warnings list
    """
    warnings = []
    
    # Check spread
    spread = getattr(snapshot, 'spread_bps', None)
    if spread is not None:
        if spread < 0:
            warnings.append(ValidationCode.WARN_SPREAD_NEGATIVE)
        elif spread > MAX_SPREAD_BPS_WARN:
            warnings.append(ValidationCode.WARN_SPREAD_ABSURD)
    
    # Check slippage at each tier
    for tier in [1000, 5000, 10000]:
        field = f'slippage_{tier // 1000}k_bps'
        slippage = getattr(snapshot, field, None)
        
        if slippage is not None:
            if slippage < 0:
                warnings.append(ValidationCode.WARN_SLIPPAGE_NEGATIVE)
            elif slippage > MAX_SLIPPAGE_BPS_WARN:
                warnings.append(ValidationCode.WARN_SLIPPAGE_ABSURD)
    
    return warnings


def validate_completeness(snapshot) -> List[str]:
    """
    Validate optional but recommended fields
    
    Returns:
        warnings list
    """
    warnings = []
    
    # Check for missing TVL
    tvl = getattr(snapshot, 'tvl_usd', None)
    if tvl is None:
        warnings.append(ValidationCode.WARN_TVL_MISSING)
    
    # Check for missing volume
    volume = getattr(snapshot, 'volume_24h', None)
    if volume is None:
        warnings.append(ValidationCode.WARN_VOLUME_MISSING)
    
    return warnings


# ===== DEMO =====

if __name__ == '__main__':
    # Demo usage
    logging.basicConfig(level=logging.INFO)
    
    # Create mock snapshot for testing
    from types import SimpleNamespace
    
    # Test 1: Valid snapshot
    valid_snap = SimpleNamespace(
        mid_price=2684.50,
        effective_buy_price_1k=2685.20,
        effective_sell_price_1k=2683.80,
        effective_buy_price_5k=2686.40,
        effective_sell_price_5k=2682.60,
        effective_buy_price_10k=2687.80,
        effective_sell_price_10k=2681.20,
        spread_bps=52.0,
        slippage_1k_bps=26.0,
        slippage_5k_bps=70.0,
        slippage_10k_bps=120.0,
        tvl_usd=50000000,
        volume_24h=10000000
    )
    
    result = validate_snapshot(valid_snap)
    print(f"Valid snapshot: ok={result.ok}, warnings={result.warnings}, errors={result.errors}")
    
    # Test 2: Invalid mid price
    invalid_snap = SimpleNamespace(
        mid_price=0,
        effective_buy_price_1k=2685.20,
        effective_sell_price_1k=2683.80,
        effective_buy_price_5k=2686.40,
        effective_sell_price_5k=2682.60,
        effective_buy_price_10k=2687.80,
        effective_sell_price_10k=2681.20,
        spread_bps=52.0,
        slippage_1k_bps=26.0,
        slippage_5k_bps=70.0,
        slippage_10k_bps=120.0,
        tvl_usd=None,
        volume_24h=None
    )
    
    result = validate_snapshot(invalid_snap)
    print(f"Invalid snapshot: ok={result.ok}, warnings={result.warnings}, errors={result.errors}")
    
    # Test 3: Non-monotonic prices
    nonmono_snap = SimpleNamespace(
        mid_price=2684.50,
        effective_buy_price_1k=2690.00,  # Higher than 5k!
        effective_sell_price_1k=2683.80,
        effective_buy_price_5k=2686.40,
        effective_sell_price_5k=2682.60,
        effective_buy_price_10k=2687.80,
        effective_sell_price_10k=2681.20,
        spread_bps=52.0,
        slippage_1k_bps=26.0,
        slippage_5k_bps=70.0,
        slippage_10k_bps=120.0,
        tvl_usd=50000000,
        volume_24h=10000000
    )
    
    result = validate_snapshot(nonmono_snap)
    print(f"Non-monotonic snapshot: ok={result.ok}, warnings={result.warnings}, errors={result.errors}")
