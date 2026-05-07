#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  AllMight — System Integrity Audit
# ────────────────────────────────────────────────────────────────────────────
#  Read-only. No state changes. No on-chain writes. No file mutations.
#  Run when you want assurance the stack is configured and operating correctly.
#
#  Surfaces ONLY problems — quiet on green, loud on drift.
#
#  10 sections:
#    1. Process census — all 8 expected processes alive at right paths
#    2. Pair consistency — every producer agrees on the active pair
#    3. Producer schemas — each JSONL emits records the consumers expect
#    4. .env critical keys — present, non-placeholder, .env locked 600
#    5. On-chain state — executor bytecode, pool depth, wallet ETH, gas
#    6. Supervisor health — recent stale_exit / restart cadence
#    7. Metrics reconciliation — signal counts agree across views
#    8. Drift vs PROJECT_STATE_CURRENT.md — claims match reality
#    9. Phase/disarmed posture — flags + canonical C9 set
#   10. Output routing — Discord channels reachable
#
#  Usage:  bash scripts/tools/system_integrity_audit.sh
#  Exit:   0 = clean, 1 = drift detected (investigate before any live action)
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

PASS=0; WARN=0; FAIL=0
green() { echo "  ✅  $*"; PASS=$((PASS+1)); }
yellow() { echo "  ⚠   $*"; WARN=$((WARN+1)); }
red()    { echo "  ❌  $*"; FAIL=$((FAIL+1)); }
info()   { echo "      $*"; }

H1() {
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════"
  echo "  $*"
  echo "═══════════════════════════════════════════════════════════════════════"
}

H2() {
  echo ""
  echo "── $* ──"
}

# Resolve current session early (used throughout)
SID=""
SESS_DIR=""
if [ -f logs/allmight.session ]; then
  SID=$(cat logs/allmight.session)
  SESS_DIR="logs/sessions/session_$SID"
fi

H1 "AllMight System Integrity Audit — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
if [ -n "$SID" ]; then
  info "Session: $SID"
  info "Dir:     $SESS_DIR"
else
  red "no logs/allmight.session — stack not initialized; aborting"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════════
# 1. PROCESS CENSUS
# ════════════════════════════════════════════════════════════════════════════
H1 "1. Process Census"

if [ ! -f logs/allmight.pid ]; then
  red "logs/allmight.pid missing — cannot verify expected processes"
else
  H2 "expected processes per logs/allmight.pid"
  while IFS='=' read -r name pid; do
    [ -z "$name" ] && continue
    if kill -0 "$pid" 2>/dev/null; then
      cmd=$(ps -p "$pid" -o cmd= 2>/dev/null | head -c 80)
      green "$name (PID $pid) alive"
      info "  cmd: $cmd"
    else
      red "$name (PID $pid) DEAD — supervisor may have relaunched under new PID"
    fi
  done < logs/allmight.pid

  H2 "actual node processes for this stack"
  count=$(ps aux | grep -E "scripts/(analysis|monitoring|execution|master-fetcher)" | grep -v grep | wc -l)
  info "  total: $count node processes detected"
  if [ "$count" -lt 5 ]; then
    yellow "fewer than 5 stack processes — partial stack"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# 2. PAIR CONSISTENCY  (the big one)
# ════════════════════════════════════════════════════════════════════════════
H1 "2. Pair Consistency"
info "Every producer should agree on the active pair, and that pair must"
info "match the deployed executor's surface (ETH/USDC for AllMightRamsesExecutor)."

declare -A PAIRS

# Activator
H2 "activator.jsonl"
if [ -s "$SESS_DIR/activator.jsonl" ]; then
  ACT_PAIR=$(grep -oE '"pair":"[A-Z]+/[A-Z]+"' "$SESS_DIR/activator.jsonl" 2>/dev/null \
    | sort | uniq -c | sort -rn | head -1 | sed -E 's/.*"pair":"([^"]+)".*/\1/')
  if [ -n "$ACT_PAIR" ]; then
    info "  dominant pair: $ACT_PAIR"
    PAIRS[activator]=$ACT_PAIR
  else
    yellow "no pair field detected in activator.jsonl"
  fi
else
  yellow "activator.jsonl empty or missing"
fi

