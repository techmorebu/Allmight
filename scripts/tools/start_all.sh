#!/usr/bin/env bash
# start_all.sh — AllMight Session Launcher v2
# Usage:
#   bash start_all.sh           — start session
#   bash start_all.sh --stop    — stop + final metrics + Discord stop summary
#   bash start_all.sh --status  — check running processes
#   bash start_all.sh --metrics — show shadow PnL + gate score + lifetime totals

set -euo pipefail

# Resolve repo root — works regardless of how this script is called
# Method 1: git rev-parse (most reliable)
# Method 2: two levels up from scripts/tools/ (structural)
# Method 3: current working directory (last resort)
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if git -C "$_SCRIPT_DIR" rev-parse --show-toplevel > /dev/null 2>&1; then
  REPO="$(git -C "$_SCRIPT_DIR" rev-parse --show-toplevel)"
elif [[ -f "$_SCRIPT_DIR/../../.env" ]]; then
  REPO="$(cd "$_SCRIPT_DIR/../.." && pwd)"
else
  REPO="$(pwd)"
fi
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

    # ── 8. Zip session → logs/archive/ (raw session stays in logs/sessions/) ────
    # logs/sessions/session_XXXX/ = raw files (readable, for active analysis)
    # logs/archive/session_XXXX.zip = compressed archive (for long-term storage)
    echo "[$(TS)] Zipping session to archive..."
    ARCHIVE_DIR="$LOG_DIR/archive"
    mkdir -p "$ARCHIVE_DIR"
    ZIP_OUT="$ARCHIVE_DIR/session_${SESSION_ID}.zip"
    FILE_COUNT=$(find "$SESSION_DIR" -maxdepth 1 -type f | wc -l)
    if [[ $FILE_COUNT -gt 0 ]]; then
      (cd "$SESSION_DIR" && zip -q "$ZIP_OUT" * 2>/dev/null)
      ZIP_SIZE=$(du -sh "$ZIP_OUT" 2>/dev/null | cut -f1)
      echo "  ✅ Archive: $ZIP_OUT ($FILE_COUNT files, ${ZIP_SIZE})"
      echo "  Raw session kept: $SESSION_DIR/"
    else
      echo "  ⚠️  No files to zip"
    fi

    # Run log_retention_manager to enforce archive limits and clean old raw sessions
    [[ -f "$REPO/scripts/tools/log_retention_manager.js" ]] &&       node "$REPO/scripts/tools/log_retention_manager.js" --archive         >> "$SESSION_DIR/analysis.log" 2>/dev/null || true
  fi

  echo ""
  echo "  Mark C9 after Boss summary:"
  echo "    node scripts/tools/dryrun_confidence_log.js --mark-c9 ${SESSION_DIR:-logs/sessions/session_XXXX}"
  echo "═══════════════════════════════════════════════════════"
  exit 0
fi

# ─── STATUS ──────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--status" || "${1:-}" == "status" ]]; then
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
ARCHIVE_DIR_GUARD="$LOG_DIR/archive"
ABORTED_DIR_GUARD="$LOG_DIR/aborted"

# ─── COMPACT-SID COLLISION GUARD (Boss C9 S15R6Q) ────────────────────────────
# SESSION_ID has MINUTE resolution, so a same-minute restart previously reused
# the session directory: `mkdir -p` succeeds silently on an existing dir, two
# runtime sessions appended into one set of .jsonl files, and the stop path's
# `zip` UPDATED the existing archive. That mixing is unrecoverable after the
# fact. It also let a stale same-SID archive trigger a false CLEAN_LOGICAL_END
# in the telemetry observers.
#
# Order matters:
#   1. ATOMIC CLAIM  — `mkdir` WITHOUT -p either creates or fails with EEXIST.
#                      There is no check-then-create window. This single call is
#                      both the claim and the guard.
#   2. ADVISORY      — the other four persisted claimants. Retention reaps the
#                      session dir while archives survive (log_retention_manager
#                      deleteRaw), and `remote_ctl.sh abort` MOVES the dir away
#                      while the SID stays claimed under logs/aborted/. So an
#                      absent directory does NOT mean an unclaimed SID.
#   3. PUBLISH       — the pointer is written only after the namespace is fully
#                      claimed; consumers must never see a SID we then abandon.
#
# Rollback uses `rmdir`, never `rm -rf`: rmdir fails on a non-empty directory,
# so a rollback can never delete through evidence something else has written.
mkdir -p "$LOG_DIR" "$LOG_DIR/sessions"
if ! mkdir "$SESSION_DIR" 2>/dev/null; then
  echo "ABORT: session id ${SESSION_ID} is already claimed by $SESSION_DIR"
  echo "       A session started during this clock minute."
  echo "       Wait for the next minute, then start again."
  exit 1
