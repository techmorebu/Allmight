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

# Recovery grace period: after a provider rebuild, suppress activator-only FAILED
# verdicts for this many seconds. Real failures (dead PID, multi-component stale)
# still escalate immediately. Only activator freshness staleness is buffered.
# Root cause: rebuild burst → temporary cadence disruption → false FAILED.
RECOVERY_GRACE_SEC=${RECOVERY_GRACE_SEC:-600}         # 10 min grace after rebuild

# Error pattern alert thresholds — per watchdog check window
UNKNOWN_HEAT_ALERT=${UNKNOWN_HEAT_ALERT:-50}    # >50 UNKNOWN heatClass records = warning
LOCK_HELD_ALERT=${LOCK_HELD_ALERT:-20}          # >20 "lock held" lines = warning
# Chain errors: raised from 30 → 200 to suppress known "Unknown chain: optimism/base"
# fetcher noise. This hygiene debt lives in master-fetcher.js (see TODO in start_all.sh).
# At 30 the watchdog fired DEGRADED on 83% of checks despite a healthy pipeline.
# Real chain-error problems will still alert at sustained volumes above 200.
CHAIN_ERROR_ALERT=${CHAIN_ERROR_ALERT:-200}     # >200 "Unknown chain" lines = warning

# ═══════════════════════════════════════════════════════════════════════════════

cd "$(dirname "$0")/../.." || exit 1

