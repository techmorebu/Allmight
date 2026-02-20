#!/usr/bin/env python3
"""
Fixes fee pairing in RC-1 and spread_monitor.
Problem: USDC/USDT 0.01% pool vs USDC/USDT 0.05% pool shows fees=6 (1+5)
         instead of comparing 0.01% vs 0.01% pools for fees=2 (1+1).

The scanner pairs ALL combos of same-named pairs including cross-fee-tier.
This is correct behavior -- but the BEST opportunity is same-token different-venue.

The real fix: the stablecoin pools need DIFFERENT pair names to distinguish them,
OR we accept the current output and understand that:
  - 1+5=6 bps (cross-tier) shown correctly
  - 1+1=2 bps (same-tier same-venue) not shown because market_id differs
    but venue_id is same (both uniswap_v3_arbitrum)

Actually the 1+1 comparison IS happening -- USDC/USDCe has two pools
both at 1 bps (0.01% and 0.05%) but RC-1 shows fees=6 meaning it paired
the 1 bps pool with the 5 bps pool, not 1+1.

Root cause: two USDC/USDCe pools exist (0.01% and 0.05%), RC-1 finds the
best-spread combo which happens to be 1bps vs 5bps (cross-tier), not same-fee.

To see 1+1=2 bps opportunities we need DIFFERENT venues with same pair,
e.g. UniV3 USDC/USDT vs Camelot USDC/USDT -- but Camelot doesn't have stables.

Real conclusion: on Arbitrum right now, stablecoin arb requires:
  UniV3 0.01% USDC/USDT  vs  some other venue with USDC/USDT
  No other venue currently in our scan has USDC/USDT.

Action: add Curve Finance on Arbitrum -- it has USDC/USDT/USDC.e 3pool
at 0.04% fee (4 bps). Then fee wall = 1 + 4 = 5 bps.
Spread of 3.29 bps - 5 bps = -1.71 bps. Very close.

This script just prints the diagnosis clearly.
"""
import os, sys
sys.path.insert(0, os.path.expanduser("~/Allmight"))

import redis
from scripts.market.redis_adapters.arbitrum import load

r = redis.from_url("redis://127.0.0.1:6379")
states = load(r)

print("Current Arbitrum market states:")
print(f"{'venue_id':<30} {'pair':<14} {'market_id':<45} {'fee':>6} {'price':>10}")
print("-" * 110)
for s in states:
    print(f"{s.venue_id:<30} {s.pair:<14} {s.market_id:<45} {s.swap_fee_bps:>5.1f} {s.mid_px:>10.6f}")

print("\nBest cross-venue stablecoin opportunities:")
print("(Need DIFFERENT venue_id for same pair to get real arb)")
stables = [s for s in states if s.pair in ('USDC/USDT', 'USDC/USDCe', 'DAI/USDT', 'DAI/USDC')]
from collections import defaultdict
by_pair = defaultdict(list)
for s in stables:
    by_pair[s.pair].append(s)

for pair, markets in by_pair.items():
    print(f"\n  {pair}:")
    for m in markets:
        print(f"    {m.venue_id:<30} fee={m.swap_fee_bps:.1f}bps  price={m.mid_px:.6f}")
    if len(markets) >= 2:
        for i, a in enumerate(markets):
            for j, b in enumerate(markets):
                if i >= j: continue
                spread = abs(a.mid_px - b.mid_px) / min(a.mid_px, b.mid_px) * 10000
                fees   = a.swap_fee_bps + b.swap_fee_bps
                edge   = spread - fees
                same_venue = a.venue_id == b.venue_id
                print(f"    {'[SAME VENUE]' if same_venue else '[DIFF VENUE]'} "
                      f"spread={spread:.2f}bps fees={fees:.0f}bps edge={edge:+.2f}bps")

print("\nConclusion: Need Curve/Balancer on Arbitrum to get true cross-venue stablecoin arb")