fi

SID_CLAIMED_BY=""
[[ -e "$ARCHIVE_DIR_GUARD/session_${SESSION_ID}.zip" ]] && SID_CLAIMED_BY="$ARCHIVE_DIR_GUARD/session_${SESSION_ID}.zip"
[[ -z "$SID_CLAIMED_BY" && -e "$ARCHIVE_DIR_GUARD/session_${SESSION_ID}.tar.gz" ]] && SID_CLAIMED_BY="$ARCHIVE_DIR_GUARD/session_${SESSION_ID}.tar.gz"
[[ -z "$SID_CLAIMED_BY" && -e "$ARCHIVE_DIR_GUARD/session_${SESSION_ID}_critical" ]] && SID_CLAIMED_BY="$ARCHIVE_DIR_GUARD/session_${SESSION_ID}_critical"
[[ -z "$SID_CLAIMED_BY" && -e "$ABORTED_DIR_GUARD/session_${SESSION_ID}" ]] && SID_CLAIMED_BY="$ABORTED_DIR_GUARD/session_${SESSION_ID}"
if [[ -n "$SID_CLAIMED_BY" ]]; then
  rmdir "$SESSION_DIR" 2>/dev/null || echo "       NOTE: $SESSION_DIR is not empty and was left in place"
  echo "ABORT: session id ${SESSION_ID} is already claimed by $SID_CLAIMED_BY"
  echo "       A prior session used this id. Wait for the next minute, then start again."
  exit 1
fi

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
(set +e; while true; do
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
  set +e
  RESTART_COUNT=0; CONSEC_CONTROLLED=0
  export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"  # Boss G2.7 — blueprint output to session folder
  while true; do
    RESTART_COUNT=$((RESTART_COUNT+1))
    _LOOP_START=$(date +%s)
    echo "[supervisor] Start #${RESTART_COUNT} $(date -u '+%Y-%m-%dT%H:%M:%SZ') consec=${CONSEC_CONTROLLED}" \
      >> "$SESSION_DIR/activator.jsonl"
    node "$REPO/scripts/analysis/arb_window_activator.js" \
      --pair=ETH/USDC-RAMSES \
      --log "$SESSION_DIR/activator.jsonl" \
      >> "$SESSION_DIR/activator.jsonl" 2>&1
    EXIT=$?
    if [[ $EXIT -eq 0 || $EXIT -eq 10 || $EXIT -eq 11 ]]; then
      # Boss ruling 2026-05-03: reset CONSEC if ran > STALE_THRESHOLD * 3
      # Long healthy run that ended in stale = normal RPC rotation (not degradation)
      # Rapid stale (<33min) = genuine degradation → escalate cooldown
      # STALE_THRESHOLD_SEC = 660 (11min) → reset threshold = 1980s (33min)
      _RUN_SEC=$(( $(date +%s) - _LOOP_START ))
      _STALE_THRESH=660  # 11min — matches HEALTH_POOL_STALE_EXIT_MS in activator
      if [[ $_RUN_SEC -gt $(( _STALE_THRESH * 3 )) ]]; then
        CONSEC_CONTROLLED=1  # reset to min delay — long run, normal rotation
      else
        CONSEC_CONTROLLED=$((CONSEC_CONTROLLED+1))
      fi
      if   [[ $CONSEC_CONTROLLED -le 1 ]]; then DELAY=300
      elif [[ $CONSEC_CONTROLLED -eq 2 ]]; then DELAY=600
      else                                       DELAY=900; fi
      case $EXIT in 0) R="RPC_EXHAUSTION";; 10) R="PROLONGED_STALE";; 11) R="RPC_DEGRADED";; *) R="CONTROLLED";; esac
      echo "[supervisor] Controlled $EXIT ($R) cooldown ${DELAY}s consec=$CONSEC_CONTROLLED run=${_RUN_SEC}s $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/activator.jsonl"
      sleep $DELAY
    else
      CONSEC_CONTROLLED=0
      echo "[supervisor] Crash $EXIT — restart 5s $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$SESSION_DIR/activator.jsonl"
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
if [[ -f "$REPO/scripts/analysis/arb_volatility_monitor.js" ]]; then
  # Wrap in retry loop — volatility exits if Redis has no fetcher data yet.
  # Retries every 30s until fetcher data is available (max 5 attempts).
  (
    set +e  # must disable — node exits non-zero, set -e would kill the wrapper
    ATTEMPT=0
    while true; do
      ATTEMPT=$((ATTEMPT+1))
      node "$REPO/scripts/analysis/arb_volatility_monitor.js" \
        >> "$SESSION_DIR/volatility.jsonl" 2>&1
      EXIT=$?
      DELAY=$([[ $EXIT -eq 0 ]] && echo 30 || echo 15)
      echo "[volatility-wrapper] Exit $EXIT attempt $ATTEMPT — retry in ${DELAY}s $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
        >> "$SESSION_DIR/volatility.jsonl"
      sleep $DELAY
    done
  ) &
  VOLATILITY_PID=$!
  echo "volatility=$VOLATILITY_PID" >> "$PID_FILE"
  echo "  PID $VOLATILITY_PID (with retry wrapper)"