LOGS="./logs"
SESSIONS_DIR="$LOGS/sessions"   # must match start_all.sh v1.6+
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
  local SESSION_DIR="$SESSIONS_DIR/session_${SESSION}"

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

  # RPC exhaustion events — read from provider factory telemetry log
  # Shows which specific endpoints are failing during rebuild windows
  local RPC_EXHAUSTED_RECENT=0 RPC_FAILING_URLS=""
  local FRESHNESS_LOG="$SESSION_DIR/rpc_freshness.jsonl"
  if [[ -f "$FRESHNESS_LOG" ]]; then
    RPC_EXHAUSTED_RECENT=$(tail_count "$FRESHNESS_LOG" '"ev":"rpc_exhausted"' 200)
    # Extract unique failing URL patterns from last 200 lines (redacted)
    RPC_FAILING_URLS=$(tail -n 200 "$FRESHNESS_LOG" 2>/dev/null | \
      grep '"ev":"rpc_exhausted"' | \
      sed -n 's/.*"urls":\[\([^]]*\)\].*/\1/p' | \
      tr -d '"' | tr ',' '\n' | sort -u | tr '\n' ',' | sed 's/,$//' | cut -c1-80)
  fi
  if [[ $RPC_EXHAUSTED_RECENT -gt 0 ]]; then
    WARNING_FLAGS+=("rpc_exhausted:${RPC_EXHAUSTED_RECENT}")
    [[ "$OVERALL" == "HEALTHY" ]] && OVERALL="DEGRADED"
  fi

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

  # ── E. Recovery grace — rebuild-aware FAILED suppression ──────────────────
  # Boss ruling 2026-04-13: after a provider rebuild burst, the activator's
  # write cadence can slow temporarily, causing false FAILED verdicts even
  # when the system is healthy and producing candidates.
  #
  # Grace applies ONLY when ALL of these are true:
  #   1. Provisional verdict is FAILED
  #   2. The ONLY stale component is activator (no dead PIDs, no multi-component failure)
  #   3. A provider rebuild occurred recently (within RECOVERY_GRACE_SEC)
  #
  # Does NOT apply if:
  #   - Activator PID is dead
  #   - Fetcher / volatility / heat are also stale or missing
  #   - No rebuild activity detected

  local RECOVERY_GRACE_ACTIVE=false
  local RECENT_REBUILD_COUNT=0

  if [[ "$OVERALL" == "FAILED" && ${#DEAD_PIDS[@]} -eq 0 ]]; then
    # Count stale/missing components that are NOT activator
    local NON_ACT_STALE=0
    for comp in "${STALE_COMPONENTS[@]+"${STALE_COMPONENTS[@]}"}"; do
      [[ -n "$comp" && "$comp" != activator* ]] && NON_ACT_STALE=$((NON_ACT_STALE+1))
    done

    # Only apply grace if activator is the sole failed component
    if [[ $NON_ACT_STALE -eq 0 ]]; then
      # Detect recent rebuild in last 500 lines of activator log.
      # Uses awk for timestamp comparison: rebuild record ts must be within
      # RECOVERY_GRACE_SEC of now. Falls back to simple count if ts unavailable.
      local ACT_LOG="$SESSION_DIR/activator.jsonl"
      if [[ -f "$ACT_LOG" ]]; then
        local NOW_SEC
        NOW_SEC=$(date +%s)
        # mawk-compatible rebuild detection: extract ts with grep+sed, compare age
        RECENT_REBUILD_COUNT=$(tail -n 500 "$ACT_LOG" 2>/dev/null | grep '"type":"provider_rebuild"' | \
          while IFS= read -r rebuild_line; do
            ts=$(echo "$rebuild_line" | sed -n 's/.*"ts":"\([^"]*\)".*/\1/p')
            if [[ -n "$ts" ]]; then
              epoch=$(date -d "$ts" +%s 2>/dev/null || echo 0)
              [[ $((NOW_SEC - epoch)) -le $RECOVERY_GRACE_SEC ]] && echo "recent"
            else
              echo "recent"  # no ts — treat as recent (conservative)
            fi
          done | wc -l | tr -d ' '
        )
      fi

      if [[ $RECENT_REBUILD_COUNT -gt 0 ]]; then
        RECOVERY_GRACE_ACTIVE=true
        OVERALL="DEGRADED"
        WARNING_FLAGS+=("recovery_grace_active")
        # Replace activator stale component tag with RECOVERING annotation
        local NEW_STALE=()
        for comp in "${STALE_COMPONENTS[@]+"${STALE_COMPONENTS[@]}"}"; do
          if [[ "$comp" == activator* ]]; then
            NEW_STALE+=("activator:RECOVERING_${RECOVERY_GRACE_SEC}s")
          else
            NEW_STALE+=("$comp")
          fi
        done
        STALE_COMPONENTS=("${NEW_STALE[@]+"${NEW_STALE[@]}"}")
      fi
    fi
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
    printf "  ║    RPC exhausted (recent): %-29s ║\n" "$RPC_EXHAUSTED_RECENT"
    if [[ -n "$RPC_FAILING_URLS" ]]; then
      printf "  ║    Failing URLs:           %-29s ║\n" "${RPC_FAILING_URLS:0:29}"
    fi
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
    if [[ "$RECOVERY_GRACE_ACTIVE" == true ]]; then
      echo "  ╠══════════════════════════════════════════════════════════╣"
      printf "  ║  ⚡ recovery_grace_active: rebuild detected (%-14s ║\n" "${RECENT_REBUILD_COUNT} recent)"
      printf "  ║    FAILED → DEGRADED for activator freshness only     ║\n"
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

  printf '{"ts":"%s","session":"%s","overallStatus":"%s","staleComponents":[%s],"deadPids":[%s],"rebuildSuccessCount":%s,"rebuildFailCount":%s,"rebuildTotalCount":%s,"unknownHeatCount":%s,"confirmedCount":%s,"nearMissCount":%s,"recentSignals":%s,"recentBlueprints":%s,"lockHeldCount":%s,"chainErrorCount":%s,"fetchFailCount":%s,"rpcExhaustedCount":%s,"warningFlags":[%s],"recoveryGraceActive":%s,"recentRebuildCount":%s}\n' \
    "$TS" "$SESSION" "$OVERALL" \
    "$STALE_JSON" "$DEAD_JSON" \
    "$RB_SUCCESS" "$RB_FAILED" "$RB_TOTAL" \
    "$UNKNOWN_HEAT" "$CONFIRMED" "$NEAR_MISS" \
    "$RECENT_SIGNALS" "$RECENT_BLUEPRINTS" \
    "$LOCK_HELD" "$CHAIN_ERRORS" "$FETCH_FAILS" \
    "$RPC_EXHAUSTED_RECENT" \
    "$WARN_JSON" \
    "$([[ "$RECOVERY_GRACE_ACTIVE" == true ]] && echo true || echo false)" \
    "$RECENT_REBUILD_COUNT" >> "$WATCHDOG_LOG"

  # Return exit code matching verdict
  case "$OVERALL" in
    HEALTHY)  return 0 ;;
    DEGRADED) return 1 ;;
    FAILED)   return 2 ;;
    *)        return 2 ;;
  esac
}

# ── Critical-process watchdog restart config ──────────────────────────────────
# Covers: fetcher, monitor (volatility), heat, activator, notifier
# Each process tracked independently: restart count + last restart timestamp.
# Set WATCHDOG_AUTO_RESTART=false in .env to disable all auto-restart.
WATCHDOG_AUTO_RESTART="${WATCHDOG_AUTO_RESTART:-true}"
WATCHDOG_MAX_RESTARTS="${WATCHDOG_MAX_RESTARTS:-5}"      # per process per session
WATCHDOG_RESTART_COOLDOWN="${WATCHDOG_RESTART_COOLDOWN:-120}"  # seconds between restarts per process

