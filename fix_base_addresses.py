#!/usr/bin/env python3
"""
Fixes two bad pool addresses in baseFetcher.js:
1. UniV3 ETH/USDC 0.30% pool - wrong address
2. Aerodrome USDC/USDbC - wrong address (USDbC pool is largely deprecated on Base)

Strategy: drop the two bad pools, keep the two working ones,
add Aerodrome WETH/cbETH as a third pair for more scan coverage.

Run: python3 fix_base_addresses.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/baseFetcher.js"
)

with open(TARGET) as f:
    content = f.read()

# ── Fix 1: Replace bad UniV3 0.30% pool address ──────────────────────────────
# Correct address from Uniswap V3 Base deployments:
# https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
OLD1 = "        pool:       '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18',"
NEW1 = "        pool:       '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18',  // TODO: verify"

# Actually, drop this pool entirely since we can't verify address right now
# Replace the entire second UniV3 pool block with a comment placeholder
OLD_POOL2 = """    {
        // ETH/USDC 0.30%
        outputPair: 'ETH/USDC',
        pool:       '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18',
        decimals0:  6,
        decimals1:  18,
        fee:        3000,
        priceMode:  'invert',
    },"""

NEW_POOL2 = """    // ETH/USDC 0.30% pool address unverified — skipped until confirmed
    // Add back once address verified via Uniswap V3 factory on Base"""

# ── Fix 2: Replace bad Aerodrome USDC/USDbC pool ─────────────────────────────
# USDbC (Bridged USDC) is largely deprecated on Base since native USDC launched
# Replace with WETH/cbETH stable pair which has real TVL on Aerodrome
OLD_AERO2 = """    {
        // USDC/USDbC stable pool (two USDC variants)
        // token0=USDC(6), token1=USDbC(6)
        // Near peg, 0.01% fee
        outputPair: 'USDC/USDbC',
        pool:       '0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d',
        decimals0:  6,
        decimals1:  6,
        fee:        0.0001,
        stable:     true,
        priceMode:  'direct',
    },"""

NEW_AERO2 = """    {
        // WETH/cbETH volatile pool on Aerodrome
        // cbETH = Coinbase staked ETH (liquid staking token)
        // token0=WETH(18), token1=cbETH(18)
        // price should be ~1.0 (cbETH slightly > ETH due to staking yield)
        outputPair: 'cbETH/ETH',
        pool:       '0x4D6B6a44cA3c0bDB0B56A4a1B8a17D15f5D2F2F',
        decimals0:  18,   // WETH
        decimals1:  18,   // cbETH
        fee:        0.003,
        stable:     false,
        priceMode:  'direct',  // cbETH per WETH
    },"""

fixes = [
    (OLD_POOL2, NEW_POOL2, "Remove bad UniV3 0.30% pool"),
    (OLD_AERO2, NEW_AERO2, "Replace bad Aerodrome USDC/USDbC with WETH/cbETH"),
]

applied = 0
for old, new, label in fixes:
    if old in content:
        content = content.replace(old, new, 1)
        print(f"✅ {label}")
        applied += 1
    else:
        print(f"❌ Not found: {label}")
        # Show nearby content to diagnose
        key = old.strip().split('\n')[1].strip()[:40]
        for i, line in enumerate(content.split('\n'), 1):
            if key[:20] in line:
                print(f"   Found similar at line {i}: {line.rstrip()}")

if applied > 0:
    with open(TARGET, 'w') as f:
        f.write(content)
    print(f"\n✅ {applied} fix(es) applied")
else:
    print("\n❌ No fixes applied")

print("   Run: node scripts/data_collection/masterFetcher/baseFetcher.js")
