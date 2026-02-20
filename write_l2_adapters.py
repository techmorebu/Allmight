#!/usr/bin/env python3
"""
Writes:
  1. scripts/market/redis_adapters/arbitrum.py
  2. scripts/market/redis_adapters/base.py
  3. Updates scripts/market/redis_adapters/__init__.py to include new adapters
  4. Updates scripts/run_reality_check.py to scan L2 chains

Run: python3 write_l2_adapters.py
"""
import os, re

ROOT = os.path.expanduser("~/Allmight")

# ── 1. Arbitrum adapter ───────────────────────────────────────────────────────
ARBITRUM_ADAPTER = '''\
#!/usr/bin/env python3
"""
Redis adapter for arbitrumFetcher.js
Parses: fetcher:arbitrumFetcher → RawMarketState list
Venues: uniswap_v3, camelot_v2
Chain:  arbitrum
"""
import json
import redis as _redis
from scripts.market.raw_market_state import RawMarketState

REDIS_KEY = "fetcher:arbitrumFetcher"
CHAIN_ID  = "arbitrum"

# Fee bps by venue (fallback if not in payload)
_FEE_BPS = {
    "uniswap_v3": 5,    # default 0.05% — overridden per pool
    "camelot_v2": 30,
}

def _fee_to_bps(fee_decimal: float) -> float:
    """Convert decimal fee (0.05, 0.3) to basis points (5, 30)."""
    if fee_decimal is None:
        return 30.0
    if fee_decimal < 5:
        return fee_decimal * 100   # 0.05 → 5, 0.3 → 30
    return fee_decimal             # already bps


def load(r: _redis.Redis) -> list:
    """
    Load Arbitrum market data from Redis.
    Returns list of RawMarketState.
    """
    raw = r.get(REDIS_KEY)
    if not raw:
        return []

    payload = json.loads(raw)
    prices  = payload.get("data", {}).get("data", {}).get("prices", [])

    states = []
    for p in prices:
        try:
            venue   = p.get("venue", "uniswap_v3")
            fee_bps = _fee_to_bps(p.get("fee"))
            price   = float(p["price"])

            if price <= 0 or price > 1e12:
                continue

            state = RawMarketState(
                pair       = p["pair"],
                venue_id   = f"{venue}_{CHAIN_ID}",
                pool_id    = p.get("pool", ""),
                price      = price,
                fee_bps    = fee_bps,
                tvl_usd    = float(p.get("tvlUSD") or p.get("reserveUSD") or 0),
                reserve0   = p.get("reserve0"),
                reserve1   = p.get("reserve1"),
                chain      = CHAIN_ID,
                source     = p.get("source", "arbitrum_onchain"),
                timestamp  = p.get("timestamp", ""),
            )
            states.append(state)
        except (KeyError, ValueError, TypeError):
            continue

    return states
'''

# ── 2. Base adapter ───────────────────────────────────────────────────────────
BASE_ADAPTER = '''\
#!/usr/bin/env python3
"""
Redis adapter for baseFetcher.js
Parses: fetcher:baseFetcher → RawMarketState list
Venues: uniswap_v3, aerodrome
Chain:  base
"""
import json
import redis as _redis
from scripts.market.raw_market_state import RawMarketState

REDIS_KEY = "fetcher:baseFetcher"
CHAIN_ID  = "base"


def _fee_to_bps(fee_decimal: float) -> float:
    if fee_decimal is None:
        return 30.0
    if fee_decimal < 5:
        return fee_decimal * 100
    return fee_decimal


def load(r: _redis.Redis) -> list:
    """
    Load Base market data from Redis.
    Returns list of RawMarketState.
    """
    raw = r.get(REDIS_KEY)
    if not raw:
        return []

    payload = json.loads(raw)
    prices  = payload.get("data", {}).get("data", {}).get("prices", [])

    states = []
    for p in prices:
        try:
            venue   = p.get("venue", "uniswap_v3")
            fee_bps = _fee_to_bps(p.get("fee"))
            price   = float(p["price"])

            if price <= 0 or price > 1e12:
                continue

            state = RawMarketState(
                pair       = p["pair"],
                venue_id   = f"{venue}_{CHAIN_ID}",
                pool_id    = p.get("pool", ""),
                price      = price,
                fee_bps    = fee_bps,
                tvl_usd    = float(p.get("tvlUSD") or p.get("reserveUSD") or 0),
                reserve0   = p.get("reserve0"),
                reserve1   = p.get("reserve1"),
                chain      = CHAIN_ID,
                source     = p.get("source", "base_onchain"),
                timestamp  = p.get("timestamp", ""),
            )
            states.append(state)
        except (KeyError, ValueError, TypeError):
            continue

    return states
'''