# Per-process restart counters and last-restart timestamps
_RC_fetcher=0;  _LR_fetcher=0
_RC_monitor=0;  _LR_monitor=0
_RC_heat=0;     _LR_heat=0
_RC_activator=0; _LR_activator=0
_RC_notifier=0; _LR_notifier=0

# ── Main loop ─────────────────────────────────────────────────────────────────

# State transition tracking — notifier is called only when status changes.
# Previous status is persisted across loop iterations via a small temp file
# so it survives subshell boundaries inside run_check.
WATCHDOG_STATE_FILE="${LOGS}/.watchdog_prev_status"
PREV_STATUS=""
[[ -f "$WATCHDOG_STATE_FILE" ]] && PREV_STATUS=$(cat "$WATCHDOG_STATE_FILE" 2>/dev/null || echo "")

if [[ $LOOP_SEC -gt 0 ]]; then
  [[ "$QUIET" == false ]] && echo "[watchdog] Running every ${LOOP_SEC}s. Ctrl+C to stop."
  while true; do
    # Capture the JSONL record written in this check by tailing watchdog.jsonl after run_check
    SESSION=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "none" )
    SESSION_DIR="$SESSIONS_DIR/session_${SESSION}"
    WD_LOG="$SESSION_DIR/watchdog.jsonl"
    LINES_BEFORE=0
    [[ -f "$WD_LOG" ]] && LINES_BEFORE=$(wc -l < "$WD_LOG" 2>/dev/null || echo 0)

    run_check || true   # never exit the loop on non-zero

    # Read the record just appended by run_check
    CURR_STATUS=""
    WD_RECORD=""
    if [[ -f "$WD_LOG" ]]; then
      LINES_AFTER=$(wc -l < "$WD_LOG" 2>/dev/null || echo 0)
      if [[ $LINES_AFTER -gt $LINES_BEFORE ]]; then
        WD_RECORD=$(tail -1 "$WD_LOG" 2>/dev/null || echo "")
        CURR_STATUS=$(echo "$WD_RECORD" | grep -o '"overallStatus":"[^"]*"' | cut -d'"' -f4)
      fi
    fi

    # Call notifier if status changed or dead PIDs detected — fail-silent
    if [[ -n "$WD_RECORD" && -n "$CURR_STATUS" ]]; then
      HAS_DEAD=$(echo "$WD_RECORD" | grep -c '"deadPids":\["[^"]' || true)
      if [[ "$CURR_STATUS" != "$PREV_STATUS" || $HAS_DEAD -gt 0 ]]; then
        echo "$WD_RECORD" | \
          node scripts/monitoring/watchdog_notifier.js --prev "$PREV_STATUS" \
          >> "$SESSION_DIR/analysis.log" 2>&1 &
        disown $! 2>/dev/null || true
      fi
      echo "$CURR_STATUS" > "$WATCHDOG_STATE_FILE"
      PREV_STATUS="$CURR_STATUS"
    fi

    # ── Critical-process auto-restart ────────────────────────────────────────────
    # Boss ruling 2026-04-24: all critical processes must be covered.
    # Each process restarted independently. Cap: 5/process/session. Cooldown: 120s.
    # If 2+ dead simultaneously → STACK_DEGRADED escalation alert.
    if [[ "$WATCHDOG_AUTO_RESTART" == "true" && -n "$WD_RECORD" ]]; then

      SESSION_NOW=$( [[ -f "$SESSION_FILE" ]] && cat "$SESSION_FILE" || echo "none" )
      SESSION_DIR_NOW="$SESSIONS_DIR/session_${SESSION_NOW}"
      ANALYSIS_LOG="$SESSION_DIR_NOW/analysis.log"
      NOW_TS=$(date +%s)

      # Build list of dead process names from DEAD_PIDS in the watchdog record
      # Record format: "deadPids":["name:PID","name:PID"]
      DEAD_NAMES=$(echo "$WD_RECORD" | grep -oP '"deadPids":\["[^]]*'         | grep -oP '"[a-z]+:\d+"' | grep -oP '[a-z]+' || echo "")

      DEAD_COUNT=$(echo "$DEAD_NAMES" | grep -c '[a-z]' 2>/dev/null || echo 0)

      # ── STACK DEGRADED escalation if 2+ critical processes dead ──────────────
      if [[ $DEAD_COUNT -ge 2 ]]; then
        echo "[watchdog] STACK_DEGRADED — ${DEAD_COUNT} processes dead: $(echo $DEAD_NAMES | tr '
' ' ')"           | tee -a "$ANALYSIS_LOG" 2>/dev/null || true
        printf '{"ts":"%s","overallStatus":"STACK_DEGRADED","deadCount":%s,"deadProcesses":"%s","session":"%s"}
