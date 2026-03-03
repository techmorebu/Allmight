#!/usr/bin/env python3
"""
add_arb_weth_pools.py
Adds ARB/WETH pool configurations to arbitrumFetcher.js.

Pools added:
  1. ARB/WETH UniswapV3 0.3% -- 0xC6F780497A95e246EB9449f5e4770916DCd6396A
     DexScreener: $4.7M/24h volume, $1.28M liquidity
  2. ARB/WETH UniswapV3 0.05% -- discovered via Uniswap V3 factory
  3. ARB/USDC UniswapV3 0.3% -- 0x...  (secondary)

These give spread_monitor a new cross-venue arbitrage path:
  ARB/WETH uniswap_v3 -> sushiswap (if Sushi has ARB/WETH)
  ARB/WETH uniswap_v3 0.3% -> uniswap_v3 0.05% (fee tier arb)

Run from ~/Allmight:  python3 add_arb_weth_pools.py
"""
import sys, re
from pathlib import Path

TARGET = Path("scripts/data_collection/masterFetcher/arbitrumFetcher.js")
BACKUP = Path("logs/backups/arbitrumFetcher.pre_arb_weth.bak")

if not TARGET.exists():
    print(f"ERROR: {TARGET} not found. Run from ~/Allmight."); sys.exit(1)

src = TARGET.read_text()
Path("logs/backups").mkdir(exist_ok=True)
BACKUP.write_text(src)
print(f"Backup saved: {BACKUP}")

# ── New pool entries to inject ────────────────────────────────────────────────
NEW_POOLS = '''    // ── ARB pools (added by add_arb_weth_pools.py) ───────────────────────────
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
    },
'''

# Inject before the closing bracket of UNISWAP_V3_POOLS
# Find the last pool entry closing brace before the array closes
insert_marker = "    // ── 0.05% stablecoin pools (for comparison) ────────────────────────────"

if insert_marker in src:
    src = src.replace(insert_marker, NEW_POOLS + insert_marker)
    print("Pools injected before stablecoin comparison section")
else:
    # Fallback: inject before closing ]; of UNISWAP_V3_POOLS
    # Find the pattern: last },\n]; in UNISWAP_V3_POOLS
    old_close = "    },\n];\n\n// ── Camelot V2 pools"
    new_close  = "    },\n" + NEW_POOLS + "];\n\n// ── Camelot V2 pools"
    if old_close in src:
        src = src.replace(old_close, new_close)
        print("Pools injected before Camelot section (fallback)")
    else:
        print("ERROR: Could not find injection point. Manual edit needed.")
        print("Add this to UNISWAP_V3_POOLS array in:", TARGET)
        print(NEW_POOLS)
        sys.exit(1)

# ── Also update token address comments ───────────────────────────────────────
old_comment = "// WETH:   0x82aF49447D8a07e3bd95BD0d56f35241523fBab1\n// USDC:   0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
new_comment = "// WETH:   0x82aF49447D8a07e3bd95BD0d56f35241523fBab1\n// USDC:   0xaf88d065e77c8cC2239327C5EDb3A432268e5831\n// ARB:    0x912CE59144191C1204E64559FE8253a0e49E6548\n// WBTC:   0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"
src = src.replace(old_comment, new_comment)

# ── Write ─────────────────────────────────────────────────────────────────────
TARGET.write_text(src)
print(f"Written: {TARGET}")

# ── Verify ────────────────────────────────────────────────────────────────────
result = TARGET.read_text()
checks = ["ARB/WETH", "ARB/USDC", "WBTC/WETH", "C6F780497A95e246EB9449f5e4770916DCd6396A"]
all_ok = True
for c in checks:
    if c in result:
        print(f"  ✅ {c}")
    else:
        print(f"  ❌ MISSING: {c}")
        all_ok = False

if all_ok:
    print("\nAll pools added successfully.")
    print("\nTest with:")
    print("  node scripts/data_collection/masterFetcher/arbitrumFetcher.js")
    print("\nThen restart fetcher to pick up new pools:")
    print("  kill $(grep fetcher logs/pids.txt | cut -d= -f2)")
    print("  sed -i '/^fetcher=/d' logs/pids.txt")
    print("  bash -c 'while true; do node scripts/master-fetcher.js once; sleep 60; done' >> logs/fetcher.log 2>&1 &")
    print("  echo fetcher=$! >> logs/pids.txt")
else:
    print("\nSome pools missing -- check file manually.")
