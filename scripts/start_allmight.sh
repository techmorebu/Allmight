#!/usr/bin/env bash
# scripts/start_allmight.sh
#
# Starts all AllMight processes in the correct order:
#   1. Master fetcher loop  (writes to Redis every 60s)
#   2. Spread monitor       (reads Redis, logs CSV)
#   3. Shadow mode          (reads Redis, simulates trades)
#
# Usage:
#   bash scripts/start_allmight.sh
#   bash scripts/start_allmight.sh --stop   (kill all three)
#
# Logs:
#   logs/fetcher.log
#   logs/monitor.log
#   logs/shadow.log
#   logs/pids.txt

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO/logs"
PID_FILE="$LOG_DIR/pids.txt"
INTERVAL=60

mkdir -p "$LOG_DIR"

# ── Stop mode ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
    if [[ ! -f "$PID_FILE" ]]; then
        echo "No PID file found -- nothing to stop"
        exit 0
    fi
    echo "Stopping AllMight processes..."
    while IFS='=' read -r name pid; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" && echo "  Stopped $name (PID $pid)"
        else
            echo "  $name (PID $pid) already stopped"
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
    echo "Done."
    python3 -c "
import sys; sys.path.insert(0,'$(pwd)')
from utils.discord_alerts import discord
discord.shutdown('Manual stop via start_allmight.sh --stop')
" 2>/dev/null || true
    exit 0
fi

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

# ── Check nothing already running ────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
    echo "WARNING: PID file exists. Already running? Run with --stop first."
    cat "$PID_FILE"
    exit 1
fi

# ── Kill orphan metrics_engine daemons ───────────────────────────────────────
ORPHANS=$(pgrep -fc "metrics_engine.py --daemon" 2>/dev/null || true)
if [[ "$ORPHANS" -gt 0 ]]; then
    echo "Killing $ORPHANS orphan metrics_engine daemon(s)..."
    pkill -f "metrics_engine.py --daemon" 2>/dev/null || true
    sleep 1
fi

# ── Load env ──────────────────────────────────────────────────────────────────
cd "$REPO"
set -a && source .env && set +a

# ── Check Redis is up ─────────────────────────────────────────────────────────
if ! redis-cli ping > /dev/null 2>&1; then
    echo "ERROR: Redis not responding. Start Redis first:"
    echo "  sudo systemctl start redis"
    exit 1
fi
echo "Redis: OK"
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

redis-cli --scan --pattern "fetcher:*" | xargs -r redis-cli del > /dev/null 2>&1
echo "Redis: stale keys cleared"

# ── 1. Master fetcher loop ────────────────────────────────────────────────────
# Runs node scripts/master-fetcher.js once every INTERVAL seconds
(
    while true; do
        node "$REPO/scripts/master-fetcher.js" once 2>&1
        sleep "$INTERVAL"
    done
) >> "$LOG_DIR/fetcher.log" 2>&1 &
FETCHER_PID=$!
echo "fetcher=$FETCHER_PID" >> "$PID_FILE"
echo "Fetcher started (PID $FETCHER_PID) -- logs/fetcher.log"

# Give fetcher time to populate Redis before monitor starts
echo "Waiting 35s for initial Redis population..."
sleep 35

# ── 2. Spread monitor ─────────────────────────────────────────────────────────
python3 -u "$REPO/scripts/spread_monitor.py" \
    --chain all \
    --interval "$INTERVAL" \
    --no-fetch \
    >> "$LOG_DIR/monitor.log" 2>&1 &
MONITOR_PID=$!
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
echo "Monitor started (PID $MONITOR_PID) -- logs/monitor.log"

# ── 3. Shadow mode ────────────────────────────────────────────────────────────
LIVE_FLAG=""
if [[ "$*" == *"--live"* ]]; then
  LIVE_FLAG="--live"
  echo "  LIVE MODE -- real on-chain transactions"
else
  echo "  SHADOW MODE -- simulation only"
fi

python3 -u "$REPO/scripts/execution/shadow_mode.py" \
    --min-edge 0 \
    --size 1000 \
    --interval "$INTERVAL" \
  $LIVE_FLAG \
    >> "$LOG_DIR/shadow.log" 2>&1 &
SHADOW_PID=$!
echo "shadow=$SHADOW_PID" >> "$PID_FILE"
echo "Shadow started (PID $SHADOW_PID) -- logs/shadow.log"


# ── 4. Metrics engine daemon ──────────────────────────────────────────────────
python3 -u "$REPO/utils/metrics_engine.py" --daemon \
    >> "$LOG_DIR/metrics.log" 2>&1 &
METRICS_PID=$!
echo "metrics=$METRICS_PID" >> "$PID_FILE"
echo "Metrics engine started (PID $METRICS_PID) -- logs/metrics.log"

# ── 4. Watchdog ──────────────────────────────────────────────────────────────
python3 -u "$REPO/scripts/watchdog.py" >> "$LOG_DIR/watchdog.log" 2>&1 &
WATCHDOG_PID=$!
echo "watchdog=$WATCHDOG_PID" >> "$PID_FILE"
echo "Watchdog started (PID $WATCHDOG_PID) -- logs/watchdog.log"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "AllMight running. PIDs saved to $PID_FILE"

# Notify Discord -- system online
python3 -c "
import sys; sys.path.insert(0,'$REPO')
from utils.discord_alerts import discord
import re
pids = {}
try:
    for line in open('$PID_FILE').read().splitlines():
        if '=' in line:
            k,v = line.split('=',1)
            pids[k.strip()] = int(v.strip())
except: pass
discord.startup(pids)
" 2>/dev/null || true
echo ""
echo "Monitor live output:"
echo "  tail -f logs/fetcher.log"
echo "  tail -f logs/monitor.log"
echo "  tail -f logs/shadow.log"
echo ""
echo "Check MVI gate:"
echo "  python3 scripts/execution/shadow_mode.py --report"
echo ""
echo "Stop everything:"
echo "  bash scripts/start_allmight.sh --stop"
