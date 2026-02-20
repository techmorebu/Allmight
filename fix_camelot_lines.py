#!/usr/bin/env python3
"""
Fixes Camelot ETH/USDC pool config using exact line numbers.
Confirmed from grep: lines 91-94 have wrong decimals/priceMode.

Actual token ordering (confirmed via on-chain debug):
  token0 = WETH (18 decimals)  reserve0 = 39558377621490804037
  token1 = USDC.e (6 decimals) reserve1 = 77432554679
  adj1/adj0 = USDC/WETH = USD per ETH directly (no inversion)

Run: python3 fix_camelot_lines.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/arbitrumFetcher.js"
)

with open(TARGET) as f:
    lines = f.readlines()

# Show current state of lines 89-96 (0-indexed: 88-95)
print("Current lines 89-96:")
for i, l in enumerate(lines[88:96], start=89):
    print(f"  {i}: {l}", end="")

# Apply fixes at exact line numbers (1-indexed → 0-indexed)
FIXES = {
    91: "        decimals0:  18,   // WETH (token0, confirmed on-chain)\n",
    92: "        decimals1:  6,    // USDC.e (token1, confirmed on-chain)\n",
    94: "        priceMode:  'direct',  // adj1/adj0 = USDC/WETH = USD/ETH\n",
}

for lineno, new_content in FIXES.items():
    idx = lineno - 1
    old = lines[idx]
    lines[idx] = new_content
    print(f"\n✅ Line {lineno}:")
    print(f"   OLD: {old.rstrip()}")
    print(f"   NEW: {new_content.rstrip()}")

# Also fix tvlUSD in fetchCamelotPool (line 175, USDC is now adj1 not adj0)
# Find it dynamically
for i, line in enumerate(lines):
    if "tvlUSD = cfg.outputPair === 'ETH/USDC'" in line and 'adj0 * 2' in line:
        old = lines[i]
        lines[i] = "        const tvlUSD = cfg.outputPair === 'ETH/USDC' ? adj1 * 2 : adj1 * price * 2;\n"
        print(f"\n✅ Line {i+1} (tvlUSD):")
        print(f"   OLD: {old.rstrip()}")
        print(f"   NEW: {lines[i].rstrip()}")
        break

with open(TARGET, 'w') as f:
    f.writelines(lines)

print(f"\n✅ Written to {TARGET}")
print("   Run: node scripts/data_collection/masterFetcher/arbitrumFetcher.js")
