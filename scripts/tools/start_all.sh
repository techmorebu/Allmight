#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Unified Launcher  v1.4
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/start_all.sh
#
#  Runs all AllMight processes from a single terminal.
#  Each run gets a timestamped session ID — logs are clearly named.
#
#  SUBCOMMANDS
#  ───────────
#  bash scripts/tools/start_all.sh          # start everything
#  bash scripts/tools/start_all.sh status   # check what's running
#  bash scripts/tools/start_all.sh stop     # stop + run analysis + compress session
#  bash scripts/tools/start_all.sh logs     # tail all logs live
#  bash scripts/tools/start_all.sh upload   # show zip path + file inventory
#
#  ╔══════════════════════════════════════════════════════════════════════════╗
#  ║  CANONICAL UNATTENDED STARTUP — USE THESE EXACT COMMANDS EVERY TIME    ║
#  ╠══════════════════════════════════════════════════════════════════════════╣
#  ║                                                                          ║
#  ║  # 1. Verify Redis is alive                                              ║
#  ║  redis-cli ping                                                           ║
#  ║                                                                          ║
#  ║  # 2. Pull latest code                                                   ║
#  ║  cd ~/Allmight && git pull                                                ║
#  ║                                                                          ║
#  ║  # 3. Start the full stack incl. watchdog (detached, survives terminal)   ║
#  ║  nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &         ║
#  ║  disown                                                                   ║
#  ║                                                                          ║
#  ║  # 4. Verify after ~3 minutes                                            ║
#  ║  bash scripts/tools/start_all.sh status                                  ║
#  ║                                                                          ║
#  ╠══════════════════════════════════════════════════════════════════════════╣
#  ║  CANONICAL STOP + COMPRESS + UPLOAD                                      ║
#  ╠══════════════════════════════════════════════════════════════════════════╣
#  ║                                                                          ║
#  ║  bash scripts/tools/start_all.sh stop    # stops + zips session auto    ║
#  ║  bash scripts/tools/start_all.sh upload  # shows zip path               ║
#  ║                                                                          ║
#  ╚══════════════════════════════════════════════════════════════════════════╝
#
#  SESSION LOG FILES (all zipped automatically on stop)
#  ────────────────────────────────────────────────────
#  activator.jsonl               — tick-level price + signal log
#  blueprints.jsonl              — trade blueprints
#  execution_candidate_audit.jsonl — candidate audit records
#  near_miss_analysis.json       — near-miss breakdown
#  threshold_edge.json           — edge tracker
#  threshold_edge_accumulator.json — cross-session edge accumulator
#  tier_breakdown.json           — threshold tier stats (CONFIRMED/ADAPTIVE/BELOW)
#  size_ladder.json              — size ladder analysis by threshold tier
#  size_ladder_accumulator.json  — cross-session size ladder consistency verdicts
#  flash_loan_readiness.json     — Aave V3 flash overhead analysis by size (Band A)
#  sandbox_results.json          — per-session execution sandbox (0/500/1000ms delay)
#  sandbox_accumulator.json      — cross-session delay survivability (CONSISTENT verdicts)
#  price_replay.jsonl            — tick-density price replay
#  heat.jsonl                    — market heat log
#  volatility.jsonl              — volatility monitor log
#  watchdog.jsonl                — watchdog health records
#  rpc_freshness.jsonl           — RPC intent + freshness telemetry
#  simulations.jsonl             — simulation detail records (if present)
#  filter_results.jsonl          — filter decision records (if present)
#  fetcher.log                   — master fetcher log
#  monitor.log                   — volatility monitor output
#  analysis.log                  — post-run analysis pipeline output
#
#  All PIDs saved to logs/allmight.pid for clean stop.
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail
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

# wait_for_nonempty_file FILE [MAX_WAIT_SEC] [POLL_SEC]
# Polls until FILE exists and has at least one line.
# Continues with a warning on timeout — never hard-fails startup.
wait_for_nonempty_file() {
  local file="$1"
  local max="${2:-60}"
  local poll="${3:-2}"
  local waited=0
  while [[ $waited -lt $max ]]; do
    if [[ -f "$file" ]] && [[ $(wc -l < "$file" 2>/dev/null || echo 0) -gt 0 ]]; then
      return 0
    fi
    sleep "$poll"
    waited=$((waited + poll))
  done
  log "  ⚠ timeout waiting for $file after ${max}s — continuing anyway"
  return 1
}

# wait_for_min_lines FILE MIN_LINES [MAX_WAIT_SEC] [POLL_SEC]
# Polls until FILE has at least MIN_LINES lines.
# Stronger than wait_for_nonempty_file — required for heat.jsonl warmup.
# Continues with a warning on timeout — never hard-fails startup.
wait_for_min_lines() {
  local file="$1"
  local min="${2:-3}"
  local max="${3:-90}"
  local poll="${4:-2}"
  local waited=0
  while [[ $waited -lt $max ]]; do
    local lines=0
    [[ -f "$file" ]] && lines=$(wc -l < "$file" 2>/dev/null || echo 0)
    if [[ $lines -ge $min ]]; then
      return 0
    fi
    sleep "$poll"
    waited=$((waited + poll))
  done
  log "  ⚠ timeout waiting for $file to reach $min lines after ${max}s — continuing anyway"
  return 1
}

