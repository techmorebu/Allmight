#!/usr/bin/env bash
# start_all.sh — AllMight Session Launcher v2
# Usage:
#   bash start_all.sh           — start session
#   bash start_all.sh --stop    — stop + final metrics + Discord stop summary
#   bash start_all.sh --status  — check running processes
#   bash start_all.sh --metrics — show shadow PnL + gate score + lifetime totals

set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$REPO/logs"
PID_FILE="$LOG_DIR/pids.txt"
SESSION_FILE="$LOG_DIR/allmight.session"

# ─── STOP ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
  echo ""
  echo "======================================================="
  echo "  AllMight -- Stopping Session"
  SESSION_ID=""
  [[ -f "$SESSION_FILE" ]] && SESSION_ID=$(cat "$SESSION_FILE") && echo "  Session: $SESSION_ID"

  if [[ -f "$PID_FILE" ]]; then
    while IFS='=' read -r name pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "  Stopped $name (PID $pid)" || true
      else
        echo "  $name already stopped"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  else
    echo "  No PID file found"
  fi

  if [[ -n "$SESSION_ID" ]]; then
    SESSION_DIR="$LOG_DIR/sessions/session_${SESSION_ID}"
    echo ""
    echo "  Computing final shadow execution metrics..."
    node "$REPO/scripts/execution/shadow_execution_engine.js" \
      --session "$SESSION_DIR" 2>/dev/null || echo "  (shadow engine: no data)"

    echo "  Updating lifetime project metrics..."
    node "$REPO/scripts/tools/project_metrics_tracker.js" --summary 2>/dev/null || echo "  (metrics: unavailable)"

    echo "  Sending Discord stop summary..."
    node -r dotenv/config "$REPO/scripts/monitoring/notification_router.js" \
      --stop-summary "$SESSION_DIR" 2>/dev/null || echo "  (Discord: unavailable)"
  fi

  echo ""
  echo "  Mark C9 (Boss summary) to count toward confidence:"
  echo "  node scripts/tools/dryrun_confidence_log.js --mark-c9 $SESSION_DIR"
  echo "======================================================="
  exit 0
fi

# ─── STATUS ──────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--status" ]]; then
  echo ""
  echo "======================================================="
  echo "  AllMight -- Process Status"
  if [[ -f "$PID_FILE" ]]; then
    while IFS='=' read -r name pid; do
      kill -0 "$pid" 2>/dev/null && echo "  [OK]   $name (PID $pid)" || echo "  [DEAD] $name (PID $pid)"
    done < "$PID_FILE"
  else
    echo "  No PID file"
  fi
  [[ -f "$SESSION_FILE" ]] && echo "  Session: $(cat "$SESSION_FILE")"
  echo "======================================================="
  exit 0
fi

# ─── METRICS ONLY ────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--metrics" ]]; then
  cd "$REPO"
  echo ""
  echo "-- Gate Score --"
  node scripts/execution/execution_gate_score.js 2>/dev/null || echo "(unavailable)"
  echo ""
  echo "-- Capital Policy --"
  node scripts/execution/capital_policy.js 2>/dev/null || echo "(unavailable)"
  echo ""
  if [[ -f "$SESSION_FILE" ]]; then
    SESSION_DIR="$LOG_DIR/sessions/session_$(cat "$SESSION_FILE")"
    echo "-- Shadow Execution (current session) --"
    node scripts/execution/shadow_execution_engine.js --session "$SESSION_DIR" 2>/dev/null || echo "(no data)"
    echo ""
  fi
  echo "-- Lifetime Metrics --"
  node scripts/tools/project_metrics_tracker.js --summary 2>/dev/null || echo "(unavailable)"
  exit 0
fi

# ─── GUARD: already running ──────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  echo "WARNING: PID file exists -- session may already be running"
  echo "  bash start_all.sh --status"
  echo "  bash start_all.sh --stop"
  exit 1
fi

# ─── LOAD ENV ────────────────────────────────────────────────────────────────
cd "$REPO"
set -a && source .env && set +a

# ─── SESSION ID ──────────────────────────────────────────────────────────────
SESSION_ID=$(date +%Y%m%d_%H%M)
SESSION_DIR="$LOG_DIR/sessions/session_${SESSION_ID}"
mkdir -p "$SESSION_DIR" "$LOG_DIR"
echo "$SESSION_ID" > "$SESSION_FILE"

echo ""
echo "======================================================="
echo "  AllMight -- Starting Session"
echo "  Session: $SESSION_ID"
echo "  Target:  4h minimum (C4) | 6-8h optimal | 24h strong"
echo "======================================================="

# ─── REDIS PREFLIGHT ─────────────────────────────────────────────────────────
echo ""
echo "-- Redis preflight --"
for i in $(seq 1 10); do
  if redis-cli ping > /dev/null 2>&1; then echo "  Redis OK"; break; fi
  if [[ $i -eq 10 ]]; then
    echo "  ERROR: Redis not responding. Run: sudo systemctl start redis"
    exit 1
  fi
  echo "  Redis waiting ($i/10)..."
  sleep 2
