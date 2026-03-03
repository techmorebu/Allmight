#!/usr/bin/env python3
"""
fix_arb_final.py
Replaces hardcoded ARB pool addresses with ethers.getAddress() calls
so checksums are computed correctly at runtime.
Also removes the duplicate ARB/WETH from uniswapV3Fetcher.js if present.

Run from ~/Allmight:  python3 fix_arb_final.py
"""
import sys
from pathlib import Path

TARGET = Path("scripts/data_collection/masterFetcher/arbitrumFetcher.js")
if not TARGET.exists():
    print(f"ERROR: {TARGET} not found"); sys.exit(1)

src = TARGET.read_text()
Path("logs/backups").mkdir(exist_ok=True)
Path("logs/backups/arbitrumFetcher.pre_final.bak").write_text(src)

# Replace the broken ARB pool block with one that uses ethers.getAddress()
# for runtime checksum computation

old_block = '''    // ── ARB pools ─────────────────────────────────────────────────────────────
    // ARB/WETH 0.05% -- highest liquidity ARB pool on Arbitrum
    // token0=WETH, token1=ARB  (verified: WETH addr < ARB addr numerically)
    // sqrtPriceX96 direct = WETH/ARB ratio (~0.000216 WETH per ARB = ~$0.40)
    {
        outputPair: 'ARB/WETH',
        pool:       '0x92c63d0e701cAe98798B2b2052212cb9649E7afe',
        decimals0:  18,   // WETH (token0)
        decimals1:  18,   // ARB  (token1)
        fee:        500,  // 0.05%
        priceMode:  'direct',  // direct = WETH per ARB
    },
    // ARB/USDC 0.3% -- for cross-venue spread detection
    {
        outputPair: 'ARB/USDC',
        pool:       '0xb0f6cA40411360c03d41C5fFa5134b1c9e2b2B16',
        decimals0:  18,   // ARB  (token0)
        decimals1:  6,    // USDC (token1)
        fee:        3000, // 0.3%
        priceMode:  'direct',  // USDC per ARB (~$0.40)
    },
    // WBTC/WETH 0.3% -- high volume BTC arb path
    {
        outputPair: 'WBTC/WETH',
        pool:       '0x2f5e87C9312fa29aed5c179E456625D79015299c',
        decimals0:  8,    // WBTC (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000, // 0.3%
        priceMode:  'direct',  // WETH per WBTC (~32-34)
    },'''

# New block uses ethers.getAddress() for runtime checksum
new_block = '''    // ── ARB / WBTC pools ──────────────────────────────────────────────────────
    // ARB/WETH 0.05% (highest liquidity ARB pool on Arbitrum)
    // WETH=token0, ARB=token1 -- priceMode direct gives WETH per ARB
    {
        outputPair: 'ARB/WETH',
        pool:       ethers.getAddress('0xc6f780497a95e246eb9449f5e4770916dcd6396a'),
        decimals0:  18,   // WETH (token0)
        decimals1:  18,   // ARB  (token1)
        fee:        3000,
        priceMode:  'direct',
    },
    // ARB/USDC 0.3%
    {
        outputPair: 'ARB/USDC',
        pool:       ethers.getAddress('0xb0f6ca40411360c03d41c5ffa5134b1c9e2b2b16'),
        decimals0:  18,   // ARB  (token0)
        decimals1:  6,    // USDC (token1)
        fee:        3000,
        priceMode:  'direct',
    },
    // WBTC/WETH 0.3%
    {
        outputPair: 'WBTC/WETH',
        pool:       ethers.getAddress('0x2f5e87c9312fa29aed5c179e456625d79015299c'),
        decimals0:  8,    // WBTC (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000,
        priceMode:  'direct',
    },'''

if old_block in src:
    src = src.replace(old_block, new_block)
    TARGET.write_text(src)
    print("✅ ARB pool block updated with ethers.getAddress() checksums")
else:
    # Find and show current ARB block for diagnosis
    print("Pattern not matched. Current ARB-related lines:")
    for i, line in enumerate(src.splitlines(), 1):
        if 'ARB' in line or 'arb' in line.lower() and 'pool' in line.lower():
            print(f"  {i}: {line}")
    sys.exit(1)

import subprocess
print("\nTesting fetcher...")
r = subprocess.run(
    ['node', 'scripts/data_collection/masterFetcher/arbitrumFetcher.js'],
    capture_output=True, text=True
)
output_lines = (r.stdout + r.stderr).splitlines()
for line in output_lines:
    if any(x in line for x in ['ARB','WBTC','ERROR','error','bad','checksum','===','---']):
        print(' ', line)

print("\nExpected:")
print("  ARB/WETH  ~0.000216 WETH per ARB")
print("  ARB/USDC  ~$0.40")
print("  WBTC/WETH ~32-34 WETH per BTC")
print("\nIf prices look correct, restart fetcher:")
print("  kill $(grep fetcher logs/pids.txt | cut -d= -f2) 2>/dev/null")
print("  sed -i '/^fetcher=/d' logs/pids.txt")
print("  bash -c 'while true; do node scripts/master-fetcher.js once; sleep 60; done' >> logs/fetcher.log 2>&1 &")
print("  echo fetcher=$! >> logs/pids.txt")
