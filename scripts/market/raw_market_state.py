"""
RawMarketState — Normalized intermediate schema.

Every Redis adapter outputs this. Nothing downstream touches
raw Redis payloads directly. If a field is missing, the adapter
fills None and emits a TELEMETRY_WARNING — it does NOT guess.

Rule: missing critical fields → return None from adapter (don't poison pipeline).
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


@dataclass
class RawMarketState:
    """
    Normalized market state from any venue fetcher.

    Produced by: redis_adapters/{venue}.py
    Consumed by: snapshot_collector.py → MarketSnapshotV1
    """

    # --- Identity ---
    chain_id: str           # e.g. "eth"
    venue_id: str           # e.g. "uniswap_v3", "sushiswap_v2"
    market_id: str          # pool address (lowercase)
    pair: str               # e.g. "ETH/USDC"
    base_token: str         # e.g. "ETH"
    quote_token: str        # e.g. "USDC"

    # --- Timing ---
    ts_ms: int              # Unix ms when fetcher wrote to Redis
    block_ref: int          # 0 if unavailable (adapter must warn)

    # --- Mid price ---
    mid_px: float           # best single-number price (quote per base)

    # --- Tiered prices (None = not available from this source) ---
    buy_px_1k:  Optional[float] = None
    sell_px_1k: Optional[float] = None
    buy_px_5k:  Optional[float] = None
    sell_px_5k: Optional[float] = None
    buy_px_10k: Optional[float] = None
    sell_px_10k: Optional[float] = None

    # --- Slippage proxies (bps; None = not computed) ---
    slippage_bps_1k:  Optional[float] = None
    slippage_bps_5k:  Optional[float] = None
    slippage_bps_10k: Optional[float] = None

    # --- Costs ---
    swap_fee_bps: float = 30.0   # pool fee in basis points

    # --- Liquidity ---
    tvl_usd: Optional[float] = None
    liquidity_raw: Optional[int] = None   # V3 liquidity tick / V2 reserve product

    # --- Pool state (for simulator) ---
    # V2: {"reserve0": int, "reserve1": int, "token0_decimals": int, "token1_decimals": int}
    # V3: {"sqrt_price_x96": int, "liquidity": int, "tick": int, "fee": int}
    pool_state: Optional[Dict[str, Any]] = None

    # --- Provenance ---
    adapter_version: str = "1.0"
    warnings: list = field(default_factory=list)   # list of warning codes emitted


    # ------------------------------------------------------------------
    # Convenience helpers
    # ------------------------------------------------------------------

    def has_pool_state(self) -> bool:
        return self.pool_state is not None and len(self.pool_state) > 0

    def is_block_ref_missing(self) -> bool:
        return self.block_ref == 0

    def spread_bps_mid_only(self, other: "RawMarketState") -> Optional[float]:
        """
        Quick cross-venue spread in bps using mid prices only.
        Returns positive if self is cheaper (buy self, sell other).
        Returns None if either mid_px is zero/missing.
        """
        if not self.mid_px or not other.mid_px:
            return None
        return ((other.mid_px - self.mid_px) / self.mid_px) * 10_000
