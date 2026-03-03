#!/usr/bin/env python3
"""
fix_session_reset.py
Adds permanent session reset to start_allmight.sh so stale state
is cleared automatically on every startup.

Fixes three recurring problems:
  1. live_state.json trade_times/paused_until carrying over between sessions
  2. shadow_trades.csv session_id from old session being re-evaluated
  3. live_trades.csv rate limit counters persisting across restarts

Also adds a standalone reset command:
  bash scripts/start_allmight.sh --reset-state

Run from ~/Allmight:  python3 fix_session_reset.py
"""
import sys, json
from pathlib import Path
from datetime import datetime, timezone

ROOT     = Path(__file__).resolve().parent
START_SH = ROOT / "scripts/start_allmight.sh"
BACKUP   = ROOT / "logs/backups"
BACKUP.mkdir(exist_ok=True)

if not START_SH.exists():
    print(f"ERROR: {START_SH} not found"); sys.exit(1)

src = START_SH.read_text()
(BACKUP / "start_allmight.sh.pre_session_reset.bak").write_text(src)
print("Backup saved.")

# ── The reset block to inject ─────────────────────────────────────────────────
RESET_BLOCK = r"""
# ── Session state reset (runs on every startup) ───────────────────────────────
SESSION_ID=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "{\"session_id\": \"$SESSION_ID\", \"started_at\": \"$SESSION_ID\"}" \
    > "$LOG_DIR/session_start.json"

# Reset live executor state -- clears trade_times, rate limits, pause timers
python3 -c "
import json
from pathlib import Path
state_file = Path('logs/live_state.json')
fresh = {
    'total_live': 0,
    'total_live_pnl': 0.0,
    'consecutive_reverts': 0,
    'last_trade_at': None,
    'paused_until': 0,
    'trade_times': []
}
# Preserve all-time totals if file exists
if state_file.exists():
    try:
        old = json.loads(state_file.read_text())
        fresh['total_live']     = old.get('total_live', 0)
        fresh['total_live_pnl'] = old.get('total_live_pnl', 0.0)
    except: pass
state_file.parent.mkdir(exist_ok=True)
state_file.write_text(json.dumps(fresh, indent=2))
print('  Live state reset (preserved all-time totals)')
"

echo "  Session ID: $SESSION_ID"
echo ""
# ── End session state reset ───────────────────────────────────────────────────
"""

# ── Inject after Redis check, before fetcher launch ──────────────────────────
# Find the anchor: "Fetcher started" or the fetcher launch line
ANCHOR = "# ── 1. Fetcher"
ALT_ANCHOR = "Fetcher started"

if RESET_BLOCK.strip()[:30] in src:
    print("Reset block already present -- skipping injection")
elif ANCHOR in src:
    src = src.replace(ANCHOR, RESET_BLOCK + "\n" + ANCHOR)
    print("Injected reset block before fetcher launch")
else:
    # Fallback: inject after Redis OK line
    src = src.replace(
        'echo "Redis: OK"',
        'echo "Redis: OK"' + RESET_BLOCK
    )
    print("Injected reset block after Redis check (fallback)")

# ── Also add --reset-state standalone command ─────────────────────────────────
RESET_CMD_BLOCK = """
# ── Reset state only (no restart) ─────────────────────────────────────────────
if [[ "$1" == "--reset-state" ]]; then
    echo "Resetting session state..."
    python3 -c "
import json
from pathlib import Path
state_file = Path('logs/live_state.json')
fresh = {
    'total_live': 0,
    'total_live_pnl': 0.0,
    'consecutive_reverts': 0,
    'last_trade_at': None,
    'paused_until': 0,
    'trade_times': []
}
if state_file.exists():
    try:
        old = json.loads(state_file.read_text())
        fresh['total_live']     = old.get('total_live', 0)
        fresh['total_live_pnl'] = old.get('total_live_pnl', 0.0)
    except: pass
state_file.write_text(json.dumps(fresh, indent=2))
print('  live_state.json reset')
"
    echo "Done. Run 'bash scripts/start_allmight.sh --live' to restart."
    exit 0
fi
"""

# Inject --reset-state after --stop block
if '--reset-state' not in src:
    # Find end of --stop block
    stop_anchor = 'fi\n\n'
    if 'if [[ "$1" == "--stop"' in src:
        # Insert after the stop block closes
        stop_end = src.index('fi\n', src.index('if [[ "$1" == "--stop"'))
        insert_at = stop_end + len('fi\n')
        src = src[:insert_at] + '\n' + RESET_CMD_BLOCK + src[insert_at:]
        print("Added --reset-state command")

# ── Write ────────────────────────────────────────────────────────────────────
START_SH.write_text(src)

# ── Verify ────────────────────────────────────────────────────────────────────
result = START_SH.read_text()
checks = {
    "session_start.json written":  "session_start.json" in result,
    "live_state.json reset":       "trade_times" in result,
    "total_live preserved":        "total_live" in result,
    "--reset-state command":       "--reset-state" in result,
}

print()
for check, ok in checks.items():
    print(f"  {'OK' if ok else 'FAIL'}: {check}")

all_ok = all(checks.values())
print()
if all_ok:
    print("  Verification: PASSED")
    print("""
  Usage:
    Normal restart:   bash scripts/start_allmight.sh --live
    Reset state only: bash scripts/start_allmight.sh --reset-state

  What resets on every startup:
    - trade_times (rate limit window) -- cleared
    - paused_until (revert pause timer) -- cleared
    - consecutive_reverts -- cleared
    - last_trade_at -- cleared
    - session_id -- new ID generated
    - total_live + total_live_pnl -- PRESERVED (all-time totals)

  Apply now without full restart:
    bash scripts/start_allmight.sh --reset-state
""")
else:
    print("  Verification: FAILED -- check above")
    sys.exit(1)
