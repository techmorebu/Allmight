#!/usr/bin/env python3
"""
Fixes Base UniV3 ETH/USDC priceMode from 'invert' to 'direct'.
Also fixes decimals to match Aerodrome config (WETH=18 as token0, USDC=6 as token1).

Logic: Aerodrome ETH/USDC works with WETH(18) as token0, USDC(6) as token1,
priceMode='direct' giving $1957. UniV3 pool on Base likely has same ordering.

Run: python3 fix_base_univ3.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/baseFetcher.js"
)

with open(TARGET) as f:
    lines = f.readlines()

print("Current UniV3 pool configs:")
for i, line in enumerate(lines, 1):
    if any(k in line for k in ['decimals0', 'decimals1', 'priceMode', 'outputPair', 'fee:', 'pool:']):
        if i < 60:  # only show pool config section
            print(f"  {i}: {line.rstrip()}")

# Fix both ETH/USDC UniV3 pools:
# Change decimals0=6->18, decimals1=18->6, priceMode='invert'->'direct'
fixes = {}
uni_pool_count = 0
i = 0
while i < len(lines):
    line = lines[i]
    # Detect start of a UniV3 pool config block
    if "'uniswap_v3'" in line or 'uniswap_v3' in line:
        pass
    # Find priceMode: 'invert' lines in the UniV3 section (before Aerodrome section)
    if "priceMode:  'invert'" in line and i < 55:
        fixes[i] = "        priceMode:  'direct',  // WETH(t0)/USDC(t1) -> adj1/adj0 = USD/ETH direct\n"
    if "decimals0:  6," in line and i < 55:
        fixes[i] = "        decimals0:  18,   // WETH (token0 on Base UniV3)\n"
    if "decimals1:  18," in line and i < 55:
        fixes[i] = "        decimals1:  6,    // USDC (token1 on Base UniV3)\n"
    i += 1

if not fixes:
    print("\n❌ No fixes found — printing lines 30-55 for manual inspection:")
    for i, l in enumerate(lines[29:55], 30):
        print(f"  {i}: {l.rstrip()}")
else:
    for lineno, new_content in sorted(fixes.items()):
        old = lines[lineno].rstrip()
        lines[lineno] = new_content
        print(f"\n✅ Line {lineno+1}:")
        print(f"   OLD: {old}")
        print(f"   NEW: {new_content.rstrip()}")

    with open(TARGET, 'w') as f:
        f.writelines(lines)
    print(f"\n✅ Written {TARGET}")
    print("   Run: node scripts/data_collection/masterFetcher/baseFetcher.js")
