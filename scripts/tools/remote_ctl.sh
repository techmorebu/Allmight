#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Remote Control  v1.2
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/remote_ctl.sh
#
#  Compatible with start_all.sh v1.7 (7-process stack).
#  PID file: logs/allmight.pid
#  Session pointer: logs/allmight.session
#
#  SETUP (run once on home machine)
#  ─────────────────────────────────
#  chmod +x ~/Allmight/scripts/tools/remote_ctl.sh
#  mkdir -p ~/.local/bin
#  ln -sf ~/Allmight/scripts/tools/remote_ctl.sh ~/.local/bin/remote_ctl
#  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
#  source ~/.bashrc
#
#  USAGE
#  ─────
#  remote_ctl status       — process health + policy mode
#  remote_ctl start        — launch full 7-process stack (unattended)
#  remote_ctl stop         — graceful stop + shadow metrics + Discord summary
#  remote_ctl abort        — emergency kill — no analysis, session discarded
#  remote_ctl restart      — stop then start clean
#  remote_ctl restart-activator — restart activator only (same session)
#  remote_ctl policy       — current operating mode only
#  remote_ctl metrics      — shadow PnL + gate score + capital policy
#  remote_ctl confidence   — dry-run confidence log across all sessions
#  remote_ctl rpc          — RPC endpoint health check
#  remote_ctl logs         — tail live session output (Ctrl-C to exit)
#  remote_ctl discord      — fire test notification to Discord
#  remote_ctl help         — show this list
# ═══════════════════════════════════════════════════════════════════════════════

set -uo pipefail

ROOT="${HOME}/Allmight"
cd "$ROOT" || { echo "ERROR: ~/Allmight not found"; exit 1; }

cmd="${1:-help}"

# ── Helpers ───────────────────────────────────────────────────────────────────
EQ="═══════════════════════════════════════════════════════"
DIV="───────────────────────────────────────────────────────"
header() { echo ""; echo "$EQ"; echo "  AllMight — $*"; echo "$DIV"; echo ""; }
ok()     { echo "  ✅ $*"; }
warn()   { echo "  ⚠️  $*"; }
err()    { echo "  ❌ $*"; }
log()    { echo "[$(date -u '+%H:%M:%SZ')] $*"; }

