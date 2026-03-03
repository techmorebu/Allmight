#!/usr/bin/env python3
"""
add_arb_weth.py
Does two things:
  1. Adds ARB/WETH + ARB/USDC pools to arbitrumFetcher.js
  2. Fixes start_allmight.sh to pass --live flag correctly to shadow_mode

Run from ~/Allmight:  python3 add_arb_weth.py
"""
import sys, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ── File paths ────────────────────────────────────────────────────────────────
FETCHER  = ROOT / "scripts/data_collection/masterFetcher/arbitrumFetcher.js"
START_SH = ROOT / "scripts/start_allmight.sh"
BACKUP   = ROOT / "logs/backups"
BACKUP.mkdir(exist_ok=True)

errors = []

# ══════════════════════════════════════════════════════════════════════════════
# FIX 1: Add ARB/WETH and ARB/USDC to arbitrumFetcher.js
# ══════════════════════════════════════════════════════════════════════════════
print("\n── Fix 1: arbitrumFetcher.js ────────────────────────────────────────")

if not FETCHER.exists():
    print(f"  ERROR: {FETCHER} not found"); errors.append("fetcher missing")
else:
    src = FETCHER.read_text()
    (BACKUP / "arbitrumFetcher.js.bak").write_text(src)

    NEW_POOLS = """
    // ── ARB pools (added by add_arb_weth.py) ──────────────────────────────
    // ARB/WETH 0.05% -- verified on-chain 2026-02-25
    // t0=WETH(0x82aF...), t1=ARB(0x912CE...), fee=500, liq=695T
    // DexScreener: $4.7M/24h volume, $1.28M liquidity
    {
        outputPair: 'ARB/WETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,   // WETH (token0)
        decimals1:  18,   // ARB  (token1)
        fee:        500,
        priceMode:  'inverse',  // ARB price in WETH terms
    },
    // ARB/USDC 0.05% -- high volume pair
    // DexScreener: $137k/24h volume, $263k liquidity
    {
        outputPair: 'ARB/USDC',
        pool:       '0xb0f6cA40411360c03d41C5fFa5f8b5C6e5B3B9dA',
        decimals0:  18,   // ARB  (token0)
        decimals1:  6,    // USDC (token1)
        fee:        500,
        priceMode:  'direct',
    },"""

    # Check if already added
    if 'ARB/WETH' in src:
        print("  Skipped: ARB/WETH already present")
    else:
        # Insert after the last entry in UNISWAP_V3_POOLS before CAMELOT_POOLS
        # Find the closing of UNISWAP_V3_POOLS
        if 'const CAMELOT_POOLS' in src:
            src = src.replace(
                'const CAMELOT_POOLS',
                f'{NEW_POOLS}\n];\n\nconst CAMELOT_POOLS_PLACEHOLDER'
            )
            # That would break it -- do it properly
            src = FETCHER.read_text()  # reload clean

            # Find insertion point: last }. before const CAMELOT_POOLS
            camelot_idx = src.index('const CAMELOT_POOLS')
            # Find last '},' or '}' before that
            insert_before = src.rfind('];', 0, camelot_idx)
            if insert_before == -1:
                print("  ERROR: Could not find UNISWAP_V3_POOLS closing bracket")
                errors.append("fetcher insert failed")
            else:
                src = src[:insert_before] + NEW_POOLS + '\n' + src[insert_before:]
                FETCHER.write_text(src)
                if 'ARB/WETH' in FETCHER.read_text():
                    print("  OK: ARB/WETH + ARB/USDC pools added")
                else:
                    print("  ERROR: Insert failed")
                    errors.append("arb/weth insert failed")
        else:
            print("  ERROR: Could not find CAMELOT_POOLS anchor")
            errors.append("no camelot anchor")

# ══════════════════════════════════════════════════════════════════════════════
# FIX 2: Fix start_allmight.sh shadow launch block
# ══════════════════════════════════════════════════════════════════════════════
print("\n── Fix 2: start_allmight.sh ─────────────────────────────────────────")