# redis_ready — check if Redis is responding before launching the stack.
# Returns 0 if PONG received, 1 otherwise.
# Uses redis-cli if available, falls back to a node one-liner.
redis_ready() {
  if command -v redis-cli &>/dev/null; then
    [[ "$(redis-cli ping 2>/dev/null)" == "PONG" ]] && return 0
    return 1
  fi
  # Fallback: node-based ping (node-fetch not needed — uses net module)
  node -e "
const net=require('net');
const c=net.connect(6379,'127.0.0.1',()=>{c.write('*1\r\n\$4\r\nPING\r\n');});
c.on('data',d=>{process.exit(d.toString().includes('PONG')?0:1);});
c.on('error',()=>process.exit(1));
setTimeout(()=>process.exit(1),2000);
" 2>/dev/null
  return $?
}

# count_jsonl_matches FILE PATTERN
# Counts lines matching a grep pattern. Returns 0 on missing file.
count_jsonl_matches() {
  local file="$1"
  local pattern="$2"
  [[ -f "$file" ]] && grep -c "$pattern" "$file" 2>/dev/null || echo 0
}

# ── WATCHDOG ──────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "watchdog" ]]; then
  shift
  exec bash scripts/tools/allmight_watchdog.sh "$@"
fi

# ── UPLOAD HELPER ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "upload" ]]; then
  if [[ ! -f "$SESSION_FILE" ]]; then
    echo "No active or recent session found."
    exit 1
  fi
  SESSION=$(cat "$SESSION_FILE")
  SESSION_DIR="$LOGS/session_${SESSION}"
  echo ""
  echo "  Upload these files to CPT for analysis:"
  echo "  ─────────────────────────────────────────────────────"
  for f in \
    activator.jsonl \
    blueprints.jsonl \
    execution_candidate_audit.jsonl \
    near_miss_analysis.json \
    threshold_edge.json \
    threshold_edge_accumulator.json \
    tier_breakdown.json \
    size_ladder.json \
    size_ladder_accumulator.json \
    flash_loan_readiness.json \
    sandbox_results.json \
    sandbox_accumulator.json \
    price_replay.jsonl \
    heat.jsonl \
    volatility.jsonl \
    watchdog.jsonl \
    rpc_freshness.jsonl \
    simulations.jsonl \
    filter_results.jsonl \
    fetcher.log \
    monitor.log \
    analysis.log; do
    target="$SESSION_DIR/$f"
    if [[ -f "$target" ]]; then
      lines=$(wc -l < "$target" 2>/dev/null || echo "?")
      size=$(du -sh "$target" 2>/dev/null | cut -f1 || echo "?")
      echo "  ✓  $f  ($lines lines, $size)"
    else
      echo "  ✗  $f  (not found)"
    fi
  done
  echo ""
  # If zip already exists, point directly to it
  ZIP_PATH="$LOGS/session_${SESSION}.zip"
  if [[ -f "$ZIP_PATH" ]]; then
    ZIP_MB=$(du -sh "$ZIP_PATH" 2>/dev/null | cut -f1 || echo "?")
    echo "  ✅  Zip ready: logs/session_${SESSION}.zip  ($ZIP_MB) — upload this file"
  else
    echo "  ℹ  Run 'bash scripts/tools/start_all.sh stop' first to generate the zip."
  fi
  echo ""
  echo "  Session: $SESSION"
  echo ""
  exit 0
fi

