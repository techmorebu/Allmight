"""
scripts/oracles/__init__.py
===========================
Public API for the Allmight oracle framework.

Import from here — don't import submodules directly in pipeline code.

Quick start:
    from scripts.oracles import get_registry, OracleValidator, StubOracle

    registry = get_registry()
    registry.register(StubOracle())              # for testing
    validator = OracleValidator(registry)

    result = validator.validate_price("WETH", "USDC")
    print(result.consensus_price)

Adding a real oracle:
    from scripts.oracles.implementations.dexscreener_oracle import DexScreenerOracle

    registry.register(DexScreenerOracle())
    # That's it. validate_price() will now include DexScreener automatically.
"""

import time
import logging
from typing import Optional

from base_oracle import BaseOracle, OraclePrice, OracleHealth
from registry import OracleRegistry, get_registry, reset_registry
from validator import OracleValidator, OracleConsensus, EdgeValidation

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
#  StubOracle — for testing only
# ─────────────────────────────────────────────

class StubOracle(BaseOracle):
    """
    Stub oracle that returns configurable fake prices.

    Used for:
    - Testing the registry and validator without network calls
    - Verifying scaffold wiring before implementing real oracles
    - Unit tests

    NOT for production use.
    """

    STUB_PRICES = {
        ("WETH", "USDC"): 3200.00,
        ("WBTC", "USDC"): 65000.00,
        ("WETH", "USDT"): 3201.50,
        ("USDC", "USDT"): 1.0002,
        ("DAI",  "USDC"): 0.9998,
    }

    def __init__(self, price_override: Optional[float] = None,
                 fail_mode: bool = False):
        """
        Args:
            price_override: If set, always return this price regardless of pair
            fail_mode:      If True, always return None (simulates broken oracle)
        """
        super().__init__(timeout_s=1.0)
        self.price_override = price_override
        self.fail_mode = fail_mode

    @property
    def oracle_id(self) -> str:
        return "stub"

    def fetch_price(self, base_token: str, quote_token: str,
                    chain_id: str = "arbitrum") -> Optional[OraclePrice]:
        if self.fail_mode:
            return None

        price = self.price_override
        if price is None:
            key = (base_token.upper(), quote_token.upper())
            price = self.STUB_PRICES.get(key)
            if price is None:
                # Unknown pair — return None like a real oracle would
                logger.debug(
                    f"[StubOracle] No stub price for {base_token}/{quote_token}"
                )
                return None

        return OraclePrice(
            oracle_id=self.oracle_id,
            base_token=base_token,
            quote_token=quote_token,
            price=price,
            liquidity_usd=1_000_000.0,
            volume_24h_usd=5_000_000.0,
            fetched_at_ms=int(time.time() * 1000),
            source_url="stub://localhost",
            chain_id=chain_id,
            extra={"is_stub": True},
        )

    def health_check(self) -> OracleHealth:
        return self._make_health(is_alive=not self.fail_mode)


# ─────────────────────────────────────────────
#  Public re-exports
# ─────────────────────────────────────────────

__all__ = [
    # Core types
    "BaseOracle",
    "OraclePrice",
    "OracleHealth",
    # Registry
    "OracleRegistry",
    "get_registry",
    "reset_registry",
    # Validator
    "OracleValidator",
    "OracleConsensus",
    "EdgeValidation",
    # Stubs
    "StubOracle",
]
