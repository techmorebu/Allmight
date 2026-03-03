#!/usr/bin/env python3
"""
inject_reset_state.py
Injects --reset-state command into start_allmight.sh and
immediately resets live_state.json for the current session.

Run from ~/Allmight:  python3 inject_reset_state.py
"""
import json, sys
from pathlib import Path

ROOT     = Path(__file__).resolve().parent
START_SH = ROOT / "scripts/start_allmight.sh"
BACKUP   = ROOT / "logs/backups"
BACKUP.mkdir(exist_ok=True)

if not START_SH.exists():
    print(f"ERROR: {START_SH} not found"); sys.exit(1)

src = START_SH.read_text()
(BACKUP / "start_allmight.sh.pre_reset_cmd.bak").write_text(src)

RESET_BLOCK = """
# ── Reset state only (no restart) ─────────────────────────────────────────────
if [[ "${1:-}" == "--reset-state" ]]; then
    echo "Resetting session state..."
    python3 -u -c "
import json
from pathlib import Path
state_file = Path('logs/live_state.json')
old = {}
if state_file.exists():
    try: old = json.loads(state_file.read_text())
    except: pass
fresh = {
    'total_live':          old.get('total_live', 0),
    'total_live_pnl':      old.get('total_live_pnl', 0.0),
    'consecutive_reverts': 0,
    'last_trade_at':       None,
    'paused_until':        0,
    'trade_times':         [],
}
state_file.write_text(json.dumps(fresh, indent=2))
print('  live_state.json reset (all-time totals preserved)')
print('  trade_times cleared, rate limits reset, pause timers cleared')
"
    echo "Done."
    exit 0
fi
"""

# Find insertion point: right after the --stop fi block
# The stop block ends with:  exit 0\nfi\n
ANCHOR = "    exit 0\nfi\n"

if "--reset-state" in src:
    print("--reset-state already present in start_allmight.sh")
elif ANCHOR in src:
    src = src.replace(ANCHOR, ANCHOR + RESET_BLOCK, 1)
    START_SH.write_text(src)
    print("OK: --reset-state injected into start_allmight.sh")
else:
    print("ERROR: Could not find insertion anchor")
    print("Anchor searched for:")
    print(repr(ANCHOR))
    # Show what the end of the stop block looks like
    if "exit 0" in src:
        idx = src.index("exit 0")
        print("Context around 'exit 0':")
        print(repr(src[idx-20:idx+40]))
    sys.exit(1)

# Verify
result = START_SH.read_text()
if "--reset-state" in result:
    print("Verification: PASSED")
else:
    print("Verification: FAILED")
    sys.exit(1)

# ── Also reset live_state.json RIGHT NOW ─────────────────────────────────────
state_file = ROOT / "logs/live_state.json"
old = {}
if state_file.exists():
    try: old = json.loads(state_file.read_text())
    except: pass

fresh = {
    "total_live":          old.get("total_live", 0),
    "total_live_pnl":      old.get("total_live_pnl", 0.0),
    "consecutive_reverts": 0,
    "last_trade_at":       None,
    "paused_until":        0,
    "trade_times":         [],
}
state_file.write_text(json.dumps(fresh, indent=2))
print(f"\nLive state reset NOW:")
print(f"  total_live preserved:     {fresh['total_live']}")
print(f"  total_live_pnl preserved: ${fresh['total_live_pnl']:.4f}")
print(f"  trade_times cleared:      0 entries")
print(f"  paused_until cleared:     0")
print(f"  consecutive_reverts:      0")

print("""
Usage going forward:
  bash scripts/start_allmight.sh --reset-state   # clear state only
  bash scripts/start_allmight.sh --live          # full restart (auto-resets)
""")
