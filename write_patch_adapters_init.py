#!/usr/bin/env python3
"""
Patch writer: fixes scripts/market/redis_adapters/__init__.py
Run from project root: python3 ~/Downloads/write_patch_adapters_init.py
"""
import os

TARGET = os.path.expanduser("~/Allmight/scripts/market/redis_adapters/__init__.py")

CONTENT = '''"""
Redis Adapters Package

Each adapter reads a single fetcher Redis key and returns List[RawMarketState].
Contract: returns [] on any failure, never raises.
"""
from . import uniswap_v3, sushiswap_v2

__all__ = ["uniswap_v3", "sushiswap_v2"]
'''

with open(TARGET, "w") as f:
    f.write(CONTENT)

print(f"✅ Wrote {TARGET}")
