#!/usr/bin/env python3
"""
Continuous spread monitor for stablecoin arb opportunities.
Logs all cross-venue spreads every 60s and alerts when gross-positive.

Usage:
  python3 scripts/spread_monitor.py              # runs forever
  python3 scripts/spread_monitor.py --once       # single snapshot
  python3 scripts/spread_monitor.py --chain arbitrum

Log file: logs/spread_monitor.csv
"""
import argparse, os, sys, time, csv
from datetime import datetime, timezone
from collections import defaultdict

import redis

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.market.redis_adapters.arbitrum     import load as load_arbitrum
from scripts.market.redis_adapters.base         import load as load_base
from scripts.market.redis_adapters.optimism     import load as load_optimism
from scripts.market.redis_adapters.uniswap_v3   import parse as load_uniswap_v3
from scripts.market.redis_adapters.sushiswap_v2 import parse as load_sushiswap_v2

CHAIN_LOADERS = {
    "mainnet":  [load_uniswap_v3, load_sushiswap_v2],
    "arbitrum": [load_arbitrum],
    "base":     [load_base],
    "optimism": [load_optimism],
    "optimism": [load_optimism],
}

GAS_USD = {"mainnet": 1.25, "arbitrum": 0.02, "base": 0.01, "optimism": 0.001}

LOG_DIR = os.path.expanduser("~/Allmight/logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "spread_monitor.csv")

# Write CSV header if new file
if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([
            'timestamp', 'chain', 'pair',
            'buy_venue', 'sell_venue',
            'buy_price', 'sell_price',
            'spread_bps', 'fees_bps', 'gross_edge', 'net_edge',
            'alert'
        ])


def gas_bps(chain, tier_usd=1000):
    return (GAS_USD.get(chain, 1.25) / tier_usd) * 10000


def scan_chain(r, chain):
    states = []
    for loader in CHAIN_LOADERS.get(chain, []):
        try:
            states.extend(loader(r))
        except Exception as e:
            print(f"  WARNING: {loader.__name__} failed: {e}")
    return states


def scan_spreads(r, chains, tier_usd=1000):
    results = []
    ts = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

    for chain in chains:
        states = scan_chain(r, chain)
        g_bps  = gas_bps(chain, tier_usd)

        by_pair = defaultdict(list)
        for s in states:
            by_pair[s.pair].append(s)

        for pair, markets in by_pair.items():
            if len(markets) < 2:
                continue
            for i, buy in enumerate(markets):
                for j, sell in enumerate(markets):
                    if i >= j:
                        continue
                    if buy.market_id == sell.market_id:
                        continue
                    buy_px  = buy.mid_px
                    sell_px = sell.mid_px
                    if buy_px > sell_px:
                        buy, sell = sell, buy
                        buy_px, sell_px = sell_px, buy_px
                    spread_bps = (sell_px - buy_px) / buy_px * 10000
                    fees_bps   = buy.swap_fee_bps + sell.swap_fee_bps
                    gross_edge = spread_bps - fees_bps
                    net_edge   = gross_edge - g_bps
                    alert      = 'GROSS_POS' if gross_edge > 0 else ('NEAR' if gross_edge > -5 else '')
                    results.append({
                        'timestamp':  ts,
                        'chain':      chain,
                        'pair':       pair,
                        'buy_venue':  buy.venue_id,
                        'sell_venue': sell.venue_id,
                        'buy_price':  buy_px,
                        'sell_price': sell_px,
                        'spread_bps': spread_bps,
                        'fees_bps':   fees_bps,
                        'gross_edge': gross_edge,
                        'net_edge':   net_edge,
                        'alert':      alert,
                    })

    # Sort by gross_edge descending
    results.sort(key=lambda x: x['gross_edge'], reverse=True)
    return results


def print_snapshot(results, show_all=False):
    ts = results[0]['timestamp'] if results else datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    print(f"\n[{ts}] Spread Snapshot")
    print(f"{'CHAIN':<10} {'PAIR':<14} {'BUY':<24} {'SELL':<24} {'SPRD':>6} {'FEES':>5} {'EDGE':>6}  ALERT")
    print("-" * 100)
    for r in results:
        if not show_all and r['gross_edge'] < -20:
            continue
        alert = f"  *** {r['alert']} ***" if r['alert'] else ''
        print(
            f"{r['chain']:<10} {r['pair']:<14} "
            f"{r['buy_venue']:<24} {r['sell_venue']:<24} "
            f"{r['spread_bps']:>5.2f} {r['fees_bps']:>4.0f} "
            f"{r['gross_edge']:>+5.2f}"
            f"{alert}"
        )


def log_results(results):
    with open(LOG_FILE, 'a', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'timestamp', 'chain', 'pair', 'buy_venue', 'sell_venue',
            'buy_price', 'sell_price', 'spread_bps', 'fees_bps',
            'gross_edge', 'net_edge', 'alert'
        ])
        writer.writerows(results)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once',    action='store_true', help='Single snapshot')
    parser.add_argument('--chain',   type=str, default='all')
    parser.add_argument('--tier',    type=int, default=1000)
    parser.add_argument('--interval',type=int, default=60, help='Seconds between scans')
    parser.add_argument('--all',     action='store_true', help='Show all pairs including far misses')
    parser.add_argument('--no-fetch', action='store_true', dest='no_fetch',
                        help='Skip internal master-fetcher calls when managed by start_allmight.sh')
    args = parser.parse_args()

    r = redis.from_url("redis://127.0.0.1:6379")
    chains = list(CHAIN_LOADERS.keys()) if args.chain == 'all' else [args.chain]

    print(f"Spread Monitor | chains={','.join(chains)} | tier=${args.tier:,} | log={LOG_FILE}")
    print(f"Interval: {args.interval}s | Ctrl+C to stop")
    print(f"Alert threshold: gross_edge > 0 bps (GROSS_POS) or > -5 bps (NEAR)")

    import subprocess
    if not args.no_fetch:
        print("\nFetching fresh data...")
        subprocess.run(
            ["node", "scripts/master-fetcher.js", "once"],
            cwd=os.path.expanduser("~/Allmight"),
            capture_output=True
        )

    while True:
        try:
            results = scan_spreads(r, chains, args.tier)
            print_snapshot(results, show_all=args.all)
            log_results(results)

            alerts = [x for x in results if x['alert']]
            if alerts:
                print(f"\n  !!! {len(alerts)} ALERT(S) !!!")
                for a in alerts:
                    print(f"  {a['alert']}: {a['pair']} {a['buy_venue']} -> {a['sell_venue']} edge={a['gross_edge']:+.2f}bps")

            if args.once:
                break

            print(f"\n  Next scan in {args.interval}s... (Ctrl+C to stop)")
            time.sleep(args.interval)

            if not args.no_fetch:
                subprocess.run(
                    ["node", "scripts/master-fetcher.js", "once"],
                    cwd=os.path.expanduser("~/Allmight"),
                    capture_output=True
                )

        except KeyboardInterrupt:
            print(f"\nStopped. Log saved to {LOG_FILE}")
            break


if __name__ == "__main__":
    main()
