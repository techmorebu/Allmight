#!/usr/bin/env python3
"""
Fixes the Camelot ETH/USDC pool config in arbitrumFetcher.js.
Actual token ordering (confirmed via getReserves debug):
  token0 = WETH (18 decimals) - reserve0 = 39558377621490804037
  token1 = USDC.e (6 decimals) - reserve1 = 77432554679

So adj0 = WETH amount, adj1 = USDC.e amount
raw = adj1/adj0 = USDC per WETH = USD price of ETH directly (no inversion needed)

Run: python3 fix_camelot_decimals.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/arbitrumFetcher.js"
)

# Fix the pool config: swap decimals, change priceMode to direct
OLD = """    {
        outputPair: 'ETH/USDC',
        pool:       '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27',
        decimals0:  6,    // USDC.e
        decimals1:  18,   // WETH
        fee:        0.003,
        priceMode:  'invert',  // WETH/USDC -> invert = USD/ETH
    },"""

NEW = """    {
        outputPair: 'ETH/USDC',
        pool:       '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27',
        decimals0:  18,   // WETH (token0, confirmed on-chain)
        decimals1:  6,    // USDC.e (token1, confirmed on-chain)
        fee:        0.003,
        priceMode:  'direct',  // adj1/adj0 = USDC/WETH = USD/ETH directly
    },"""

# Also fix tvlUSD in fetchCamelotPool — USDC side is now adj1 not adj0
OLD_TVL = "        const tvlUSD = cfg.outputPair === 'ETH/USDC' ? adj0 * 2 : adj1 * price * 2;"
NEW_TVL = "        const tvlUSD = cfg.outputPair === 'ETH/USDC' ? adj1 * 2 : adj1 * price * 2;"

with open(TARGET) as f:
    content = f.read()

fixes = [
    (OLD,     NEW,     "Camelot pool config decimals+priceMode"),
    (OLD_TVL, NEW_TVL, "Camelot tvlUSD USDC side"),
]

applied = 0
for old, new, label in fixes:
    if old in content:
        content = content.replace(old, new, 1)
        print(f"✅ Fixed: {label}")
        applied += 1
    else:
        print(f"❌ Not found: {label}")

if applied > 0:
    with open(TARGET, 'w') as f:
        f.write(content)
    print(f"\n✅ {applied} fix(es) written to {TARGET}")
else:
    print("\n❌ No fixes applied — check file manually")

print("   Run: node scripts/data_collection/masterFetcher/arbitrumFetcher.js")
