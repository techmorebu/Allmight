"""
validator.py
============
Cross-oracle price validator for Allmight.

Takes prices from multiple oracles and:
1. Checks consensus (do they agree within tolerance?)
2. Flags outliers
3. Returns a consensus price with confidence score
4. Compares your detected arb edge vs oracle quotes

This is the "sanity check" layer before execution.
If your edge looks better than ALL oracles → investigate manually.
If your edge matches oracles → you're competitive.

Usage:
    from scripts.oracles.registry import get_registry
    from scripts.oracles.validator import OracleValidator

    registry = get_registry()
    validator = OracleValidator(registry)

    result = validator.validate_price("WETH", "USDC")
    if result.has_consensus:
        print(f"Consensus: ${result.consensus_price:.2f}")
        print(f"Confidence: {result.confidence:.1%}")
"""

import logging
import statistics
from dataclasses import dataclass, field
from typing import List, Optional, Dict

from base_oracle import OraclePrice
from registry import OracleRegistry

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  Result dataclasses
# ─────────────────────────────────────────────

@dataclass
class OracleConsensus:
    """
    Result from validate_price().
    Always returned — check has_consensus before using consensus_price.
    """
    base_token: str
    quote_token: str
    chain_id: str

    # Core result
    has_consensus: bool         # True if oracles agree within tolerance
    consensus_price: float      # Median of non-outlier prices (0.0 if no consensus)
    confidence: float           # 0.0 to 1.0 (ratio of agreeing oracles)

    # Raw data
    prices_used: List[OraclePrice]       # All valid prices fetched
    outliers: List[OraclePrice]          # Prices rejected as outliers
    price_spread_pct: float              # Max deviation from median (%)

    # Metadata
    oracles_queried: int
    oracles_responded: int
    reason: str = ""            # Human-readable explanation if no consensus


@dataclass
class EdgeValidation:
    """
    Result from validate_edge().
    Compares your detected arb edge vs oracle quotes.
    """
    your_edge_bps: float
    oracle_prices: List[OraclePrice]
    consensus: OracleConsensus

    # Verdicts
    edge_is_plausible: bool     # Edge is within reason given oracle data
    edge_is_suspicious: bool    # Edge looks too good — verify manually
    edge_is_competitive: bool   # You're at or better than oracle quotes

    # Details
    implied_oracle_edge_bps: float   # Edge implied by oracle price spread
    delta_bps: float                 # your_edge_bps - implied_oracle_edge_bps
    warning_message: str = ""


# ─────────────────────────────────────────────
#  Validator
# ─────────────────────────────────────────────

