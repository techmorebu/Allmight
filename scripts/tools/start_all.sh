#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Unified Launcher  v1.1
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/start_all.sh
#
#  Runs all AllMight processes from a single terminal.
#  Each run gets a timestamped session ID — logs are clearly named.
#
#  USAGE
#  ─────
#  bash scripts/tools/start_all.sh          # start everything
#  bash scripts/tools/start_all.sh status   # check what's running
#  bash scripts/tools/start_all.sh stop     # stop everything
#  bash scripts/tools/start_all.sh logs     # tail all logs live
#  bash scripts/tools/start_all.sh upload   # show which files to upload to CPT
#
#  LOG NAMING
#  ──────────
#  Each run stamps all logs with a session ID: YYYYMMDD_HHMM
#  Example: session 20260411_0930 produces:
#    logs/session_20260411_0930/activator.jsonl
#    logs/session_20260411_0930/blueprints.jsonl
#    logs/session_20260411_0930/volatility.jsonl
#    logs/session_20260411_0930/heat.jsonl
#    logs/session_20260411_0930/fetcher.log
#    logs/session_20260411_0930/monitor.log
#
#  All PIDs saved to logs/allmight.pid for clean stop.
# ═══════════════════════════════════════════════════════════════════════════════

set -e
cd "$(dirname "$0")/../.." || exit 1   # always run from repo root

LOGS="./logs"
PID_FILE="$LOGS/allmight.pid"
SESSION_FILE="$LOGS/allmight.session"
mkdir -p "$LOGS"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[start_all] $*"; }
die()  { echo "[start_all] ERROR: $*" >&2; exit 1; }

[[ -f "scripts/analysis/arb_window_activator.js" ]] || \
  die "Run from repo root (~/Allmight)"

# ── UPLOAD HELPER ─────────────────────────────────────────────────────────────
if [[ "$1" == "upload" ]]; then
  if [[ ! -f "$SESSION_FILE" ]]; then
    echo "No active or recent session found."
    exit 1
  fi
  SESSION=$(cat "$SESSION_FILE")
  SESSION_DIR="$LOGS/session_${SESSION}"
  echo ""
  echo "  Upload these files to CPT for analysis:"
  echo "  ─────────────────────────────────────────────────────"
  for f in activator.jsonl blueprints.jsonl heat.jsonl volatility.jsonl; do
    target="$SESSION_DIR/$f"
    if [[ -f "$target" ]]; then
      lines=$(wc -l < "$target")
      size=$(du -sh "$target" | cut -f1)
      echo "  ✓  $target  ($lines lines, $size)"
    else
      echo "  ✗  $target  (not found)"
    fi
  done
  echo ""
  echo "  Session: $SESSION"
  echo ""
  exit 0
fi

# ── STATUS ────────────────────────────────────────────────────────────────────
if [[ "$1" == "status" ]]; then
  SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "none" )
  SESSION_DIR="$LOGS/session_${SESSION}"
  echo ""
  echo "  AllMight status  (session: $SESSION)"
  echo "  ─────────────────────────────────────────────"
  for name in fetcher monitor heat activator; do
    pid=$(grep "^${name}=" "$PID_FILE" 2>/dev/null | cut -d= -f2)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "  ✓ $name  (pid $pid)  RUNNING"
    else
      echo "  ✗ $name  NOT RUNNING"
    fi
  done
  echo ""
  if [[ -d "$SESSION_DIR" ]]; then
    echo "  Log files this session:"
    for f in activator.jsonl blueprints.jsonl heat.jsonl volatility.jsonl; do
      target="$SESSION_DIR/$f"
      [[ -f "$target" ]] && echo "    $(wc -l < "$target") lines  $target" \
                         || echo "    —  $target (not yet created)"
    done
  fi
  echo ""
  echo "  Run 'bash scripts/tools/start_all.sh upload' to see what to send CPT."
  echo ""
  exit 0
fi

# ── STOP ──────────────────────────────────────────────────────────────────────
if [[ "$1" == "stop" ]]; then
  log "Stopping all AllMight processes..."
  if [[ -f "$PID_FILE" ]]; then
    while IFS='=' read -r name pid; do
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null && echo "  stopped $name (pid $pid)"
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  pkill -f "arb_window_activator.js"        2>/dev/null || true
  pkill -f "arb_volatility_monitor.js"      2>/dev/null || true
  pkill -f "volatility_divergence_report.js" 2>/dev/null || true
  SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "" )
  log "Done."
  [[ -n "$SESSION" ]] && log "Session logs: logs/session_${SESSION}/"
  log "Run 'bash scripts/tools/start_all.sh upload' to see what to send CPT."
  exit 0
fi

