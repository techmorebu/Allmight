#!/usr/bin/env python3
"""
fix_arb_pools2.py
Final fix for ARB pool configurations in arbitrumFetcher.js.

Key insight:
  - ARB/WETH pool 0xC6F780: token0=WETH, token1=ARB
  - sqrtPriceX96 'direct' gives WETH/ARB ratio directly
  - Expected: ~0.000216 WETH per ARB ($0.40 at $1852/ETH)
  - Getting:  ~0.000050 -- pool may have low liquidity or wrong address
  - Using a higher-liquidity pool: 0x92c63d0e701cAe98798B2b2052212cb9649E7afe (0.05% fee)
  
  ARB/USDC: fix checksum on address

Run from ~/Allmight:  python3 fix_arb_pools2.py
"""
import sys
from pathlib import Path

TARGET = Path("scripts/data_collection/masterFetcher/arbitrumFetcher.js")
if not TARGET.exists():
    print(f"ERROR: {TARGET} not found"); sys.exit(1)

src = TARGET.read_text()
Path("logs/backups").mkdir(exist_ok=True)
Path("logs/backups/arbitrumFetcher.pre_fix2.bak").write_text(src)

old_block = '''    // ── ARB pools (fixed token order -- WETH=token0, ARB=token1) ───────────
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

new_block = '''    // ── ARB pools ─────────────────────────────────────────────────────────────
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

if old_block in src:
    src = src.replace(old_block, new_block)
    TARGET.write_text(src)
    print("Fixed. Testing...")
    import subprocess
    r = subprocess.run(
        ['node', str(TARGET)],
        capture_output=True, text=True, cwd=str(TARGET.parent.parent.parent.parent)
    )
    for line in r.stdout.splitlines():
        if any(x in line for x in ['ARB','WBTC','ERROR','error','bad']):
            print(' ', line)
    if r.stderr:
        for line in r.stderr.splitlines():
            if any(x in line for x in ['ARB','WBTC','ERROR','bad']):
                print('  ERR:', line[:100])
    print("\nIf ARB/WETH shows ~0.000216 and ARB/USDC shows ~$0.40, run:")
    print("  kill $(grep fetcher logs/pids.txt | cut -d= -f2)")
    print("  sed -i '/^fetcher=/d' logs/pids.txt")
    print("  bash -c 'while true; do node scripts/master-fetcher.js once; sleep 60; done' >> logs/fetcher.log 2>&1 &")
    print("  echo fetcher=$! >> logs/pids.txt")
else:
    print("ERROR: pattern not found")
    # Show what the current ARB block looks like
    lines = src.splitlines()
    for i, l in enumerate(lines):
        if 'ARB' in l and ('pool' in l.lower() or 'outputPair' in l):
            print(f"  Line {i+1}: {l}")
    sys.exit(1)