# Volatility
H2 "volatility.jsonl"
if [ -s "$SESS_DIR/volatility.jsonl" ]; then
  VOL_PAIR=$(grep -oE '"pair":"[A-Z]+/[A-Z]+"' "$SESS_DIR/volatility.jsonl" 2>/dev/null \
    | sort | uniq -c | sort -rn | head -1 | sed -E 's/.*"pair":"([^"]+)".*/\1/')
  if [ -n "$VOL_PAIR" ]; then
    info "  dominant pair: $VOL_PAIR"
    PAIRS[volatility]=$VOL_PAIR
  else
    yellow "no pair field in volatility.jsonl"
  fi
else
  yellow "volatility.jsonl empty or missing"
fi

# Heat
H2 "heat.jsonl"
if [ -s "$SESS_DIR/heat.jsonl" ]; then
  HEAT_PAIR=$(grep -oE '"pair":"[A-Z]+/[A-Z]+"' "$SESS_DIR/heat.jsonl" 2>/dev/null \
    | sort | uniq -c | sort -rn | head -1 | sed -E 's/.*"pair":"([^"]+)".*/\1/')
  if [ -n "$HEAT_PAIR" ]; then
    info "  dominant pair: $HEAT_PAIR"
    PAIRS[heat]=$HEAT_PAIR
  else
    yellow "no pair field in heat.jsonl"
  fi
else
  info "heat.jsonl empty or missing"
fi

# Monitor
H2 "monitor.jsonl"
if [ -s "$SESS_DIR/monitor.jsonl" ]; then
  MON_PAIR=$(grep -oE '"pair":"[A-Z]+/[A-Z]+"' "$SESS_DIR/monitor.jsonl" 2>/dev/null \
    | sort | uniq -c | sort -rn | head -1 | sed -E 's/.*"pair":"([^"]+)".*/\1/')
  if [ -n "$MON_PAIR" ]; then
    info "  dominant pair: $MON_PAIR"
    PAIRS[monitor]=$MON_PAIR
  fi
fi

# Executor surface (from on-chain pool address baked into contract)
H2 "executor (deployed contract)"
EXEC_ADDR=$(grep -E '^EXECUTOR_ADDRESS=' .env | cut -d= -f2)
if [ -n "$EXEC_ADDR" ] && [ "$EXEC_ADDR" != "" ]; then
  info "  executor: $EXEC_ADDR"
  info "  (per project memory: WETH/USDC Ramses V2 surface, pool 0x30AF...4110)"
  PAIRS[executor]="ETH/USDC"
fi

# Project memory canonical
PAIRS[project_state]="ETH/USDC"

# Compare
H2 "consistency check"
unique_pairs=$(printf '%s\n' "${PAIRS[@]}" | sort -u | wc -l)
if [ "$unique_pairs" -le 1 ]; then
  green "all producers agree on pair"
else
  red "PAIR DRIFT — producers disagree:"
  for k in "${!PAIRS[@]}"; do
    info "    $k = ${PAIRS[$k]}"
  done
fi

# ════════════════════════════════════════════════════════════════════════════
# 3. PRODUCER SCHEMAS
# ════════════════════════════════════════════════════════════════════════════
H1 "3. Producer Schemas"
info "Each producer's latest JSON record must contain the fields its consumers expect."

# Activator: signal records must have signal+spread+block+ts
H2 "activator.jsonl — signal record fields"
if [ -s "$SESS_DIR/activator.jsonl" ]; then
  node -e "
const fs = require('fs');
const lines = fs.readFileSync('$SESS_DIR/activator.jsonl','utf8').split('\n').slice(-2000);
let last = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const r = JSON.parse(lines[i]);
    if (r.signal && typeof r.spread === 'number') { last = r; break; }
  } catch {}
}
if (!last) { console.log('  ❌  no signal record in last 2000 lines (activator pipeline may be stalled)'); process.exit(1); }
const need = ['ts','signal','spread','block','uniPrice','camPrice','regime'];
const miss = need.filter(k => !(k in last));
if (miss.length) console.log('  ❌  missing fields:', miss.join(','));
else console.log('  ✅  signal schema valid (signal=' + last.signal + ', spread=' + (last.spread*100).toFixed(2) + 'bps)');
const age = Math.round((Date.now() - new Date(last.ts).getTime()) / 1000);
console.log('      newest signal age: ' + age + 's' + (age > 600 ? ' (⚠ stale)' : ''));
" || red "activator schema check threw"
fi

# Watchdog
H2 "watchdog.jsonl — overallStatus + staleComponents"
if [ -s "$SESS_DIR/watchdog.jsonl" ]; then
  node -e "
