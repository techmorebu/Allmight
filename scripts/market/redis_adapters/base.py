#!/usr/bin/env python3
"""Redis adapter for baseFetcher.js"""
import json, time
import redis as _redis
from scripts.market.raw_market_state import RawMarketState

REDIS_KEY = "fetcher:baseFetcher"
CHAIN_ID  = "base"


def _fee_to_bps(fee):
    if fee is None: return 30.0
    # Fee encoding by venue:
    #   UniV3:          0.05 (percent) -> 5 bps    [fee >= 0.01]
    #   UniV3:          0.3  (percent) -> 30 bps   [fee >= 0.01]
    #   Camelot/Aero:   0.003 (fraction) -> 30 bps [fee < 0.01]
    #   Aero stable:    0.0001 (fraction) -> 1 bps  [fee < 0.01]
    if fee < 0.01: return fee * 10000   # raw fraction -> bps
    if fee < 5:    return fee * 100     # percent -> bps
    return float(fee)                   # already bps

def _split_pair(pair):
    parts = pair.split("/")
    return (parts[0], parts[1]) if len(parts) == 2 else (pair, "USD")


def load(r: _redis.Redis) -> list:
    raw = r.get(REDIS_KEY)
    if not raw:
        return []
    payload = json.loads(raw)
    prices  = payload.get("data", {}).get("data", {}).get("prices", [])
    states  = []
    for p in prices:
        try:
            price = float(p["price"])
            if price <= 0 or price > 1e12:
                continue
            venue        = p.get("venue", "uniswap_v3")
            base, quote  = _split_pair(p["pair"])
            states.append(RawMarketState(
                chain_id    = CHAIN_ID,
                venue_id    = f"{venue}_{CHAIN_ID}",
                market_id   = p.get("pool", "").lower(),
                pair        = p["pair"],
                base_token  = base,
                quote_token = quote,
                ts_ms       = int(time.time() * 1000),
                block_ref   = 0,
                mid_px      = price,
                swap_fee_bps= _fee_to_bps(p.get("fee")),
                tvl_usd     = float(p.get("tvlUSD") or p.get("reserveUSD") or 0) or None,
            ))
        except (KeyError, ValueError, TypeError):
            continue
    return states