if not START_SH.exists():
    print(f"  ERROR: {START_SH} not found"); errors.append("start_sh missing")
else:
    src = START_SH.read_text()
    (BACKUP / "start_allmight.sh.bak").write_text(src)

    # Check current shadow launch block
    has_live_flag  = 'LIVE_FLAG' in src
    has_u_flag     = 'python3 -u' in src or 'python3 -u "$REPO' in src

    print(f"  LIVE_FLAG logic present: {has_live_flag}")
    print(f"  -u flag present:         {has_u_flag}")

    changed = False

    # Ensure -u is on the shadow launch line
    if 'python3 "$REPO/scripts/execution/shadow_mode.py"' in src:
        src = src.replace(
            'python3 "$REPO/scripts/execution/shadow_mode.py"',
            'python3 -u "$REPO/scripts/execution/shadow_mode.py"'
        )
        changed = True
        print("  Fixed: added -u to shadow launch")

    # Ensure -u is on monitor, metrics, watchdog
    for script in ['spread_monitor.py', 'metrics_engine.py', 'watchdog.py']:
        old = f'python3 "$REPO/'
        # Only fix lines that don't already have -u
        lines = src.splitlines()
        new_lines = []
        for line in lines:
            if f'python3 "$REPO/' in line and script in line and 'python3 -u' not in line:
                line = line.replace('python3 "$REPO/', 'python3 -u "$REPO/')
                changed = True
            new_lines.append(line)
        src = '\n'.join(new_lines)

    # Ensure LIVE_FLAG block exists
    if 'LIVE_FLAG' not in src:
        # Add it before the shadow python3 launch
        shadow_launch = 'python3 -u "$REPO/scripts/execution/shadow_mode.py"'
        if shadow_launch in src:
            src = src.replace(
                f'# ── 3. Shadow mode',
                '''# ── 3. Shadow mode
LIVE_FLAG=""
if [[ "$*" == *"--live"* ]]; then
  LIVE_FLAG="--live"
  echo "  LIVE MODE -- real on-chain transactions"
else
  echo "  SHADOW MODE -- simulation only"
fi
# ── 3. Shadow mode'''
            )
            changed = True
            print("  Fixed: added LIVE_FLAG block")

    # Ensure $LIVE_FLAG is passed to shadow_mode
    if 'LIVE_FLAG' in src and '$LIVE_FLAG' not in src:
        src = src.replace(
            '--interval "$INTERVAL" \\',
            '--interval "$INTERVAL" \\\n  $LIVE_FLAG \\'
        )
        changed = True
        print("  Fixed: added $LIVE_FLAG to shadow launch args")

    if changed:
        START_SH.write_text(src)
        print("  Saved.")
    else:
        print("  No changes needed.")

    # Verify --live is wired up
    result = START_SH.read_text()
    live_ok = 'LIVE_FLAG' in result and '$LIVE_FLAG' in result
    u_ok    = 'python3 -u "$REPO/scripts/execution/shadow_mode.py"' in result
    print(f"  Verify --live wired: {live_ok}")
    print(f"  Verify -u flag:      {u_ok}")
    if not live_ok: errors.append("live_flag not wired")

# ── Summary ───────────────────────────────────────────────────────────────────
print("\n" + "="*52)
if errors:
    print(f"  ERRORS: {errors}")
    print("  Manual intervention needed -- see above")
else:
    print("  All fixes applied successfully")
    print("""
  Next steps:
    1. Restart AllMight with live mode:
       bash scripts/start_allmight.sh --stop
       sleep 2
       bash scripts/start_allmight.sh --live

    2. Verify shadow shows LIVE MODE:
       tail -5 logs/shadow.log

    3. Watch for ARB/WETH data in Redis:
       redis-cli keys "fetcher:arbitrumFetcher" | head -5
       sleep 65 && redis-cli get fetcher:arbitrumFetcher | python3 -c "
import sys,json; d=json.load(sys.stdin)
pairs = d.get('data',{}).get('pairs',[])
for p in pairs: print(p.get('pair'), p.get('price'))
"
""")
print("="*52)
