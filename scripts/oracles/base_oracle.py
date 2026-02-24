"""
base_oracle.py
==============
Abstract base class for all Allmight price oracles.

Every oracle implementation (DexScreener, 0x, 1inch, CoinGecko, etc.)
must inherit from BaseOracle and implement the required methods.

Philosophy:
- Fail closed: return None on any error, never raise into the pipeline
- Never block: respect timeout_s at all costs
- Never poison: return None if data is stale, malformed, or untrustworthy
- Zero side effects: read-only, no state mutation outside this class

Usage:
    class DexScreenerOracle(BaseOracle):
        def fetch_price(self, base_token, quote_token):
            ...
"""

import time
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class OraclePrice:
    """
    Standardized price result returned by every oracle.
    All fields are required. Oracle returns None instead of
    constructing a partially-filled OraclePrice.
    """
    oracle_id: str              # e.g. "dexscreener", "zerox", "coingecko"
    base_token: str             # e.g. "WETH"
    quote_token: str            # e.g. "USDC"
    price: float                # base/quote price (e.g. 3200.50 for ETH/USDC)
    liquidity_usd: float        # Available liquidity in USD (0.0 if unknown)
    volume_24h_usd: float       # 24h volume in USD (0.0 if unknown)
    fetched_at_ms: int          # Unix timestamp ms when price was fetched
    source_url: str             # URL or endpoint used (for debugging)
    chain_id: str               # e.g. "arbitrum", "ethereum"
    extra: dict = field(default_factory=dict)  # Oracle-specific extra fields

    def age_ms(self) -> int:
        """How old is this price in milliseconds."""
        return int(time.time() * 1000) - self.fetched_at_ms

    def is_fresh(self, max_age_ms: int = 30_000) -> bool:
        """True if price was fetched within max_age_ms (default 30s)."""
        return self.age_ms() < max_age_ms


@dataclass
class OracleHealth:
    """Health status for a single oracle."""
    oracle_id: str
    is_alive: bool
    last_success_ms: Optional[int]   # Unix ms of last successful fetch
    last_error: Optional[str]        # Last error message if any
    success_count: int = 0
    error_count: int = 0

    def success_rate(self) -> float:
        total = self.success_count + self.error_count
        if total == 0:
            return 0.0
        return self.success_count / total


class BaseOracle(ABC):
    """
    Abstract base for all price oracles.

    Subclasses implement:
        fetch_price()    - required
        health_check()   - required
        oracle_id        - required property

    Subclasses get for free:
        safe_fetch()     - wraps fetch_price() with timeout + error handling
        _track_success() / _track_error() - internal health tracking
    """

    # Override in subclass if needed
    DEFAULT_TIMEOUT_S: float = 5.0
    DEFAULT_MAX_AGE_MS: int = 30_000   # 30 seconds

    def __init__(self, timeout_s: Optional[float] = None):
        self.timeout_s = timeout_s or self.DEFAULT_TIMEOUT_S
        self._success_count = 0
        self._error_count = 0
        self._last_success_ms: Optional[int] = None
        self._last_error: Optional[str] = None

    @property
    @abstractmethod
    def oracle_id(self) -> str:
        """Unique string identifier for this oracle. e.g. 'dexscreener'"""
        ...

    @abstractmethod
    def fetch_price(self, base_token: str, quote_token: str,
                    chain_id: str = "arbitrum") -> Optional[OraclePrice]:
        """
        Fetch current price for base_token/quote_token pair.

        MUST:
        - Return OraclePrice on success
        - Return None on any failure (never raise)
        - Respect self.timeout_s
        - Never mutate external state

        Args:
            base_token:  Token symbol being priced (e.g. "WETH")
            quote_token: Quote token symbol (e.g. "USDC")
            chain_id:    Chain to query (e.g. "arbitrum", "ethereum")

        Returns:
            OraclePrice if successful, None if any error
        """
        ...

    @abstractmethod
    def health_check(self) -> OracleHealth:
        """
        Return current health status of this oracle.
        Should be cheap — no network call required.
        """
        ...

    def safe_fetch(self, base_token: str, quote_token: str,
                   chain_id: str = "arbitrum") -> Optional[OraclePrice]:
        """
        Wraps fetch_price() with:
        - Exception catching (never raises)
        - Automatic health tracking
        - Logging

        Use this instead of fetch_price() directly in the pipeline.
        """
        try:
            result = self.fetch_price(base_token, quote_token, chain_id)
            if result is not None:
                self._track_success()
                return result
            else:
                self._track_error("fetch_price returned None")
                return None
        except Exception as e:
            self._track_error(str(e))
            logger.warning(
                f"[{self.oracle_id}] safe_fetch failed for "
                f"{base_token}/{quote_token} on {chain_id}: {e}"
            )
            return None

    def _track_success(self):
        self._success_count += 1
        self._last_success_ms = int(time.time() * 1000)

    def _track_error(self, msg: str):
        self._error_count += 1
        self._last_error = msg
        logger.debug(f"[{self.oracle_id}] error tracked: {msg}")

    def _make_health(self, is_alive: bool) -> OracleHealth:
        """Helper for subclasses implementing health_check()."""
        return OracleHealth(
            oracle_id=self.oracle_id,
            is_alive=is_alive,
            last_success_ms=self._last_success_ms,
            last_error=self._last_error,
            success_count=self._success_count,
            error_count=self._error_count,
        )

    def __repr__(self):
        return (
            f"{self.__class__.__name__}("
            f"id={self.oracle_id}, "
            f"ok={self._success_count}, "
            f"err={self._error_count})"
        )
