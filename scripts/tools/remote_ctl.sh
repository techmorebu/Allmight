#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Remote Control  v2.0
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/remote_ctl.sh
#
#  SETUP (run once)
#  ─────────────────────────────────────────────────────────
#  chmod +x ~/Allmight/scripts/tools/remote_ctl.sh
#  mkdir -p ~/.local/bin
#  ln -sf ~/Allmight/scripts/tools/remote_ctl.sh ~/.local/bin/remote_ctl
#  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
#
#  COMMANDS
#  ─────────────────────────────────────────────────────────
#  remote_ctl status      — processes + policy + gate score + shadow PnL
#  remote_ctl start       — launch full stack (Redis + git pull + all processes)
#  remote_ctl stop        — graceful stop + shadow metrics + Discord summary
#  remote_ctl abort       — emergency kill, no analysis, session discarded
#  remote_ctl restart     — stop then start clean
#  remote_ctl shadow      — run shadow execution engine + show totals
#  remote_ctl gate        — execution gate score (BLOCK/PAPER/DRY/MICRO)
#  remote_ctl metrics     — lifetime project metrics (shadow PnL + gate progress)
#  remote_ctl c9          — mark current session C9 (Boss summary complete)
#  remote_ctl policy      — current operating mode only
#  remote_ctl rpc         — RPC endpoint health (Arbitrum, 20 samples)
#  remote_ctl rpc-full    — RPC benchmark all chains + burst test
#  remote_ctl logs        — tail launch.log live (Ctrl+C to exit)
#  remote_ctl confidence  — dry-run confidence log across all sessions
#  remote_ctl discord     — fire test notifications to all Discord channels
#  remote_ctl help        — show this list
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

ROOT="${HOME}/Allmight"
cd "$ROOT" || { echo "ERROR: ~/Allmight not found"; exit 1; }

# Load .env so node scripts have access to env vars
set -a && source .env 2>/dev/null || true && set +a

cmd="${1:-help}"

# ── Helpers ───────────────────────────────────────────────────────────────────

EQ="═══════════════════════════════════════════════════════"
DIV="───────────────────────────────────────────────────────"

header() { echo ""; echo "$EQ"; echo "  AllMight — $*"; echo "$DIV"; echo ""; }
ok()     { echo "  ✅ $*"; }
warn()   { echo "  ⚠️  $*"; }
err()    { echo "  ❌ $*"; }
sep()    { echo "$DIV"; }

# Resolve active session dir
session_dir() {
  local sid=""
  [[ -f logs/allmight.session ]] && sid=$(cat logs/allmight.session)
  if [[ -n "$sid" ]]; then
    if   [[ -d "logs/sessions/session_${sid}" ]]; then echo "logs/sessions/session_${sid}"
    elif [[ -d "logs/session_${sid}" ]];          then echo "logs/session_${sid}"
    fi
  fi
}