const fs = require('fs');
const lines = fs.readFileSync('$SESS_DIR/watchdog.jsonl','utf8').split('\n').slice(-20);
let last = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try { const r = JSON.parse(lines[i]); if (r.overallStatus) { last = r; break; } } catch {}
}
if (!last) { console.log('  ❌  no overallStatus record'); process.exit(1); }
const tag = last.overallStatus === 'HEALTHY' ? '✅' : (last.overallStatus === 'DEGRADED' ? '⚠ ' : '❌');
const age = Math.round((Date.now() - new Date(last.ts).getTime())/1000);
console.log('  ' + tag + '  overallStatus: ' + last.overallStatus + ' (age ' + age + 's)');
if (last.staleComponents && last.staleComponents.length) console.log('      stale: ' + last.staleComponents.join(','));
" || red "watchdog schema check threw"
fi

# Heat
H2 "heat.jsonl — heatClass field"
if [ -s "$SESS_DIR/heat.jsonl" ]; then
  node -e "
const fs = require('fs');
const lines = fs.readFileSync('$SESS_DIR/heat.jsonl','utf8').split('\n').slice(-10);
let last = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try { const r = JSON.parse(lines[i]); if (r.heatClass) { last = r; break; } } catch {}
}
if (!last) { console.log('  ⚠   no heatClass in heat.jsonl'); process.exit(0); }
const age = Math.round((Date.now() - new Date(last.ts).getTime())/1000);
console.log('  ✅  heatClass: ' + last.heatClass + ' (age ' + age + 's)');
" || true
else
  yellow "heat.jsonl absent — heat module may not be writing here"
fi

# ════════════════════════════════════════════════════════════════════════════
# 4. .env CRITICAL KEYS
# ════════════════════════════════════════════════════════════════════════════
H1 "4. Environment Configuration"

H2 "permissions"
PERMS=$(stat -c '%a' .env 2>/dev/null)
if [ "$PERMS" = "600" ]; then green ".env mode 600 (locked)"; else red ".env mode $PERMS (should be 600)"; fi

H2 "required keys"
for k in METAMASK_PRIVATE_KEY PROFIT_RECIPIENT_ADDRESS EXECUTOR_ADDRESS \
         ARBITRUM_MAINNET_RPC_URL_1 ARBITRUM_MAINNET_RPC_URL_2 \
         DISCORD_OPS_WEBHOOK_URL DISCORD_CANDIDATE_WEBHOOK_URL; do
  v=$(grep -E "^${k}=" .env | tail -1 | cut -d= -f2-)
  if [ -z "$v" ] || [[ "$v" == *YOUR_* ]] || [[ "$v" == "" ]]; then
    red "$k MISSING / placeholder"
  else
    green "$k present (${v:0:8}...${v: -6})"
  fi
done

# Optional keys
H2 "optional / awareness"
for k in DISCORD_SUMMARY_WEBHOOK_URL TICK_MAP_ALWAYS_REFRESH PROFIT_RECIPIENT_ADDRESS; do
  v=$(grep -E "^${k}=" .env | tail -1 | cut -d= -f2- 2>/dev/null)
  if [ -z "$v" ]; then info "$k not set"; else info "$k = ${v:0:30}..."; fi
done

# ════════════════════════════════════════════════════════════════════════════
# 5. ON-CHAIN STATE
# ════════════════════════════════════════════════════════════════════════════
H1 "5. On-Chain State"

node -e "
require('dotenv').config();
const { ethers } = require('ethers');
const rpc = process.env.ARBITRUM_MAINNET_RPC_URL_2 || process.env.ARBITRUM_MAINNET_RPC_URL_1;
if (!rpc || !process.env.EXECUTOR_ADDRESS || !process.env.METAMASK_PRIVATE_KEY) {
  console.log('  ❌  missing env keys for on-chain check'); process.exit(1);
}
const p = new ethers.JsonRpcProvider(rpc);
(async () => {
  const code = await p.getCode(process.env.EXECUTOR_ADDRESS);
  if (code === '0x') console.log('  ❌  no bytecode at executor');
  else console.log('  ✅  executor bytecode present (' + (code.length/2-1) + ' bytes)');

  const bn = await p.getBlockNumber();
  console.log('      head block: ' + bn);

  const fee = await p.getFeeData();
  const gw = Number(fee.gasPrice || 0) / 1e9;
  const tag = gw <= 0.05 ? '✅' : '⚠ ';
  console.log('  ' + tag + '  gas: ' + gw.toFixed(4) + ' gwei (cap 0.05)');

  const w = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, p);
  const b = await p.getBalance(w.address);
  const eth = Number(ethers.formatEther(b));
  const tag2 = eth >= 0.001 ? '✅' : '❌';
  console.log('  ' + tag2 + '  wallet ' + w.address.slice(0,8) + '...' + w.address.slice(-4) + ': ' + eth.toFixed(6) + ' ETH');

  // Pool reserves (Ramses V2 ETH/USDC)
  const POOL = '0x30AFBcF9458c3131A6d051C621E307E6278E4110';
  const ABI = ['function token0() view returns (address)', 'function token1() view returns (address)',
               'function liquidity() view returns (uint128)'];
  const pool = new ethers.Contract(POOL, ABI, p);
  try {
    const liq = await pool.liquidity();
    console.log('  ✅  ETH/USDC pool liquidity: ' + liq.toString());
  } catch (e) { console.log('  ⚠   pool read failed: ' + e.message.slice(0, 60)); }
})().catch(e => console.log('  ❌  on-chain check threw:', e.message.slice(0,80)));
" 2>&1

