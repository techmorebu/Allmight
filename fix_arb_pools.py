#!/usr/bin/env python3
"""
fix_arb_pools.py
Fixes ARB/WETH pool config -- corrects token order (WETH=token0, ARB=token1)
and removes the duplicate entry.

Run from ~/Allmight:  python3 fix_arb_pools.py
"""
import sys
from pathlib import Path

TARGET = Path("scripts/data_collection/masterFetcher/arbitrumFetcher.js")
if not TARGET.exists():
    print(f"ERROR: {TARGET} not found"); sys.exit(1)

src = TARGET.read_text()
Path("logs/backups").mkdir(exist_ok=True)
Path("logs/backups/arbitrumFetcher.pre_fix_arb.bak").write_text(src)

# ── Replace the broken ARB pool block with corrected version ─────────────────
old_block = '''    // ── ARB pools (added by add_arb_weth_pools.py) ───────────────────────────
    {
        outputPair: 'ARB/WETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,   // ARB  (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000, // 0.3%
        priceMode:  'direct',  // WETH per ARB
    },
    {
        outputPair: 'ARB/USDC',
        pool:       '0xb0f6cA40411360c03d41C5fFa5134b1c9e2b2B16',
        decimals0:  18,   // ARB
        decimals1:  6,    // USDC
        fee:        500,  // 0.05%
        priceMode:  'direct',  // USDC per ARB
    },
    {
        outputPair: 'WBTC/WETH',
        pool:       '0x2f5e87C9312fa29aed5c179E456625D79015299c',
        decimals0:  8,    // WBTC
        decimals1:  18,   // WETH
        fee:        3000, // 0.3%
        priceMode:  'direct',
    },'''

new_block = '''    // ── ARB pools (fixed token order -- WETH=token0, ARB=token1) ───────────
    {
        outputPair: 'ARB/WETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,   // WETH (token0 -- confirmed via on-chain token0())
        decimals1:  18,   // ARB  (token1)
        fee:        3000, // 0.3%
        priceMode:  'invert',  // invert so result = WETH per ARB (~0.000216)
    },
    {
        outputPair: 'ARB/USDC',
        pool:       '0xb0f6cA40411360c03d41C5fFa5134b1c9e2b2B16',
        decimals0:  18,   // ARB  (token0)
        decimals1:  6,    // USDC (token1)
        fee:        500,  // 0.05%
        priceMode:  'direct',  // USDC per ARB (~$0.40)
    },
    {
        outputPair: 'WBTC/WETH',
        pool:       '0x2f5e87C9312fa29aed5c179E456625D79015299c',
        decimals0:  8,    // WBTC (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000, // 0.3%
        priceMode:  'direct',  // WETH per WBTC (~32.5)
    },'''

if old_block in src:
    src = src.replace(old_block, new_block)
    print("ARB pool block replaced with corrected token order")
else:
    print("ERROR: old block not found -- check file manually")
    sys.exit(1)

TARGET.write_text(src)
print(f"Written: {TARGET}")
print("\nTest with:")
print("  node scripts/data_collection/masterFetcher/arbitrumFetcher.js 2>&1 | grep -E 'ARB|WBTC'")
print("\nExpected output:")
print("  ARB/WETH   ~$0.000210  (WETH per ARB)")
print("  ARB/USDC   ~$0.40      (USDC per ARB)")
print("  WBTC/WETH  ~32.5       (WETH per WBTC)")