# Resolve start_all launcher (root preferred, fallback to scripts/tools)
launcher() {
  if   [[ -f "start_all.sh" ]];              then echo "start_all.sh"
  elif [[ -f "scripts/tools/start_all.sh" ]]; then echo "scripts/tools/start_all.sh"
  else echo "start_allmight.sh"
  fi
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

case "$cmd" in

  # ── STATUS — full health check ─────────────────────────────────────────────
  status)
    header "Status Check"

    echo "  [Processes]"
    LAUNCH="$(launcher)"
    bash "$LAUNCH" --status 2>/dev/null || bash scripts/tools/start_all.sh status 2>/dev/null || echo "  (status unavailable)"
    sep

    echo "  [Policy]"
    SDIR="$(session_dir)"
    if [[ -n "$SDIR" ]]; then
      node scripts/tools/session_policy_check.js --session "$SDIR" 2>/dev/null \
        || node scripts/tools/session_policy_check.js 2>/dev/null \
        || echo "  (policy check unavailable)"
    else
      echo "  No active session"
    fi
    sep

    echo "  [Execution Gate]"
    node scripts/execution/execution_gate_score.js 2>/dev/null \
      || echo "  (gate score unavailable)"
    sep

    echo "  [Shadow Execution]"
    SDIR2="$(session_dir)"
    if [[ -n "$SDIR2" && -f "$SDIR2/shadow_execution_totals.json" ]]; then
      node scripts/execution/shadow_execution_engine.js --session "$SDIR2" 2>/dev/null \
        || echo "  (shadow engine unavailable)"
    else
      echo "  No shadow data yet — run: remote_ctl shadow"
    fi
    ;;

  # ── START — launch full stack ──────────────────────────────────────────────
  start)
    header "Starting AllMight Stack"

    if ! redis-cli ping 2>/dev/null | grep -q PONG; then
      err "Redis not responding. Start it first:"
      echo "    sudo systemctl start redis"
      exit 1
    fi
    ok "Redis: PONG"

    echo "  Pulling latest code..."
    git pull --quiet && ok "Git: up to date" || warn "Git pull failed — continuing with local code"
    echo ""

    LAUNCH="$(launcher)"
    echo "  Launcher: $LAUNCH"
    echo "  Launching stack..."

    nohup bash "$LAUNCH" > logs/launch.log 2>&1 &
    LAUNCH_PID=$!
    disown $LAUNCH_PID

    echo "  Waiting 20s for warmup..."
    sleep 20
    echo ""

    # Start notification router (new version) if not already running
    if ! grep -q "notification_router" logs/pids.txt 2>/dev/null; then
      echo "  Starting notification router..."
      node -r dotenv/config scripts/monitoring/notification_router.js \
        --startup --loop 300 >> logs/notification_router.log 2>&1 &
      NOTIF_PID=$!
      echo "notification_router=$NOTIF_PID" >> logs/pids.txt
      ok "Notification router PID $NOTIF_PID"
    fi

    # Start shadow execution engine polling loop
    SESSION_ID=$(cat logs/allmight.session 2>/dev/null || echo "")
    if [[ -n "$SESSION_ID" ]]; then
      SESSION_DIR="logs/sessions/session_${SESSION_ID}"
      echo "  Starting shadow execution engine..."
      (while true; do
        sleep 300
        node "$ROOT/scripts/execution/shadow_execution_engine.js" \
          --session "$ROOT/$SESSION_DIR" 2>/dev/null || true
      done) >> logs/shadow_engine.log 2>&1 &
      SHADOW_PID=$!
      echo "shadow_engine=$SHADOW_PID" >> logs/pids.txt
      ok "Shadow engine PID $SHADOW_PID (polls every 5m)"

      # Run once immediately to seed the totals file
      node scripts/execution/shadow_execution_engine.js \
        --session "$SESSION_DIR" 2>/dev/null && ok "Shadow totals seeded" || true
    fi

    sep
    echo "  [Status]"
    bash "$LAUNCH" --status 2>/dev/null || true
    sep
    echo "  [Gate Score]"
    node scripts/execution/execution_gate_score.js 2>/dev/null || true
    ;;

  # ── STOP — graceful stop + shadow metrics + Discord summary ───────────────
  stop)
    header "Stopping AllMight Stack"

    SDIR="$(session_dir)"
    SESSION_ID=$(cat logs/allmight.session 2>/dev/null || echo "")

    LAUNCH="$(launcher)"
    bash "$LAUNCH" --stop 2>/dev/null || bash scripts/tools/start_all.sh stop 2>/dev/null || true

    echo ""
    echo "  [Final shadow execution pass]"
    if [[ -n "$SDIR" ]]; then
      node scripts/execution/shadow_execution_engine.js --session "$SDIR" 2>/dev/null \
        && ok "Shadow ledger finalized" || warn "Shadow engine unavailable"
    fi

    echo ""
    echo "  [Lifetime metrics update]"
    node scripts/tools/project_metrics_tracker.js --summary 2>/dev/null \
      || warn "Metrics tracker unavailable"

    echo ""
    echo "  [Discord stop summary]"
    if [[ -n "$SDIR" ]]; then
      node -r dotenv/config scripts/monitoring/notification_router.js \
        --stop-summary "$SDIR" 2>/dev/null && ok "Stop summary sent" || warn "Discord unavailable"
    fi

    sep
    echo "  [Confidence check]"
    node scripts/tools/dryrun_confidence_log.js --logs logs/sessions 2>/dev/null || true

    echo ""
    if [[ -n "$SESSION_ID" ]]; then
      echo "  Mark C9 to make this session Boss-valid:"
      echo "  remote_ctl c9"
    fi
    sep
    ;;

  # ── ABORT — emergency kill ─────────────────────────────────────────────────
  abort)
    header "ABORT — Emergency Stop"
    warn "This discards the session. No analysis. Session will NOT count toward confidence."
    echo ""
    read -r -p "  Confirm abort? (yes/no): " confirm
    if [[ "$confirm" == "yes" ]]; then
      if [[ -f logs/pids.txt ]]; then
        while IFS='=' read -r name pid; do
          kill "$pid" 2>/dev/null && echo "  Killed $name ($pid)" || true
        done < logs/pids.txt
        rm -f logs/pids.txt
      fi
      ok "All processes killed. Session discarded."
    else
      echo "  Abort cancelled."
    fi
    ;;

  # ── RESTART — stop then start ─────────────────────────────────────────────
  restart)
    header "Restarting AllMight Stack"
    echo "  Stopping current session..."
    bash "$(launcher)" --stop 2>/dev/null || bash scripts/tools/start_all.sh stop 2>/dev/null || true
    echo ""
    sleep 3

    if ! redis-cli ping 2>/dev/null | grep -q PONG; then
      err "Redis not responding"; exit 1
    fi

    echo "  Pulling latest code..."
    git pull --quiet && ok "Git: up to date" || warn "Git pull failed — continuing"
    echo ""

    LAUNCH="$(launcher)"
    echo "  Launching fresh session..."
    nohup bash "$LAUNCH" > logs/launch.log 2>&1 &
    disown $!

    echo "  Waiting 20s for warmup..."
    sleep 20
    echo ""

    # Restart notification router with new version
    NOTIF_OLD=$(grep "notification_router" logs/pids.txt 2>/dev/null | cut -d'=' -f2 || echo "")
    [[ -n "$NOTIF_OLD" ]] && kill "$NOTIF_OLD" 2>/dev/null || true
    node -r dotenv/config scripts/monitoring/notification_router.js \
      --startup --loop 300 >> logs/notification_router.log 2>&1 &
    NOTIF_PID=$!
    grep -v "notification_router" logs/pids.txt > /tmp/pids_tmp 2>/dev/null && mv /tmp/pids_tmp logs/pids.txt || true
    echo "notification_router=$NOTIF_PID" >> logs/pids.txt
    ok "Notification router restarted PID $NOTIF_PID"

    # Start shadow engine
    SESSION_ID=$(cat logs/allmight.session 2>/dev/null || echo "")
    if [[ -n "$SESSION_ID" ]]; then
      SESSION_DIR="logs/sessions/session_${SESSION_ID}"
      (while true; do
        sleep 300
        node "$ROOT/scripts/execution/shadow_execution_engine.js" \
          --session "$ROOT/$SESSION_DIR" 2>/dev/null || true
      done) >> logs/shadow_engine.log 2>&1 &
      echo "shadow_engine=$!" >> logs/pids.txt
      node scripts/execution/shadow_execution_engine.js --session "$SESSION_DIR" 2>/dev/null || true
      ok "Shadow engine started"
    fi

    sep
    echo "  [Status after restart]"
    bash "$LAUNCH" --status 2>/dev/null || true
    sep
    echo "  [Gate Score]"
    node scripts/execution/execution_gate_score.js 2>/dev/null || true
    ;;

  # ── SHADOW — run shadow engine + show totals ───────────────────────────────
  shadow)
    header "Shadow Execution"
    SDIR="$(session_dir)"
    if [[ -z "$SDIR" ]]; then
      err "No active session found"
      exit 1
    fi
    node scripts/execution/shadow_execution_engine.js --session "$SDIR"
    ;;

  # ── GATE — execution gate score ────────────────────────────────────────────
  gate)
    header "Execution Gate Score"
    node scripts/execution/execution_gate_score.js
    echo ""
    echo "  [Capital Policy]"
    node scripts/execution/capital_policy.js
    ;;

  # ── METRICS — lifetime project metrics ────────────────────────────────────
  metrics)
    header "Project Lifetime Metrics"
    node scripts/tools/project_metrics_tracker.js --summary
    ;;

  # ── C9 — mark current session Boss-valid ──────────────────────────────────
  c9)
    header "Mark Session C9 (Boss Summary)"
    SESSION_ID=$(cat logs/allmight.session 2>/dev/null || echo "")
    if [[ -z "$SESSION_ID" ]]; then
      err "No active session found in logs/allmight.session"
      exit 1
    fi
    SDIR="$(session_dir)"
    if [[ -z "$SDIR" ]]; then
      err "Session directory not found for $SESSION_ID"
      exit 1
    fi
    echo "  Session: $SESSION_ID"
    echo "  Dir:     $SDIR"
    echo ""
    node scripts/tools/dryrun_confidence_log.js \
      --mark-c9 "$SDIR" 2>/dev/null \
      && ok "C9 marked — session is now Boss-valid" \
      || err "dryrun_confidence_log.js --mark-c9 failed (is the session finished?)"
    echo ""
    echo "  Updated confidence:"
    node scripts/tools/dryrun_confidence_log.js --logs logs/sessions 2>/dev/null | tail -15
    ;;

  # ── POLICY ─────────────────────────────────────────────────────────────────
  policy)
    header "Session Policy"
    SDIR="$(session_dir)"
    if [[ -n "$SDIR" ]]; then
      node scripts/tools/session_policy_check.js --session "$SDIR" 2>/dev/null \
        || node scripts/tools/session_policy_check.js 2>/dev/null
    else
      node scripts/tools/session_policy_check.js 2>/dev/null || echo "  No active session"
    fi
    ;;

  # ── RPC ────────────────────────────────────────────────────────────────────
  rpc)
    header "RPC Benchmark — Arbitrum"
    node -r dotenv/config scripts/tools/rpc_benchmark.js \
      --chain arbitrum --samples 20
    ;;

  rpc-full)
    header "RPC Benchmark — All Chains"
    node -r dotenv/config scripts/tools/rpc_benchmark.js \
      --all --samples 20
    ;;

  # ── LOGS ───────────────────────────────────────────────────────────────────
  logs)
    header "Live Logs  (Ctrl+C to exit)"
    LOG="logs/launch.log"
    if [[ -f "$LOG" ]]; then
      tail -n 80 -f "$LOG"
    else
      err "logs/launch.log not found — has the stack been started?"
    fi
    ;;

  logs-activator)
    header "Activator Log (Ctrl+C to exit)"
    SDIR="$(session_dir)"
    if [[ -n "$SDIR" && -f "$SDIR/activator.jsonl" ]]; then
      tail -n 40 -f "$SDIR/activator.jsonl" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        r = json.loads(line)
        t = r.get('type','?')
        sp = r.get('spread','')
        ts = r.get('ts','')[:19]
        if sp: print(f'{ts}  {t:<28} spread={sp:.5f}')
        else:  print(f'{ts}  {t}')
    except: print(line[:100])
