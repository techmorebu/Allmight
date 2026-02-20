#!/usr/bin/env python3
"""
Fixes DAI/USDC pool config in arbitrumFetcher.js.
DAI(18)/USDC(6): sqrtP^2 * 10^(18-6) = 10^12 scale = overflow
Need to invert: 1/raw = USDC per DAI = ~1.0

Run: python3 fix_dai_usdc.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/arbitrumFetcher.js"
)

with open(TARGET) as f:
    lines = f.readlines()

# Find and fix the DAI/USDC 0.01% pool config
fixes = {
    # line content to find -> replacement
    "        decimals0:  18,   // DAI\n": "        decimals0:  18,   // DAI (token0)\n",
    "        decimals1:  6,    // USDC\n": "        decimals1:  6,    // USDC (token1)\n",
}

# Find the DAI/USDC 0.01% block and fix priceMode
in_dai_usdc_block = False
changed = []
i = 0
while i < len(lines):
    line = lines[i]
    if "DAI/USDC 0.01%" in line:
        in_dai_usdc_block = True
    if in_dai_usdc_block and "priceMode:  'direct'" in line and "USDC per DAI" in lines[i+1] if i+1 < len(lines) else False:
        pass
    if in_dai_usdc_block and "priceMode:  'direct',  // adj1/adj0 = USDC/WETH" not in line and "priceMode:  'direct'," in line:
        old = line
        lines[i] = "        priceMode:  'invert',  // DAI(18)/USDC(6): sqrtP^2*10^12 -> invert = USDC/DAI ~1.0\n"
        changed.append((i+1, old.rstrip(), lines[i].rstrip()))
        in_dai_usdc_block = False
    i += 1

if not changed:
    # Try simpler approach: find by line proximity to pool address
    for i, line in enumerate(lines):
        if '0x7CF803e8d82A50504180f417B8bC7a493C0a0503' in line:
            # Look within next 6 lines for priceMode
            for j in range(i, min(i+8, len(lines))):
                if "priceMode:  'direct'," in lines[j]:
                    old = lines[j]
                    lines[j] = "        priceMode:  'invert',  // DAI(18)/USDC(6): sqrtP^2*10^12 -> invert = USDC/DAI ~1.0\n"
                    changed.append((j+1, old.rstrip(), lines[j].rstrip()))
                    break
            break

if changed:
    with open(TARGET, 'w') as f:
        f.writelines(lines)
    for lineno, old, new in changed:
        print(f"Fixed line {lineno}:")
        print(f"  OLD: {old}")
        print(f"  NEW: {new}")
    print("\nRun: node scripts/data_collection/masterFetcher/arbitrumFetcher.js")
else:
    print("ERROR: Could not find DAI/USDC priceMode line")
    print("Showing pool-related lines around 0x7CF803:")
    for i, line in enumerate(lines, 1):
        if '7CF803' in line or 'DAI/USDC' in line or ('priceMode' in line and 40 < i < 80):
            print(f"  {i}: {line.rstrip()}")
