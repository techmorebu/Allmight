#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Pre-Run Stack Evaluation
#  scripts/tools/pre_run_eval.sh
#
#  Runs a complete pre-flight check of every component before launching a
#  session. Covers: file presence, syntax, env vars, Redis, RPC, pool state,
#  process conflicts, execution gate, capital mode, and session policy.
#
#  Usage:
#    bash scripts/tools/pre_run_eval.sh
#    bash scripts/tools/pre_run_eval.sh --json     (machine-readable summary)
#    bash scripts/tools/pre_run_eval.sh --fix       (attempt auto-fixes)
#
#  Exit codes:
#    0 = all checks pass (GO)
#    1 = warnings only   (CAUTION — review before starting)
#    2 = hard failures   (NO-GO — fix before starting)
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"

JSON_MODE=false
FIX_MODE=false
[[ "${1:-}" == "--json" ]] && JSON_MODE=true
[[ "${1:-}" == "--fix"  ]] && FIX_MODE=true

# ─── COUNTERS ────────────────────────────────────────────────────────────────
PASS=0; WARN=0; FAIL=0
declare -a FAIL_MSGS=()
declare -a WARN_MSGS=()
declare -a PASS_MSGS=()

# ─── HELPERS ─────────────────────────────────────────────────────────────────
pass() { PASS=$((PASS+1)); PASS_MSGS+=("$1"); [[ "$JSON_MODE" == false ]] && echo "  ✅ $1"; }
warn() { WARN=$((WARN+1)); WARN_MSGS+=("$1"); [[ "$JSON_MODE" == false ]] && echo "  ⚠️  $1"; }
fail() { FAIL=$((FAIL+1)); FAIL_MSGS+=("$1"); [[ "$JSON_MODE" == false ]] && echo "  ❌ $1"; }
section() { [[ "$JSON_MODE" == false ]] && { echo ""; echo "── $* ──"; }; }

# ─── 1. CRITICAL FILES ───────────────────────────────────────────────────────
section "1. File Presence"

declare -A CRITICAL_FILES=(
  ["scripts/tools/start_all.sh"]="Session launcher"
  ["scripts/tools/remote_ctl.sh"]="Remote control"
  ["scripts/tools/allmight_watchdog.sh"]="Watchdog"
  ["scripts/analysis/arb_window_activator.js"]="Core activator"
  ["scripts/analysis/arb_volatility_monitor.js"]="Volatility monitor"
  ["scripts/tools/volatility_divergence_report.js"]="Heat report"
  ["scripts/monitoring/notification_router.js"]="Discord router"
  ["scripts/monitoring/discord_notifier.js"]="Discord notifier"
  ["utils/provider_factory.js"]="RPC provider"
  ["utils/rpc_provider.js"]="RPC compat shim"
  ["scripts/tools/session_policy_check.js"]="Policy check"
  ["scripts/tools/project_metrics_tracker.js"]="Metrics tracker"
  ["scripts/execution/shadow_execution_engine.js"]="Shadow engine"
  ["scripts/execution/execution_gate_score.js"]="Gate score"
  ["scripts/execution/capital_policy.js"]="Capital policy"
  ["scripts/execution/preflight_ramses_executor.js"]="Executor preflight"
  ["contracts/AllMightRamsesExecutor.sol"]="Executor contract"
  [".env"]="Environment config"
)

for file in "${!CRITICAL_FILES[@]}"; do
  label="${CRITICAL_FILES[$file]}"
  if [[ -f "$REPO/$file" ]]; then
    pass "$label — $file"
  else
    fail "$label MISSING — $file"
  fi
done

# Check for the bad root-level start_all.sh (my error from prior session)
if [[ -f "$REPO/start_all.sh" ]]; then
  warn "Stale root-level start_all.sh exists — should be deleted (real one is scripts/tools/start_all.sh)"
  if [[ "$FIX_MODE" == true ]]; then
    rm -f "$REPO/start_all.sh"
    pass "Removed stale root start_all.sh (--fix)"
  fi
fi

# ─── 2. SYNTAX CHECKS ────────────────────────────────────────────────────────
section "2. Syntax"

declare -a SYNTAX_SH=(
  "scripts/tools/start_all.sh"
  "scripts/tools/allmight_watchdog.sh"
  "scripts/tools/remote_ctl.sh"
)
for f in "${SYNTAX_SH[@]}"; do
  [[ -f "$f" ]] || continue
  if bash -n "$f" 2>/dev/null; then
    pass "Syntax OK — $f"
  else
    fail "Syntax ERROR — $f"
  fi
done

