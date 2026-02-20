"""
Sushiswap V2 Redis Adapter v1.1

Real payload structure (confirmed 2026-02-19):
{
  "ok": true,
  "name": "sushiswapFetcher",
  "timestamp": "<iso_string>",
  "data": {
    "status": "success",
    "data": {
      "prices": [
        {
          "pair": "ETH/USDC",
          "pool": "0x...",
          "price": 1942.35,
          "reserve0": "792837391350",
          "reserve1": "408184893821789767505",
          "reserveUSD": 1539967071.91,
          "fee": 0.3,         <- decimal percent (0.3 = 0.3% = 30 bps)
          "source": "sushiswap_onchain",
          "timestamp": "<iso_string>"
        }
      ]
    }
  }
}

Reserves ARE present — V2 sim can run.
tvlUSD field absent; use reserveUSD instead.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional, List, Dict, Any

logger = logging.getLogger("Allmight.Adapter.SushiswapV2")

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from raw_market_state import RawMarketState

REDIS_KEY       = "fetcher:sushiswapFetcher"
VENUE_ID        = "sushiswap_v2"
CHAIN_ID        = "eth"
SWAP_FEE_BPS    = 30.0
ADAPTER_VERSION = "1.1"

PAIR_ALLOWLIST = {
    "ETH/USDC", "WBTC/ETH", "ETH/USDT", "USDC/USDT",
    "LINK/ETH", "UNI/ETH", "AAVE/ETH", "MATIC/ETH",
    "USDC/ETH", "ETH/WBTC",
}


def _normalize_pair(pair: str) -> str:
    return pair.strip().upper()


def _token_labels_from_pair(pair: str):
    parts = pair.split("/")
    if len(parts) == 2:
        return parts[0].strip().upper(), parts[1].strip().upper()
    return "UNKNOWN", "UNKNOWN"


def _fee_to_bps(fee_raw) -> float:
    try:
        f = float(fee_raw)
    except (TypeError, ValueError):
        return 30.0
    if f < 5:
        return round(f * 100, 4)
    elif f <= 100:
        return round(f, 4)
    else:
        return round(f / 100, 4)


def _estimate_slippage_bps(tvl_usd: Optional[float], notional_usd: float, fee_bps: float) -> Optional[float]:
    if not tvl_usd or tvl_usd <= 0:
        return None
    price_impact_bps = (notional_usd / (2.0 * tvl_usd)) * 10_000
    return round(price_impact_bps + fee_bps, 4)


def _parse_reserve(val: Any) -> Optional[int]:
    if val is None:
        return None
    try:
        return int(float(str(val)))
    except (ValueError, TypeError):
        return None


def _parse_iso_ts(ts_str) -> int:
    if not ts_str:
        return int(time.time() * 1000)
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return int(time.time() * 1000)


def parse(redis_client, warn_fn=None) -> List[RawMarketState]:
    """Read Redis, parse, return List[RawMarketState]. Returns [] on failure."""
    results: List[RawMarketState] = []

    def warn(code: str, detail: str = ""):
        logger.warning(f"[{VENUE_ID}] {code}: {detail}")
        if warn_fn:
            warn_fn(code, detail)

    try:
        raw = redis_client.get(REDIS_KEY)
    except Exception as e:
        warn("REDIS_READ_ERROR", str(e))
        return []

    if raw is None:
        warn("REDIS_KEY_MISSING", f"key={REDIS_KEY}")
        return []

    try:
        payload = json.loads(raw)
    except Exception as e:
        warn("JSON_PARSE_ERROR", str(e))
        return []

    # Real structure: payload["data"]["status"]
    status = payload.get("data", {}).get("status")
    if status != "success":
        warn("FETCHER_STATUS_NOT_SUCCESS", f"status={status}")
        return []

    ts_ms = _parse_iso_ts(payload.get("timestamp"))

    age_s = (time.time() * 1000 - ts_ms) / 1000
    if age_s > 60:
        warn("DATA_STALE", f"age={age_s:.0f}s")

    try:
        prices = payload["data"]["data"]["prices"]
    except (KeyError, TypeError):
        warn("PRICES_PATH_MISSING", "expected data.data.prices")
        return []

    if not isinstance(prices, list) or len(prices) == 0:
        warn("PRICES_EMPTY", "")
        return []

    for entry in prices:
        try:
            pair_raw = entry.get("pair", "")
            pair = _normalize_pair(pair_raw)

            if pair not in PAIR_ALLOWLIST:
                logger.debug(f"Skipping pair not in allowlist: {pair}")
                continue

            base_token, quote_token = _token_labels_from_pair(pair)

            price = entry.get("price")
            if price is None or float(price) <= 0:
                warn("PRICE_INVALID", f"pair={pair} price={price}")
                continue

            pool_addr   = entry.get("pool", "").lower()
            fee_raw     = entry.get("fee", 0.3)
            fee_bps     = _fee_to_bps(fee_raw)

            # Sushiswap uses reserveUSD, not tvlUSD
            tvl_usd = entry.get("tvlUSD") or entry.get("reserveUSD")

            reserve0 = _parse_reserve(entry.get("reserve0"))
            reserve1 = _parse_reserve(entry.get("reserve1"))

            pool_state: Dict[str, Any] = {
                "type": "v2",
                "pool_address": pool_addr,
                "fee_bps": fee_bps,
                "tvl_usd": tvl_usd,
                "reserves_available": (reserve0 is not None and reserve1 is not None),
            }
            if reserve0 is not None:
                pool_state["reserve0"] = reserve0
            if reserve1 is not None:
                pool_state["reserve1"] = reserve1

            slip_1k  = _estimate_slippage_bps(tvl_usd, 1_000,  fee_bps)
            slip_5k  = _estimate_slippage_bps(tvl_usd, 5_000,  fee_bps)
            slip_10k = _estimate_slippage_bps(tvl_usd, 10_000, fee_bps)

            entry_warnings = []
            if tvl_usd is None:
                entry_warnings.append("TVL_MISSING")
            if not pool_state["reserves_available"]:
                entry_warnings.append("RESERVES_MISSING")
            if pool_addr == "":
                entry_warnings.append("POOL_ADDRESS_MISSING")
            if age_s > 60:
                entry_warnings.append("DATA_STALE")

            rms = RawMarketState(
                chain_id         = CHAIN_ID,
                venue_id         = VENUE_ID,
                market_id        = pool_addr or f"sushi_{pair}",
                pair             = pair,
                base_token       = base_token,
                quote_token      = quote_token,
                ts_ms            = ts_ms,
                block_ref        = 0,
                mid_px           = float(price),
                swap_fee_bps     = fee_bps,
                tvl_usd          = float(tvl_usd) if tvl_usd else None,
                slippage_bps_1k  = slip_1k,
                slippage_bps_5k  = slip_5k,
                slippage_bps_10k = slip_10k,
                pool_state       = pool_state,
                adapter_version  = ADAPTER_VERSION,
                warnings         = entry_warnings,
            )
            results.append(rms)
            logger.debug(f"Parsed {pair} @ {float(price):.4f} "
                         f"fee={fee_bps:.1f}bps tvl=${tvl_usd:,.0f} "
                         f"reserves={'YES' if pool_state['reserves_available'] else 'NO'}"
                         if tvl_usd else
                         f"Parsed {pair} @ {float(price):.4f} fee={fee_bps:.1f}bps")

        except Exception as e:
            warn("ENTRY_PARSE_ERROR", f"pair={entry.get('pair','?')} err={e}")
            continue

    logger.info(f"SushiswapV2 adapter: parsed {len(results)} markets from {len(prices)} entries")
    return results
