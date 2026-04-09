#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  AllMight — Activator Restart Wrapper  v1.0
#  Boss directive 2026-04-07: uptime fix before execution design research.
#
#  PLACEMENT: ~/Allmight/restart_wrapper.sh
#  USAGE:
#    chmod +x restart_wrapper.sh
#    ./restart_wrapper.sh ETH/USDC-RAMSES [gas-profile]
#
#  Runs the activator in a persistent loop. On clean crash (exit 2),
#  waits RESTART_DELAY_SEC then restarts. On non-crash exit (Ctrl+C = exit 0
#  or SIGTERM), stops the loop cleanly.
#
#  Logs: one JSONL per session, timestamped to avoid overwrites.
#  Separate log per restart so individual sessions are analyzable.
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

PAIR="${1:-ETH/USDC-RAMSES}"
GAS_PROFILE="${2:-atomic_optimistic}"
RESTART_DELAY_SEC=10          # wait before restart (give RPC time to recover)
MAX_RESTARTS=50               # safety ceiling — stops after N restarts
LOG_DIR="./logs"
SCRIPT="scripts/analysis/arb_window_activator.js"

# Colour helpers
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}[wrapper] AllMight Activator Restart Wrapper v1.0${NC}"
echo -e "${GREEN}[wrapper] pair=${PAIR}  gas=${GAS_PROFILE}  max_restarts=${MAX_RESTARTS}${NC}"
echo -e "${GREEN}[wrapper] Press Ctrl+C to stop cleanly.${NC}"
echo

mkdir -p "$LOG_DIR"

restart_count=0
wrapper_start=$(date -u +%s)

# Trap Ctrl+C / SIGTERM — let current activator finish, then stop loop
stop_requested=0
trap 'echo -e "\n${YELLOW}[wrapper] Stop requested — will not restart after current run.${NC}"; stop_requested=1' SIGINT SIGTERM

while true; do
  if [ "$restart_count" -ge "$MAX_RESTARTS" ]; then
    echo -e "${RED}[wrapper] Max restarts (${MAX_RESTARTS}) reached — stopping.${NC}"
    exit 1
  fi

  # Timestamped log file per session
  SESSION_TS=$(date -u +%Y%m%dT%H%M%S)
  LOG_FILE="${LOG_DIR}/activator_${PAIR//\//_}_${SESSION_TS}.jsonl"

  echo -e "${GREEN}[wrapper] Starting session #$((restart_count+1)) at $(date -u +%H:%M:%SZ)${NC}"
  echo -e "${GREEN}[wrapper] Log: ${LOG_FILE}${NC}"
  echo

  # Run activator — capture exit code
  set +e
  node -r dotenv/config "$SCRIPT" \
    --pair="$PAIR" \
    --remap-ticks \
    --gas-profile="$GAS_PROFILE" \
    --log="$LOG_FILE"
  EXIT_CODE=$?
  set -e

  restart_count=$((restart_count + 1))
  elapsed=$(( $(date -u +%s) - wrapper_start ))
  elapsed_h=$(( elapsed / 3600 ))
  elapsed_m=$(( (elapsed % 3600) / 60 ))

  echo
  if [ "$EXIT_CODE" -eq 0 ]; then
    echo -e "${GREEN}[wrapper] Clean exit (0) after ${elapsed_h}h${elapsed_m}m. Not restarting.${NC}"
    exit 0
  fi

  if [ "$stop_requested" -eq 1 ]; then
    echo -e "${YELLOW}[wrapper] Stop requested — exiting after session #${restart_count}.${NC}"
    exit 0
  fi

  echo -e "${YELLOW}[wrapper] Exit code ${EXIT_CODE} after ${elapsed_h}h${elapsed_m}m. Restart #${restart_count} in ${RESTART_DELAY_SEC}s...${NC}"
  echo -e "${YELLOW}[wrapper] Session log: ${LOG_FILE}${NC}"

  # Brief pause — lets RPC endpoints recover
  sleep "$RESTART_DELAY_SEC"
  echo -e "${GREEN}[wrapper] Restarting now.${NC}"
  echo "────────────────────────────────────────────────"
done
