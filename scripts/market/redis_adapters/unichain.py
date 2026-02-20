#!/usr/bin/env python3
"""Redis adapter for unichainFetcher.js"""
import json, time
import redis as _redis
from scripts.market.raw_market_state import RawMarketState

REDIS_KEYS = ["fetcher:unichainFetcher"]
CHAIN_ID   = "unichain"

def _fee_to_bps(fee):
    if fee is None: return 30.0
    if fee < 0.01: return fee * 10000
    if fee < 5:    return fee * 100
    return float(fee)

def _split_pair(pair):
    parts = pair.split("/")
    return (parts[0], parts[1]) if len(parts) == 2 else (pair, "USD")

def load(r: _redis.Redis) -> list:
    states = []
    for key in REDIS_KEYS:
        raw = r.get(key)
        if not raw: continue
        payload = json.loads(raw)
        prices  = payload.get("data", {}).get("data", {}).get("prices", [])
        for p in prices:
            try:
                price = float(p["price"])
                if price <= 0 or price > 1e12: continue
                base, quote = _split_pair(p["pair"])
                venue = p.get("venue", "uniswap_v3")
                states.append(RawMarketState(
                    chain_id=CHAIN_ID, venue_id=f"{venue}_{CHAIN_ID}",
                    market_id=p.get("pool","").lower(), pair=p["pair"],
                    base_token=base, quote_token=quote,
                    ts_ms=int(time.time()*1000), block_ref=0, mid_px=price,
                    swap_fee_bps=_fee_to_bps(p.get("fee")),
                    tvl_usd=float(p.get("tvlUSD") or p.get("reserveUSD") or 0) or None,
                ))
            except (KeyError, ValueError, TypeError):
                continue
    return states