# ── RESTART-ACTIVATOR ─────────────────────────────────────────────────────────
# Same-session activator restart — kills only the activator/supervisor,
# leaves fetcher/monitor/heat running, relaunches into the same session files.
# Use when: activator PID is dead but upstream pipeline is still healthy.
if [[ "${1:-}" == "restart-activator" ]]; then
  if [[ ! -f "$SESSION_FILE" ]]; then
    die "No active session found. Start the stack first."
  fi
  SESSION=$(cat "$SESSION_FILE")
  SESSION_DIR="$LOGS/session_${SESSION}"
  log "Restarting activator for session $SESSION..."

  # ── Kill existing activator/supervisor only ──────────────────────────────────
  OLD_PID=$(grep "^activator=" "$PID_FILE" 2>/dev/null | cut -d= -f2 || true)
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID" 2>/dev/null && log "  Killed activator supervisor (pid $OLD_PID)"
    sleep 2
  fi
  pkill -f "arb_window_activator.js" 2>/dev/null || true
  sleep 1

  # ── Verify upstream pipeline is healthy before relaunch ─────────────────────
  log "  Checking upstream pipeline health..."
  HEAT_OK=false
  HEAT_LINES=0
  [[ -f "$SESSION_DIR/heat.jsonl" ]] && HEAT_LINES=$(wc -l < "$SESSION_DIR/heat.jsonl" 2>/dev/null || echo 0)
  [[ $HEAT_LINES -ge 3 ]] && HEAT_OK=true

  HEAT_AGE=99999
  [[ -f "$SESSION_DIR/heat.jsonl" ]] && \
    HEAT_AGE=$(( $(date +%s) - $(date -r "$SESSION_DIR/heat.jsonl" +%s 2>/dev/null || echo 0) ))

  if [[ "$HEAT_OK" == false ]] || [[ $HEAT_AGE -gt 300 ]]; then
    log "  ⚠ Heat pipeline not ready (lines=$HEAT_LINES age=${HEAT_AGE}s) — waiting up to 90s..."
    WAITED=0
    while [[ $WAITED -lt 90 ]]; do
      sleep 5; WAITED=$((WAITED+5))
      HEAT_LINES=0
      [[ -f "$SESSION_DIR/heat.jsonl" ]] && HEAT_LINES=$(wc -l < "$SESSION_DIR/heat.jsonl" 2>/dev/null || echo 0)
      HEAT_AGE=$(( $(date +%s) - $(date -r "$SESSION_DIR/heat.jsonl" +%s 2>/dev/null || echo 0) ))
      if [[ $HEAT_LINES -ge 3 && $HEAT_AGE -le 300 ]]; then
        log "  ✓ Heat ready (${HEAT_LINES} lines, ${HEAT_AGE}s old)"
        HEAT_OK=true; break
      fi
    done
    if [[ "$HEAT_OK" == false ]]; then
      log "  ⚠ Heat still not ready after 90s — restarting activator anyway (supervisor will retry)"
    fi
  else
    log "  ✓ Heat pipeline healthy (${HEAT_LINES} lines, ${HEAT_AGE}s old)"
  fi

  # ── Relaunch activator into same session ─────────────────────────────────────
  export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"
  export SIM_LOG_PATH="$SESSION_DIR/simulations.jsonl"
  export FILTER_LOG_PATH="$SESSION_DIR/filter_results.jsonl"
  export RPC_FRESHNESS_LOG_PATH="$SESSION_DIR/rpc_freshness.jsonl"

  echo "[restart-activator] $(date -u '+%Y-%m-%dT%H:%M:%SZ')" >> "$SESSION_DIR/activator.jsonl"

  nohup bash -c "
    RESTART_COUNT=0
    while true; do
      RESTART_COUNT=\$((RESTART_COUNT+1))
      echo \"[supervisor] Start #\${RESTART_COUNT} \$(date -u '+%Y-%m-%dT%H:%M:%SZ')\" \
        >> '$SESSION_DIR/activator.jsonl'

      node -r dotenv/config scripts/analysis/arb_window_activator.js \
        --pair ETH/USDC-RAMSES \
        --remap-ticks \
        --gas-profile atomic_optimistic \
        --log '$SESSION_DIR/activator.jsonl' \
        --heat-log '$SESSION_DIR/heat.jsonl'

      EXIT=\$?
      echo \"[supervisor] Exited code \$EXIT — restarting in 5s\" \
        >> '$SESSION_DIR/activator.jsonl'
      [[ \$EXIT -eq 0 ]] && break

      HEAT_WAIT=0
      echo \"[supervisor] checking heat readiness before restart...\" \
        >> '$SESSION_DIR/activator.jsonl'
      while [[ \$HEAT_WAIT -lt 120 ]]; do
        HEAT_LINES=0
        [[ -f '$SESSION_DIR/heat.jsonl' ]] && HEAT_LINES=\$(wc -l < '$SESSION_DIR/heat.jsonl' 2>/dev/null || echo 0)
        if [[ \$HEAT_LINES -ge 3 ]]; then
          echo \"[supervisor] heat ready (\${HEAT_LINES} lines) — restarting activator\" \
            >> '$SESSION_DIR/activator.jsonl'
          break
        fi
        sleep 5; HEAT_WAIT=\$((HEAT_WAIT+5))
      done
      [[ \$HEAT_WAIT -ge 120 ]] && echo \"[supervisor] heat timeout — restarting anyway\" \
        >> '$SESSION_DIR/activator.jsonl'
      sleep 5
    done
  " >> "$SESSION_DIR/activator.jsonl" 2>&1 &
  NEW_PID=$!
  disown $NEW_PID 2>/dev/null || true

  # Update PID file — activator line only
  if [[ -f "$PID_FILE" ]]; then
    TMP_PID=$(mktemp)
    grep -v "^activator=" "$PID_FILE" > "$TMP_PID" && mv "$TMP_PID" "$PID_FILE"
  fi
  echo "activator=$NEW_PID" >> "$PID_FILE"

  log "✓ Activator restarted (pid $NEW_PID) → same session $SESSION"
  log "  Logs continuing in: $SESSION_DIR/activator.jsonl"
  log "  Blueprints:         $SESSION_DIR/blueprints.jsonl"
  exit 0
fi

# ── STATUS ────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "status" ]]; then
  SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "none" )
  SESSION_DIR="$LOGS/session_${SESSION}"
  echo ""
  echo "  AllMight status  (session: $SESSION)"
  echo "  ─────────────────────────────────────────────"
  for name in fetcher monitor heat activator; do
    pid=$(grep "^${name}=" "$PID_FILE" 2>/dev/null | cut -d= -f2 || true)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "  ✓ $name  (pid $pid)  RUNNING"
    else
      echo "  ✗ $name  NOT RUNNING"
    fi
  done
  echo ""
  if [[ -d "$SESSION_DIR" ]]; then
    echo "  Log files this session:"
    for f in activator.jsonl blueprints.jsonl execution_candidate_audit.jsonl near_miss_analysis.json threshold_edge.json threshold_edge_accumulator.json tier_breakdown.json size_ladder.json size_ladder_accumulator.json flash_loan_readiness.json sandbox_results.json sandbox_accumulator.json price_replay.jsonl heat.jsonl volatility.jsonl watchdog.jsonl rpc_freshness.jsonl simulations.jsonl filter_results.jsonl fetcher.log monitor.log analysis.log; do
      target="$SESSION_DIR/$f"
      [[ -f "$target" ]] && echo "    $(wc -l < "$target" 2>/dev/null || echo "?") lines  $f" \
                         || echo "    —  $f (not yet created)"
    done
  fi
  echo ""
  echo "  Run 'bash scripts/tools/start_all.sh upload' to see what to send CPT."
  echo ""
  exit 0