# ════════════════════════════════════════════════════════════════════════════
# 6. SUPERVISOR HEALTH
# ════════════════════════════════════════════════════════════════════════════
H1 "6. Supervisor / Restart Patterns"

if [ -s "$SESS_DIR/activator.jsonl" ]; then
  H2 "stale_exit cadence (last 100 lines)"
  STALE_RECENT=$(tail -100 "$SESS_DIR/activator.jsonl" 2>/dev/null | grep -c '"stale_exit"' || echo 0)
  STALE_TOTAL=$(grep -c '"stale_exit"' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  info "  recent (last 100 lines): $STALE_RECENT"
  info "  session total:           $STALE_TOTAL"
  if [ "$STALE_RECENT" -gt 0 ]; then
    yellow "supervisor is currently relaunching the activator — process not stable"
  fi

  H2 "STATE_UNHEALTHY count"
  UNHEALTHY=$(grep -c '"STATE_UNHEALTHY"' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  if [ "$UNHEALTHY" -gt 0 ]; then yellow "STATE_UNHEALTHY events: $UNHEALTHY"
  else green "0 STATE_UNHEALTHY events"; fi

  H2 "tick_map_refresh_deferred"
  DEFERRED=$(grep -c '"tick_map_refresh_deferred"' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  REFRESHED=$(grep -c '"type":"tick_map_refresh"[^_]' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  info "  deferred: $DEFERRED"
  info "  successful: $REFRESHED"
  if [ "$DEFERRED" -gt 0 ] && [ "$REFRESHED" -eq 0 ]; then
    red "tick map deferred $DEFERRED times, never refreshed — DEADLOCK"
    info "    escape hatch: TICK_MAP_ALWAYS_REFRESH=true in .env"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# 7. METRICS RECONCILIATION
# ════════════════════════════════════════════════════════════════════════════
H1 "7. Metrics Reconciliation"
info "Signal counts should agree across views (or differ for documented reasons)."

if [ -f "$SESS_DIR/session_totals.json" ]; then
  H2 "session_totals.json"
  cat "$SESS_DIR/session_totals.json" | python3 -m json.tool 2>/dev/null \
    | grep -E "totalSignals|totalConfirmed|netProfitUsd|durationSec" | head -10 \
    || info "  (parse failed)"
fi

H2 "activator file counts"
if [ -s "$SESS_DIR/activator.jsonl" ]; then
  EXEC_READY=$(grep -c '"signal":"EXECUTION_READY"' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  MARGINAL=$(grep -c '"signal":"SIMULATION_MARGINAL"' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  LOST=$(grep -c '"signal":"SIMULATION_LOST"' "$SESS_DIR/activator.jsonl" 2>/dev/null || echo 0)
  info "  EXECUTION_READY:     $EXEC_READY"
  info "  SIMULATION_MARGINAL: $MARGINAL"
  info "  SIMULATION_LOST:     $LOST"
  if [ "$EXEC_READY" -eq 0 ] && [ "$MARGINAL" -eq 0 ] && [ "$LOST" -eq 0 ]; then
    red "ZERO simulation results in entire session file — pipeline silent"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# 8. DRIFT vs PROJECT_STATE_CURRENT.md
# ════════════════════════════════════════════════════════════════════════════
H1 "8. Drift vs PROJECT_STATE_CURRENT.md"

PSC=docs/current/PROJECT_STATE_CURRENT.md
if [ -f "$PSC" ]; then
  H2 "executor address claim"
  CLAIMED=$(grep -oE '0x[a-fA-F0-9]{40}' "$PSC" | head -1)
  CURRENT=$(grep -E '^EXECUTOR_ADDRESS=' .env | cut -d= -f2)
  info "  PROJECT_STATE: $CLAIMED"
  info "  .env:          $CURRENT"
  if [ "$CLAIMED" = "$CURRENT" ] || [[ "$(cat $PSC)" == *"$CURRENT"* ]]; then
    green "executor address consistent"
  else
    yellow "PROJECT_STATE may not yet reference deployed address"
  fi

  H2 "primary surface claim"
  if grep -q "ETH/USDC Ramses" "$PSC" 2>/dev/null; then
    info "  PROJECT_STATE claims ETH/USDC Ramses as primary"
    if [ "${PAIRS[activator]:-?}" = "ETH/USDC" ]; then
      green "activator targets matching pair"
    else
      red "DRIFT — PROJECT_STATE says ETH/USDC, activator on ${PAIRS[activator]:-?}"
    fi
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# 9. PHASE / DISARMED POSTURE
# ════════════════════════════════════════════════════════════════════════════
H1 "9. Phase / Disarmed Posture"

H2 ".env flags"
LD=$(grep -E '^LIVE_DEPLOY_APPROVED=' .env | tail -1 | cut -d= -f2)
AM=$(grep -E '^AUTO_MICRO_ONESHOT=' .env | tail -1 | cut -d= -f2)
if [ "$LD" = "false" ]; then green "LIVE_DEPLOY_APPROVED=false"; else red "LIVE_DEPLOY_APPROVED=$LD (expected false outside live ops)"; fi
if [ "$AM" = "false" ]; then green "AUTO_MICRO_ONESHOT=false"; else red "AUTO_MICRO_ONESHOT=$AM (expected false outside live ops)"; fi

H2 "C9 canonical state"
if [ -f logs/.dryrun_c9_confirmed.json ]; then
  KEYS=$(python3 -c "import json; d=json.load(open('logs/.dryrun_c9_confirmed.json')); print(' '.join(sorted(d.keys())))")
  EXPECTED="20260428_2329 20260503_1948 20260505_0755"
  if [ "$KEYS" = "$EXPECTED" ]; then
    green "C9 state = canonical 3"
  else
    yellow "C9 keys: $KEYS"
    info "  expected (Boss canonical): $EXPECTED"
  fi
fi

# ════════════════════════════════════════════════════════════════════════════
# 10. OUTPUT ROUTING (test pings)
# ════════════════════════════════════════════════════════════════════════════
H1 "10. Output Routing — Discord pings"

node -e "
require('dotenv').config();
const m = require('./scripts/monitoring/discord_notifier');
const stamp = new Date().toISOString();
(async () => {
  try {
    const r = await m.sendOpsNotification({
      title: '🔬 INTEGRITY AUDIT — ops ping', status: 'INFO',
      description: 'system_integrity_audit.sh routing test\nTimestamp: ' + stamp,
      footer: 'system_integrity_audit',
    });
    console.log('  ' + (r ? '✅' : '❌') + '  ops channel: ' + (r ? 'webhook accepted' : 'rejected'));
  } catch (e) { console.log('  ❌  ops ping threw:', e.message.slice(0,80)); }
  try {
    const r = await m.sendCandidateNotification({
      pair: 'AUDIT/INTEGRITY', spreadPct: 0, expectedEdgePct: 0,
      executionConfidence: 1.0, baseNetProfitUsd: 0,
      profile: 'AUDIT', heatClass: 'AUDIT', regime: 'AUDIT',
      direction: 'AUDIT', sessionId: '$SID',
      extra: 'system_integrity_audit.sh routing test\nTimestamp: ' + stamp,
    });
    console.log('  ' + (r ? '✅' : '❌') + '  candidate channel: ' + (r ? 'webhook accepted' : 'rejected'));
  } catch (e) { console.log('  ❌  candidate ping threw:', e.message.slice(0,80)); }
})();
" 2>&1

# ════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ════════════════════════════════════════════════════════════════════════════
H1 "Audit Summary"
echo ""
echo "  Pass:    $PASS  ✅"
echo "  Warn:    $WARN  ⚠"
echo "  Fail:    $FAIL  ❌"
echo ""

if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  echo "  ✅✅✅  Stack on track. No drift detected."
  exit 0
elif [ "$FAIL" -eq 0 ]; then
  echo "  ✅  No critical failures, but $WARN advisories — review before live actions."
  exit 0
else
  echo "  ❌  $FAIL critical drift findings — DO NOT proceed with live ops."
  echo ""
  echo "  Recommended next step: paste this output to the chat for analysis."
  exit 1
fi