'           "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$DEAD_COUNT"           "$(echo $DEAD_NAMES | tr '
' ' ')" "$SESSION_NOW" |           node scripts/monitoring/watchdog_notifier.js --prev "$PREV_STATUS"           >> "$ANALYSIS_LOG" 2>&1 &
        disown $! 2>/dev/null || true
      fi

      # ── Per-process restart function ──────────────────────────────────────────
      _try_restart() {
        local PROC="$1"
        local CMD="$2"
        local LOG_SUFFIX="${3:-$PROC}"

        eval local RC="\$_RC_${PROC}"
        eval local LR="\$_LR_${PROC}"
        local ELAPSED=$(( NOW_TS - LR ))

        if [[ $RC -ge $WATCHDOG_MAX_RESTARTS ]]; then
          echo "[watchdog] $PROC — restart cap reached ($RC/${WATCHDOG_MAX_RESTARTS}). Manual intervention required."             | tee -a "$ANALYSIS_LOG" 2>/dev/null || true
          return
        fi

        if [[ $ELAPSED -lt $WATCHDOG_RESTART_COOLDOWN ]]; then
          return  # still in cooldown
        fi

        eval "_RC_${PROC}=\$(( RC + 1 ))"
        eval "_LR_${PROC}=$NOW_TS"
        eval local NEW_RC="\$_RC_${PROC}"

        echo "[watchdog] $PROC DEAD — auto-restart attempt ${NEW_RC}/${WATCHDOG_MAX_RESTARTS}"           | tee -a "$ANALYSIS_LOG" 2>/dev/null || true

        # Launch process
        eval "nohup $CMD >> "$SESSION_DIR_NOW/${LOG_SUFFIX}_restart_${NEW_RC}.log" 2>&1 &"
        local NEW_PID=$!
        disown $NEW_PID 2>/dev/null || true

        # Update PID file
        if [[ -f "$PID_FILE" ]]; then
          grep -v "^${PROC}=" "$PID_FILE" > "${PID_FILE}.tmp" 2>/dev/null || true
          echo "${PROC}=${NEW_PID}" >> "${PID_FILE}.tmp"
          mv "${PID_FILE}.tmp" "$PID_FILE"
        fi

        echo "[watchdog] $PROC restarted — new pid=$NEW_PID (restart ${NEW_RC}/${WATCHDOG_MAX_RESTARTS})"           | tee -a "$ANALYSIS_LOG" 2>/dev/null || true

        # Discord alert
        printf '{"ts":"%s","overallStatus":"PROCESS_RESTARTED","process":"%s","restartCount":%s,"maxRestarts":%s,"newPid":%s,"session":"%s"}
'           "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PROC" "$NEW_RC" "$WATCHDOG_MAX_RESTARTS"           "$NEW_PID" "$SESSION_NOW" |           node scripts/monitoring/watchdog_notifier.js --prev "$PREV_STATUS"           >> "$ANALYSIS_LOG" 2>&1 &
        disown $! 2>/dev/null || true
      }

      # ── Check and restart each critical process ───────────────────────────────────────────
      for DEAD_PROC in $DEAD_NAMES; do
        case "$DEAD_PROC" in

          fetcher)
            # Supervisor loop for fetcher — use temp script to avoid quote nesting
            _FTMP=$(mktemp /tmp/wd_fetch_XXXX.sh)
            printf '#!/usr/bin/env bash\nwhile true; do\n  node -r dotenv/config scripts/master-fetcher.js\n  sleep 120\ndone\n' > "$_FTMP"
            chmod +x "$_FTMP"
            _try_restart "fetcher" "bash $_FTMP"
            ;;

          monitor)
            _try_restart "monitor" \
              "node -r dotenv/config scripts/analysis/arb_volatility_monitor.js --chain arbitrum --interval 120 --log $SESSION_DIR_NOW/volatility.jsonl" \
              "monitor"
            ;;

          heat)
            _try_restart "heat" \
              "node scripts/tools/volatility_divergence_report.js --log $SESSION_DIR_NOW/volatility.jsonl --out $SESSION_DIR_NOW/heat.jsonl --interval 30" \
              "heat"
            ;;

          activator)
            _try_restart "activator" \
              "node -r dotenv/config scripts/analysis/arb_window_activator.js --pair ETH/USDC-RAMSES --remap-ticks --gas-profile atomic_optimistic --log $SESSION_DIR_NOW/activator.jsonl --heat-log $SESSION_DIR_NOW/heat.jsonl"
            ;;

          notifier)
            _try_restart "notifier" \
              "node -r dotenv/config scripts/monitoring/notification_router.js --loop 300" \
              "notifier"
            ;;

        esac
      done

    fi

    sleep "$LOOP_SEC"
  done
else
  run_check
  exit $?
fi
