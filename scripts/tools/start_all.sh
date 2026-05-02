#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Unified Launcher  v1.7
#  PLACEMENT: scripts/tools/start_all.sh
#
#  Processes:
#    1. Master fetcher loop  (Redis → price data)
#    2. Volatility monitor   (arb_volatility_monitor.js)
#    3. Heat report runner   (volatility_divergence_report.js)
#    4. Activator            (arb_window_activator.js — supervised restart loop)
#    5. Watchdog             (allmight_watchdog.sh --loop 300)
#    6. Notification router  (Discord heartbeat --loop 300)
#    7. Shadow engine        (analytics loop — gate score + shadow PnL every 5m)
#
#  Usage:
#    bash scripts/tools/start_all.sh
#    bash scripts/tools/start_all.sh status
#    bash scripts/tools/start_all.sh stop
#    bash scripts/tools/start_all.sh logs
#    bash scripts/tools/start_all.sh restart-activator
#    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 & disown
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$REPO/logs"
PID_FILE="$LOG_DIR/allmight.pid"
SESSION_POINTER="$LOG_DIR/allmight.session"
INTERVAL=60

log() { echo "[$(date -u '+%H:%M:%SZ')] $*"; }

mkdir -p "$LOG_DIR"

# ── STATUS ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "status" ]]; then
  if [[ ! -f "$PID_FILE" ]]; then echo "No PID file — not running"; exit 0; fi
  echo ""
  echo "═══════════════════════════════════"
  echo "  AllMight Process Status"
  echo "═══════════════════════════════════"
  while IFS='=' read -r name pid; do
    [[ -z "$name" || -z "$pid" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "  [OK]   $name  (PID $pid)"
    else
      echo "  [DEAD] $name  (PID $pid)"
    fi
  done < "$PID_FILE"
  [[ -f "$SESSION_POINTER" ]] && echo "  Session: $(cat "$SESSION_POINTER")"
  echo "═══════════════════════════════════"
  exit 0
fi

# ── LOGS ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "logs" ]]; then
  SESSION=""
  [[ -f "$SESSION_POINTER" ]] && SESSION=$(cat "$SESSION_POINTER")
  SESSION_DIR="$LOG_DIR/sessions/session_${SESSION}"
  echo "Tailing activator + monitor logs. Ctrl-C to stop."
  tail -f "$SESSION_DIR/activator.jsonl" "$SESSION_DIR/monitor.log" 2>/dev/null
  exit 0
fi

# ── RESTART-ACTIVATOR ─────────────────────────────────────────────────────────
if [[ "${1:-}" == "restart-activator" ]]; then
  log "Restarting activator (same session)..."
  pkill -f "arb_window_activator.js" 2>/dev/null || true
  sleep 2
  SESSION=$(cat "$SESSION_POINTER" 2>/dev/null || echo "unknown")
  SESSION_DIR="$LOG_DIR/sessions/session_${SESSION}"
  export RPC_FRESHNESS_LOG_PATH="$SESSION_DIR/rpc_freshness.jsonl"
  export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"
  (
    RESTART_COUNT=0
    while true; do
      RESTART_COUNT=$((RESTART_COUNT+1))
      echo "[supervisor] Start #${RESTART_COUNT} $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/activator.jsonl"
      node -r dotenv/config "$REPO/scripts/analysis/arb_window_activator.js" \
        --pair ETH/USDC-RAMSES \
        --remap-ticks \
        --gas-profile atomic_optimistic \
        --log "$SESSION_DIR/activator.jsonl" \
        --heat-log "$SESSION_DIR/heat.jsonl" 2>&1
      EXIT=$?
      echo "[supervisor] Exited code $EXIT — restarting in 5s" >> "$SESSION_DIR/activator.jsonl"
      [[ $EXIT -eq 0 ]] && break
      sleep 5
    done
  ) &
  NEW_PID=$!
  disown $NEW_PID 2>/dev/null || true
  log "Activator restarted (PID $NEW_PID)"
  sed -i "/^activator=/d" "$PID_FILE" 2>/dev/null || true
  echo "activator=$NEW_PID" >> "$PID_FILE"
  exit 0
fi

# ── STOP ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  log "Stopping AllMight session..."

  SESSION=""
  [[ -f "$SESSION_POINTER" ]] && SESSION=$(cat "$SESSION_POINTER")
  SESSION_DIR="$LOG_DIR/sessions/session_${SESSION}"

  # Kill via PID file
  if [[ -f "$PID_FILE" ]]; then
    while IFS='=' read -r name pid; do
      [[ -z "$name" || -z "$pid" ]] && continue
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && log "  Stopped $name (PID $pid)" || true
      else
        log "  $name (PID $pid) already stopped"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi

  # Belt-and-suspenders pkill cleanup
  pkill -f "arb_window_activator.js"          2>/dev/null || true
  pkill -f "arb_volatility_monitor.js"        2>/dev/null || true
  pkill -f "volatility_divergence_report.js"  2>/dev/null || true
  pkill -f "allmight_watchdog.sh"             2>/dev/null || true
  pkill -f "notification_router.js"           2>/dev/null || true
  pkill -f "shadow_execution_engine.js"       2>/dev/null || true

  # ── Final shadow execution metrics ──────────────────────────────────────────
  if [[ -n "$SESSION" ]]; then
    log "Computing final shadow execution metrics..."
    node "$REPO/scripts/execution/shadow_execution_engine.js" \
      --session "$SESSION_DIR" 2>/dev/null || true

    log "Updating lifetime project metrics..."
    node "$REPO/scripts/tools/project_metrics_tracker.js" --summary 2>/dev/null || true

    # Discord stop summary (non-blocking, fail-silent)
    node -r dotenv/config "$REPO/scripts/monitoring/notification_router.js" \
      --stop-summary "$SESSION_DIR" >> "$SESSION_DIR/analysis.log" 2>&1 || true

    log ""
    log "Session files in: $SESSION_DIR"
    log "Upload to CPT: activator.jsonl blueprints.jsonl watchdog.jsonl sandbox_results.json"
    log "               shadow_execution_totals.json dryrun_confidence.json"
    log ""
    log "Mark C9 after Boss summary:"
    log "  node scripts/tools/dryrun_confidence_log.js --mark-c9 $SESSION_DIR"
  fi

  log "AllMight stopped."
  exit 0
fi

# ── GUARD: already running ────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  echo "WARNING: PID file exists — may already be running"
  echo "  bash scripts/tools/start_all.sh status"
  echo "  bash scripts/tools/start_all.sh stop"
  exit 1
fi

# ── LOAD ENV ─────────────────────────────────────────────────────────────────
cd "$REPO"
set -a && source .env && set +a

# ── SESSION ID ───────────────────────────────────────────────────────────────
SESSION=$(date +%Y%m%d_%H%M)
SESSION_DIR="$LOG_DIR/sessions/session_${SESSION}"
mkdir -p "$SESSION_DIR"
echo "$SESSION" > "$SESSION_POINTER"

log "═══════════════════════════════════════════════════════"
log "  AllMight Session: $SESSION"
log "  Target: 4h min (C4) | 6-8h optimal | 24h strong"
log "═══════════════════════════════════════════════════════"

# ── REDIS PREFLIGHT ──────────────────────────────────────────────────────────
log "Redis preflight..."
for i in $(seq 1 10); do
  redis-cli ping > /dev/null 2>&1 && break
  if [[ $i -eq 10 ]]; then
    log "ERROR: Redis not responding. Run: sudo systemctl start redis"
    exit 1
  fi
  log "  Redis not ready ($i/10)..."
  sleep 3
done
redis-cli --scan --pattern "fetcher:*" | xargs -r redis-cli del > /dev/null 2>&1 || true
log "Redis OK — stale keys cleared"

# ── EXPORTS (before any process launch) ─────────────────────────────────────
export RPC_FRESHNESS_LOG_PATH="$SESSION_DIR/rpc_freshness.jsonl"
export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"
export SESSION_DIR

# ── READINESS HELPER ─────────────────────────────────────────────────────────
wait_for_min_lines() {
  local file="$1" min_lines="$2" max_secs="$3"
  local elapsed=0
  while [[ $elapsed -lt $max_secs ]]; do
    if [[ -f "$file" ]] && [[ $(wc -l < "$file") -ge $min_lines ]]; then
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  log "WARNING: $file did not reach $min_lines lines in ${max_secs}s — continuing anyway"
  return 0
}

# ── PROCESS 1: Master fetcher loop ───────────────────────────────────────────
log "Starting Process 1: Master fetcher..."
nohup bash -c "
  while true; do
    node '$REPO/scripts/master-fetcher.js' once 2>&1
    sleep $INTERVAL
  done
" >> "$SESSION_DIR/fetcher.log" 2>&1 &
FETCHER_PID=$!
disown $FETCHER_PID 2>/dev/null || true
echo "fetcher=$FETCHER_PID" >> "$PID_FILE"
log "✓ Fetcher loop     (PID $FETCHER_PID)"

log "  Waiting 15s for initial Redis population..."
sleep 15

# ── PROCESS 2: Volatility monitor ────────────────────────────────────────────
log "Starting Process 2: Volatility monitor..."
nohup node -r dotenv/config "$REPO/scripts/analysis/arb_volatility_monitor.js" \
  --chain arbitrum \
  --interval 120 \
  --log "$SESSION_DIR/volatility.jsonl" \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
MONITOR_PID=$!
disown $MONITOR_PID 2>/dev/null || true
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
log "✓ Volatility monitor (PID $MONITOR_PID)"

sleep 5

# ── PROCESS 3: Heat report runner ────────────────────────────────────────────
log "Starting Process 3: Heat report runner..."
nohup node "$REPO/scripts/tools/volatility_divergence_report.js" \
  --log "$SESSION_DIR/volatility.jsonl" \
  --out "$SESSION_DIR/heat.jsonl" \
  --interval 30 \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
HEAT_PID=$!
disown $HEAT_PID 2>/dev/null || true
echo "heat=$HEAT_PID" >> "$PID_FILE"
log "✓ Heat report      (PID $HEAT_PID)"

log "  Waiting for volatility data (≥2 lines, max 60s)..."
wait_for_min_lines "$SESSION_DIR/volatility.jsonl" 2 60

log "  Waiting for heat data (≥3 lines, max 120s)..."
wait_for_min_lines "$SESSION_DIR/heat.jsonl" 3 120

# ── PROCESS 4: Activator (supervised restart loop) ───────────────────────────
log "Starting Process 4: Activator (supervised)..."
(
  RESTART_COUNT=0
  while true; do
    RESTART_COUNT=$((RESTART_COUNT+1))
    echo "[supervisor] Start #${RESTART_COUNT} $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      >> "$SESSION_DIR/activator.jsonl"

    node -r dotenv/config "$REPO/scripts/analysis/arb_window_activator.js" \
      --pair ETH/USDC-RAMSES \
      --remap-ticks \
      --gas-profile atomic_optimistic \
      --log "$SESSION_DIR/activator.jsonl" \
      --heat-log "$SESSION_DIR/heat.jsonl" 2>&1

    EXIT=$?
    echo "[supervisor] Exited code $EXIT — restarting in 5s" \
      >> "$SESSION_DIR/activator.jsonl"
    if [[ $EXIT -eq 0 ]]; then
      # Clean exit = RPC exhaustion. Wait 15 min for quota cooldown.
      echo "[supervisor] Exited code 0 (RPC cooldown) -- waiting 15m before restart $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/activator.jsonl"
      sleep 900
    else
      echo "[supervisor] Exited code $EXIT -- restarting in 5s $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/activator.jsonl"
      sleep 5
    fi
  done
) &
ACTIVATOR_PID=$!
disown $ACTIVATOR_PID 2>/dev/null || true
echo "activator=$ACTIVATOR_PID" >> "$PID_FILE"
log "✓ Activator        (PID $ACTIVATOR_PID)"

# ── PROCESS 5: Watchdog ──────────────────────────────────────────────────────
log "Starting Process 5: Watchdog..."
nohup bash "$REPO/scripts/tools/allmight_watchdog.sh" --loop 300 \
  >> "$SESSION_DIR/watchdog_loop.log" 2>&1 &
WATCHDOG_PID=$!
disown $WATCHDOG_PID 2>/dev/null || true
echo "watchdog=$WATCHDOG_PID" >> "$PID_FILE"
log "✓ Watchdog loop    (PID $WATCHDOG_PID, every 300s)"

# ── PROCESS 6: Notification router (Discord heartbeat) ───────────────────────
log "Starting Process 6: Notification router..."
node -r dotenv/config "$REPO/scripts/monitoring/notification_router.js" \
  --startup >> "$SESSION_DIR/analysis.log" 2>&1 &

nohup node -r dotenv/config "$REPO/scripts/monitoring/notification_router.js" \
  --loop 300 >> "$SESSION_DIR/analysis.log" 2>&1 &
NOTIF_PID=$!
disown $NOTIF_PID 2>/dev/null || true
echo "notification_router=$NOTIF_PID" >> "$PID_FILE"
log "✓ Notification router (PID $NOTIF_PID, heartbeat every 300s)"

# ── PROCESS 7: Shadow execution engine (analytics loop) ──────────────────────
# Classifies each signal through gate/capital policy every 5 minutes.
# Writes shadow_execution_ledger.jsonl + shadow_execution_totals.json
# MODE 0 PAPER enforced — $0 live capital. Analytics only.
log "Starting Process 7: Shadow execution engine..."
(
  while true; do
    sleep 300
    node "$REPO/scripts/execution/shadow_execution_engine.js" \
      --session "$SESSION_DIR" 2>/dev/null || true
  done
) >> "$LOG_DIR/shadow_engine.log" 2>&1 &
SHADOW_PID=$!
disown $SHADOW_PID 2>/dev/null || true
echo "shadow_engine=$SHADOW_PID" >> "$PID_FILE"
log "✓ Shadow engine    (PID $SHADOW_PID, every 300s)"

# ── STARTUP SUMMARY ──────────────────────────────────────────────────────────
echo ""
log "Session $SESSION running."
log "PIDs: fetcher=$FETCHER_PID monitor=$MONITOR_PID heat=$HEAT_PID activator=$ACTIVATOR_PID"
log "      watchdog=$WATCHDOG_PID notif=$NOTIF_PID shadow=$SHADOW_PID"
echo ""
echo "  bash scripts/tools/start_all.sh status             — check health"
echo "  bash scripts/tools/start_all.sh logs               — watch live output"
echo "  bash scripts/tools/start_all.sh stop               — stop + final metrics"
echo "  bash scripts/tools/start_all.sh restart-activator  — restart activator only"
echo ""
echo "  For unattended run:"
echo "    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 & disown"
echo ""
echo "  Mark C9 after stop (Boss summary):"
echo "    node scripts/tools/dryrun_confidence_log.js --mark-c9 $SESSION_DIR"
echo ""

# ── Show prior lifetime metrics ───────────────────────────────────────────────
echo "── Prior lifetime metrics ──"
node "$REPO/scripts/tools/project_metrics_tracker.js" --summary 2>/dev/null || true
echo ""