# ── 3. __init__.py update ─────────────────────────────────────────────────────
INIT_CONTENT = '''\
"""
Redis adapters package.
Each adapter loads data from a specific fetcher's Redis key
and returns a list of RawMarketState objects.
"""
from scripts.market.redis_adapters.uniswap_v3   import load as load_uniswap_v3
from scripts.market.redis_adapters.sushiswap_v2 import load as load_sushiswap_v2
from scripts.market.redis_adapters.arbitrum     import load as load_arbitrum
from scripts.market.redis_adapters.base         import load as load_base

__all__ = [
    "load_uniswap_v3",
    "load_sushiswap_v2",
    "load_arbitrum",
    "load_base",
]
'''

# ── 4. Updated run_reality_check.py ──────────────────────────────────────────
RC1_CONTENT = '''\
#!/usr/bin/env python3
"""
RC-1 Reality Check — Multi-Chain
Scans mainnet + Arbitrum + Base for cross-venue arbitrage opportunities.

Usage:
  python3 scripts/run_reality_check.py --single --tier 1000
  python3 scripts/run_reality_check.py --single --tier 1000 --chain arbitrum
  python3 scripts/run_reality_check.py --single --tier 1000 --chain base
  python3 scripts/run_reality_check.py --single --tier 1000 --chain all
"""
import argparse
import sys
import os
from datetime import datetime
from collections import defaultdict

import redis

# ── path setup ────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.market.redis_adapters.uniswap_v3   import load as load_uniswap_v3
from scripts.market.redis_adapters.sushiswap_v2 import load as load_sushiswap_v2
from scripts.market.redis_adapters.arbitrum     import load as load_arbitrum
from scripts.market.redis_adapters.base         import load as load_base

# ── gas cost estimates (USD) by chain at common tiers ────────────────────────
# Conservative estimates. L2 gas is ~100x cheaper than mainnet.
GAS_USD = {
    "mainnet":  1.25,   # from oracle
    "arbitrum": 0.02,
    "base":     0.01,
}

CHAIN_LOADERS = {
    "mainnet":  [load_uniswap_v3, load_sushiswap_v2],
    "arbitrum": [load_arbitrum],
    "base":     [load_base],
}


def load_chain_states(r, chain: str) -> list:
    states = []
    for loader in CHAIN_LOADERS.get(chain, []):
        try:
            states.extend(loader(r))
        except Exception as e:
            print(f"  ⚠ Loader {loader.__name__} failed: {e}")
    return states


def gas_bps(chain: str, tier_usd: int) -> float:
    gas = GAS_USD.get(chain, 1.25)
    return (gas / tier_usd) * 10000


def check_chain(r, chain: str, tier_usd: int, verbose: bool = True):
    states = load_chain_states(r, chain)
    if not states:
        print(f"\n{'─'*60}")
        print(f"  {chain.upper()}: no data in Redis — run master-fetcher first")
        return

    # Group by pair
    by_pair = defaultdict(list)
    for s in states:
        by_pair[s.pair].append(s)

    candidates   = []
    near_misses  = []
    total_pairs  = 0

    g_bps = gas_bps(chain, tier_usd)

    for pair, markets in by_pair.items():
        if len(markets) < 2:
            continue
        total_pairs += 1

        for i, buy in enumerate(markets):
            for j, sell in enumerate(markets):
                if i >= j:
                    continue
                if buy.pool_id == sell.pool_id:
                    continue

                # Orient: buy cheaper, sell dearer
                if buy.price > sell.price:
                    buy, sell = sell, buy

                spread_bps = (sell.price - buy.price) / buy.price * 10000
                fees_bps   = buy.fee_bps + sell.fee_bps
                gross_edge = spread_bps - fees_bps

                record = {
                    "pair":       pair,
                    "buy_venue":  buy.venue_id,
                    "sell_venue": sell.venue_id,
                    "buy_price":  buy.price,
                    "sell_price": sell.price,
                    "spread_bps": spread_bps,
                    "fees_bps":   fees_bps,
                    "gross_edge": gross_edge,
                    "net_edge":   gross_edge - g_bps,
                }

                if gross_edge > 0:
                    candidates.append(record)
                elif gross_edge > -60:
                    near_misses.append(record)

    # Sort
    candidates.sort(key=lambda x: x["net_edge"], reverse=True)
    near_misses.sort(key=lambda x: x["gross_edge"], reverse=True)

    # ── Report ────────────────────────────────────────────────────────────────
    print(f"\n{'═'*60}")
    print(f"  CHAIN: {chain.upper()}   tier=${tier_usd:,}   gas={g_bps:.2f}bps")
    print(f"  markets={len(states)}  pairs={total_pairs}  "
          f"candidates={len(candidates)}  near-misses={len(near_misses)}")
    print(f"{'─'*60}")

    if candidates:
        print(f"\n  🟢 GROSS-POSITIVE CANDIDATES ({len(candidates)}):")
        print(f"  {'PAIR':<12} {'BUY':<25} {'SELL':<25} {'SPREAD':>8} {'FEES':>6} {'GROSS':>7} {'NET':>7}")
        for c in candidates[:10]:
            print(f"  {c['pair']:<12} {c['buy_venue']:<25} {c['sell_venue']:<25} "
                  f"{c['spread_bps']:>7.2f} {c['fees_bps']:>5.1f} "
                  f"{c['gross_edge']:>+6.2f} {c['net_edge']:>+6.2f}")
    else:
        print(f"\n  ⛔ No gross-positive candidates on {chain}")

    if near_misses:
        closest = near_misses[0]
        gap = abs(closest["gross_edge"])
        print(f"\n  📍 Closest near-miss: {closest['pair']} "
              f"({closest['buy_venue']} → {closest['sell_venue']})")
        print(f"     spread={closest['spread_bps']:.2f}bps  "
              f"fees={closest['fees_bps']:.1f}bps  "
              f"gap={gap:.2f}bps from profitable")
        print(f"\n  Top near-misses:")
        print(f"  {'PAIR':<12} {'BUY':<22} {'SELL':<22} {'SPREAD':>8} {'FEES':>6} {'EDGE':>7}")
        for m in near_misses[:6]:
            print(f"  {m['pair']:<12} {m['buy_venue']:<22} {m['sell_venue']:<22} "
                  f"{m['spread_bps']:>7.2f} {m['fees_bps']:>5.1f} {m['gross_edge']:>+6.2f}")


def main():
    parser = argparse.ArgumentParser(description="RC-1 Multi-Chain Reality Check")
    parser.add_argument("--single",  action="store_true", help="Run once")
    parser.add_argument("--tier",    type=int, default=1000, help="Trade size USD")
    parser.add_argument("--chain",   type=str, default="all",
                        help="Chain to scan: mainnet|arbitrum|base|all")
    args = parser.parse_args()

    r = redis.from_url("redis://127.0.0.1:6379")

    chains = list(CHAIN_LOADERS.keys()) if args.chain == "all" else [args.chain]

    print(f"\n{'═'*60}")
    print(f"  RC-1 MULTI-CHAIN REALITY CHECK")
    print(f"  {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}")
    print(f"  Chains: {', '.join(chains)}   Tier: ${args.tier:,}")
    print(f"{'═'*60}")

    for chain in chains:
        check_chain(r, chain, args.tier)

    print(f"\n{'═'*60}\n")


if __name__ == "__main__":
    main()
\'\'\'

# ── Write files ───────────────────────────────────────────────────────────────
files = [
    (f"{ROOT}/scripts/market/redis_adapters/arbitrum.py",    ARBITRUM_ADAPTER),
    (f"{ROOT}/scripts/market/redis_adapters/base.py",        BASE_ADAPTER),
    (f"{ROOT}/scripts/market/redis_adapters/__init__.py",    INIT_CONTENT),
    (f"{ROOT}/scripts/run_reality_check.py",                 RC1_CONTENT),
]

for path, content in files:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    print(f"✅ {path.replace(ROOT+'/', '')}")

print("\n✅ All files written.")
print("   Run: node scripts/master-fetcher.js once && python3 scripts/run_reality_check.py --single --tier 1000")