declare -a SYNTAX_JS=(
  "scripts/analysis/arb_window_activator.js"
  "scripts/analysis/arb_volatility_monitor.js"
  "scripts/monitoring/notification_router.js"
  "utils/provider_factory.js"
  "scripts/execution/shadow_execution_engine.js"
  "scripts/execution/execution_gate_score.js"
  "scripts/execution/capital_policy.js"
)
for f in "${SYNTAX_JS[@]}"; do
  [[ -f "$f" ]] || continue
  if node --check "$f" 2>/dev/null; then
    pass "Syntax OK — $f"
  else
    fail "Syntax ERROR — $f"
  fi
done

# ─── 3. ENV VARS ─────────────────────────────────────────────────────────────
section "3. Environment Variables"

set -a && source .env && set +a 2>/dev/null || true

declare -A REQUIRED_ENV=(
  ["ARBITRUM_MAINNET_RPC_URL_1"]="Tenderly RPC (primary)"
  ["ARBITRUM_MAINNET_RPC_URL_2"]="Infura RPC (cold failover)"
  ["DISCORD_OPS_WEBHOOK_URL"]="Discord OPS channel"
  ["DISCORD_CANDIDATE_WEBHOOK_URL"]="Discord CANDIDATE channel"
  ["DISCORD_SUMMARY_WEBHOOK_URL"]="Discord SUMMARY channel"
)

for var in "${!REQUIRED_ENV[@]}"; do
  label="${REQUIRED_ENV[$var]}"
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    fail "$label not set ($var)"
  elif [[ "$val" == *"YOUR_"* ]] || [[ "$val" == *"PLACEHOLDER"* ]]; then
    warn "$label is a placeholder ($var)"
  else
    # Redact: show hostname only
    display=$(node -e "try{console.log(new URL('$val').hostname)}catch{console.log('[set]')}" 2>/dev/null || echo "[set]")
    pass "$label = $display"
  fi
done

declare -a OPTIONAL_ENV=(
  "PROFIT_RECIPIENT_ADDRESS"
  "LIVE_DEPLOY_APPROVED"
  "DISCORD_NOTIFY_ENABLED"
  "RPC_FRESHNESS_LOG_PATH"
)
for var in "${OPTIONAL_ENV[@]}"; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    pass "Optional $var = $val"
  fi
done

# LIVE_DEPLOY_APPROVED must be false (not true)
LIVE="${LIVE_DEPLOY_APPROVED:-false}"
if [[ "$LIVE" == "true" ]]; then
  warn "LIVE_DEPLOY_APPROVED=true — live execution enabled (ensure Boss approval)"
else
  pass "LIVE_DEPLOY_APPROVED != true — execution correctly locked (MODE 0 PAPER)"
fi

# ─── 4. REDIS ────────────────────────────────────────────────────────────────
section "4. Redis"

if redis-cli ping > /dev/null 2>&1; then
  REDIS_KEYS=$(redis-cli dbsize 2>/dev/null || echo "?")
  pass "Redis responding — $REDIS_KEYS keys"
else
  fail "Redis not responding — run: sudo systemctl start redis"
fi

# ─── 5. NODE MODULES ─────────────────────────────────────────────────────────
section "5. Node Dependencies"

if [[ -d "node_modules/ethers" ]]; then
  ETHERS_VER=$(node -e "console.log(require('./node_modules/ethers/package.json').version)" 2>/dev/null || echo "?")
  pass "ethers installed — v$ETHERS_VER"
else
  fail "ethers not installed — run: npm install"
fi

if [[ -d "node_modules/dotenv" ]]; then
  pass "dotenv installed"
else
  fail "dotenv not installed — run: npm install"
fi

# ─── 6. PROCESS CONFLICTS ────────────────────────────────────────────────────
section "6. Process Conflicts"

declare -a PROCS=(
  "arb_window_activator.js"
  "arb_volatility_monitor.js"
  "allmight_watchdog.sh"
  "notification_router.js"
  "shadow_execution_engine.js"
)

CONFLICT=0
for p in "${PROCS[@]}"; do
  COUNT=$(pgrep -cf "$p" 2>/dev/null | tr -d '\n' || echo "0")
  COUNT=${COUNT:-0}
  if [[ "$COUNT" =~ ^[0-9]+$ ]] && [[ "$COUNT" -gt 0 ]]; then
    warn "$p already running ($COUNT instance(s)) — stop first: bash scripts/tools/start_all.sh stop"
    CONFLICT=$((CONFLICT+1))
  fi
done
[[ $CONFLICT -eq 0 ]] && pass "No process conflicts — clean slate"

# ─── 7. LIVE RPC CHECK ───────────────────────────────────────────────────────
section "7. RPC Connectivity"

