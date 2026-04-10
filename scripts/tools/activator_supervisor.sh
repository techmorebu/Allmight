#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  AllMight — Activator Supervisor  v1.0
# ───────────────────────────────────────────────────────────────────────────────
#  PLACEMENT : scripts/tools/activator_supervisor.sh
#  STATUS    : NEW — Boss ruling 2026-04-10
#
#  PURPOSE
#  ─────────
#  Restart arb_window_activator.js automatically on fatal exit (exit code 2).
#  The activator exits non-zero when provider rebuild limit is exceeded.
#  This wrapper ensures the process restarts cleanly without manual intervention.
#
#  USAGE
#  ─────
#  bash scripts/tools/activator_supervisor.sh
#  bash scripts/tools/activator_supervisor.sh --pair ETH/USDC-RAMSES
#  bash scripts/tools/activator_supervisor.sh --gas-profile atomic_optimistic
#
#  DEFAULTS
#  ────────
#  pair:       ETH/USDC-RAMSES
#  gas-profile: atomic_optimistic
#  log:        logs/activator_supervised.jsonl
#  heat-log:   logs/volatility_timeseries.jsonl
#  restart delay: 5 seconds
#
#  FLAGS (passed through to activator)
#  ────────────────────────────────────
#  --pair        Surface pair (default: ETH/USDC-RAMSES)
#  --gas-profile Gas profile (default: atomic_optimistic)
#  --log         Log file path (default: logs/activator_supervised.jsonl)
#  --heat-log    Heat log path (default: logs/volatility_timeseries.jsonl)
#  --no-remap    Skip --remap-ticks (not recommended)
# ═══════════════════════════════════════════════════════════════════════════════

# ── Defaults ──────────────────────────────────────────────────────────────────
PAIR="ETH/USDC-RAMSES"
GAS_PROFILE="atomic_optimistic"
LOG_PATH="./logs/activator_supervised.jsonl"
HEAT_LOG="./logs/volatility_timeseries.jsonl"
REMAP_TICKS="--remap-ticks"
RESTART_DELAY=5

# ── Arg parsing ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pair)         PAIR="$2";        shift 2 ;;
    --pair=*)       PAIR="${1#*=}";   shift   ;;
    --gas-profile)  GAS_PROFILE="$2"; shift 2 ;;
    --gas-profile=*)GAS_PROFILE="${1#*=}"; shift ;;
    --log)          LOG_PATH="$2";    shift 2 ;;
    --log=*)        LOG_PATH="${1#*=}"; shift  ;;
    --heat-log)     HEAT_LOG="$2";    shift 2 ;;
    --heat-log=*)   HEAT_LOG="${1#*=}"; shift  ;;
    --no-remap)     REMAP_TICKS="";   shift   ;;
    *) echo "[supervisor] Unknown arg: $1" >&2; shift ;;
  esac
done

# ── Validate we're in repo root ───────────────────────────────────────────────
if [[ ! -f "scripts/analysis/arb_window_activator.js" ]]; then
  echo "[supervisor] ERROR: Run from repo root (Allmight/)" >&2
  exit 1
fi

# ── Ensure logs dir exists ────────────────────────────────────────────────────
mkdir -p "$(dirname "$LOG_PATH")"

# ── Run loop ──────────────────────────────────────────────────────────────────
echo "[supervisor] AllMight Activator Supervisor v1.0"
echo "[supervisor] pair=${PAIR}  gas-profile=${GAS_PROFILE}"
echo "[supervisor] log=${LOG_PATH}"
echo "[supervisor] heat-log=${HEAT_LOG}"
echo "[supervisor] restart-delay=${RESTART_DELAY}s"
echo "[supervisor] Press Ctrl+C to stop."
echo ""

RESTART_COUNT=0

while true; do
  RESTART_COUNT=$((RESTART_COUNT + 1))
  echo "[supervisor] ─── Start #${RESTART_COUNT}  $(date -u '+%Y-%m-%dT%H:%M:%SZ') ───"

  node -r dotenv/config scripts/analysis/arb_window_activator.js \
    --pair "${PAIR}" \
    --gas-profile "${GAS_PROFILE}" \
    --log "${LOG_PATH}" \
    --heat-log "${HEAT_LOG}" \
    ${REMAP_TICKS}

  EXIT_CODE=$?
  echo ""
  echo "[supervisor] Activator exited with code ${EXIT_CODE}  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  if [[ $EXIT_CODE -eq 0 ]]; then
    # Clean exit (duration elapsed) — stop supervisor
    echo "[supervisor] Clean exit (code 0). Supervisor stopping."
    break
  fi

  echo "[supervisor] Non-zero exit (${EXIT_CODE}). Restarting in ${RESTART_DELAY}s..."
  sleep "${RESTART_DELAY}"
done

echo "[supervisor] Done. Total restarts: $((RESTART_COUNT - 1))"
