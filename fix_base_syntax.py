#!/usr/bin/env python3
"""
Rewrites the AERODROME_POOLS array in baseFetcher.js cleanly.
Keeps only the one confirmed working pool (WETH/USDC volatile).
Fixes any syntax errors left by the block removal.

Run: python3 fix_base_syntax.py
"""
import os, re

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/baseFetcher.js"
)

with open(TARGET) as f:
    content = f.read()

# Replace entire AERODROME_POOLS array with clean single-pool version
OLD_PATTERN = r'const AERODROME_POOLS = \[.*?\];'

NEW_ARRAY = """\
const AERODROME_POOLS = [
    {
        // WETH/USDC volatile -- confirmed working, price verified on-chain
        // token0=WETH(18), token1=USDC(6)
        outputPair: 'ETH/USDC',
        pool:       '0xcDAC0d6c6C59727a65F871236188350531885C43',
        decimals0:  18,   // WETH
        decimals1:  6,    // USDC
        fee:        0.003,
        stable:     false,
        priceMode:  'direct',
    },
];"""

result = re.sub(OLD_PATTERN, NEW_ARRAY, content, flags=re.DOTALL)

if result == content:
    print("Pattern not found -- showing lines 60-95:")
    for i, line in enumerate(content.split('\n')[59:95], 60):
        print(f"  {i}: {line}")
else:
    with open(TARGET, 'w') as f:
        f.write(result)
    print("baseFetcher.js AERODROME_POOLS rewritten cleanly")
    print("Run: node scripts/data_collection/masterFetcher/baseFetcher.js")