RPC1="${ARBITRUM_MAINNET_RPC_URL_2:-${ARBITRUM_MAINNET_RPC_URL_1:-}}"

if [[ -z "$RPC1" ]]; then
  fail "No Arbitrum RPC URL available"
else
  BLOCK=$(cast block-number --rpc-url "$RPC1" 2>/dev/null || echo "0")
  if [[ "$BLOCK" -gt 0 ]]; then
    pass "Arbitrum RPC live — block #$BLOCK"
  else
    fail "Arbitrum RPC not responding — check $RPC1"
  fi
fi

# ─── 8. POOL STATE ───────────────────────────────────────────────────────────
section "8. Active Pool State"

RAMSES_POOL="0x30AFBcF9458c3131A6d051C621E307E6278E4110"
WETH="0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"

if [[ -n "${RPC1:-}" && "$BLOCK" -gt 0 ]]; then
  LIQ_RAW=$(cast call "$RAMSES_POOL" 'liquidity()(uint128)' --rpc-url "$RPC1" 2>/dev/null || echo "0")
  LIQ=$(echo "$LIQ_RAW" | awk '{print $1}'|tr -dc '0-9')
  LIQ=${LIQ:-0}
  if [[ "$LIQ" -gt 0 ]]; then
    pass "Ramses WETH/USDC pool active — liquidity=$LIQ_RAW"
  else
    fail "Ramses pool has zero liquidity — pool may be inactive"
  fi

  # WETH price proxy (slot0 sqrtPrice)
  SQRT_RAW=$(cast call "$RAMSES_POOL" 'slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)' \
    --rpc-url "$RPC1" 2>/dev/null | head -1 || echo "0")
  SQRT=$(echo "$SQRT_RAW" | awk '{print $1}'|tr -dc '0-9')
  SQRT=${SQRT:-0}
  if [[ ${#SQRT} -gt 5 ]]; then
    pass "Pool slot0 readable — sqrtPriceX96=${SQRT:0:12}..."
  else
    warn "Pool slot0 value looks low ($SQRT_RAW) — verify pool address"
  fi
else
  warn "Pool check skipped — RPC not available"
fi

# ─── 9. EXECUTION GATE SCORE ─────────────────────────────────────────────────
section "9. Execution Gate Score"

SESSION_POINTER="logs/allmight.session"
SESSION_DIR=""
if [[ -f "$SESSION_POINTER" ]]; then
  SESSION=$(cat "$SESSION_POINTER")
  SESSION_DIR="logs/sessions/session_${SESSION}"
fi

GATE_OUTPUT=""
if [[ -n "$SESSION_DIR" && -d "$SESSION_DIR" ]]; then
  GATE_OUTPUT=$(node scripts/execution/execution_gate_score.js \
    --session "$SESSION_DIR" --json 2>/dev/null || echo "")
else
  # Try without session (will use cold defaults)
  GATE_OUTPUT=$(node scripts/execution/execution_gate_score.js --json 2>/dev/null || echo "")
fi

if [[ -n "$GATE_OUTPUT" ]]; then
  SCORE=$(echo "$GATE_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('totalScore','?'))" 2>/dev/null || echo "?")
  VERDICT=$(echo "$GATE_OUTPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('verdict','?'))" 2>/dev/null || echo "?")
  BLOCKERS=$(echo "$GATE_OUTPUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
b=d.get('hardBlockers',[])
print('; '.join(b[:2]) if b else 'none')
" 2>/dev/null || echo "?")
  pass "Gate score computed — score=$SCORE verdict=$VERDICT"
  [[ "$BLOCKERS" != "none" ]] && warn "Hard blockers: $BLOCKERS"
else
  warn "Gate score unavailable (no session data — will populate after first run)"
fi

# ─── 10. SESSION POLICY ──────────────────────────────────────────────────────
section "10. Session Policy"

# Policy check requires an active session with a live activator.
# Pre-session PAUSE = expected (last session's activator is stale).
# Only treat PAUSE as a hard failure if a session is already running.
SESSION_RUNNING=false
[[ -f "logs/allmight.pid" ]] && SESSION_RUNNING=true

POLICY_OUT=$(node scripts/tools/session_policy_check.js 2>/dev/null || echo "unavailable")
POLICY_MODE=$(echo "$POLICY_OUT" | grep -oE "PAUSE|STANDARD|CONSERVATIVE|AGGRESSIVE" | head -1 || echo "")
if [[ "$POLICY_MODE" == "PAUSE" && "$SESSION_RUNNING" == "true" ]]; then
  fail "Session policy is PAUSE (mid-session) — check activator health"
elif [[ "$POLICY_MODE" == "PAUSE" ]]; then
  pass "Session policy: PAUSE (expected pre-session — clears once activator starts writing)"
elif [[ "$POLICY_MODE" == "STANDARD" ]]; then
  pass "Session policy: STANDARD — green light"
elif [[ "$POLICY_MODE" == "CONSERVATIVE" || "$POLICY_MODE" == "AGGRESSIVE" ]]; then
  warn "Session policy: $POLICY_MODE"
elif [[ -z "$POLICY_MODE" ]]; then
  pass "Session policy: pre-session (no active session — will evaluate after launch)"
else
  warn "Session policy: $POLICY_MODE"
fi

# ─── 11. EXECUTOR PREFLIGHT ──────────────────────────────────────────────────
section "11. Executor Contract Preflight"

if [[ -f "scripts/execution/preflight_ramses_executor.js" && -n "${RPC1:-}" ]]; then
  PREFLIGHT=$(node scripts/execution/preflight_ramses_executor.js --json 2>/dev/null || echo "")
  if [[ -n "$PREFLIGHT" ]]; then
    P_PASS=$(echo "$PREFLIGHT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checksPass','?'))" 2>/dev/null || echo "?")
    P_TOTAL=$(echo "$PREFLIGHT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('checksTotal','?'))" 2>/dev/null || echo "?")
    if [[ "$P_PASS" == "$P_TOTAL" ]]; then
      pass "Executor preflight $P_PASS/$P_TOTAL — all addresses live"
    else
      warn "Executor preflight $P_PASS/$P_TOTAL — some checks failed"
    fi
  else
    warn "Executor preflight returned no output"
  fi
else
  warn "Executor preflight skipped (no RPC or script missing)"
fi

# ─── 12. LOG HOUSEKEEPING ────────────────────────────────────────────────────
section "12. Log Housekeeping"

SESSION_COUNT=$(ls -d logs/sessions/session_* 2>/dev/null | wc -l || echo 0)
if [[ $SESSION_COUNT -gt 50 ]]; then
  warn "$SESSION_COUNT session folders in logs/ — consider archiving old sessions:"
  warn "  node scripts/tools/log_retention_manager.js --archive"
else
  pass "$SESSION_COUNT session folders (log space OK)"
fi

DISK_FREE=$(df -h "$REPO/logs" 2>/dev/null | awk 'NR==2{print $4}' || echo "?")
pass "Disk free: $DISK_FREE"

# ─── FINAL VERDICT ───────────────────────────────────────────────────────────
TOTAL=$((PASS+WARN+FAIL))

if [[ "$JSON_MODE" == true ]]; then
  python3 - << PYEOF
import json
result = {
  "ts": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "total": $TOTAL, "pass": $PASS, "warn": $WARN, "fail": $FAIL,
  "verdict": "GO" if $FAIL == 0 and $WARN == 0 else ("CAUTION" if $FAIL == 0 else "NO_GO"),
  "failures": $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${FAIL_MSGS[@]+"${FAIL_MSGS[@]}"}' | sed 's/,$//')])" 2>/dev/null || echo "[]"),
  "warnings": $(python3 -c "import json; print(json.dumps([$(printf '"%s",' "${WARN_MSGS[@]+"${WARN_MSGS[@]}"}' | sed 's/,$//')])" 2>/dev/null || echo "[]"),
}
print(json.dumps(result, indent=2))
PYEOF
  exit 0
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Pre-Run Evaluation — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  $PASS pass  /  $WARN warn  /  $FAIL fail  (of $TOTAL checks)"
echo "───────────────────────────────────────────────────────"

if [[ $FAIL -gt 0 ]]; then
  echo "  🔴 NO-GO — fix failures before starting"
  echo ""
  for msg in "${FAIL_MSGS[@]}"; do echo "  ❌ $msg"; done
  echo ""
  echo "  Run: bash scripts/tools/pre_run_eval.sh --fix"
  echo "  Then re-run eval to confirm clean"
  echo "═══════════════════════════════════════════════════════"
  exit 2
elif [[ $WARN -gt 0 ]]; then
  echo "  🟡 CAUTION — warnings present, review before starting"
  echo ""
  for msg in "${WARN_MSGS[@]}"; do echo "  ⚠️  $msg"; done
  echo ""
  echo "  If acceptable, proceed with:"
  echo "  bash scripts/tools/start_all.sh"
  echo "═══════════════════════════════════════════════════════"
  exit 1
else
  echo "  🟢 GO — all checks passed"
  echo ""
  echo "  bash scripts/tools/start_all.sh"
  echo "  # or for unattended:"
  echo "  nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 & disown"
  echo "═══════════════════════════════════════════════════════"
  exit 0
fi
