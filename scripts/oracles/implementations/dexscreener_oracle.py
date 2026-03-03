#!/usr/bin/env python3
"""
scripts/oracles/implementations/dexscreener_oracle.py

DexScreener oracle -- free, no API key, real-time DEX data.
Covers 70+ DEXs across Arbitrum, Ethereum, Base, Polygon, BSC.

What this adds vs current system:
  - Discovers new trading pairs automatically (not just ETH/USDT)
  - Cross-validates prices from our on-chain fetchers
  - Surfaces high-volume pairs worth monitoring
  - Identifies new venues (Camelot, GMX, Balancer, etc.)

Usage:
  from scripts.oracles.implementations.dexscreener_oracle import DexScreenerOracle
  oracle = DexScreenerOracle()
  price  = oracle.safe_fetch("WETH", "USDC", "arbitrum")
  pairs  = oracle.discover_pairs("arbitrum", min_volume_24h=100_000)
"""

import time
import json
import logging
import requests
from typing import Optional, List, Dict
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(ROOT))

sys.path.insert(0, str(ROOT / "scripts" / "oracles"))
from base_oracle import BaseOracle, OraclePrice, OracleHealth

logger = logging.getLogger(__name__)

# DexScreener chain IDs
CHAIN_MAP = {
    "arbitrum":  "arbitrum",
    "ethereum":  "ethereum",
    "base":      "base",
    "polygon":   "polygon",
    "bsc":       "bsc",
    "optimism":  "optimism",
}

