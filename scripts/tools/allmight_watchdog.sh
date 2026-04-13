#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Watchdog  v1.0
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/allmight_watchdog.sh
#
#  PURPOSE
#  ─────────
#  Verify session health during unattended operation.
#  Detects stale pipelines, dead processes, and error accumulation.
#  Does NOT change any trade logic, thresholds, or execution decisions.
#
#  USAGE
#  ─────
#  # Single snapshot
#  bash scripts/tools/allmight_watchdog.sh
#
#  # Continuous loop (e.g. every 60 seconds for 24h burn-in)
#  bash scripts/tools/allmight_watchdog.sh --loop 60
#
#  # Quiet mode — machine-readable JSONL only (no console output)
#  bash scripts/tools/allmight_watchdog.sh --quiet
#
#  EXIT CODES
#  ──────────
#  0 = HEALTHY
#  1 = DEGRADED (non-critical warnings)
#  2 = FAILED   (critical component dead or stale)
#
# ── HEALTH VERDICT RULES ──────────────────────────────────────────────────────
#
#  HEALTHY  — all critical files fresh within thresholds AND all PIDs alive
#  DEGRADED — PIDs alive but ≥1 file stale, OR minor error patterns spiking
#  FAILED   — any critical PID dead, OR critical file stale beyond FAILED_STALE_SEC
#
# ── FRESHNESS THRESHOLDS (seconds) ───────────────────────────────────────────
#  Configurable via environment variables. Defaults shown below.
#  A file is "stale" if its mtime is older than the threshold.
#  FAILED threshold is 2× the DEGRADED threshold for each component.

FETCHER_STALE_SEC=${FETCHER_STALE_SEC:-300}          # 5 min degraded
FETCHER_FAILED_SEC=${FETCHER_FAILED_SEC:-600}         # 10 min failed
VOLATILITY_STALE_SEC=${VOLATILITY_STALE_SEC:-300}     # 5 min degraded
VOLATILITY_FAILED_SEC=${VOLATILITY_FAILED_SEC:-600}   # 10 min failed
# Heat and activator: DEGRADED threshold unchanged (3 min = correct sensitivity).
# FAILED threshold raised from 360s → 600s after burn-in showed false-positive
# FAILED verdicts in session_20260412_2102 where activator was still alive.
# Heat runner emits every ~30s; a 6-min FAILED window fired during normal
# inter-cycle gaps. 10-min FAILED gives a fairer signal for true death.
HEAT_STALE_SEC=${HEAT_STALE_SEC:-180}                 # 3 min degraded (unchanged)
HEAT_FAILED_SEC=${HEAT_FAILED_SEC:-600}               # 10 min failed  (was 360s)
ACTIVATOR_STALE_SEC=${ACTIVATOR_STALE_SEC:-180}       # 3 min degraded (unchanged)
ACTIVATOR_FAILED_SEC=${ACTIVATOR_FAILED_SEC:-600}     # 10 min failed  (was 360s)

# Error pattern alert thresholds — per watchdog check window
UNKNOWN_HEAT_ALERT=${UNKNOWN_HEAT_ALERT:-50}    # >50 UNKNOWN heatClass records = warning
LOCK_HELD_ALERT=${LOCK_HELD_ALERT:-20}          # >20 "lock held" lines = warning
CHAIN_ERROR_ALERT=${CHAIN_ERROR_ALERT:-30}      # >30 "Unknown chain" lines = warning

# ═══════════════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")/../.." || exit 1

LOGS="./logs"
PID_FILE="$LOGS/allmight.pid"
SESSION_FILE="$LOGS/allmight.session"

# ── Args ──────────────────────────────────────────────────────────────────────

LOOP_SEC=0
QUIET=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --loop)   LOOP_SEC="${2:-60}"; shift 2 ;;
    --loop=*) LOOP_SEC="${1#*=}";  shift   ;;
    --quiet)  QUIET=true;          shift   ;;
    *)                             shift   ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────────