class OracleValidator:
    """
    Cross-oracle consensus validator.

    Fetches from all registered oracles and computes consensus.
    Use validate_edge() to sanity-check your arbitrage detector's output.
    """

    # Prices within this % of median are considered in-consensus
    DEFAULT_CONSENSUS_TOLERANCE_PCT: float = 1.0   # 1%

    # Need at least this many responding oracles for consensus
    DEFAULT_MIN_ORACLES: int = 2

    # Edge this many bps better than ALL oracles → suspicious
    SUSPICIOUS_EDGE_BUFFER_BPS: float = 20.0

    def __init__(self, registry: OracleRegistry,
                 consensus_tolerance_pct: Optional[float] = None,
                 min_oracles: Optional[int] = None):
        self.registry = registry
        self.tolerance_pct = consensus_tolerance_pct or self.DEFAULT_CONSENSUS_TOLERANCE_PCT
        self.min_oracles = min_oracles or self.DEFAULT_MIN_ORACLES

    def validate_price(self, base_token: str, quote_token: str,
                       chain_id: str = "arbitrum") -> OracleConsensus:
        """
        Fetch from all oracles and compute consensus price.

        Args:
            base_token:  e.g. "WETH"
            quote_token: e.g. "USDC"
            chain_id:    e.g. "arbitrum"

        Returns:
            OracleConsensus — always returned, check has_consensus first
        """
        oracles_queried = self.registry.count()
        prices = self.registry.fetch_all(base_token, quote_token, chain_id)

        base_result = dict(
            base_token=base_token,
            quote_token=quote_token,
            chain_id=chain_id,
            oracles_queried=oracles_queried,
            oracles_responded=len(prices),
        )

        # Not enough responses
        if len(prices) < self.min_oracles:
            logger.warning(
                f"[OracleValidator] Only {len(prices)}/{oracles_queried} "
                f"oracles responded for {base_token}/{quote_token} "
                f"(need {self.min_oracles})"
            )
            return OracleConsensus(
                **base_result,
                has_consensus=False,
                consensus_price=0.0,
                confidence=0.0,
                prices_used=prices,
                outliers=[],
                price_spread_pct=0.0,
                reason=f"Insufficient oracle responses: {len(prices)}/{self.min_oracles} needed",
            )

        # Compute median and filter outliers
        raw_prices = [p.price for p in prices]
        median_price = statistics.median(raw_prices)

        in_consensus = []
        outliers = []
        for p in prices:
            deviation_pct = abs(p.price - median_price) / median_price * 100
            if deviation_pct <= self.tolerance_pct:
                in_consensus.append(p)
            else:
                outliers.append(p)
                logger.debug(
                    f"[OracleValidator] Outlier from {p.oracle_id}: "
                    f"{p.price:.4f} ({deviation_pct:.2f}% from median {median_price:.4f})"
                )

        if not in_consensus:
            return OracleConsensus(
                **base_result,
                has_consensus=False,
                consensus_price=0.0,
                confidence=0.0,
                prices_used=prices,
                outliers=outliers,
                price_spread_pct=_spread_pct(raw_prices),
                reason="All prices are outliers — no consensus possible",
            )

        consensus_price = statistics.median([p.price for p in in_consensus])
        confidence = len(in_consensus) / len(prices)

        logger.info(
            f"[OracleValidator] {base_token}/{quote_token} consensus: "
            f"${consensus_price:.4f} "
            f"(confidence={confidence:.1%}, "
            f"agreeing={len(in_consensus)}/{len(prices)}, "
            f"outliers={len(outliers)})"
        )

        return OracleConsensus(
            **base_result,
            has_consensus=True,
            consensus_price=consensus_price,
            confidence=confidence,
            prices_used=prices,
            outliers=outliers,
            price_spread_pct=_spread_pct(raw_prices),
            reason="OK",
        )

    def validate_edge(self, your_edge_bps: float,
                      base_token: str, quote_token: str,
                      chain_id: str = "arbitrum") -> EdgeValidation:
        """
        Compare your detected arb edge against oracle consensus.

        Interpretation:
            edge_is_plausible=True   → proceed normally
            edge_is_suspicious=True  → pause, inspect manually
            edge_is_competitive=True → you're at least as good as oracle routing

        Args:
            your_edge_bps: Your detected edge in basis points
            base_token:    e.g. "WETH"
            quote_token:   e.g. "USDC"
            chain_id:      e.g. "arbitrum"
        """
        consensus = self.validate_price(base_token, quote_token, chain_id)

        if not consensus.has_consensus or not consensus.prices_used:
            return EdgeValidation(
                your_edge_bps=your_edge_bps,
                oracle_prices=consensus.prices_used,
                consensus=consensus,
                edge_is_plausible=True,   # Can't invalidate without data
                edge_is_suspicious=False,
                edge_is_competitive=False,
                implied_oracle_edge_bps=0.0,
                delta_bps=0.0,
                warning_message="No oracle consensus — cannot validate edge",
            )

        # Implied oracle edge = price spread across oracle quotes in bps
        prices = [p.price for p in consensus.prices_used]
        if len(prices) >= 2:
            price_min = min(prices)
            price_max = max(prices)
            implied_edge_bps = ((price_max - price_min) / price_min) * 10_000
        else:
            implied_edge_bps = 0.0

        delta_bps = your_edge_bps - implied_edge_bps

        # Suspicious: you see significantly more edge than any oracle spread implies
        edge_is_suspicious = delta_bps > self.SUSPICIOUS_EDGE_BUFFER_BPS

        # Competitive: you're within range of oracle-implied edge
        edge_is_competitive = your_edge_bps >= implied_edge_bps * 0.8

        # Plausible: not suspicious and positive
        edge_is_plausible = (your_edge_bps > 0) and not edge_is_suspicious

        warning = ""
        if edge_is_suspicious:
            warning = (
                f"Edge {your_edge_bps:.1f}bps is {delta_bps:.1f}bps better than "
                f"oracle-implied {implied_edge_bps:.1f}bps — verify manually before execution"
            )
            logger.warning(f"[OracleValidator] SUSPICIOUS EDGE: {warning}")

        return EdgeValidation(
            your_edge_bps=your_edge_bps,
            oracle_prices=consensus.prices_used,
            consensus=consensus,
            edge_is_plausible=edge_is_plausible,
            edge_is_suspicious=edge_is_suspicious,
            edge_is_competitive=edge_is_competitive,
            implied_oracle_edge_bps=implied_edge_bps,
            delta_bps=delta_bps,
            warning_message=warning,
        )


# ─────────────────────────────────────────────
#  Helpers
# ─────────────────────────────────────────────

def _spread_pct(prices: List[float]) -> float:
    """Max deviation from median as percentage."""
    if not prices:
        return 0.0
    med = statistics.median(prices)
    if med == 0:
        return 0.0
    return max(abs(p - med) / med * 100 for p in prices)
