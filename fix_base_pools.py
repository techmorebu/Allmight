#!/usr/bin/env python3
"""
Fixes two broken Base pool addresses in baseFetcher.js:
1. Aerodrome USDC/USDbC - wrong address (price=0.87 means wrong pool)
2. cbETH/ETH - bad checksum

Strategy: remove both broken pools, keep only the two verified working ones.
We can add more once we verify addresses via Aerodrome UI directly.

Run: python3 fix_base_pools.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/baseFetcher.js"
)

with open(TARGET) as f:
    lines = f.readlines()

# Find and remove the two broken Aerodrome pool blocks
# Keep only: WETH/USDC volatile (confirmed working at $1957)
new_lines = []
skip_block = False
brace_depth = 0
removed = []
i = 0

while i < len(lines):
    line = lines[i]

    # Detect start of a broken pool block
    is_bad = (
        '0x27a8Afa3Bd49406e48a074350fB7b2020c43B2bD' in line or  # bad USDC/USDbC
        '0x4d2A422dB44144996E855ce15FB581a477dbB947' in line      # bad cbETH checksum
    )

    if is_bad:
        # Find the enclosing { } block by scanning backwards for {
        # and forward for matching }
        block_start = i
        while block_start > 0 and '{' not in lines[block_start]:
            block_start -= 1
        # Now scan forward for the closing }
        depth = 0
        block_end = block_start
        for j in range(block_start, len(lines)):
            depth += lines[j].count('{') - lines[j].count('}')
            if depth <= 0:
                block_end = j
                break
        removed.append(f"Lines {block_start+1}-{block_end+1}: {lines[i].strip()[:60]}")
        # Skip the block + any trailing comma+newline
        i = block_end + 1
        # Skip trailing comma line if present
        if i < len(lines) and lines[i].strip() == ',':
            i += 1
        continue

    new_lines.append(line)
    i += 1

if removed:
    with open(TARGET, 'w') as f:
        f.writelines(new_lines)
    print(f"Removed {len(removed)} broken pool blocks:")
    for r in removed:
        print(f"  {r}")
else:
    print("No changes made - addresses not found. Current pool addresses:")
    for i, line in enumerate(lines, 1):
        if '0x' in line and 'pool' in lines[i-2] if i >= 2 else False:
            print(f"  {i}: {line.rstrip()}")

print("\nRun: node scripts/data_collection/masterFetcher/baseFetcher.js")
