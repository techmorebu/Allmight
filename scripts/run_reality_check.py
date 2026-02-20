#!/usr/bin/env python3
"""RC-1 Multi-Chain Reality Check"""
import argparse, sys, os
from datetime import datetime
from collections import defaultdict
import redis

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.market.redis_adapters.uniswap_v3   import parse as load_uniswap_v3
from scripts.market.redis_adapters.sushiswap_v2 import parse as load_sushiswap_v2
from scripts.market.redis_adapters.arbitrum     import load as load_arbitrum
from scripts.market.redis_adapters.base         import load as load_base
from scripts.market.redis_adapters.optimism     import load as load_optimism
from scripts.market.redis_adapters.unichain     import load as load_unichain

GAS_USD = {"mainnet": 1.25, "arbitrum": 0.02, "base": 0.01}
CHAIN_LOADERS = {
    "mainnet":  [load_uniswap_v3, load_sushiswap_v2],
    "arbitrum": [load_arbitrum],
    "base":     [load_base],
}


def gas_bps(chain, tier_usd):
    return (GAS_USD.get(chain, 1.25) / tier_usd) * 10000


def load_chain_states(r, chain):
    states = []
    for loader in CHAIN_LOADERS.get(chain, []):
        try:
            states.extend(loader(r))
        except Exception as e:
            print(f"  WARNING: {loader.__name__} failed: {e}")
    return states


def check_chain(r, chain, tier_usd):
    states = load_chain_states(r, chain)
    g_bps  = gas_bps(chain, tier_usd)
    print()
    print("=" * 64)
    print(f"  CHAIN: {chain.upper():<12} tier=${tier_usd:,}  gas={g_bps:.2f}bps (${GAS_USD.get(chain,1.25):.3f})")
    print("=" * 64)
    if not states:
        print("  No data in Redis -- run master-fetcher first")
        return
    print(f"  Markets loaded: {len(states)}")

    by_pair = defaultdict(list)
    for s in states:
        by_pair[s.pair].append(s)

    candidates  = []
    near_misses = []

    for pair, markets in by_pair.items():
        if len(markets) < 2:
            continue
        for i, buy in enumerate(markets):
            for j, sell in enumerate(markets):
                if i >= j:
                    continue
                if buy.market_id == sell.market_id:
                    continue
                # Use mid_px (the correct field name on RawMarketState)
                buy_px  = buy.mid_px
                sell_px = sell.mid_px
                if buy_px > sell_px:
                    buy, sell = sell, buy
                    buy_px, sell_px = sell_px, buy_px
                spread_bps = (sell_px - buy_px) / buy_px * 10000
                fees_bps   = buy.swap_fee_bps + sell.swap_fee_bps
                gross_edge = spread_bps - fees_bps
                net_edge   = gross_edge - g_bps
                rec = dict(
                    pair       = pair,
                    buy_venue  = buy.venue_id,
                    sell_venue = sell.venue_id,
                    buy_price  = buy_px,
                    sell_price = sell_px,
                    spread_bps = spread_bps,
                    fees_bps   = fees_bps,
                    gross_edge = gross_edge,
                    net_edge   = net_edge,
                )
                if gross_edge > 0:
                    candidates.append(rec)
                elif gross_edge > -100:
                    near_misses.append(rec)

    candidates.sort( key=lambda x: x["net_edge"],  reverse=True)
    near_misses.sort(key=lambda x: x["gross_edge"], reverse=True)

    if candidates:
        print(f"\n  GROSS-POSITIVE CANDIDATES: {len(candidates)}")
        print(f"  {'PAIR':<10} {'BUY':<26} {'SELL':<26} {'SPRD':>6} {'FEES':>5} {'GROSS':>6} {'NET':>6}")
        for c in candidates[:10]:
            print(f"  {c['pair']:<10} {c['buy_venue']:<26} {c['sell_venue']:<26} "
                  f"{c['spread_bps']:>5.1f} {c['fees_bps']:>4.0f} "
                  f"{c['gross_edge']:>+5.1f} {c['net_edge']:>+5.1f}")
    else:
        print("\n  No gross-positive candidates")

    if near_misses:
        best = near_misses[0]
        print(f"\n  Closest: {best['pair']} ({best['buy_venue']} -> {best['sell_venue']})")
        print(f"  spread={best['spread_bps']:.2f}bps  fees={best['fees_bps']:.0f}bps  "
              f"gap={abs(best['gross_edge']):.2f}bps from gross-positive")
        print(f"\n  {'PAIR':<10} {'BUY':<24} {'SELL':<24} {'SPRD':>6} {'FEES':>5} {'EDGE':>6}")
        for m in near_misses[:8]:
            print(f"  {m['pair']:<10} {m['buy_venue']:<24} {m['sell_venue']:<24} "
                  f"{m['spread_bps']:>5.1f} {m['fees_bps']:>4.0f} {m['gross_edge']:>+5.1f}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--single", action="store_true")
    parser.add_argument("--tier",   type=int, default=1000)
    parser.add_argument("--chain",  type=str, default="all")
    args = parser.parse_args()

    r = redis.from_url("redis://127.0.0.1:6379")
    chains = list(CHAIN_LOADERS.keys()) if args.chain == "all" else [args.chain]

    print()
    print("=" * 64)
    print("  RC-1 MULTI-CHAIN REALITY CHECK")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  Chains: {', '.join(chains)}   Tier: ${args.tier:,}")
    print("=" * 64)

    for chain in chains:
        check_chain(r, chain, args.tier)

    print()
    print("=" * 64)


if __name__ == "__main__":
    main()