"
    else
      err "No activator.jsonl found"
    fi
    ;;

  # ── CONFIDENCE ─────────────────────────────────────────────────────────────
  confidence)
    header "Dry-Run Confidence Log"
    node scripts/tools/dryrun_confidence_log.js \
      --logs logs/sessions
    ;;

  # ── DISCORD ────────────────────────────────────────────────────────────────
  discord)
    header "Discord Notification Test"
    node -r dotenv/config scripts/tools/test_discord_alerts.js
    ;;

  # ── HELP ───────────────────────────────────────────────────────────────────
  help|*)
    echo ""
    echo "$EQ"
    echo "  AllMight Remote Control  v2.0"
    echo "$DIV"
    echo ""
    echo "  SESSION"
    echo "  remote_ctl start          Launch full stack (Redis + git pull + all processes)"
    echo "  remote_ctl stop           Graceful stop + shadow metrics + Discord summary"
    echo "  remote_ctl restart        Stop then start clean"
    echo "  remote_ctl abort          Emergency kill — session discarded, no zip"
    echo ""
    echo "  MONITORING"
    echo "  remote_ctl status         Processes + policy + gate score + shadow PnL"
    echo "  remote_ctl shadow         Run shadow execution engine + show totals"
    echo "  remote_ctl gate           Execution gate score (BLOCK/PAPER/DRY/MICRO)"
    echo "  remote_ctl metrics        Lifetime project metrics (shadow PnL + progression)"
    echo "  remote_ctl policy         Current operating mode only"
    echo ""
    echo "  VALIDATION"
    echo "  remote_ctl confidence     Dry-run confidence log across all sessions"
    echo "  remote_ctl c9             Mark current session C9 (Boss summary complete)"
    echo ""
    echo "  DIAGNOSTICS"
    echo "  remote_ctl rpc            RPC benchmark — Arbitrum (20 samples)"
    echo "  remote_ctl rpc-full       RPC benchmark — all chains + burst test"
    echo "  remote_ctl logs           Tail launch.log live  (Ctrl+C to exit)"
    echo "  remote_ctl logs-activator Live activator signals with spread"
    echo "  remote_ctl discord        Fire test notifications to Discord"
    echo ""
    echo "  CANONICAL WORKFLOW"
    echo ""
    echo "  redis-cli ping            # must return PONG"
    echo "  cd ~/Allmight"
    echo "  remote_ctl start          # full stack + shadow engine + notification router"
    echo "  remote_ctl status         # confirm everything running"
    echo "  remote_ctl shadow         # check shadow PnL mid-session"
    echo "  remote_ctl stop           # final metrics + Discord + confidence check"
    echo "  remote_ctl c9             # mark Boss summary complete → session counts"
    echo ""
    echo "$EQ"
    echo ""
    ;;

esac