else
  echo "  Skipped (arb_volatility_monitor.js not found)"
fi

# ─── 3b. HEAT REPORTER ───────────────────────────────────────────────────────
echo ""; echo "-- 3b. Heat reporter --"
if [[ -f "$REPO/scripts/tools/volatility_divergence_report.js" ]]; then
  node "$REPO/scripts/tools/volatility_divergence_report.js" --interval 30 \
    >> "$SESSION_DIR/heat.jsonl" 2>&1 &
  HEAT_PID=$!; echo "heat=$HEAT_PID" >> "$PID_FILE"; echo "  PID $HEAT_PID"
else
  echo "  Skipped (volatility_divergence_report.js not found)"
fi

# ─── 4. SPREAD MONITOR (optional — requires python3 redis module) ────────────
echo ""
echo "-- 4. Spread monitor --"
if python3 -c "import redis" 2>/dev/null; then
  python3 "$REPO/scripts/spread_monitor.py" \
    --chain all --interval 60 \
    >> "$SESSION_DIR/monitor.log" 2>&1 &
  MONITOR_PID=$!
  echo "monitor=$MONITOR_PID" >> "$PID_FILE"
  echo "  PID $MONITOR_PID"
else
  echo "  Skipped (python3 redis not installed)"
  echo "  Fix: sudo apt install python3-pip && pip3 install redis --break-system-packages"
fi

# ─── 5. WATCHDOG ─────────────────────────────────────────────────────────────
# Delay: give volatility 20s to write its first record before watchdog checks it
echo ""
echo "-- 5. Watchdog (starting in 20s) --"
sleep 20
echo "-- 5. Watchdog (60s delay for heat.jsonl) --"
sleep 60
echo "-- 5. Watchdog --"
if [[ -f "$REPO/scripts/tools/allmight_watchdog.sh" ]]; then
  bash "$REPO/scripts/tools/allmight_watchdog.sh" --loop 60 \
    >> "$SESSION_DIR/watchdog.jsonl" 2>&1 &
else
  node "$REPO/scripts/analysis/arb_window_activator.js" --watchdog 2>/dev/null \
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
(set +e; while true; do
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

# ─── STARTUP HEALTH CHECK ───────────────────────────────────────────────────
# Wait for all processes to settle after watchdog delay, then show real status
echo ""
echo "  Checking process health..."
sleep 5

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  AllMight — Session Started"
echo "  Session: $SESSION_ID"
echo "═══════════════════════════════════════════════════════"
HEALTHY=0; DEAD=0; DEAD_NAMES=""
while IFS='=' read -r _name _pid; do
  [[ -z "$_name" || -z "$_pid" ]] && continue
  [[ "$_pid" =~ ^[0-9]+$ ]] || continue
  if kill -0 "$_pid" 2>/dev/null; then
    echo "  [OK]   $_name (PID $_pid)"
    HEALTHY=$((HEALTHY+1))
  else
    echo "  [DEAD] $_name (PID $_pid)"
    DEAD=$((DEAD+1))
    DEAD_NAMES="$DEAD_NAMES $_name"
  fi
done < "$PID_FILE"
echo ""
if [[ $DEAD -eq 0 ]]; then
  echo "  ✅ All $HEALTHY processes running cleanly"
else
  echo "  ⚠️  $HEALTHY OK · $DEAD dead:$DEAD_NAMES"
  echo "  Note: volatility may take 1-2 restarts (needs Redis data)"
  echo "  Note: watchdog/spread_monitor non-critical"
fi
echo ""
echo "  Logs:      $SESSION_DIR/"
echo "  Monitor:   remote_ctl status"
echo "  Stop:      remote_ctl stop"
echo "  Discord:   first heartbeat in ~5 min"
echo "  Policy:    PAUSE clears after first activator heartbeat (~5 min)"
echo "═══════════════════════════════════════════════════════"
