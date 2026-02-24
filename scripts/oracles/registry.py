"""
registry.py
===========
Oracle registry for Allmight.

Manages all registered oracle implementations.
Provides lookup, health monitoring, and iteration.

Design rules:
- Oracles are registered by ID string
- Registry never calls network itself
- Thread-safe reads (register during startup only)
- All oracle calls go through safe_fetch() — never raw fetch_price()

Usage:
    from scripts.oracles.registry import get_registry
    from scripts.oracles.implementations.dexscreener_oracle import DexScreenerOracle

    registry = get_registry()
    registry.register(DexScreenerOracle())

    price = registry.fetch("dexscreener", "WETH", "USDC")
    all_prices = registry.fetch_all("WETH", "USDC")
"""

import logging
from typing import Dict, List, Optional, Type

from base_oracle import BaseOracle, OraclePrice, OracleHealth

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
#  Singleton registry instance
# ─────────────────────────────────────────────
_REGISTRY: Optional["OracleRegistry"] = None


def get_registry() -> "OracleRegistry":
    """Return the singleton OracleRegistry. Creates it on first call."""
    global _REGISTRY
    if _REGISTRY is None:
        _REGISTRY = OracleRegistry()
    return _REGISTRY


def reset_registry():
    """Reset singleton — use in tests only."""
    global _REGISTRY
    _REGISTRY = None


# ─────────────────────────────────────────────
#  Registry
# ─────────────────────────────────────────────
class OracleRegistry:
    """
    Central registry for all price oracle instances.

    Lifecycle:
        1. On startup: call register() for each enabled oracle
        2. During runtime: call fetch() or fetch_all()
        3. For monitoring: call health_report()

    Never instantiate more than one — use get_registry().
    """

    def __init__(self):
        self._oracles: Dict[str, BaseOracle] = {}
        logger.info("[OracleRegistry] initialized (empty)")

    # ── Registration ──────────────────────────

    def register(self, oracle: BaseOracle) -> None:
        """
        Register an oracle instance.

        Call once per oracle during system startup.
        Overwrites any existing oracle with the same ID (logs a warning).

        Args:
            oracle: Instantiated oracle implementing BaseOracle
        """
        oid = oracle.oracle_id
        if oid in self._oracles:
            logger.warning(
                f"[OracleRegistry] Overwriting existing oracle '{oid}'"
            )
        self._oracles[oid] = oracle
        logger.info(f"[OracleRegistry] Registered oracle: '{oid}'")

    def unregister(self, oracle_id: str) -> bool:
        """Remove oracle by ID. Returns True if it existed."""
        if oracle_id in self._oracles:
            del self._oracles[oracle_id]
            logger.info(f"[OracleRegistry] Unregistered oracle: '{oracle_id}'")
            return True
        return False

    # ── Fetching ──────────────────────────────

    def fetch(self, oracle_id: str, base_token: str, quote_token: str,
              chain_id: str = "arbitrum") -> Optional[OraclePrice]:
        """
        Fetch price from a specific oracle by ID.

        Returns None if oracle not found or fetch fails.
        Always uses safe_fetch() — never raises.
        """
        oracle = self._oracles.get(oracle_id)
        if oracle is None:
            logger.warning(
                f"[OracleRegistry] fetch() called for unknown oracle '{oracle_id}'"
            )
            return None
        return oracle.safe_fetch(base_token, quote_token, chain_id)

    def fetch_all(self, base_token: str, quote_token: str,
                  chain_id: str = "arbitrum",
                  min_fresh_ms: int = 30_000) -> List[OraclePrice]:
        """
        Fetch price from ALL registered oracles.

        Returns list of successful, fresh OraclePrices.
        Failed oracles are silently skipped (logged at DEBUG).

        Args:
            base_token:   Token being priced
            quote_token:  Quote token
            chain_id:     Chain to query
            min_fresh_ms: Drop results older than this (ms)

        Returns:
            List of OraclePrice, may be empty if all fail
        """
        results = []
        for oid, oracle in self._oracles.items():
            price = oracle.safe_fetch(base_token, quote_token, chain_id)
            if price is None:
                logger.debug(
                    f"[OracleRegistry] {oid} returned None for "
                    f"{base_token}/{quote_token}"
                )
                continue
            if not price.is_fresh(min_fresh_ms):
                logger.debug(
                    f"[OracleRegistry] {oid} price is stale "
                    f"(age={price.age_ms()}ms)"
                )
                continue
            results.append(price)

        logger.debug(
            f"[OracleRegistry] fetch_all {base_token}/{quote_token}: "
            f"{len(results)}/{len(self._oracles)} oracles responded"
        )
        return results

    # ── Health & Introspection ─────────────────

    def health_report(self) -> Dict[str, OracleHealth]:
        """
        Return health status for all registered oracles.
        Cheap — no network calls.
        """
        return {
            oid: oracle.health_check()
            for oid, oracle in self._oracles.items()
        }

    def list_oracle_ids(self) -> List[str]:
        """Return list of all registered oracle IDs."""
        return list(self._oracles.keys())

    def count(self) -> int:
        """Number of registered oracles."""
        return len(self._oracles)

    def is_registered(self, oracle_id: str) -> bool:
        return oracle_id in self._oracles

    def __repr__(self):
        ids = list(self._oracles.keys())
        return f"OracleRegistry(oracles={ids})"
