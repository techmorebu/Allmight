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
PID_FILE="$LOG_DIR/allmight.pid"  # unified with remote_ctl.sh
SESSION_FILE="$LOG_DIR/allmight.session"

# ─── STOP (canonical full pipeline) ─────────────────────────────────────────
# Accepts both: bash start_all.sh --stop   AND   bash start_all.sh stop
if [[ "${1:-}" == "--stop" || "${1:-}" == "stop" ]]; then
  TS() { date -u '+%H:%M:%SZ'; }
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  AllMight — Stop + Analytics Pipeline"
  SESSION_ID=""
  SESSION_DIR=""
  [[ -f "$SESSION_FILE" ]] && SESSION_ID=$(cat "$SESSION_FILE")
  [[ -n "$SESSION_ID" ]] && SESSION_DIR="$LOG_DIR/sessions/session_${SESSION_ID}"
  [[ -n "$SESSION_ID" ]] && echo "  Session: $SESSION_ID"

  # ── 1. Kill all processes ──────────────────────────────────────────────────
  echo "[$(TS)] Stopping processes..."
  if [[ -f "$PID_FILE" ]]; then
    while IFS='=' read -r name pid; do
      [[ -z "$name" || -z "$pid" ]] && continue
      kill -0 "$pid" 2>/dev/null && kill "$pid" 2>/dev/null && echo "  Stopped $name (PID $pid)" || echo "  $name already stopped"
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  pkill -f "arb_window_activator.js"        2>/dev/null || true
  pkill -f "arb_volatility_monitor.js"       2>/dev/null || true
  pkill -f "volatility_divergence_report.js" 2>/dev/null || true
  pkill -f "allmight_watchdog.sh"            2>/dev/null || true
  pkill -f "notification_router.js"          2>/dev/null || true
  pkill -f "shadow_execution_engine.js"      2>/dev/null || true

  if [[ -z "$SESSION_ID" || ! -d "$SESSION_DIR" ]]; then
    echo "  No active session found — skipping analytics"
  else
    # ── 2. Shadow v1 (opportunity) ──────────────────────────────────────────
    echo "[$(TS)] [1/6] Shadow v1 (opportunity)..."
    node "$REPO/scripts/execution/shadow_execution_engine.js" \
      --session "$SESSION_DIR" 2>/dev/null || echo "  (v1: unavailable)"

    # ── 3. Shadow v2 (realistic) ────────────────────────────────────────────
    echo "[$(TS)] [2/6] Shadow v2 (realistic, 5bps friction)..."
    node "$REPO/scripts/execution/shadow_execution_engine_v2.js" \
      --session "$SESSION_DIR" 2>/dev/null || echo "  (v2: unavailable)"

    # ── 4. Dry execution (optional — set RUN_DRY_EXECUTION=true) ────────────
    echo "[$(TS)] [3/6] Dry execution..."
    if [[ "${RUN_DRY_EXECUTION:-false}" == "true" ]]; then
      SESSION_ID="$SESSION_ID" GAS_PRICE_GWEI="${GAS_PRICE_GWEI:-0.05}" \
        npx hardhat run "$REPO/scripts/execution/dry_execution_fork_runner.js" \
          --network hardhat 2>/dev/null || echo "  (fork runner: unavailable)"
    else
      node -r dotenv/config "$REPO/scripts/execution/dry_execution_engine.js" \
        --session "$SESSION_DIR" 2>/dev/null || echo "  (dry run: unavailable)"
    fi

    # ── 5. Shadow accuracy report ────────────────────────────────────────────
    echo "[$(TS)] [4/6] Shadow accuracy + backtest..."
    node "$REPO/scripts/tools/shadow_accuracy_report.js" \
      --session "$SESSION_DIR" 2>/dev/null || true
    node "$REPO/scripts/tools/gate_score_backtest.js" --all 2>/dev/null || true
    node "$REPO/scripts/tools/spread_dominance_report.js" --all 2>/dev/null || true

    # ── 6. Lifetime metrics ──────────────────────────────────────────────────
    echo "[$(TS)] [5/6] Lifetime project metrics..."
    node "$REPO/scripts/tools/project_metrics_tracker.js" --summary 2>/dev/null || echo "  (metrics: unavailable)"

    # ── 7. Discord stop summary ──────────────────────────────────────────────
    echo "[$(TS)] [6/6] Discord stop summary..."
    node -r dotenv/config "$REPO/scripts/monitoring/notification_router.js" \
      --stop-summary "$SESSION_DIR" 2>/dev/null || echo "  (Discord: unavailable)"

    # ── 8. Zip session ───────────────────────────────────────────────────────
    echo "[$(TS)] Zipping session..."
    ZIP_OUT="$LOG_DIR/sessions/session_${SESSION_ID}.zip"
    INCLUDE_FILES=(
      activator.jsonl blueprints.jsonl watchdog.jsonl volatility.jsonl heat.jsonl
      sandbox_results.json dryrun_confidence.json execution_candidate_audit.jsonl
      flash_loan_readiness.json size_ladder.json threshold_edge.json
      tier_breakdown.json near_miss_analysis.json session_totals.json
      shadow_execution_totals.json shadow_execution_totals_v2.json
      shadow_execution_ledger.jsonl shadow_execution_ledger_v2.jsonl
      shadow_dryrun_totals.json shadow_accuracy_report.json
    )
    EXISTING=()
    for f in "${INCLUDE_FILES[@]}"; do
      [[ -f "$SESSION_DIR/$f" ]] && EXISTING+=("$f")
    done
    if [[ ${#EXISTING[@]} -gt 0 ]]; then
      (cd "$SESSION_DIR" && zip -q "../session_${SESSION_ID}.zip" "${EXISTING[@]}" 2>/dev/null)
      echo "  ✅ Session zip: $ZIP_OUT (${#EXISTING[@]} files)"
    else
      echo "  ⚠️  No files to zip"
    fi
  fi

  echo ""
  echo "  Mark C9 after Boss summary:"
  echo "    node scripts/tools/dryrun_confidence_log.js --mark-c9 ${SESSION_DIR:-logs/sessions/session_XXXX}"
  echo "═══════════════════════════════════════════════════════"
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

# ─── PRE-LAUNCH CLEANUP ─────────────────────────────────────────────────────
# Auto-clears orphaned state from: abort, crash, incomplete stop, bad restart.
# Blocks only if processes are genuinely still running.
echo ""
echo "-- Pre-launch cleanup --"

# Check both PID file locations (belt-and-suspenders)
for _pf in "$PID_FILE" "$LOG_DIR/pids.txt" "$LOG_DIR/allmight.pid"; do
  [[ -f "$_pf" ]] || continue
  ALIVE=0
  while IFS='=' read -r name pid; do
    [[ -z "$pid" || -z "$name" ]] && continue
    # Skip lines that are not name=number format
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    kill -0 "$pid" 2>/dev/null && ALIVE=$((ALIVE+1))
  done < "$_pf"

  if [[ $ALIVE -gt 0 ]]; then
    echo "  ERROR: $ALIVE process(es) still running -- stop first:"
    echo "     bash scripts/tools/start_all.sh --stop"
    exit 1
  else
    echo "  Stale PID file cleared: $_pf ($ALIVE live processes)"
    rm -f "$_pf"
  fi
done

# Clear stale session pointer
[[ -f "$SESSION_FILE" ]] && echo "  Stale session cleared ($(cat "$SESSION_FILE"))" && rm -f "$SESSION_FILE"

echo "  Pre-launch state clean" 

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
redis-cli --scan --pattern "allmight:*" | xargs -r redis-cli del > /dev/null 2>&1 || true
echo "  Redis keys cleared"

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

# ─── 2. ARB WINDOW ACTIVATOR (supervised restart loop) ───────────────────────
# Exit code 0  = activator detected RPC exhaustion and exited cleanly.
#               Wait 15 minutes before restarting (cooldown for provider quotas).
#               Without this, code-0 exits cause a rapid restart storm that keeps
#               all providers in cooldown and burns quota until the session fails.
# Exit code !0 = crash/error — restart after 5s as before.
echo ""
echo "-- 2. Arb window activator (supervised) --"
(
  RESTART_COUNT=0
  while true; do
    RESTART_COUNT=$((RESTART_COUNT+1))
    echo "[supervisor] Start #${RESTART_COUNT} $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      >> "$SESSION_DIR/activator.jsonl"

    node "$REPO/scripts/arb_window_activator.js" \
      >> "$SESSION_DIR/activator.jsonl" 2>&1

    EXIT=$?

    if [[ $EXIT -eq 0 ]]; then
      # Clean exit = RPC exhaustion. Wait 15 min for quota cooldown then retry.
      echo "[supervisor] Exited code 0 (RPC cooldown) — waiting 15m before restart $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/activator.jsonl"
      sleep 900
    else
      # Crash/error — short delay then restart
      echo "[supervisor] Exited code $EXIT — restarting in 5s $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/activator.jsonl"
      sleep 5
    fi
  done
) &
ACTIVATOR_PID=$!
disown $ACTIVATOR_PID 2>/dev/null || true
echo "activator=$ACTIVATOR_PID" >> "$PID_FILE"
echo "  PID $ACTIVATOR_PID (supervised, 15m cooldown on RPC exhaustion)"

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
  node "$REPO/scripts/execution/shadow_execution_engine_v2.js" \
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