now_sec()      { date +%s; }
now_iso()      { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
file_age_sec() { local f="$1"; [[ -f "$f" ]] && echo $(( $(now_sec) - $(date -r "$f" +%s 2>/dev/null || echo 0) )) || echo 99999; }
file_size()    { [[ -f "$1" ]] && wc -c < "$1" 2>/dev/null || echo 0; }
# awk-based counts: always exits 0 and outputs exactly one number.
# grep -c exits 1 on zero matches but still prints "0", causing || echo 0
# to fire and produce two lines — which breaks printf-based JSONL assembly.
grep_count()   { [[ -f "$1" ]] && awk -v p="$2" '$0~p{c++}END{print c+0}' "$1" 2>/dev/null || echo 0; }
tail_count()   { [[ -f "$1" ]] && tail -n "${3:-500}" "$1" 2>/dev/null | awk -v p="$2" '$0~p{c++}END{print c+0}' || echo 0; }

# ── Single health snapshot ────────────────────────────────────────────────────

run_check() {
  local TS
  TS=$(now_iso)
  local OVERALL="HEALTHY"
  local STALE_COMPONENTS=()
  local DEAD_PIDS=()
  local WARNING_FLAGS=()

  # Read session
  if [[ ! -f "$SESSION_FILE" ]]; then
    [[ "$QUIET" == false ]] && echo "[watchdog] No active session found (logs/allmight.session missing)."
    exit 2
  fi
  local SESSION
  SESSION=$(cat "$SESSION_FILE")
  local SESSION_DIR="$LOGS/session_${SESSION}"

  # ── A. Freshness checks ───────────────────────────────────────────────────
  # check_freshness is called directly (not in a subshell) so that mutations
  # to OVERALL and STALE_COMPONENTS persist to the parent scope.
  # Status string is stored in a caller-provided variable name via printf -v.

  check_freshness() {
    local label="$1" file="$2" stale_sec="$3" failed_sec="$4" outvar="$5"
    local age
    age=$(file_age_sec "$file")
    local size
    size=$(file_size "$file")
    local status="OK"

    if [[ ! -f "$file" ]] || [[ "$size" -eq 0 ]]; then
      status="MISSING"
      STALE_COMPONENTS+=("$label:MISSING")
      OVERALL="FAILED"
    elif [[ $age -gt $failed_sec ]]; then
      status="FAILED(${age}s)"
      STALE_COMPONENTS+=("$label:STALE_${age}s")
      OVERALL="FAILED"
    elif [[ $age -gt $stale_sec ]]; then
      status="STALE(${age}s)"
      STALE_COMPONENTS+=("$label:WARN_${age}s")
      [[ "$OVERALL" == "HEALTHY" ]] && OVERALL="DEGRADED"
    fi
    printf -v "$outvar" '%s' "$label=$status age=${age}s"
  }

  local F_STATUS V_STATUS H_STATUS A_STATUS
  check_freshness "fetcher"    "$SESSION_DIR/fetcher.log"      $FETCHER_STALE_SEC    $FETCHER_FAILED_SEC    F_STATUS
  check_freshness "volatility" "$SESSION_DIR/volatility.jsonl"  $VOLATILITY_STALE_SEC $VOLATILITY_FAILED_SEC V_STATUS
  check_freshness "heat"       "$SESSION_DIR/heat.jsonl"        $HEAT_STALE_SEC       $HEAT_FAILED_SEC       H_STATUS
  check_freshness "activator"  "$SESSION_DIR/activator.jsonl"   $ACTIVATOR_STALE_SEC  $ACTIVATOR_FAILED_SEC  A_STATUS

  # ── B. PID checks ─────────────────────────────────────────────────────────

  local RB_SUCCESS=0 RB_FAILED=0 RB_TOTAL=0

  if [[ -f "$PID_FILE" ]]; then
    while IFS='=' read -r name pid; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        true  # alive
      else
        DEAD_PIDS+=("$name:$pid")
        OVERALL="FAILED"
      fi
    done < "$PID_FILE"
  else
    WARNING_FLAGS+=("no_pid_file")
    [[ "$OVERALL" == "HEALTHY" ]] && OVERALL="DEGRADED"
  fi

  # ── C. Content checks ─────────────────────────────────────────────────────

  # Rebuild counts from activator log
  RB_SUCCESS=$(grep_count "$SESSION_DIR/activator.jsonl" '"type":"provider_rebuild_success"')
  RB_FAILED=$(grep_count "$SESSION_DIR/activator.jsonl" '"type":"provider_rebuild_failed"')
  RB_TOTAL=$(grep_count "$SESSION_DIR/activator.jsonl" '"type":"provider_rebuild"')

  # Unknown heat — count only the last 500 lines (recent window)
  local UNKNOWN_HEAT
  UNKNOWN_HEAT=$(tail_count "$SESSION_DIR/activator.jsonl" '"heatClass":"UNKNOWN"' 500)

  # Confirmed / near-miss from audit log
  local CONFIRMED NEAR_MISS
  CONFIRMED=$(grep_count "$SESSION_DIR/execution_candidate_audit.jsonl" '"auditVerdict":"CANDIDATE_CONFIRMED"')
  NEAR_MISS=$(grep_count "$SESSION_DIR/execution_candidate_audit.jsonl" '"auditVerdict":"CANDIDATE_NEAR_MISS"')

  # Recent EXECUTION_READY count (last 500 lines)
  local RECENT_SIGNALS
  RECENT_SIGNALS=$(tail_count "$SESSION_DIR/activator.jsonl" '"signal":"EXECUTION_READY"' 500)

  # Recent blueprint count
  local RECENT_BLUEPRINTS
  RECENT_BLUEPRINTS=$(tail_count "$SESSION_DIR/blueprints.jsonl" '"blueprintId"' 500)

  # ── D. Error pattern checks (last 200 lines of each log) ──────────────────

  local LOCK_HELD CHAIN_ERRORS FETCH_FAILS
  LOCK_HELD=$(tail_count "$SESSION_DIR/monitor.log" "lock held" 200)
  CHAIN_ERRORS=$(tail_count "$SESSION_DIR/fetcher.log" "Unknown chain" 200)
  FETCH_FAILS=$(tail_count "$SESSION_DIR/fetcher.log" "Fetcher execution failed" 200)

  if [[ $UNKNOWN_HEAT -gt $UNKNOWN_HEAT_ALERT ]]; then
    WARNING_FLAGS+=("high_unknown_heat:$UNKNOWN_HEAT")
    [[ "$OVERALL" == "HEALTHY" ]] && OVERALL="DEGRADED"
  fi
  if [[ $LOCK_HELD -gt $LOCK_HELD_ALERT ]]; then
    WARNING_FLAGS+=("lock_contention:$LOCK_HELD")
    [[ "$OVERALL" == "HEALTHY" ]] && OVERALL="DEGRADED"
  fi
  if [[ $CHAIN_ERRORS -gt $CHAIN_ERROR_ALERT ]]; then
    WARNING_FLAGS+=("chain_errors:$CHAIN_ERRORS")
    # Chain errors are hygiene debt, not a critical failure
    [[ "$OVERALL" == "HEALTHY" ]] && OVERALL="DEGRADED"
  fi

  # ── Human-readable snapshot ───────────────────────────────────────────────

  if [[ "$QUIET" == false ]]; then
    local STATUS_CLR=""
    local RST="\033[0m"
    [[ "$OVERALL" == "HEALTHY"  ]] && STATUS_CLR="\033[1;32m"
    [[ "$OVERALL" == "DEGRADED" ]] && STATUS_CLR="\033[33m"
    [[ "$OVERALL" == "FAILED"   ]] && STATUS_CLR="\033[1;31m"

    echo ""
    echo "  ╔══════════════════════════════════════════════════════════╗"
    printf "  ║  AllMight Watchdog  %-35s ║\n" "$TS"
    printf "  ║  Session: %-46s ║\n" "$SESSION"
    printf "  ║  Status:  ${STATUS_CLR}%-46s${RST} ║\n" "$OVERALL"
    echo "  ╠══════════════════════════════════════════════════════════╣"
    echo "  ║  Freshness:"
    printf "  ║    %-52s ║\n" "$F_STATUS"
    printf "  ║    %-52s ║\n" "$V_STATUS"
    printf "  ║    %-52s ║\n" "$H_STATUS"
    printf "  ║    %-52s ║\n" "$A_STATUS"
    echo "  ╠══════════════════════════════════════════════════════════╣"
    echo "  ║  PIDs:"
    if [[ -f "$PID_FILE" ]]; then
      while IFS='=' read -r name pid; do
        if kill -0 "$pid" 2>/dev/null; then
          printf "  ║    %-20s pid=%-8s ✓ alive          ║\n" "$name" "$pid"
        else
          printf "  ║    %-20s pid=%-8s ✗ DEAD            ║\n" "$name" "$pid"
        fi
      done < "$PID_FILE"
    else
      echo "  ║    (no PID file — processes may be stopped)              ║"
    fi
    echo "  ╠══════════════════════════════════════════════════════════╣"
    echo "  ║  Content:"
    printf "  ║    Signals (recent/500):   %-29s ║\n" "$RECENT_SIGNALS"
    printf "  ║    Blueprints (recent/500):%-29s ║\n" "$RECENT_BLUEPRINTS"
    printf "  ║    CONFIRMED candidates:   %-29s ║\n" "$CONFIRMED"
    printf "  ║    Near-miss candidates:   %-29s ║\n" "$NEAR_MISS"
    printf "  ║    Rebuilds (tot/ok/fail): %-29s ║\n" "${RB_TOTAL}/${RB_SUCCESS}/${RB_FAILED}"
    printf "  ║    UNKNOWN heat (recent):  %-29s ║\n" "$UNKNOWN_HEAT"
    echo "  ╠══════════════════════════════════════════════════════════╣"
    echo "  ║  Error patterns (last 200 lines):"
    printf "  ║    Lock contention:        %-29s ║\n" "$LOCK_HELD"
    printf "  ║    Unknown chain errors:   %-29s ║\n" "$CHAIN_ERRORS"
    printf "  ║    Fetch failures:         %-29s ║\n" "$FETCH_FAILS"
    if [[ ${#WARNING_FLAGS[@]} -gt 0 ]]; then
      echo "  ╠══════════════════════════════════════════════════════════╣"
      echo "  ║  Warnings:"
      for w in "${WARNING_FLAGS[@]}"; do
        printf "  ║    ⚠ %-53s ║\n" "$w"
      done
    fi
    if [[ ${#DEAD_PIDS[@]} -gt 0 ]]; then
      echo "  ╠══════════════════════════════════════════════════════════╣"
      echo "  ║  Dead processes:"
      for d in "${DEAD_PIDS[@]}"; do
        printf "  ║    ✗ %-53s ║\n" "$d"
      done
    fi
    echo "  ╚══════════════════════════════════════════════════════════╝"
    echo ""
  fi

  # ── Machine-readable JSONL record ─────────────────────────────────────────

  local WATCHDOG_LOG="$SESSION_DIR/watchdog.jsonl"
  local STALE_JSON
  STALE_JSON=$(printf '"%s",' "${STALE_COMPONENTS[@]+"${STALE_COMPONENTS[@]}"}" | sed 's/,$//')
  local DEAD_JSON
  DEAD_JSON=$(printf '"%s",' "${DEAD_PIDS[@]+"${DEAD_PIDS[@]}"}" | sed 's/,$//')
  local WARN_JSON
  WARN_JSON=$(printf '"%s",' "${WARNING_FLAGS[@]+"${WARNING_FLAGS[@]}"}" | sed 's/,$//')

  printf '{"ts":"%s","session":"%s","overallStatus":"%s","staleComponents":[%s],"deadPids":[%s],"rebuildSuccessCount":%s,"rebuildFailCount":%s,"rebuildTotalCount":%s,"unknownHeatCount":%s,"confirmedCount":%s,"nearMissCount":%s,"recentSignals":%s,"recentBlueprints":%s,"lockHeldCount":%s,"chainErrorCount":%s,"fetchFailCount":%s,"warningFlags":[%s]}\n' \
    "$TS" "$SESSION" "$OVERALL" \
    "$STALE_JSON" "$DEAD_JSON" \
    "$RB_SUCCESS" "$RB_FAILED" "$RB_TOTAL" \
    "$UNKNOWN_HEAT" "$CONFIRMED" "$NEAR_MISS" \
    "$RECENT_SIGNALS" "$RECENT_BLUEPRINTS" \
    "$LOCK_HELD" "$CHAIN_ERRORS" "$FETCH_FAILS" \
    "$WARN_JSON" >> "$WATCHDOG_LOG"

  # Return exit code matching verdict
  case "$OVERALL" in
    HEALTHY)  return 0 ;;
    DEGRADED) return 1 ;;
    FAILED)   return 2 ;;
    *)        return 2 ;;
  esac
}

# ── Main loop ─────────────────────────────────────────────────────────────────

if [[ $LOOP_SEC -gt 0 ]]; then
  [[ "$QUIET" == false ]] && echo "[watchdog] Running every ${LOOP_SEC}s. Ctrl+C to stop."
  while true; do
    run_check || true   # never exit the loop on non-zero
    sleep "$LOOP_SEC"
  done
else
  run_check
  exit $?
fi
