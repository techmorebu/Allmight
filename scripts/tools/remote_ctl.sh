#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Remote Control  v1.0
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/remote_ctl.sh
#
#  Single-command interface for remote operation of the AllMight stack.
#  Designed for SSH access from phone, tablet, or laptop via Tailscale.
#
#  SETUP (run once on home machine)
#  ─────────────────────────────────
#  chmod +x ~/Allmight/scripts/tools/remote_ctl.sh
#  mkdir -p ~/.local/bin
#  ln -sf ~/Allmight/scripts/tools/remote_ctl.sh ~/.local/bin/remote_ctl
#  # Add to ~/.bashrc if not already there:
#  echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
#  source ~/.bashrc
#
#  USAGE
#  ─────
#  remote_ctl status      — full health check (processes + policy)
#  remote_ctl start       — launch full stack unattended
#  remote_ctl stop        — graceful stop + run analysis + zip session
#  remote_ctl abort       — emergency stop, no analysis, session discarded
#  remote_ctl restart     — stop then start clean
#  remote_ctl policy      — current operating mode only
#  remote_ctl rpc         — RPC endpoint health check
#  remote_ctl logs        — tail last 80 lines of launch.log live
#  remote_ctl confidence  — dry-run confidence log across all sessions
#  remote_ctl discord     — fire test notification to all Discord channels
#  remote_ctl help        — show this list
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
sep()    { echo "$DIV"; }

# ── COMMANDS ──────────────────────────────────────────────────────────────────

case "$cmd" in

  # ── STATUS — full health check ─────────────────────────────────────────────
  status)
    header "Status Check"
    echo "  [Processes]"
    bash scripts/tools/start_all.sh status
    echo ""
    sep
    echo "  [Policy]"
    node scripts/tools/session_policy_check.js
    ;;

  # ── START — launch full stack unattended ───────────────────────────────────
  start)
    header "Starting AllMight Stack"

    # Guard: check Redis first
    if ! redis-cli ping 2>/dev/null | grep -q PONG; then
      err "Redis not responding — start Redis first:"
      echo "  sudo systemctl start redis"
      echo "  # or: redis-server --daemonize yes"
      exit 1
    fi
    ok "Redis: PONG"

    # Pull latest code
    echo "  Pulling latest code..."
    git pull --quiet && ok "Git: up to date" || warn "Git pull failed — continuing with local code"
    echo ""

    # Launch
    echo "  Launching stack..."
    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
    disown $!

    echo "  Waiting 15s for warmup..."
    sleep 15
    echo ""

    sep
    echo "  [Startup result]"
    bash scripts/tools/start_all.sh status
    echo ""
    sep
    echo "  [Policy]"
    node scripts/tools/session_policy_check.js
    ;;

  # ── STOP — graceful stop + analysis + zip ─────────────────────────────────
  stop)
    header "Stopping AllMight Stack"
    bash scripts/tools/start_all.sh stop
    echo ""
    ok "Session stopped. Analysis pipeline ran. Zip created in logs/archive/"
    echo "  Run 'remote_ctl confidence' to check session validity."
    ;;

  # ── ABORT — emergency kill, no analysis ───────────────────────────────────
  abort)
    header "ABORT — Emergency Stop"
    warn "This discards the session. No analysis. No zip. Session will NOT count."
    echo ""
    read -r -p "  Confirm abort? (yes/no): " confirm
    if [[ "$confirm" == "yes" ]]; then
      bash scripts/tools/start_all.sh abort
    else
      echo "  Abort cancelled."
    fi
    ;;

  # ── RESTART — stop then start ─────────────────────────────────────────────
  restart)
    header "Restarting AllMight Stack"
    echo "  Stopping current session..."
    bash scripts/tools/start_all.sh stop || true
    echo ""
    sleep 3

    # Guard: check Redis
    if ! redis-cli ping 2>/dev/null | grep -q PONG; then
      err "Redis not responding — start Redis first"
      exit 1
    fi

    echo "  Pulling latest code..."
    git pull --quiet && ok "Git: up to date" || warn "Git pull failed — continuing"
    echo ""
    echo "  Launching fresh session..."
    nohup bash scripts/tools/start_all.sh > logs/launch.log 2>&1 &
    disown $!

    echo "  Waiting 15s for warmup..."
    sleep 15
    echo ""

    sep
    echo "  [Status after restart]"
    bash scripts/tools/start_all.sh status
    echo ""
    sep
    echo "  [Policy]"
    node scripts/tools/session_policy_check.js
    ;;

  # ── POLICY — operating mode only ──────────────────────────────────────────
  policy)
    header "Session Policy"
    node scripts/tools/session_policy_check.js
    ;;

  # ── RPC — endpoint health check ───────────────────────────────────────────
  rpc)
    header "RPC Health Check"
    if [[ -f "rpc_healthcheck.py" ]]; then
      python3 rpc_healthcheck.py \
        --prefix ARBITRUM_MAINNET \
        --expected-chain-id 42161 \
        --timeout 5
    else
      err "rpc_healthcheck.py not found in repo root"
    fi
    ;;

  # ── LOGS — tail launch log live ───────────────────────────────────────────
  logs)
    header "Live Logs  (Ctrl+C to exit)"
    LOG="logs/launch.log"
    if [[ -f "$LOG" ]]; then
      tail -n 80 -f "$LOG"
    else
      err "logs/launch.log not found — has the stack been started?"
    fi
    ;;

  # ── CONFIDENCE — dry-run confidence log ───────────────────────────────────
  confidence)
    header "Dry-Run Confidence Log"
    node scripts/tools/dryrun_confidence_log.js \
      --logs logs/sessions
    ;;

  # ── DISCORD — fire test alerts ────────────────────────────────────────────
  discord)
    header "Discord Notification Test"
    node -r dotenv/config scripts/tools/test_discord_alerts.js
    ;;

  # ── HELP ──────────────────────────────────────────────────────────────────
  help|*)
    echo ""
    echo "$EQ"
    echo "  AllMight Remote Control  v1.0"
    echo "$DIV"
    echo ""
    echo "  COMMANDS"
    echo ""
    echo "  remote_ctl status       Full health check — processes + policy"
    echo "  remote_ctl start        Launch full stack (Redis check + git pull first)"
    echo "  remote_ctl stop         Graceful stop + analysis + zip session"
    echo "  remote_ctl abort        Emergency kill — session discarded, no zip"
    echo "  remote_ctl restart      Stop then start clean"
    echo "  remote_ctl policy       Current operating mode only"
    echo "  remote_ctl rpc          RPC endpoint health check"
    echo "  remote_ctl logs         Tail launch.log live  (Ctrl+C to exit)"
    echo "  remote_ctl confidence   Dry-run confidence log across all sessions"
    echo "  remote_ctl discord      Fire test notifications to Discord"
    echo ""
    echo "  CANONICAL STARTUP"
    echo ""
    echo "  redis-cli ping          # must return PONG"
    echo "  cd ~/Allmight"
    echo "  git pull"
    echo "  remote_ctl start"
    echo ""
    echo "  CANONICAL STOP"
    echo ""
    echo "  remote_ctl stop"
    echo ""
    echo "  EMERGENCY"
    echo ""
    echo "  remote_ctl abort        # kills all, session does not count"
    echo ""
    echo "$EQ"
    echo ""
    ;;

esac
