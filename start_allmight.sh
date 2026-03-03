#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  start_allmight.sh  --  AllMight v2 launcher
#
#  Process order (dependency chain):
#    1. Fetchers       -> Redis (raw pool data, every 30s)
#    2. onchain_quoter -> Redis (real profitable routes, every 15s)
#    3. shadow_mode_v2 -> logs  (reads quoter output, executes)
#    4. Watchdog       -> monitors all processes
#
#  Usage:
#    ./start_allmight.sh          # shadow mode (safe, no capital)
#    ./start_allmight.sh --live   # live execution
#    ./start_allmight.sh --stop   # kill all processes
#    ./start_allmight.sh --status # show process status
# ═══════════════════════════════════════════════════════════════

set -euo pipefail
cd "$(dirname "$0")"

PIDS_FILE="logs/pids.txt"
LOG_DIR="logs"
LIVE_FLAG=""
_stop=0
_status=0

for arg in "$@"; do
  case $arg in
    --live)   LIVE_FLAG="--live" ;;
    --stop)   _stop=1 ;;
    --status) _status=1 ;;
  esac
done

if [[ "$_stop" == "1" ]]; then
  echo "Stopping AllMight..."
  if [[ -f "$PIDS_FILE" ]]; then
    while IFS='=' read -r name pid; do
      [[ -z "$pid" || -z "$name" ]] && continue
      kill "$pid" 2>/dev/null && echo "  Stopped $name (PID $pid)" || echo "  $name not running"
    done < "$PIDS_FILE"
    rm -f "$PIDS_FILE"
  fi
  pkill -f "onchain_quoter.js"    2>/dev/null || true
  pkill -f "shadow_mode_v2.py"    2>/dev/null || true
  pkill -f "uniswapV3Fetcher.js"  2>/dev/null || true
  pkill -f "curveFetcherArbitrum" 2>/dev/null || true
  pkill -f "watchdog.py"          2>/dev/null || true
  echo "Done."; exit 0
fi

if [[ "$_status" == "1" ]]; then
  echo "AllMight process status:"
  if [[ ! -f "$PIDS_FILE" ]]; then echo "  No PID file (not running?)"; exit 0; fi
  while IFS='=' read -r name pid; do
    [[ -z "$pid" || -z "$name" ]] && continue
    if kill -0 "$pid" 2>/dev/null; then
      echo "  OK  $name (PID $pid)"
    else
      echo "  DEAD $name (PID $pid)"
    fi
  done < "$PIDS_FILE"
  exit 0
fi

# ── Preflight ─────────────────────────────────────────────────
echo "==========================================="
echo "  AllMight v2"
[[ -n "$LIVE_FLAG" ]] && echo "  Mode: LIVE" || echo "  Mode: SHADOW"
echo "==========================================="

mkdir -p "$LOG_DIR"
rm -f "$PIDS_FILE"

if ! redis-cli ping > /dev/null 2>&1; then
  echo "ERROR: Redis not running. Start with: redis-server --daemonize yes"; exit 1
fi
echo "OK Redis"

if [[ ! -f ".env" ]]; then echo "ERROR: .env not found"; exit 1; fi
set -a; source .env; set +a 2>/dev/null || true

if [[ -z "${ARBITRUM_MAINNET_RPC_URL_1:-}" ]]; then
  echo "ERROR: ARBITRUM_MAINNET_RPC_URL_1 not set in .env"; exit 1
fi
echo "OK .env"

if [[ -n "$LIVE_FLAG" ]]; then
  sed -i 's/LIVE_TRADING_ENABLED=.*/LIVE_TRADING_ENABLED=true/' .env 2>/dev/null || \
    echo "LIVE_TRADING_ENABLED=true" >> .env
  echo "OK Live trading enabled"
else
  sed -i 's/LIVE_TRADING_ENABLED=.*/LIVE_TRADING_ENABLED=false/' .env 2>/dev/null || true
fi

# ── Fetchers ──────────────────────────────────────────────────
echo ""
echo "Starting fetchers..."

nohup node -u scripts/data_collection/masterFetcher/uniswapV3Fetcher.js \
  >> "$LOG_DIR/fetcher_univ3.log" 2>&1 &
echo "fetcher_univ3=$!" >> "$PIDS_FILE"
echo "  UniV3 fetcher PID $!"
sleep 1

nohup node -u scripts/data_collection/masterFetcher/curveFetcherArbitrum.js \
  >> "$LOG_DIR/fetcher_curve.log" 2>&1 &
echo "fetcher_curve=$!" >> "$PIDS_FILE"
echo "  Curve fetcher PID $!"
sleep 3

# ── On-chain quoter ───────────────────────────────────────────
echo ""
echo "Starting on-chain quoter..."

nohup node scripts/execution/onchain_quoter.js \
  >> "$LOG_DIR/quoter.log" 2>&1 &
echo "quoter=$!" >> "$PIDS_FILE"
echo "  On-chain quoter PID $!"

echo "  Waiting 20s for first scan..."
sleep 20

OPPS=$(redis-cli get "quoter:opportunities" 2>/dev/null | python3 -c "
import sys,json
try:
  d=json.loads(sys.stdin.read())
  n=len(d.get('opportunities',[]))
  print(f'{n} profitable routes')
except: print('no data yet')
" 2>/dev/null || echo "check failed")
echo "  Quoter: $OPPS"

# ── Shadow mode ───────────────────────────────────────────────
echo ""
echo "Starting shadow mode v2..."

nohup python3 -u scripts/execution/shadow_mode_v2.py $LIVE_FLAG \
  >> "$LOG_DIR/shadow.log" 2>&1 &
echo "shadow=$!" >> "$PIDS_FILE"
echo "  Shadow mode PID $!"

# ── Watchdog ──────────────────────────────────────────────────
sleep 2
nohup python3 -u scripts/watchdog.py \
  >> "$LOG_DIR/watchdog.log" 2>&1 &
echo "watchdog=$!" >> "$PIDS_FILE"
echo "  Watchdog PID $!"

# ── Done ──────────────────────────────────────────────────────
echo ""
# ── Discord startup notification ──────────────────────────────
python3 -c "
import sys; sys.path.insert(0,'.')
from utils.discord_alerts import discord
pids = {}
$(grep -E "^[a-z_]+=[0-9]+" logs/pids.txt 2>/dev/null | \
  sed "s/\([a-z_]*\)=\([0-9]*\)/pids['\1']=\2/" | tr '\n' ';')
discord.startup(pids)
" 2>/dev/null || echo "  Discord notify: skipped (webhooks not set)"

echo "==========================================="
echo "  AllMight v2 running"
echo ""
echo "  tail -f logs/shadow.log    # opportunities"
echo "  tail -f logs/quoter.log    # quote scanner"
echo ""
echo "  ./start_allmight.sh --stop"
echo "  ./start_allmight.sh --status"
echo "  python3 scripts/execution/shadow_mode_v2.py --report"
echo "==========================================="
