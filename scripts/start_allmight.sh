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
    exit 0
fi

# ── Check nothing already running ────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
    echo "WARNING: PID file exists. Already running? Run with --stop first."
    cat "$PID_FILE"
    exit 1
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
echo "Waiting 15s for initial Redis population..."
sleep 15

# ── 2. Spread monitor ─────────────────────────────────────────────────────────
python3 "$REPO/scripts/spread_monitor.py" \
    --chain all \
    --interval "$INTERVAL" \
    >> "$LOG_DIR/monitor.log" 2>&1 &
MONITOR_PID=$!
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
echo "Monitor started (PID $MONITOR_PID) -- logs/monitor.log"

# ── 3. Shadow mode ────────────────────────────────────────────────────────────
python3 "$REPO/scripts/execution/shadow_mode.py" \
    --min-edge 0 \
    --size 1000 \
    --interval "$INTERVAL" \
    >> "$LOG_DIR/shadow.log" 2>&1 &
SHADOW_PID=$!
echo "shadow=$SHADOW_PID" >> "$PID_FILE"
echo "Shadow started (PID $SHADOW_PID) -- logs/shadow.log"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "AllMight running. PIDs saved to $PID_FILE"
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