fi

# ── STOP ──────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
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
  pkill -f "allmight_watchdog.sh"           2>/dev/null || true
  pkill -f "notification_router.js"         2>/dev/null || true

  SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "" )
  SESSION_DIR="$LOGS/session_${SESSION}"
  log "Done."

  # ── Post-run analysis pipeline ───────────────────────────────────────────────
  # Runs automatically on stop if blueprints.jsonl exists in the session folder.
  # All outputs land in the session folder. Skip if no signals were recorded.

  if [[ -n "$SESSION" && -f "$SESSION_DIR/blueprints.jsonl" ]]; then
    BP_COUNT=$(wc -l < "$SESSION_DIR/blueprints.jsonl")
    log "Running post-run analysis on $BP_COUNT blueprints..."

    # 1. Candidate audit
    node scripts/tools/candidate_audit_report.js \
      --blueprints "$SESSION_DIR/blueprints.jsonl" \
      --out        "$SESSION_DIR/execution_candidate_audit.jsonl" \
      2>> "$SESSION_DIR/analysis.log" \
      && log "  ✓ candidate_audit_report     → session_${SESSION}/execution_candidate_audit.jsonl" \
      || log "  ✗ candidate_audit_report failed (see analysis.log)"

    # 2. Near-miss analysis
    if [[ -f "$SESSION_DIR/execution_candidate_audit.jsonl" ]]; then
      node scripts/tools/near_miss_analysis_report.js \
        --audit "$SESSION_DIR/execution_candidate_audit.jsonl" \
        --json  > "$SESSION_DIR/near_miss_analysis.json" \
        2>> "$SESSION_DIR/analysis.log" \
        && log "  ✓ near_miss_analysis_report  → session_${SESSION}/near_miss_analysis.json" \
        || log "  ✗ near_miss_analysis_report failed"

      # 3. Threshold-edge tracker
      node scripts/tools/threshold_edge_report.js \
        --audit "$SESSION_DIR/execution_candidate_audit.jsonl" \
        --json  > "$SESSION_DIR/threshold_edge.json" \
        2>> "$SESSION_DIR/analysis.log" \
        && log "  ✓ threshold_edge_report      → session_${SESSION}/threshold_edge.json" \
        || log "  ✗ threshold_edge_report failed"

      # 3b. Threshold tier breakdown (Boss ruling 2026-04-19)
      # Reads execution_candidate_audit.jsonl and emits per-tier stats JSON:
      #   CONFIRMED_STRICT / ADAPTIVE_BUFFER / BELOW_BUFFER counts, avg PnL, pass rates.
      node -e "