done
redis-cli --scan --pattern "fetcher:*" | xargs -r redis-cli del > /dev/null 2>&1 || true
echo "  Stale keys cleared"

# ─── PROTOCOL PREFLIGHT ──────────────────────────────────────────────────────
echo ""
echo "-- Protocol preflight --"
node "$REPO/scripts/execution/preflight_ramses_executor.js" 2>/dev/null \
  && echo "  Preflight passed" || echo "  Preflight skipped (non-blocking)"

# ─── 1. MASTER FETCHER ───────────────────────────────────────────────────────
echo ""
echo "-- 1. Master fetcher --"
(while true; do
  node "$REPO/scripts/master-fetcher.js" once 2>&1
  sleep 60
done) >> "$SESSION_DIR/fetcher.log" 2>&1 &
FETCHER_PID=$!
echo "fetcher=$FETCHER_PID" >> "$PID_FILE"
echo "  PID $FETCHER_PID"

echo "  Waiting 35s for Redis population..."
sleep 35

# ─── 2. ARB WINDOW ACTIVATOR ─────────────────────────────────────────────────
echo ""
echo "-- 2. Arb window activator --"
node "$REPO/scripts/arb_window_activator.js" \
  >> "$SESSION_DIR/activator.jsonl" 2>&1 &
ACTIVATOR_PID=$!
echo "activator=$ACTIVATOR_PID" >> "$PID_FILE"
echo "  PID $ACTIVATOR_PID"

# ─── 3. VOLATILITY MONITOR ───────────────────────────────────────────────────
echo ""
echo "-- 3. Volatility monitor --"
if [[ -f "$REPO/scripts/arb_volatility_monitor.js" ]]; then
  node "$REPO/scripts/arb_volatility_monitor.js" \
    >> "$SESSION_DIR/volatility.jsonl" 2>&1 &
  VOLATILITY_PID=$!
  echo "volatility=$VOLATILITY_PID" >> "$PID_FILE"
  echo "  PID $VOLATILITY_PID"
else
  echo "  Skipped (arb_volatility_monitor.js not found)"
fi

# ─── 4. SPREAD MONITOR ───────────────────────────────────────────────────────
echo ""
echo "-- 4. Spread monitor --"
python3 "$REPO/scripts/spread_monitor.py" \
  --chain all --interval 60 \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
MONITOR_PID=$!
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
echo "  PID $MONITOR_PID"

# ─── 5. WATCHDOG ─────────────────────────────────────────────────────────────
echo ""
echo "-- 5. Watchdog --"
if [[ -f "$REPO/scripts/allmight_watchdog.sh" ]]; then
  bash "$REPO/scripts/allmight_watchdog.sh" \
    >> "$SESSION_DIR/watchdog.jsonl" 2>&1 &
else
  node "$REPO/scripts/arb_window_activator.js" --watchdog 2>/dev/null \
    >> "$SESSION_DIR/watchdog.jsonl" 2>&1 &
fi
WATCHDOG_PID=$!
echo "watchdog=$WATCHDOG_PID" >> "$PID_FILE"
echo "  PID $WATCHDOG_PID"

# ─── 6. NOTIFICATION ROUTER ──────────────────────────────────────────────────
echo ""
echo "-- 6. Notification router --"
node -r dotenv/config "$REPO/scripts/monitoring/notification_router.js" \
  --startup --loop 300 \
  >> "$LOG_DIR/notification_router.log" 2>&1 &
NOTIF_PID=$!
echo "notification_router=$NOTIF_PID" >> "$PID_FILE"
echo "  PID $NOTIF_PID (heartbeat every 5m)"

# ─── 7. SHADOW EXECUTION ENGINE ──────────────────────────────────────────────
echo ""
echo "-- 7. Shadow execution engine (polls every 5m) --"
(while true; do
  sleep 300
  node "$REPO/scripts/execution/shadow_execution_engine.js" \
    --session "$SESSION_DIR" 2>/dev/null || true
done) >> "$LOG_DIR/shadow_engine.log" 2>&1 &
SHADOW_PID=$!
echo "shadow_engine=$SHADOW_PID" >> "$PID_FILE"
echo "  PID $SHADOW_PID"

# ─── SHOW PRIOR LIFETIME METRICS AT STARTUP ──────────────────────────────────
echo ""
echo "-- Prior lifetime metrics --"
node "$REPO/scripts/tools/project_metrics_tracker.js" --summary 2>/dev/null || echo "  (no prior data)"

# ─── STARTUP SUMMARY ─────────────────────────────────────────────────────────
echo ""
echo "======================================================="
echo "  AllMight -- Session Active"
echo "  Session:  $SESSION_ID"
echo "  Logs:     $SESSION_DIR/"
echo "======================================================="
echo ""
echo "  Live monitoring:"
echo "    bash start_all.sh --status"
echo "    bash start_all.sh --metrics"
echo "    node scripts/execution/execution_gate_score.js"
echo ""
echo "  Stop + final report:"
echo "    bash start_all.sh --stop"
echo ""
echo "  Mark C9 after stop (required for Boss-valid):"
echo "    node scripts/tools/dryrun_confidence_log.js --mark-c9 $SESSION_DIR"
echo "======================================================="
