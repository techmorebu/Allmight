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
  for f in activator.jsonl blueprints.jsonl heat.jsonl volatility.jsonl execution_candidate_audit.jsonl near_miss_analysis.json threshold_edge.json threshold_edge_accumulator.json; do
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
    for f in activator.jsonl blueprints.jsonl heat.jsonl volatility.jsonl execution_candidate_audit.jsonl near_miss_analysis.json threshold_edge.json threshold_edge_accumulator.json; do
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
  SESSION_DIR="$LOGS/session_${SESSION}"
  log "Done."

  # ── Post-run analysis pipeline ───────────────────────────────────────────────
  # Runs automatically on stop if blueprints.jsonl exists in the session folder.
  # All outputs land in the session folder alongside activator/heat/volatility logs.
  # Skip silently if blueprints are missing (session had no signals).

  if [[ -n "$SESSION" && -f "$SESSION_DIR/blueprints.jsonl" ]]; then
    BP_COUNT=$(wc -l < "$SESSION_DIR/blueprints.jsonl")
    log "Running post-run analysis on $BP_COUNT blueprints..."

    # 1. Candidate audit — produces execution_candidate_audit.jsonl
    node scripts/tools/candidate_audit_report.js \
      --blueprints "$SESSION_DIR/blueprints.jsonl" \
      --out        "$SESSION_DIR/execution_candidate_audit.jsonl" \
      2>> "$SESSION_DIR/analysis.log" \
      && log "  ✓ candidate_audit_report     → session_${SESSION}/execution_candidate_audit.jsonl" \
      || log "  ✗ candidate_audit_report failed (see session_${SESSION}/analysis.log)"

    # 2. Near-miss analysis — reads audit log
    if [[ -f "$SESSION_DIR/execution_candidate_audit.jsonl" ]]; then
      node scripts/tools/near_miss_analysis_report.js \
        --audit "$SESSION_DIR/execution_candidate_audit.jsonl" \
        --json  > "$SESSION_DIR/near_miss_analysis.json" \
        2>> "$SESSION_DIR/analysis.log" \
        && log "  ✓ near_miss_analysis_report  → session_${SESSION}/near_miss_analysis.json" \
        || log "  ✗ near_miss_analysis_report failed"

      # 3. Threshold-edge tracker — reads same audit log
      node scripts/tools/threshold_edge_report.js \
        --audit "$SESSION_DIR/execution_candidate_audit.jsonl" \
        --json  > "$SESSION_DIR/threshold_edge.json" \
        2>> "$SESSION_DIR/analysis.log" \
        && log "  ✓ threshold_edge_report      → session_${SESSION}/threshold_edge.json" \
        || log "  ✗ threshold_edge_report failed"

      # 4. Cross-session threshold-edge accumulator
      # Finds all previous session audit logs and runs accumulation across them
      PREV_SESSIONS=$(find "$LOGS" -name "execution_candidate_audit.jsonl" \
        -not -path "$SESSION_DIR/*" 2>/dev/null \
        | sed 's|/execution_candidate_audit.jsonl||' | sort)
      ALL_SESSIONS="$PREV_SESSIONS $SESSION_DIR"
      SESSION_ARGS=""
      for s in $ALL_SESSIONS; do
        [[ -f "$s/execution_candidate_audit.jsonl" ]] && SESSION_ARGS="$SESSION_ARGS $s"
      done
      SESSION_COUNT=$(echo $SESSION_ARGS | wc -w)

      if [[ $SESSION_COUNT -ge 1 ]]; then
        node scripts/tools/threshold_edge_accumulator_report.js \
          --sessions $SESSION_ARGS \
          --json > "$SESSION_DIR/threshold_edge_accumulator.json" \
          2>> "$SESSION_DIR/analysis.log" \
          && log "  ✓ threshold_edge_accumulator → session_${SESSION}/threshold_edge_accumulator.json  (${SESSION_COUNT} session(s))" \
          || log "  ✗ threshold_edge_accumulator failed"
      fi
    fi

    # 5. Quick summary to console
    if [[ -f "$SESSION_DIR/execution_candidate_audit.jsonl" ]]; then
      CONFIRMED=$(grep -c '"auditVerdict":"CANDIDATE_CONFIRMED"' "$SESSION_DIR/execution_candidate_audit.jsonl" 2>/dev/null || echo 0)
      NEAR_MISS=$(grep -c '"auditVerdict":"CANDIDATE_NEAR_MISS"' "$SESSION_DIR/execution_candidate_audit.jsonl" 2>/dev/null || echo 0)
      EDGE_COUNT=$(python3 -c "
import json, sys
recs = [json.loads(l) for l in open('$SESSION_DIR/execution_candidate_audit.jsonl') if l.strip()]
edge = [r for r in recs if r.get('nearMissType')=='near_miss_spread'
        and r.get('simulationVerdict')=='SIM_PASS'
        and (r.get('executionConfidence') or 0) >= 0.65]
print(len(edge))
" 2>/dev/null || echo "?")
      ACCUM_VERDICT=$(python3 -c "
import json
try:
  d = json.load(open('$SESSION_DIR/threshold_edge_accumulator.json'))
  print(d.get('recurrenceVerdict','?') + ' (' + d.get('q1_sessionCoverage','?') + ')')
except: print('not run')
" 2>/dev/null || echo "?")
      echo ""
      echo "  ┌─────────────────────────────────────────────────────┐"
      echo "  │  Session $SESSION analysis summary                  │"
      echo "  │  CONFIRMED candidates:      $CONFIRMED"
      echo "  │  Near-miss:                 $NEAR_MISS"
      echo "  │  Threshold-edge (tracked):  $EDGE_COUNT"
      echo "  │  Accumulator verdict:       $ACCUM_VERDICT"
      echo "  └─────────────────────────────────────────────────────┘"
      echo ""
    fi
  else
    [[ -n "$SESSION" ]] && log "No blueprints found — skipping post-run analysis."
  fi

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
# BLUEPRINT_LOG_PATH must be exported BEFORE the subshell launches so the
# child process inherits it. blueprint_logger.js reads this env var on load.
export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"
export SIM_LOG_PATH="$SESSION_DIR/simulations.jsonl"
export FILTER_LOG_PATH="$SESSION_DIR/filter_results.jsonl"

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