# Token addresses on Arbitrum (for pair lookup)
TOKEN_ADDRESSES = {
    "arbitrum": {
        "WETH":  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
        "USDT":  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
        "USDC":  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        "USDC.e":"0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        "WBTC":  "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
        "ARB":   "0x912CE59144191C1204E64559FE8253a0e49E6548",
        "GMX":   "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a",
        "DAI":   "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    }
}

# Venues we care about on Arbitrum
KNOWN_VENUES = {
    "uniswap v3":   "uniswap_v3",
    "uniswap_v3":   "uniswap_v3",
    "curve":        "curve",
    "sushiswap":    "sushiswap",
    "camelot v3":   "camelot_v3",
    "camelot":      "camelot",
    "balancer v2":  "balancer_v2",
    "balancer":     "balancer_v2",
    "gmx":          "gmx",
    "trader joe":   "traderjoe",
    "zyberswap":    "zyberswap",
    "ramses":       "ramses",
}


class DexScreenerOracle(BaseOracle):
    """
    DexScreener price oracle.
    Free, no API key, 300 req/min rate limit.
    """

    DEFAULT_TIMEOUT_S = 5.0
    BASE_URL = "https://api.dexscreener.com/latest/dex"

    @property
    def oracle_id(self) -> str:
        return "dexscreener"

    # ── Primary: fetch single price ───────────────────────────────────────────

    def fetch_price(self, base_token: str, quote_token: str,
                    chain_id: str = "arbitrum") -> Optional[OraclePrice]:
        """
        Fetch best price for base_token/quote_token from DexScreener.
        Returns highest-liquidity pool result.
        """
        chain = CHAIN_MAP.get(chain_id, chain_id)
        addrs = TOKEN_ADDRESSES.get(chain_id, {})

        # Resolve token address
        base_addr = addrs.get(base_token.upper())
        if not base_addr:
            logger.debug(f"[dexscreener] No address for {base_token} on {chain_id}")
            return None

        url = f"{self.BASE_URL}/tokens/{base_addr}"
        try:
            r = requests.get(url, timeout=self.timeout_s)
            if r.status_code != 200:
                logger.debug(f"[dexscreener] HTTP {r.status_code} for {base_token}")
                return None
            data = r.json()
        except Exception as e:
            logger.debug(f"[dexscreener] Request failed: {e}")
            return None

        pairs = data.get("pairs") or []
        if not pairs:
            return None

        # Filter to correct chain and quote token
        qt = quote_token.upper()
        matching = [
            p for p in pairs
            if p.get("chainId", "").lower() == chain
            and (p.get("quoteToken", {}).get("symbol", "").upper() == qt
                 or p.get("baseToken", {}).get("symbol", "").upper() == qt)
        ]

        if not matching:
            # Fallback: any pair on this chain
            matching = [p for p in pairs if p.get("chainId", "").lower() == chain]

        if not matching:
            return None

        # Pick highest liquidity
        best = max(matching, key=lambda p: float(p.get("liquidity", {}).get("usd", 0) or 0))

        try:
            price_usd  = float(best.get("priceUsd", 0) or 0)
            liq_usd    = float(best.get("liquidity", {}).get("usd", 0) or 0)
            vol_24h    = float(best.get("volume", {}).get("h24", 0) or 0)
            dex_id     = best.get("dexId", "unknown")
            pair_addr  = best.get("pairAddress", "")

            if price_usd <= 0:
                return None

            return OraclePrice(
                oracle_id     = self.oracle_id,
                base_token    = base_token.upper(),
                quote_token   = quote_token.upper(),
                price         = price_usd,
                liquidity_usd = liq_usd,
                volume_24h_usd= vol_24h,
                fetched_at_ms = int(time.time() * 1000),
                source_url    = url,
                chain_id      = chain_id,
                extra         = {
                    "dex_id":     dex_id,
                    "pair_addr":  pair_addr,
                    "price_change_24h": best.get("priceChange", {}).get("h24", 0),
                    "txns_24h":   best.get("txns", {}).get("h24", {}).get("buys", 0),
                },
            )
        except Exception as e:
            logger.debug(f"[dexscreener] Parse error: {e}")
            return None

    # ── Discovery: find new profitable pairs ──────────────────────────────────

    def discover_pairs(self, chain_id: str = "arbitrum",
                       min_volume_24h: float = 50_000,
                       min_liquidity: float = 100_000,
                       max_results: int = 50) -> List[Dict]:
        """
        Discover high-volume pairs on a chain worth monitoring for arbitrage.

        Returns list of dicts with:
            pair, buy_venue, sell_venue, volume_24h, liquidity_usd,
            price_usd, dex_id, pair_address
        """
        chain  = CHAIN_MAP.get(chain_id, chain_id)
        # DexScreener search: top pairs on chain
        url    = f"{self.BASE_URL}/search?q={chain}"

        try:
            r = requests.get(url, timeout=self.timeout_s * 2)
            if r.status_code != 200:
                return []
            data  = r.json()
            pairs = data.get("pairs") or []
        except Exception as e:
            logger.debug(f"[dexscreener] discover_pairs failed: {e}")
            return []

        results = []
        seen_pairs = set()

        for p in pairs:
            if p.get("chainId", "").lower() != chain:
                continue

            vol    = float(p.get("volume", {}).get("h24", 0) or 0)
            liq    = float(p.get("liquidity", {}).get("usd", 0) or 0)

            if vol < min_volume_24h or liq < min_liquidity:
                continue

            base_sym  = p.get("baseToken", {}).get("symbol", "").upper()
            quote_sym = p.get("quoteToken", {}).get("symbol", "").upper()
            dex_id    = p.get("dexId", "unknown").lower()
            venue     = KNOWN_VENUES.get(dex_id, dex_id)

            pair_key = f"{base_sym}/{quote_sym}"
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            try:
                price = float(p.get("priceUsd", 0) or 0)
                results.append({
                    "pair":         pair_key,
                    "base_token":   base_sym,
                    "quote_token":  quote_sym,
                    "venue":        venue,
                    "dex_id":       dex_id,
                    "volume_24h":   vol,
                    "liquidity_usd":liq,
                    "price_usd":    price,
                    "pair_address": p.get("pairAddress", ""),
                    "price_change_24h": float(p.get("priceChange", {}).get("h24", 0) or 0),
                    "chain_id":     chain_id,
                })
            except: continue

        # Sort by volume descending
        results.sort(key=lambda x: x["volume_24h"], reverse=True)
        return results[:max_results]

    # ── Cross-validate our fetcher prices ─────────────────────────────────────

    def validate_edge(self, buy_price: float, sell_price: float,
                      base_token: str, quote_token: str,
                      chain_id: str = "arbitrum") -> Dict:
        """
        Cross-check a detected edge against DexScreener's reference price.
        Returns validation result dict.
        """
        ref = self.safe_fetch(base_token, quote_token, chain_id)
        if ref is None:
            return {"valid": True, "reason": "no_reference", "ref_price": None}

        ref_price = ref.price
        mid_price = (buy_price + sell_price) / 2
        deviation_pct = abs(mid_price - ref_price) / ref_price * 100

        # Flag if our mid-price deviates >2% from DexScreener reference
        suspicious = deviation_pct > 2.0

        return {
            "valid":         not suspicious,
            "reason":        "price_deviation" if suspicious else "ok",
            "ref_price":     ref_price,
            "our_mid_price": mid_price,
            "deviation_pct": round(deviation_pct, 3),
            "liquidity_usd": ref.liquidity_usd,
            "volume_24h":    ref.volume_24h_usd,
        }

    # ── Health check ──────────────────────────────────────────────────────────

    def health_check(self) -> OracleHealth:
        try:
            r = requests.get(
                f"{self.BASE_URL}/tokens/0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
                timeout=3.0
            )
            alive = r.status_code == 200 and bool(r.json().get("pairs"))
        except:
            alive = False
        return self._make_health(alive)


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)

    oracle = DexScreenerOracle()

    print("\n" + "="*56)
    print("  DexScreener Oracle -- Live Test")
    print("="*56)

    # Health
    h = oracle.health_check()
    print(f"\n  Health: {'OK' if h.is_alive else 'FAIL'}")

    # Price fetch
    print("\n  Fetching ETH/USDT on Arbitrum...")
    price = oracle.safe_fetch("WETH", "USDT", "arbitrum")
    if price:
        print(f"  Price:       ${price.price:,.2f}")
        print(f"  Liquidity:   ${price.liquidity_usd:,.0f}")
        print(f"  Volume 24h:  ${price.volume_24h_usd:,.0f}")
        print(f"  DEX:         {price.extra.get('dex_id')}")
        print(f"  Age:         {price.age_ms()}ms")
    else:
        print("  FAIL: no price returned")

    # Discover pairs
    print("\n  Discovering top pairs on Arbitrum...")
    pairs = oracle.discover_pairs("arbitrum", min_volume_24h=100_000, max_results=10)
    print(f"  Found {len(pairs)} pairs above $100k/24h volume:\n")
    for p in pairs:
        print(f"    {p['pair']:<14} {p['venue']:<18} "
              f"vol=${p['volume_24h']:>12,.0f}  "
              f"liq=${p['liquidity_usd']:>12,.0f}")

    # Validate edge
    print("\n  Validating sample edge (buy=2650, sell=2680)...")
    v = oracle.validate_edge(2650, 2680, "WETH", "USDT", "arbitrum")
    print(f"  Valid:       {v['valid']}")
    print(f"  Reason:      {v['reason']}")
    print(f"  Ref price:   ${v['ref_price']:,.2f}" if v['ref_price'] else "  Ref price:   N/A")
    print(f"  Deviation:   {v['deviation_pct']}%")
    print()
