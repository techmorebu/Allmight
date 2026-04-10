#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Unified Launcher  v1.0
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/start_all.sh
#
#  Runs all AllMight processes from a single terminal.
#  All output goes to logs/. No extra windows needed.
#
#  USAGE
#  ─────
#  bash scripts/tools/start_all.sh          # start everything
#  bash scripts/tools/start_all.sh status   # check what's running
#  bash scripts/tools/start_all.sh stop     # stop everything
#  bash scripts/tools/start_all.sh logs     # tail all logs live
#
#  PROCESSES STARTED
#  ─────────────────
#  1. master-fetcher      — feeds Redis every 120s
#  2. volatility-monitor  — reads Redis, writes volatility_arbitrum.jsonl
#  3. heat-report         — reads monitor log, writes volatility_timeseries.jsonl
#  4. activator           — supervised, auto-restarts on fatal exit
#
#  All PIDs saved to logs/allmight.pid for clean stop.
# ═══════════════════════════════════════════════════════════════════════════════

set -e
cd "$(dirname "$0")/../.." || exit 1   # always run from repo root

LOGS="./logs"
PID_FILE="$LOGS/allmight.pid"
mkdir -p "$LOGS"

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[start_all] $*"; }
die()  { echo "[start_all] ERROR: $*" >&2; exit 1; }

[[ -f "scripts/analysis/arb_window_activator.js" ]] || \
  die "Run from repo root (~/Allmight)"

# ── STATUS ────────────────────────────────────────────────────────────────────
if [[ "$1" == "status" ]]; then
  echo ""
  echo "  AllMight process status:"
  echo "  ─────────────────────────────────"
  for name in fetcher monitor heat activator; do
    pid=$(grep "^${name}=" "$PID_FILE" 2>/dev/null | cut -d= -f2)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "  ✓ $name  (pid $pid)  RUNNING"
    else
      echo "  ✗ $name  NOT RUNNING"
    fi
  done
  echo ""
  echo "  Blueprint count: $(wc -l < "$LOGS/trade_blueprints.jsonl" 2>/dev/null || echo 0)"
  echo "  Activator log:   $(wc -l < "$LOGS/activator_supervised.jsonl" 2>/dev/null || echo 0) lines"
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
  # Catch any stragglers
  pkill -f "arb_window_activator.js" 2>/dev/null || true
  pkill -f "arb_volatility_monitor.js" 2>/dev/null || true
  pkill -f "volatility_divergence_report.js" 2>/dev/null || true
  log "Done."
  exit 0
fi

# ── LOGS (live tail) ──────────────────────────────────────────────────────────
if [[ "$1" == "logs" ]]; then
  echo ""
  echo "  Tailing all AllMight logs. Ctrl+C to stop watching."
  echo "  ─────────────────────────────────────────────────────"
  tail -f \
    "$LOGS/fetcher.log" \
    "$LOGS/monitor.log" \
    "$LOGS/heat.log" \
    "$LOGS/activator_supervised.jsonl" \
    2>/dev/null
  exit 0
fi

# ── START ─────────────────────────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
  # Check if processes are already running
  RUNNING=0
  while IFS='=' read -r name pid; do
    kill -0 "$pid" 2>/dev/null && RUNNING=$((RUNNING+1))
  done < "$PID_FILE"
  if [[ $RUNNING -gt 0 ]]; then
    log "Already running ($RUNNING processes). Use 'stop' first or 'status' to check."
    exit 1
  fi
  rm -f "$PID_FILE"
fi

# Kill any stale processes from previous runs
pkill -f "arb_window_activator.js"   2>/dev/null || true
pkill -f "arb_volatility_monitor.js" 2>/dev/null || true
pkill -f "volatility_divergence_report.js" 2>/dev/null || true
sleep 1

log "Starting AllMight..."
echo ""

# ── Process 1: Fetcher loop ───────────────────────────────────────────────────
# Runs master-fetcher every 120s to keep Redis fresh.
(
  while true; do
    node -r dotenv/config scripts/master-fetcher.js >> "$LOGS/fetcher.log" 2>&1
    sleep 120
  done
) &
FETCHER_PID=$!
echo "fetcher=$FETCHER_PID" >> "$PID_FILE"
log "✓ Fetcher loop started (pid $FETCHER_PID) → logs/fetcher.log"

# Wait for first fetch to complete before starting dependent processes
log "  Waiting 15s for initial Redis population..."
sleep 15

# ── Process 2: Volatility monitor ────────────────────────────────────────────
node -r dotenv/config scripts/analysis/arb_volatility_monitor.js \
  --chain arbitrum \
  --interval 120 \
  --log "$LOGS/volatility_arbitrum.jsonl" \
  >> "$LOGS/monitor.log" 2>&1 &
MONITOR_PID=$!
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
log "✓ Volatility monitor started (pid $MONITOR_PID) → logs/monitor.log"

# Wait for monitor to produce first scan before heat report starts
sleep 5

# ── Process 3: Heat report runner ────────────────────────────────────────────
node scripts/tools/volatility_divergence_report.js \
  --log "$LOGS/volatility_arbitrum.jsonl" \
  --out "$LOGS/volatility_timeseries.jsonl" \
  --interval 30 \
  >> "$LOGS/heat.log" 2>&1 &
HEAT_PID=$!
echo "heat=$HEAT_PID" >> "$PID_FILE"
log "✓ Heat report started (pid $HEAT_PID) → logs/heat.log"

# ── Process 4: Activator (supervised) ────────────────────────────────────────
(
  RESTART_COUNT=0
  while true; do
    RESTART_COUNT=$((RESTART_COUNT+1))
    echo "[supervisor] Start #${RESTART_COUNT} $(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
      >> "$LOGS/activator_supervised.jsonl"

    node -r dotenv/config scripts/analysis/arb_window_activator.js \
      --pair ETH/USDC-RAMSES \
      --remap-ticks \
      --gas-profile atomic_optimistic \
      --log "$LOGS/activator_supervised.jsonl" \
      --heat-log "$LOGS/volatility_timeseries.jsonl"

    EXIT=$?
    echo "[supervisor] Exited code $EXIT — restarting in 5s" \
      >> "$LOGS/activator_supervised.jsonl"
    [[ $EXIT -eq 0 ]] && break
    sleep 5
  done
) &
ACTIVATOR_PID=$!
echo "activator=$ACTIVATOR_PID" >> "$PID_FILE"
log "✓ Activator (supervised) started (pid $ACTIVATOR_PID) → logs/activator_supervised.jsonl"

echo ""
log "All processes running. PIDs saved to logs/allmight.pid"
echo ""
echo "  Commands:"
echo "    bash scripts/tools/start_all.sh status   — check health"
echo "    bash scripts/tools/start_all.sh logs      — watch live output"
echo "    bash scripts/tools/start_all.sh stop      — stop everything"
echo ""
echo "  Blueprint output:"
echo "    tail -f logs/trade_blueprints.jsonl"
echo ""
echo "  EXECUTION_READY signals:"
echo "    grep EXECUTION_READY logs/activator_supervised.jsonl | tail -5"
echo ""
