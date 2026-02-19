#!/usr/bin/env python3
"""
Preflight Policy - Phase 2.4.1

Defines policy parameters for preflight accept/reject decisions.
All thresholds and safety buffer coefficients in one place.

Author: Allmight System
Phase: 2.4.1 - Preflight Module
"""

from dataclasses import dataclass
from typing import Set, Optional


@dataclass
class PreflightPolicyV1:
    """
    Preflight policy parameters (conservative defaults)
    
    These control when opportunities are accepted vs rejected.
    All values are tunable based on instrumentation feedback.
    """
    
    # === SAFETY BUFFER COEFFICIENTS ===
    base_buffer_bps: float = 5.0  # Base safety margin
    k_slippage: float = 0.20       # Slippage risk multiplier
    k_latency: float = 2.0          # Latency risk multiplier (bps per second)
    k_competition: float = 15.0     # Competition risk multiplier
    
    # === THRESHOLDS ===
    max_slippage_bps: float = 500.0     # 5% max slippage
    max_gas_bps: float = 200.0          # 2% max gas cost
    max_latency_ms: int = 5000          # 5 seconds max latency
    max_competition_density: float = 0.8  # 80% max competition
    
    # === ACCEPT LEVELS ===
    bundle_extra_bps: float = 10.0  # Extra margin needed for ACCEPT_BUNDLE
    
    # === DEFAULT FALLBACKS ===
    default_latency_ms: int = 200   # Default if not available
    default_gas_cost_usd: float = 5.0  # Default gas cost estimate
    
    # === POLICY RESTRICTIONS ===
    allowed_tiers: Set[int] = None  # None = all tiers allowed
    denied_venues: Set[str] = None  # Venue denylist
    denied_tokens: Set[str] = None  # Token denylist
    denied_markets: Set[str] = None  # Market denylist
    
    def __post_init__(self):
        """Initialize empty sets if None"""
        if self.allowed_tiers is None:
            self.allowed_tiers = {1000, 5000, 10000}
        if self.denied_venues is None:
            self.denied_venues = set()
        if self.denied_tokens is None:
            self.denied_tokens = set()
        if self.denied_markets is None:
            self.denied_markets = set()


# === DEFAULT POLICIES ===

CONSERVATIVE_POLICY = PreflightPolicyV1(
    base_buffer_bps=10.0,
    k_slippage=0.30,
    k_latency=3.0,
    k_competition=20.0,
    max_slippage_bps=300.0,
    max_gas_bps=150.0,
    bundle_extra_bps=15.0,
)

AGGRESSIVE_POLICY = PreflightPolicyV1(
    base_buffer_bps=3.0,
    k_slippage=0.10,
    k_latency=1.0,
    k_competition=10.0,
    max_slippage_bps=800.0,
    max_gas_bps=300.0,
    bundle_extra_bps=5.0,
)

DEFAULT_POLICY = PreflightPolicyV1()  # Medium defaults
