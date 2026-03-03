#!/usr/bin/env python3
"""
expand_fee_walls.py
Adds new validated trading pairs to FEE_WALLS in shadow_mode.py.
Also fixes --live flag in start_allmight.sh restart command.

New pairs added (all venue names confirmed from live Redis data):
  ETH/USDC  uniswap_v3  <-> camelot_v2   arbitrum  fee_wall=35bps
  USDC/USDT uniswap_v3  <-> curve        arbitrum  fee_wall=5bps
  ETH/USDC  uniswap_v3  <-> velodrome    optimism  fee_wall=8bps (near-miss monitor)
  ETH/USDC  uniswap_v3  <-> aerodrome    base      fee_wall=8bps (near-miss monitor)

Run from ~/Allmight:  python3 expand_fee_walls.py
"""
import sys, re
from pathlib import Path

SHADOW = Path("scripts/execution/shadow_mode.py")
START  = Path("scripts/start_allmight.sh")

if not SHADOW.exists():
    print(f"ERROR: {SHADOW} not found"); sys.exit(1)

src = SHADOW.read_text()
Path("logs/backups").mkdir(exist_ok=True)
Path("logs/backups/shadow_mode.pre_fee_walls.bak").write_text(src)

# ── Replace FEE_WALLS block ───────────────────────────────────────────────────
old_walls = '''FEE_WALLS = {
    # ── Arbitrum PRIORITY 1 -- confirmed gross-positive signal ───────────────
    # ETH/USDT UniV3 <-> Curve: observed 0.5-151 bps, fires daily
    ("ETH/USDT",   "uniswap_v3", "curve"):        10,
    ("ETH/USDT",   "curve",      "uniswap_v3"):   10,

    # USDC/USDCe UniV3 <-> UniV3: -2.71 bps best, near-miss
    ("USDC/USDCe", "uniswap_v3", "uniswap_v3"):    6,
    ("USDCe/USDC", "uniswap_v3", "uniswap_v3"):    6,

    # ── Optimism PRIORITY 2 -- near-miss, monitor only ────────────────────────
    # USDCe/USDT Velodrome <-> UniV3: -1.73 bps best, 3 bps fee wall
    ("USDCe/USDT", "velodrome",  "uniswap_v3"):    3,
    ("USDCe/USDT", "uniswap_v3", "velodrome"):     3,
}'''

new_walls = '''FEE_WALLS = {
    # ── Arbitrum PRIORITY 1 -- confirmed gross-positive signal ───────────────
    # ETH/USDT UniV3 <-> Curve: observed 0.5-151 bps, fires daily
    ("ETH/USDT",   "uniswap_v3", "curve"):        10,
    ("ETH/USDT",   "curve",      "uniswap_v3"):   10,

    # ETH/USDC UniV3 <-> Camelot V2: 21.75bps spread observed 2026-02-25
    # fee wall = UniV3 0.05% (5bps) + Camelot 0.3% (30bps) = 35bps total
    ("ETH/USDC",   "uniswap_v3", "camelot_v2"):   35,
    ("ETH/USDC",   "camelot_v2", "uniswap_v3"):   35,

    # USDC/USDT UniV3 <-> Curve: stablecoin arb, fee wall = ~5bps
    # curve fee ~0bps + UniV3 0.01% (1bps) = 5bps (flash loan 4bps + gas)
    ("USDC/USDT",  "uniswap_v3", "curve"):         5,
    ("USDC/USDT",  "curve",      "uniswap_v3"):    5,

    # USDC/USDT UniV3 0.01% <-> UniV3 0.05%: same venue different fee tiers
    ("USDC/USDT",  "uniswap_v3", "uniswap_v3"):    6,

    # USDC/USDCe UniV3 <-> UniV3: -2.71 bps best, near-miss
    ("USDC/USDCe", "uniswap_v3", "uniswap_v3"):    6,
    ("USDCe/USDC", "uniswap_v3", "uniswap_v3"):    6,

    # ── Optimism PRIORITY 2 -- near-miss, monitor only ────────────────────────
    # USDCe/USDT Velodrome <-> UniV3: -1.73 bps best, 3 bps fee wall
    ("USDCe/USDT", "velodrome",  "uniswap_v3"):    3,
    ("USDCe/USDT", "uniswap_v3", "velodrome"):     3,

    # ETH/USDC UniV3 <-> Velodrome (Optimism): monitor only
    ("ETH/USDC",   "uniswap_v3", "velodrome"):     8,
    ("ETH/USDC",   "velodrome",  "uniswap_v3"):    8,

    # ETH/USDC UniV3 <-> Aerodrome (Base): monitor only
    ("ETH/USDC",   "uniswap_v3", "aerodrome"):     8,
    ("ETH/USDC",   "aerodrome",  "uniswap_v3"):    8,
}'''

if old_walls in src:
    src = src.replace(old_walls, new_walls)
    print("✅ FEE_WALLS expanded with 6 new trading pairs")
else:
    print("ERROR: FEE_WALLS block not found -- check for whitespace differences")
    # Show first 5 lines of actual block for debugging
    idx = src.find("FEE_WALLS = {")
    if idx >= 0:
        print("Current FEE_WALLS starts:")
        print(src[idx:idx+200])
    sys.exit(1)

SHADOW.write_text(src)

# ── Fix start_allmight.sh -- ensure --live flag is present ───────────────────
if START.exists():
    sh = START.read_text()
    # The INTERVAL variable controls both fetcher and shadow
    # Shadow needs --live flag -- check if it's there
    if '--live' not in sh:
        sh = sh.replace(
            '--interval "$INTERVAL" \\',
            '--interval "$INTERVAL" \\\n    --live \\'
        )
        START.write_text(sh)
        print("✅ Added --live flag to start_allmight.sh shadow command")
    else:
        print("✅ --live flag already in start_allmight.sh")
else:
    print("⚠ start_allmight.sh not found, skipping")

# ── Verify ────────────────────────────────────────────────────────────────────
result = SHADOW.read_text()
checks = [
    ('ETH/USDC uniswap_v3<->camelot_v2', '"ETH/USDC",   "uniswap_v3", "camelot_v2"'),
    ('USDC/USDT uniswap_v3<->curve',      '"USDC/USDT",  "uniswap_v3", "curve"'),
    ('ETH/USDC velodrome',                '"ETH/USDC",   "uniswap_v3", "velodrome"'),
    ('ETH/USDC aerodrome',                '"ETH/USDC",   "uniswap_v3", "aerodrome"'),
]
print()
for name, pattern in checks:
    ok = pattern in result
    print(f"  {'✅' if ok else '❌'} {name}")

print("""
Next steps:
1. Kill and restart shadow with --live flag:
   kill $(grep ^shadow= logs/pids.txt | cut -d= -f2) 2>/dev/null
   sed -i '/^shadow=/d' logs/pids.txt
   python3 -u scripts/execution/shadow_mode.py \\
       --min-edge 0 --size 1000 --interval 30 --live \\
       >> logs/shadow.log 2>&1 &
   echo "shadow=$!" >> logs/pids.txt

2. Run one-shot test to confirm new pairs are found:
   python3 scripts/execution/shadow_mode.py --min-edge 0 --size 1000 --interval 30 --once 2>&1 | grep -E "EXECUTE|SKIP|candidate|ETH/USDC|USDC/USDT"

3. Monitor for first live trade:
   tail -f logs/shadow.log | grep -E "LIVE|EXECUTE|REVERT|bps"
""")
