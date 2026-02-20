"""
Redis Adapters Package

Each adapter reads a single fetcher Redis key and returns List[RawMarketState].
Contract: returns [] on any failure, never raises.
"""
from . import uniswap_v3, sushiswap_v2

__all__ = ["uniswap_v3", "sushiswap_v2"]