# ── COMMAND ROUTER ────────────────────────────────────────────────────────────
case "$cmd" in

  # ── STATUS ─────────────────────────────────────────────────────────────────
  status)
    header "Status Check"
    echo "  [Processes]"
    bash scripts/tools/start_all.sh --status
    echo ""
    echo "$DIV"
    echo "  [Policy]"
    node scripts/tools/session_policy_check.js 2>/dev/null || echo "  (policy check unavailable)"
    ;;

  # ── START ──────────────────────────────────────────────────────────────────
  # Delegates entirely to start_all.sh — never starts processes directly here
  start)
    header "Starting AllMight Stack"

    if ! redis-cli ping > /dev/null 2>&1; then
      err "Redis not responding. Run: sudo systemctl start redis"
      exit 1
    fi
    ok "Redis OK"

    git pull --ff-only 2>/dev/null && ok "Git pull OK" || warn "Git pull skipped (unclean or offline)"

    echo ""
    echo "  Launching stack (7 processes)..."
    echo "  Logs → logs/launch.log"
    echo ""

    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
    disown $! 2>/dev/null || true

    sleep 3
    bash scripts/tools/start_all.sh --status
    ;;

  # ── STOP ───────────────────────────────────────────────────────────────────
  # Full stop pipeline delegated to start_all.sh --stop (single source of truth)
  # start_all.sh --stop runs: kill → shadow v1+v2 → dry run → accuracy →
  # backtest + spread dominance → project metrics → Discord → zip session
  stop)
    header "Stopping AllMight"
    bash scripts/tools/start_all.sh --stop
    ;;

  # ── ABORT — emergency kill, no analysis ────────────────────────────────────
  abort)
    header "EMERGENCY ABORT"
    warn "Killing all AllMight processes. Session will not be analyzed or zipped."
    echo ""

    PID_FILE="logs/allmight.pid"
    if [[ -f "$PID_FILE" ]]; then
      while IFS='=' read -r name pid; do
        [[ -z "$name" || -z "$pid" ]] && continue
        kill -9 "$pid" 2>/dev/null && echo "  Killed $name (PID $pid)" || true
      done < "$PID_FILE"
      rm -f "$PID_FILE"
    fi

    # Belt-and-suspenders — catch anything not in PID file
    pkill -9 -f "arb_window_activator.js"         2>/dev/null || true
    pkill -9 -f "arb_volatility_monitor.js"        2>/dev/null || true
    pkill -9 -f "volatility_divergence_report.js"  2>/dev/null || true
    pkill -9 -f "allmight_watchdog.sh"             2>/dev/null || true
    pkill -9 -f "notification_router.js"           2>/dev/null || true
    pkill -9 -f "shadow_execution_engine.js"       2>/dev/null || true

    # Move session to aborted folder
    SESSION_POINTER="logs/allmight.session"
    if [[ -f "$SESSION_POINTER" ]]; then
      SESSION=$(cat "$SESSION_POINTER")
      SESSION_DIR="logs/sessions/session_${SESSION}"
      ABORT_DIR="logs/aborted/session_${SESSION}"
      if [[ -d "$SESSION_DIR" ]]; then
        mkdir -p logs/aborted
        mv "$SESSION_DIR" "$ABORT_DIR"
        echo "  Session moved to: $ABORT_DIR"
      fi
    fi

    err "Session aborted — not counted toward confidence score"
    ;;

  # ── RESTART ────────────────────────────────────────────────────────────────
  restart)
    header "Restarting AllMight"
    # Full stop pipeline (shadow v1+v2, accuracy, backtest, zip) before restart
    bash scripts/tools/start_all.sh --stop
    echo ""
    echo "  Pulling latest code..."
    git pull --ff-only 2>/dev/null || true
    echo "  Starting new session..."
    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
    disown $! 2>/dev/null || true
    sleep 5
    bash scripts/tools/start_all.sh --status
    ;;

  # ── RESTART-ACTIVATOR — same session, just the activator ───────────────────
  restart-activator)
    header "Restarting Activator (same session)"
    bash scripts/tools/start_all.sh restart-activator
    ;;

  # ── POLICY ─────────────────────────────────────────────────────────────────
  policy)
    header "Session Policy"
    node scripts/tools/session_policy_check.js 2>/dev/null || echo "  (policy check unavailable)"
    ;;

  # ── METRICS — shadow PnL + gate score + capital policy ─────────────────────
  # New in v1.2 — shows execution readiness without starting anything
  metrics)
    header "Execution Metrics"

    SESSION_POINTER="logs/allmight.session"
    SESSION=""
    [[ -f "$SESSION_POINTER" ]] && SESSION=$(cat "$SESSION_POINTER")

    echo "  [Gate Score]"
    node scripts/execution/execution_gate_score.js 2>/dev/null \
      || echo "  (gate score unavailable)"

    echo ""
    echo "  [Capital Policy]"
    node scripts/execution/capital_policy.js 2>/dev/null \
      || echo "  (capital policy unavailable)"

    if [[ -n "$SESSION" ]]; then
      SESSION_DIR="logs/sessions/session_${SESSION}"
      echo ""
      echo "  [Shadow Execution — session $SESSION]"
      node scripts/execution/shadow_execution_engine.js \
        --session "$SESSION_DIR" 2>/dev/null \
        || echo "  (no shadow data yet)"
    fi

    echo ""
    echo "  [Lifetime Metrics]"
    node scripts/tools/project_metrics_tracker.js --summary 2>/dev/null \
      || echo "  (lifetime metrics unavailable)"
    ;;

  # ── CONFIDENCE — dry-run confidence log ────────────────────────────────────
  confidence)
    header "Dry-Run Confidence Log"
    node scripts/tools/dryrun_confidence_log.js \
      --logs logs/sessions 2>/dev/null \
      || echo "  (confidence log unavailable)"
    ;;

  # ── RPC — endpoint health check ────────────────────────────────────────────
  rpc)
    header "RPC Health Check"
    node -r dotenv/config -e "
      const pf = require('./utils/provider_factory');
      const health = pf.getEndpointHealth('arbitrum');
      for (const h of health) {
        const icon = h.demoted || h.inCooldown ? '❌' : '✅';
        console.log(icon + ' ' + h.host + ' fails=' + h.fails + ' quota=' + (h.quotaUsed||0));
      }
    " 2>/dev/null || echo "  (RPC health check unavailable)"
    ;;

  # ── LOGS — tail live session output ────────────────────────────────────────
  logs)
    SESSION_POINTER="logs/allmight.session"
    SESSION=""
    [[ -f "$SESSION_POINTER" ]] && SESSION=$(cat "$SESSION_POINTER")
    SESSION_DIR="logs/sessions/session_${SESSION}"

    echo ""
    echo "  Tailing logs (session: ${SESSION:-none}). Ctrl-C to stop."
    echo "$DIV"

    tail -f \
      "$SESSION_DIR/activator.jsonl" \
      "$SESSION_DIR/monitor.log" \
      2>/dev/null || echo "  No active session logs found."
    ;;

  # ── DISCORD — test notification ────────────────────────────────────────────
  discord)
    header "Discord Notification Test"
    node -r dotenv/config scripts/tools/test_discord_alerts.js 2>/dev/null \
      || echo "  (test_discord_alerts.js not found — sending manual test)"
    ;;

  # ── HELP ───────────────────────────────────────────────────────────────────
  help|*)
    echo ""
    echo "$EQ"
    echo "  AllMight Remote Control  v1.2"
    echo "  (compatible with start_all.sh v1.7)"
    echo "$DIV"
    echo ""
    echo "  COMMANDS"
    echo ""
    echo "  remote_ctl status              Full health — processes + policy"
    echo "  remote_ctl start               Launch 7-process stack (unattended)"
    echo "  remote_ctl stop                Graceful stop + shadow metrics + Discord"
    echo "  remote_ctl abort               Emergency kill — session discarded"
    echo "  remote_ctl restart             Stop then start clean"
    echo "  remote_ctl restart-activator   Restart activator only (same session)"
    echo "  remote_ctl policy              Current operating mode"
    echo "  remote_ctl metrics             Shadow PnL + gate score + capital policy"
    echo "  remote_ctl confidence          Confidence log across all sessions"
    echo "  remote_ctl rpc                 RPC endpoint health"
    echo "  remote_ctl logs                Tail live session output (Ctrl-C)"
    echo "  remote_ctl discord             Fire test Discord notification"
    echo ""
    echo "  CANONICAL WORKFLOW"
    echo ""
    echo "  redis-cli ping          # must return PONG"
    echo "  cd ~/Allmight"
    echo "  git pull"
    echo "  remote_ctl start"
    echo "  remote_ctl status       # confirm all 7 processes [OK]"
    echo "  remote_ctl metrics      # check gate score + shadow PnL any time"
    echo ""
    echo "  STOP + MARK C9"
    echo ""
    echo "  remote_ctl stop"
    echo "  node scripts/tools/dryrun_confidence_log.js --mark-c9 \\"
    echo "    logs/sessions/session_\$(cat logs/allmight.session)"
    echo ""
    echo "  EMERGENCY"
    echo ""
    echo "  remote_ctl abort        # kill all, session does not count"
    echo ""
    echo "  RULE: remote_ctl never starts individual processes directly."
    echo "        All process management goes through start_all.sh."
    echo ""
    echo "$EQ"
    echo ""
    ;;

esac