# ── LOGS (live tail) ──────────────────────────────────────────────────────────
if [[ "$1" == "logs" ]]; then
  SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "" )
  SESSION_DIR="$LOGS/session_${SESSION}"
  echo ""
  echo "  Tailing all AllMight logs (session: $SESSION). Ctrl+C to stop."
  echo "  ─────────────────────────────────────────────────────────────────"
  tail -f \
    "$SESSION_DIR/fetcher.log" \
    "$SESSION_DIR/monitor.log" \
    "$SESSION_DIR/heat.log" \
    "$SESSION_DIR/activator.jsonl" \
    2>/dev/null
  exit 0
fi

# ── START ─────────────────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  RUNNING=0
  while IFS='=' read -r name pid; do
    kill -0 "$pid" 2>/dev/null && RUNNING=$((RUNNING+1))
  done < "$PID_FILE" 2>/dev/null || true
  if [[ $RUNNING -gt 0 ]]; then
    log "Already running ($RUNNING processes). Use 'stop' first or 'status' to check."
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# ── Session ID — stamped at launch time ───────────────────────────────────────
SESSION=$(date -u '+%Y%m%d_%H%M')
SESSION_DIR="$LOGS/session_${SESSION}"
mkdir -p "$SESSION_DIR"
echo "$SESSION" > "$SESSION_FILE"

# Kill any stale processes
pkill -f "arb_window_activator.js"        2>/dev/null || true
pkill -f "arb_volatility_monitor.js"      2>/dev/null || true
pkill -f "volatility_divergence_report.js" 2>/dev/null || true
sleep 1

log "Starting AllMight — session: $SESSION"
log "All logs → $SESSION_DIR/"
echo ""

# ── Process 1: Fetcher loop ───────────────────────────────────────────────────
(
  while true; do
    node -r dotenv/config scripts/master-fetcher.js >> "$SESSION_DIR/fetcher.log" 2>&1
    sleep 120
  done
) &
FETCHER_PID=$!
echo "fetcher=$FETCHER_PID" >> "$PID_FILE"
log "✓ Fetcher loop     (pid $FETCHER_PID) → session_${SESSION}/fetcher.log"

log "  Waiting 15s for initial Redis population..."
sleep 15

# ── Process 2: Volatility monitor ────────────────────────────────────────────
node -r dotenv/config scripts/analysis/arb_volatility_monitor.js \
  --chain arbitrum \
  --interval 120 \
  --log "$SESSION_DIR/volatility.jsonl" \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
MONITOR_PID=$!
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
log "✓ Volatility monitor (pid $MONITOR_PID) → session_${SESSION}/volatility.jsonl"

sleep 5

# ── Process 3: Heat report runner ────────────────────────────────────────────
node scripts/tools/volatility_divergence_report.js \
  --log "$SESSION_DIR/volatility.jsonl" \
  --out "$SESSION_DIR/heat.jsonl" \
  --interval 30 \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
HEAT_PID=$!
echo "heat=$HEAT_PID" >> "$PID_FILE"
log "✓ Heat report      (pid $HEAT_PID) → session_${SESSION}/heat.jsonl"

# ── Process 4: Activator (supervised) ────────────────────────────────────────
(
  RESTART_COUNT=0
  while true; do
    RESTART_COUNT=$((RESTART_COUNT+1))
    echo "[supervisor] Start #${RESTART_COUNT} $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      >> "$SESSION_DIR/activator.jsonl"

    node -r dotenv/config scripts/analysis/arb_window_activator.js \
      --pair ETH/USDC-RAMSES \
      --remap-ticks \
      --gas-profile atomic_optimistic \
      --log "$SESSION_DIR/activator.jsonl" \
      --heat-log "$SESSION_DIR/heat.jsonl"

    EXIT=$?
    echo "[supervisor] Exited code $EXIT — restarting in 5s" \
      >> "$SESSION_DIR/activator.jsonl"
    [[ $EXIT -eq 0 ]] && break
    sleep 5
  done
) &
ACTIVATOR_PID=$!
echo "activator=$ACTIVATOR_PID" >> "$PID_FILE"
# Blueprint log path is set by the activator's default (logs/trade_blueprints.jsonl)
# Override via BLUEPRINT_LOG_PATH env var so it lands in the session folder
export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"
log "✓ Activator        (pid $ACTIVATOR_PID) → session_${SESSION}/activator.jsonl"
log "✓ Blueprints                            → session_${SESSION}/blueprints.jsonl"

echo ""
log "Session $SESSION running. PIDs: fetcher=$FETCHER_PID monitor=$MONITOR_PID heat=$HEAT_PID activator=$ACTIVATOR_PID"
echo ""
echo "  bash scripts/tools/start_all.sh status   — check health"
echo "  bash scripts/tools/start_all.sh logs      — watch live output"
echo "  bash scripts/tools/start_all.sh stop      — stop + see what to upload"
echo "  bash scripts/tools/start_all.sh upload    — show files to send CPT"
echo ""