'use strict';
const fs = require('fs');
const path = require('path');
const auditPath = process.argv[1];
if (!fs.existsSync(auditPath)) process.exit(0);
const records = fs.readFileSync(auditPath,'utf8').split('\n').filter(Boolean).reduce((acc,l)=>{
  try{acc.push(JSON.parse(l));}catch{}return acc;
},[]);
const tiers = ['CONFIRMED_STRICT','ADAPTIVE_BUFFER','BELOW_BUFFER'];
const result = { generatedAt: new Date().toISOString(), totalRecords: records.length, tiers: {} };
for (const tier of tiers) {
  const recs = records.filter(r => r.thresholdTier === tier);
  const nets   = recs.map(r=>r.baseNetProfitUsd).filter(n=>n!=null);
  const confs  = recs.map(r=>r.executionConfidence).filter(n=>n!=null);
  const spreads= recs.map(r=>r.spreadPct).filter(n=>n!=null);
  const worsts = recs.map(r=>r.worstCaseNetUsd).filter(n=>n!=null);
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  const simPass = recs.filter(r=>r.simulationVerdict==='SIM_PASS').length;
  result.tiers[tier] = {
    count       : recs.length,
    avgSpreadPct: avg(spreads),
    avgConf     : avg(confs),
    avgNetUsd   : avg(nets),
    minNetUsd   : nets.length ? Math.min(...nets) : null,
    maxNetUsd   : nets.length ? Math.max(...nets) : null,
    worstCasePositiveCount: worsts.filter(w=>w>0).length,
    simPassCount: simPass,
    simPassRate : recs.length ? simPass/recs.length : null,
    bySafeProfile: recs.filter(r=>r.profile==='SAFE').length,
    byRegime    : recs.reduce((acc,r)=>{const k=r.regime||'?';acc[k]=(acc[k]||0)+1;return acc;},{}),
  };
}
fs.writeFileSync(process.argv[2], JSON.stringify(result, null, 2));
" "$SESSION_DIR/execution_candidate_audit.jsonl" \
        "$SESSION_DIR/tier_breakdown.json" \
        2>> "$SESSION_DIR/analysis.log" \
        && log "  ✓ tier_breakdown             → session_${SESSION}/tier_breakdown.json" \
        || log "  ✗ tier_breakdown failed"

      # 3c. Size ladder analysis by threshold tier (Boss ruling 2026-04-19)
      # Runs realism simulator across $200→$1000 for CONFIRMED_STRICT
      # and $200→$300 for ADAPTIVE_BUFFER. Emits per-tier viable rate,
      # avg net, worst-case positivity, fail rate, and Band B recommendation.
      if [[ -f "$SESSION_DIR/blueprints.jsonl" ]]; then
        node scripts/tools/size_ladder_report.js \
          --blueprints "$SESSION_DIR/blueprints.jsonl" \
          --json > "$SESSION_DIR/size_ladder.json" \
          2>> "$SESSION_DIR/analysis.log" \
          && log "  ✓ size_ladder_report         → session_${SESSION}/size_ladder.json" \
          || log "  ✗ size_ladder_report failed"
      fi

      # 3d. Flash-loan readiness analysis — Band A only (Boss ruling 2026-04-19)
      # Models Aave V3 flash overhead (0.05% fee + atomic gas + MEV complexity)
      # across the approved $200→$1000 size ladder. Requires audit + blueprints.
      if [[ -f "$SESSION_DIR/blueprints.jsonl" && -f "$SESSION_DIR/execution_candidate_audit.jsonl" ]]; then
        node scripts/tools/flash_loan_readiness_report.js \
          --blueprints "$SESSION_DIR/blueprints.jsonl" \
          --audit      "$SESSION_DIR/execution_candidate_audit.jsonl" \
          --json > "$SESSION_DIR/flash_loan_readiness.json" \
          2>> "$SESSION_DIR/analysis.log" \
          && log "  ✓ flash_loan_readiness       → session_${SESSION}/flash_loan_readiness.json" \
          || log "  ✗ flash_loan_readiness failed"
      fi

      # 3e. Per-session execution sandbox (Execution Timing Model phase)
      # Simulates each blueprint at 0ms / 500ms / 1000ms delay using replay data.
      # Requires both blueprints.jsonl and price_replay.jsonl — skipped if either missing.
      if [[ -f "$SESSION_DIR/blueprints.jsonl" && -f "$SESSION_DIR/price_replay.jsonl" ]]; then
        node scripts/tools/execution_sandbox_report.js \
          --blueprints "$SESSION_DIR/blueprints.jsonl" \
          --replay     "$SESSION_DIR/price_replay.jsonl" \
          --delays     0,500,1000 \
          --out        "$SESSION_DIR/sandbox_results.json" \
          2>> "$SESSION_DIR/analysis.log" \
          && log "  ✓ execution_sandbox_report   → session_${SESSION}/sandbox_results.json" \
          || log "  ✗ execution_sandbox_report failed"
      fi

      # 4. Cross-session accumulator — auto-discovers all previous session audit logs
      SESSION_ARGS=""
      while IFS= read -r -d '' sdir; do
        [[ -f "$sdir/execution_candidate_audit.jsonl" ]] && SESSION_ARGS="$SESSION_ARGS $sdir"
      done < <(find "$LOGS" -maxdepth 1 -name "session_*" -type d -print0 | sort -z)
      SESSION_COUNT=$(echo $SESSION_ARGS | wc -w)

      if [[ $SESSION_COUNT -ge 1 ]]; then
        # shellcheck disable=SC2086
        node scripts/tools/threshold_edge_accumulator_report.js \
          --sessions $SESSION_ARGS \
          --json > "$SESSION_DIR/threshold_edge_accumulator.json" \
          2>> "$SESSION_DIR/analysis.log" \
          && log "  ✓ threshold_edge_accumulator → session_${SESSION}/threshold_edge_accumulator.json  (${SESSION_COUNT} session(s))" \
          || log "  ✗ threshold_edge_accumulator failed"

        # 4b. Cross-session size ladder accumulator (Boss ruling 2026-04-19)
        # Aggregates size ladder results across all sessions — issues CONSISTENT /
        # CONSISTENT_STRONG / DEVELOPING / INSUFFICIENT_DATA verdicts per size step.
        # Requires >= 3 sessions for CONSISTENT, >= 5 for CONSISTENT_STRONG.
        # shellcheck disable=SC2086
        node scripts/tools/size_ladder_accumulator_report.js \
          --sessions $SESSION_ARGS \
          --json > "$SESSION_DIR/size_ladder_accumulator.json" \
          2>> "$SESSION_DIR/analysis.log" \
          && log "  ✓ size_ladder_accumulator    → session_${SESSION}/size_ladder_accumulator.json  (${SESSION_COUNT} session(s))" \
          || log "  ✗ size_ladder_accumulator failed"

        # 4c. Cross-session execution sandbox accumulator (Execution Timing Model phase)
        # Aggregates delay survivability across sessions — CONSISTENT / DEVELOPING verdicts
        # per delay tier (0ms / 500ms / 1000ms). Requires both blueprints.jsonl +
        # price_replay.jsonl per session. Sessions missing either file are skipped cleanly.
        SANDBOX_SESSION_ARGS=""
        while IFS= read -r -d '' sdir; do
          [[ -f "$sdir/blueprints.jsonl" && -f "$sdir/price_replay.jsonl" ]] && \
            SANDBOX_SESSION_ARGS="$SANDBOX_SESSION_ARGS $sdir"
        done < <(find "$LOGS" -maxdepth 1 -name "session_*" -type d -print0 | sort -z)
        SANDBOX_COUNT=$(echo $SANDBOX_SESSION_ARGS | wc -w)

        if [[ $SANDBOX_COUNT -ge 1 ]]; then
          # shellcheck disable=SC2086
          node scripts/tools/execution_sandbox_accumulator_report.js \
            --sessions $SANDBOX_SESSION_ARGS \
            --json > "$SESSION_DIR/sandbox_accumulator.json" \
            2>> "$SESSION_DIR/analysis.log" \
            && log "  ✓ sandbox_accumulator        → session_${SESSION}/sandbox_accumulator.json  (${SANDBOX_COUNT} session(s))" \
            || log "  ✗ sandbox_accumulator failed"
        fi
      fi
    fi

    # 5. Session health summary
    ACT_LOG="$SESSION_DIR/activator.jsonl"
    AUDIT_LOG="$SESSION_DIR/execution_candidate_audit.jsonl"

    CONFIRMED=$(count_jsonl_matches "$AUDIT_LOG" '"auditVerdict":"CANDIDATE_CONFIRMED"')
    NEAR_MISS=$(count_jsonl_matches "$AUDIT_LOG" '"auditVerdict":"CANDIDATE_NEAR_MISS"')
    EDGE_COUNT=$(python3 -c "
import json
try:
  d = json.load(open('$SESSION_DIR/threshold_edge.json'))
  print(d.get('edgeCount', 0))
except: print('?')
" 2>/dev/null || echo "?")
    RB_OK=$(count_jsonl_matches "$ACT_LOG" '"type":"provider_rebuild_success"')
    RB_FAIL=$(count_jsonl_matches "$ACT_LOG" '"type":"provider_rebuild_failed"')
    RB_TOTAL=$(count_jsonl_matches "$ACT_LOG" '"type":"provider_rebuild"')
    UNKNOWN_HEAT=$(count_jsonl_matches "$ACT_LOG" '"heatClass":"UNKNOWN"')
    SIGNALS=$(count_jsonl_matches "$ACT_LOG" '"signal":"EXECUTION_READY"')
    ACCUM_VERDICT=$(python3 -c "
import json
try:
  d = json.load(open('$SESSION_DIR/threshold_edge_accumulator.json'))
  print(d.get('recurrenceVerdict','?') + ' (' + d.get('q1_sessionCoverage','?') + ')')
except: print('not run')
" 2>/dev/null || echo "?")

    echo ""
    echo "  ╔═══════════════════════════════════════════════════════╗"
    echo "  ║  Session $SESSION — health summary          ║"
    echo "  ╠═══════════════════════════════════════════════════════╣"
    echo "  ║  Signals (EXECUTION_READY):    $SIGNALS"
    echo "  ║  Blueprints:                   $BP_COUNT"
    echo "  ║  CONFIRMED candidates:         $CONFIRMED"
    echo "  ║  Near-miss:                    $NEAR_MISS"
    echo "  ║  Threshold-edge tracked:       $EDGE_COUNT"
    echo "  ║  Accumulator verdict:          $ACCUM_VERDICT"
    echo "  ╠═══════════════════════════════════════════════════════╣"
    echo "  ║  Provider rebuilds:            $RB_TOTAL  (ok=$RB_OK  fail=$RB_FAIL)"
    echo "  ║  Heat UNKNOWN at signal:       $UNKNOWN_HEAT"
    echo "  ╚═══════════════════════════════════════════════════════╝"
    echo ""

  else
    [[ -n "$SESSION" ]] && log "No blueprints found — skipping post-run analysis."
  fi

  [[ -n "$SESSION" ]] && log "Session logs: logs/session_${SESSION}/"
  log "Run 'bash scripts/tools/start_all.sh upload' to see what to send CPT."

  # ── Discord stop summary notification (non-blocking, fail-silent) ──────────
  if [[ -n "$SESSION" && -d "$SESSION_DIR" ]]; then
    node -r dotenv/config scripts/monitoring/notification_router.js \
      --stop-summary "$SESSION_DIR" >> "$SESSION_DIR/analysis.log" 2>&1 &
  fi

  # ── Auto-compress session folder ───────────────────────────────────────────
  # Compresses the completed session into a single zip for easy upload and storage.
  # Skips rpc_freshness.jsonl (large, low-value for CPT analysis) to save space.
  # Output: logs/session_<ID>.zip (beside the session folder, not inside it).
  if [[ -n "$SESSION" && -d "$SESSION_DIR" ]]; then
    ZIP_PATH="$LOGS/session_${SESSION}.zip"
    ZIP_TMP="$LOGS/.session_${SESSION}_zipping"

    # Guard: skip if zip already exists
    if [[ -f "$ZIP_PATH" ]]; then
      log "  ↩ session zip already exists: session_${SESSION}.zip"
    else
      log "  Compressing session_${SESSION}/ → session_${SESSION}.zip ..."
      touch "$ZIP_TMP"   # flag file so we can detect interrupted zips

      # All files required for CPT analysis — price_replay.jsonl always included.
      # rpc_freshness.jsonl included (Boss ruling: telemetry required).
      # JSONL compresses ~97% so even a 150MB raw session fits in ~4MB zip.
      ZIP_FILES=(
        activator.jsonl
        blueprints.jsonl
        execution_candidate_audit.jsonl
        near_miss_analysis.json
        threshold_edge.json
        threshold_edge_accumulator.json
        tier_breakdown.json
        size_ladder.json
        size_ladder_accumulator.json
        flash_loan_readiness.json
        sandbox_results.json
        sandbox_accumulator.json
        price_replay.jsonl
        heat.jsonl
        volatility.jsonl
        watchdog.jsonl
        rpc_freshness.jsonl
        simulations.jsonl
        filter_results.jsonl
        fetcher.log
        monitor.log
        analysis.log
      )

      # Build the zip from the session directory
      (
        cd "$LOGS"
        TARGETS=()
        for f in "${ZIP_FILES[@]}"; do
          [[ -f "session_${SESSION}/$f" ]] && TARGETS+=("session_${SESSION}/$f")
        done
        if [[ ${#TARGETS[@]} -gt 0 ]]; then
          zip -q "session_${SESSION}.zip" "${TARGETS[@]}"
        fi
      )

      rm -f "$ZIP_TMP"

      if [[ -f "$ZIP_PATH" ]]; then
        ZIP_MB=$(du -m "$ZIP_PATH" 2>/dev/null | cut -f1 || echo "?")
        RAW_MB=$(du -sm "$SESSION_DIR" 2>/dev/null | cut -f1 || echo "?")
        log "  ✓ Compressed: session_${SESSION}.zip (${ZIP_MB}MB, was ${RAW_MB}MB raw)"
        log "    Upload: logs/session_${SESSION}.zip"
      else
        log "  ✗ Compression failed — session folder still intact"
      fi
    fi
  fi

  exit 0
fi

# ── LOGS (live tail) ──────────────────────────────────────────────────────────
if [[ "${1:-}" == "logs" ]]; then
  SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "" )
  SESSION_DIR="$LOGS/session_${SESSION}"
  echo ""
  echo "  Tailing all AllMight logs (session: $SESSION). Ctrl+C to stop."
  echo "  ─────────────────────────────────────────────────────────────────"
  tail -f \
    "$SESSION_DIR/fetcher.log" \
    "$SESSION_DIR/monitor.log" \
    "$SESSION_DIR/heat.jsonl" \
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

# ── REDIS PRE-FLIGHT ──────────────────────────────────────────────────────────
# Root cause of DEAD_ON_START pattern: Redis ECONNREFUSED causes volatility
# monitor to fail silently → no heat data → activator exits immediately.
# Abort startup if Redis is not reachable — clear error beats silent failure.
log "Checking Redis connectivity..."
if redis_ready; then
  log "✓ Redis reachable"
else
  die "Redis is not responding. Start Redis before launching AllMight.\n  Try: redis-server --daemonize yes\n  Or:  sudo systemctl start redis"
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
pkill -f "allmight_watchdog.sh"           2>/dev/null || true
pkill -f "notification_router.js"         2>/dev/null || true
sleep 1

log "Starting AllMight — session: $SESSION"
log "All logs → $SESSION_DIR/"
echo ""

# ── Process 1: Fetcher loop ───────────────────────────────────────────────────
# TODO: unsupported-chain noise (base/optimism "Unknown chain" errors) comes from
# fetcher modules loading all chain configs regardless of what is active.
# Fix belongs in master-fetcher.js / chain config, not here.
# Tracked as hygiene debt — does not affect arbitrum pipeline.
#
# nohup + disown: protects the stack from terminal close (SIGHUP).
# Root cause of session_20260412_2102 abrupt stop — whole group killed on
# terminal close. Using nohup ensures background jobs survive detachment.
nohup bash -c "
  while true; do
    node -r dotenv/config scripts/master-fetcher.js >> '$SESSION_DIR/fetcher.log' 2>&1
    sleep 120
  done
" >> "$SESSION_DIR/fetcher.log" 2>&1 &
FETCHER_PID=$!
disown $FETCHER_PID 2>/dev/null || true
echo "fetcher=$FETCHER_PID" >> "$PID_FILE"
log "✓ Fetcher loop     (pid $FETCHER_PID) → session_${SESSION}/fetcher.log"

# Wait for fetcher to produce output before starting the monitor.
log "  Waiting for fetcher output (max 60s)..."
wait_for_nonempty_file "$SESSION_DIR/fetcher.log" 60 2

# ── Process 2: Volatility monitor ────────────────────────────────────────────
nohup node -r dotenv/config scripts/analysis/arb_volatility_monitor.js \
  --chain arbitrum \
  --interval 120 \
  --log "$SESSION_DIR/volatility.jsonl" \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
MONITOR_PID=$!
disown $MONITOR_PID 2>/dev/null || true
echo "monitor=$MONITOR_PID" >> "$PID_FILE"
log "✓ Volatility monitor (pid $MONITOR_PID) → session_${SESSION}/volatility.jsonl"

# Wait for at least 2 volatility scan records before starting the heat runner.
# One record is insufficient — heat runner needs a stable data window.
log "  Waiting for volatility data (≥2 records, max 90s)..."
wait_for_min_lines "$SESSION_DIR/volatility.jsonl" 2 90 2

# ── Process 3: Heat report runner ────────────────────────────────────────────
nohup node scripts/tools/volatility_divergence_report.js \
  --log "$SESSION_DIR/volatility.jsonl" \
  --out "$SESSION_DIR/heat.jsonl" \
  --interval 30 \
  >> "$SESSION_DIR/monitor.log" 2>&1 &
HEAT_PID=$!
disown $HEAT_PID 2>/dev/null || true
echo "heat=$HEAT_PID" >> "$PID_FILE"
log "✓ Heat report      (pid $HEAT_PID) → session_${SESSION}/heat.jsonl"

# Wait for at least 3 heat records before launching the activator.
# Root cause of DEAD_ON_START in sessions 0955 and 0516: activator launched
# with only 1 heat record, got insufficient data, and exited immediately.
# 3 records = ~90s of warmup, giving the activator a stable regime read.
log "  Waiting for heat warmup (≥3 records, max 120s)..."
wait_for_min_lines "$SESSION_DIR/heat.jsonl" 3 120 2

# ── Process 4: Activator (supervised) ────────────────────────────────────────
# BLUEPRINT_LOG_PATH must be exported BEFORE the subshell launches so the
# child process inherits it. blueprint_logger.js reads this env var on load.
export BLUEPRINT_LOG_PATH="$SESSION_DIR/blueprints.jsonl"
export SIM_LOG_PATH="$SESSION_DIR/simulations.jsonl"
export FILTER_LOG_PATH="$SESSION_DIR/filter_results.jsonl"
# Route provider factory telemetry into the session folder so RPC failure
# URLs are captured per-session and visible in watchdog/analysis.
export RPC_FRESHNESS_LOG_PATH="$SESSION_DIR/rpc_freshness.jsonl"

nohup bash -c "
  RESTART_COUNT=0
  while true; do
    RESTART_COUNT=\$((RESTART_COUNT+1))
    echo \"[supervisor] Start #\${RESTART_COUNT} \$(date -u '+%Y-%m-%dT%H:%M:%SZ')\" \
      >> '$SESSION_DIR/activator.jsonl'

    node -r dotenv/config scripts/analysis/arb_window_activator.js \
      --pair ETH/USDC-RAMSES \
      --remap-ticks \
      --gas-profile atomic_optimistic \
      --log '$SESSION_DIR/activator.jsonl' \
      --heat-log '$SESSION_DIR/heat.jsonl'

    EXIT=\$?
    echo \"[supervisor] Exited code \$EXIT — restarting in 5s\" \
      >> '$SESSION_DIR/activator.jsonl'
    [[ \$EXIT -eq 0 ]] && break

    # ── Restart readiness check (Boss ruling 2026-04-14) ──────────────────────
    # Before relaunching after a non-zero exit, verify the heat pipeline is warm.
    # A DEAD_ON_START can occur if heat.jsonl is stale or insufficient after an
    # RPC outage that also froze the upstream pipeline.
    # Poll up to 120s for heat file to have ≥3 fresh lines before restarting.
    HEAT_WAIT=0
    echo \"[supervisor] checking heat readiness before restart...\" \
      >> '$SESSION_DIR/activator.jsonl'
    while [[ \$HEAT_WAIT -lt 120 ]]; do
      HEAT_LINES=0
      [[ -f '$SESSION_DIR/heat.jsonl' ]] && HEAT_LINES=\$(wc -l < '$SESSION_DIR/heat.jsonl' 2>/dev/null || echo 0)
      if [[ \$HEAT_LINES -ge 3 ]]; then
        echo \"[supervisor] heat ready (\${HEAT_LINES} lines) — restarting activator\" \
          >> '$SESSION_DIR/activator.jsonl'
        break
      fi
      sleep 5
      HEAT_WAIT=\$((HEAT_WAIT+5))
    done
    if [[ \$HEAT_WAIT -ge 120 ]]; then
      echo \"[supervisor] heat readiness timeout after 120s — restarting anyway\" \
        >> '$SESSION_DIR/activator.jsonl'
    fi

    sleep 5
  done
" >> "$SESSION_DIR/activator.jsonl" 2>&1 &
ACTIVATOR_PID=$!
disown $ACTIVATOR_PID 2>/dev/null || true
echo "activator=$ACTIVATOR_PID" >> "$PID_FILE"
log "✓ Activator        (pid $ACTIVATOR_PID) → session_${SESSION}/activator.jsonl"
log "✓ Blueprints                            → session_${SESSION}/blueprints.jsonl"

# ── Process 5: Watchdog loop ──────────────────────────────────────────────────
# Monitors all components for staleness, dead PIDs, and error accumulation.
# Writes watchdog.jsonl per check. Triggers Discord alerts on DEGRADED/FAILED.
# Runs every 300s (5 min). Integrated here so it always launches with the stack.
nohup bash scripts/tools/allmight_watchdog.sh --loop 300 \
  >> "$SESSION_DIR/watchdog_loop.log" 2>&1 &
WATCHDOG_PID=$!
disown $WATCHDOG_PID 2>/dev/null || true
echo "watchdog=$WATCHDOG_PID" >> "$PID_FILE"
log "✓ Watchdog loop    (pid $WATCHDOG_PID) → session_${SESSION}/watchdog.jsonl (every 300s)"

echo ""
log "Session $SESSION running. PIDs: fetcher=$FETCHER_PID monitor=$MONITOR_PID heat=$HEAT_PID activator=$ACTIVATOR_PID watchdog=$WATCHDOG_PID"
echo ""
echo "  bash scripts/tools/start_all.sh status             — check health"
echo "  bash scripts/tools/start_all.sh logs               — watch live output"
echo "  bash scripts/tools/start_all.sh stop               — stop + run analysis"
echo "  bash scripts/tools/start_all.sh upload             — show files to send CPT"
echo "  bash scripts/tools/start_all.sh restart-activator  — restart activator only (same session)"
echo ""
echo "  For 72h unattended run — terminal-safe launch:"
echo "    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &"
echo "    disown; echo 'AllMight running detached'"
echo ""

# ── Discord startup notification (non-blocking, fail-silent) ──────────────────
node -r dotenv/config scripts/monitoring/notification_router.js \
  --startup >> "$SESSION_DIR/analysis.log" 2>&1 &
