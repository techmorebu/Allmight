#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
#  AllMight — Pre-Rehearsal Wiring Audit
# ────────────────────────────────────────────────────────────────────────────
#  Verifies every wire the micro_live_oneshot rehearsal will rely on,
#  BEFORE launching it. Sends test pings to each Discord channel so you
#  can visually confirm routing.
#
#  Usage:
#    bash scripts/tools/audit_rehearsal_wiring.sh
#
#  Exit code:
#    0 — all green, safe to launch rehearsal
#    1 — a critical wire is broken, do NOT launch
#
#  This script does not modify any state, does not broadcast, does not
#  flip flags. Read-only + 3 test webhook pings.
# ════════════════════════════════════════════════════════════════════════════
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

PASS=0; FAIL=0
green()  { echo "  ✅  $*"; PASS=$((PASS+1)); }
red()    { echo "  ❌  $*"; FAIL=$((FAIL+1)); }
info()   { echo "      $*"; }

echo "═══════════════════════════════════════════════════════════════════════"
echo "  AllMight — Pre-Rehearsal Wiring Audit"
echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "═══════════════════════════════════════════════════════════════════════"

# ─── 1. Session pointer + session dir ────────────────────────────────────────
echo ""
echo "── 1. Session pointer ──"
if [ ! -f "logs/allmight.session" ]; then
  red "logs/allmight.session missing — stack not started?"
  echo ""; echo "FATAL — cannot continue without a session."; exit 1
fi
SID=$(cat logs/allmight.session)
SESS_DIR="logs/sessions/session_$SID"
if [ -z "$SID" ]; then
  red "logs/allmight.session is empty"
  exit 1
elif [ ! -d "$SESS_DIR" ]; then
  red "session dir missing: $SESS_DIR"
  exit 1
else
  green "session: $SID"
  info "  dir: $SESS_DIR"
fi

# ─── 2. Activator alive + writing fresh records ──────────────────────────────
echo ""
echo "── 2. Activator data feed ──"
ACT="$SESS_DIR/activator.jsonl"
if [ ! -f "$ACT" ]; then
  red "activator.jsonl missing"
elif [ ! -s "$ACT" ]; then
  red "activator.jsonl is empty"
else
  MTIME=$(stat -c '%Y' "$ACT")
  NOW=$(date +%s)
  AGE=$(( NOW - MTIME ))
  if [ "$AGE" -gt 120 ]; then
    red "activator.jsonl stale — last write ${AGE}s ago"
    info "    expected: < 120s"
    info "    process may be dead. ps aux | grep arb_window_activator"
  else
    green "activator.jsonl fresh (last write ${AGE}s ago)"
  fi
  SIZE=$(stat -c '%s' "$ACT")
  info "  size: $SIZE bytes"
fi

# Sniff the most recent JSON record (skip non-JSON summary lines)
echo ""
echo "── 3. Activator schema check ──"
node -e "
const fs = require('fs');
const lines = fs.readFileSync('$ACT', 'utf8').trim().split('\n').slice(-100);
let lastSig = null;
let lastAny = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const r = JSON.parse(lines[i]);
    if (!lastAny) lastAny = r;
    if (r.signal && typeof r.spread === 'number') { lastSig = r; break; }
  } catch { /* not JSON */ }
}
if (!lastAny) { console.log('  ❌  no JSON records in last 100 lines'); process.exit(1); }
if (!lastSig) {
  console.log('  ⚠   no signal+spread record in last 100 lines (may indicate quiet market)');
  console.log('      last JSON record fields:', Object.keys(lastAny).slice(0, 8).join(', '));
} else {
  console.log('  ✅  schema valid: signal=' + lastSig.signal + ' spread=' + (lastSig.spread*100).toFixed(2) + 'bps block=' + lastSig.block);
  const expected = ['ts','signal','spread','block'];
  const missing = expected.filter(k => !(k in lastSig));
  if (missing.length) console.log('  ⚠   missing fields:', missing.join(','));
}
" || red "activator schema check failed"

# ─── 4. Watchdog records ─────────────────────────────────────────────────────
echo ""
echo "── 4. Watchdog state ──"
WD="$SESS_DIR/watchdog.jsonl"
if [ ! -f "$WD" ]; then
  red "watchdog.jsonl missing"
else
  node -e "
const fs = require('fs');
const lines = fs.readFileSync('$WD', 'utf8').trim().split('\n').slice(-10);
let last = null;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const r = JSON.parse(lines[i]);
    if (r.overallStatus) { last = r; break; }
  } catch { /* skip */ }
}
if (!last) { console.log('  ❌  no overallStatus record in last 10 lines'); process.exit(1); }
const age = Math.round((Date.now() - new Date(last.ts).getTime())/1000);
const tag = last.overallStatus === 'HEALTHY' ? '✅' : (last.overallStatus === 'DEGRADED' ? '⚠ ' : '❌');
console.log('  ' + tag + '  watchdog: ' + last.overallStatus + ' (age ' + age + 's)');
if (last.staleComponents && last.staleComponents.length) {
  console.log('      stale:', last.staleComponents.join(', '));
}
" || red "watchdog read failed"
fi

# ─── 5. Blueprints (used for trade sizing in LIVE mode) ──────────────────────
echo ""
echo "── 5. Blueprints (sizing data, optional for dry) ──"
BP="$SESS_DIR/blueprints.jsonl"
if [ ! -f "$BP" ]; then
  info "  ℹ   blueprints.jsonl absent — fallback sizing will be used"
else
  COUNT=$(wc -l < "$BP" 2>/dev/null || echo 0)
  green "blueprints.jsonl present ($COUNT records)"
fi

# ─── 6. .env critical keys ───────────────────────────────────────────────────
echo ""
echo "── 6. Required env keys ──"
for k in METAMASK_PRIVATE_KEY PROFIT_RECIPIENT_ADDRESS EXECUTOR_ADDRESS \
         ARBITRUM_MAINNET_RPC_URL_1 ARBITRUM_MAINNET_RPC_URL_2 \
         DISCORD_OPS_WEBHOOK_URL DISCORD_CANDIDATE_WEBHOOK_URL DISCORD_SUMMARY_WEBHOOK_URL; do
  v=$(grep -E "^${k}=" .env | tail -1 | cut -d= -f2-)
  if [ -z "$v" ] || [[ "$v" == *YOUR_* ]]; then
    if [[ "$k" == DISCORD_SUMMARY_WEBHOOK_URL ]]; then
      info "  ℹ   $k absent (summary channel — non-blocking)"
    else
      red "$k MISSING / placeholder"
    fi
  else
    green "$k present (${v:0:10}...${v: -6})"
  fi
done

# ─── 7. .env disarmed posture ────────────────────────────────────────────────
echo ""
echo "── 7. .env disarmed posture ──"
LD=$(grep -E "^LIVE_DEPLOY_APPROVED=" .env | tail -1 | cut -d= -f2)
AM=$(grep -E "^AUTO_MICRO_ONESHOT=" .env | tail -1 | cut -d= -f2)
if [ "$LD" = "false" ]; then green "LIVE_DEPLOY_APPROVED=false"; else red "LIVE_DEPLOY_APPROVED=$LD (expected false)"; fi
if [ "$AM" = "false" ]; then green "AUTO_MICRO_ONESHOT=false"; else red "AUTO_MICRO_ONESHOT=$AM (expected false)"; fi

# ─── 8. Executor on-chain verify ─────────────────────────────────────────────
echo ""
echo "── 8. Executor on-chain ──"
node -e "
require('dotenv').config();
const { ethers } = require('ethers');
const rpc = process.env.ARBITRUM_MAINNET_RPC_URL_2 || process.env.ARBITRUM_MAINNET_RPC_URL_1;
const addr = process.env.EXECUTOR_ADDRESS;
if (!rpc || !addr) { console.log('  ❌  RPC or EXECUTOR_ADDRESS missing'); process.exit(1); }
const p = new ethers.JsonRpcProvider(rpc);
(async () => {
  const code = await p.getCode(addr);
  if (code === '0x') { console.log('  ❌  no bytecode at ' + addr); process.exit(1); }
  console.log('  ✅  executor bytecode present at ' + addr.slice(0,8) + '...' + addr.slice(-6));
  const bn = await p.getBlockNumber();
  console.log('      Arbitrum head block: ' + bn);
  const fee = await p.getFeeData();
  const gw = Number(fee.gasPrice || 0) / 1e9;
  console.log('      live gas: ' + gw.toFixed(4) + ' gwei (cap 0.05)');
  if (gw > 0.05) console.log('  ⚠   gas above cap — rehearsal would gate-fail until it drops');
})().catch(e => { console.log('  ❌  RPC probe failed:', e.message.slice(0,80)); process.exit(1); });
" || red "executor verify failed"

# ─── 9. Wallet balance ───────────────────────────────────────────────────────
echo ""
echo "── 9. Wallet balance ──"
node -e "
require('dotenv').config();
const { ethers } = require('ethers');
const rpc = process.env.ARBITRUM_MAINNET_RPC_URL_2 || process.env.ARBITRUM_MAINNET_RPC_URL_1;
const p = new ethers.JsonRpcProvider(rpc);
const w = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY, p);
p.getBalance(w.address).then(b => {
  const eth = Number(ethers.formatEther(b));
  const tag = eth >= 0.001 ? '✅' : '❌';
  console.log('  ' + tag + '  wallet ' + w.address.slice(0,8) + '...: ' + eth.toFixed(6) + ' ETH');
});
" || red "wallet balance check failed"

# ─── 10. Discord webhook test pings (visual confirmation) ────────────────────
echo ""
echo "── 10. Discord channel routing — sending test pings ──"
node -e "
require('dotenv').config();
const path = require('path');
const m = require('./scripts/monitoring/discord_notifier');
const stamp = new Date().toISOString();
(async () => {
  // Ops ping
  try {
    const ok1 = await m.sendOpsNotification({
      title: '🔬 AUDIT — ops channel routing test',
      description: 'Pre-rehearsal audit ping. Disregard.\nTimestamp: ' + stamp,
      status: 'INFO',
      footer: 'audit_rehearsal_wiring.sh',
    });
    console.log('  ' + (ok1 ? '✅' : '❌') + '  ops channel ping sent (' + (ok1 ? 'webhook accepted' : 'webhook rejected') + ')');
  } catch (e) { console.log('  ❌  ops ping threw:', e.message.slice(0,80)); }

  // Candidate ping
  try {
    const ok2 = await m.sendCandidateNotification({
      pair: 'AUDIT/TEST',
      spreadPct: 0.0001,
      expectedEdgePct: 0.0001,
      executionConfidence: 1.0,
      baseNetProfitUsd: 0,
      profile: 'AUDIT', heatClass: 'AUDIT', regime: 'AUDIT',
      direction: 'AUDIT', sessionId: 'PRE-REHEARSAL-AUDIT',
      extra: 'Channel routing test — disregard. Timestamp: ' + stamp,
    });
    console.log('  ' + (ok2 ? '✅' : '❌') + '  candidate channel ping sent (' + (ok2 ? 'webhook accepted' : 'webhook rejected') + ')');
  } catch (e) { console.log('  ❌  candidate ping threw:', e.message.slice(0,80)); }
})();
" || red "Discord ping module failed"

# ─── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  Audit complete — $PASS passed, $FAIL critical failures"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  Visually confirm in Discord:"
echo "    ops channel       — should show: '🔬 AUDIT — ops channel routing test'"
echo "    candidate channel — should show: '🔥 EXECUTION CANDIDATE — AUDIT/TEST'"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "  ✅  Safe to launch rehearsal."
  exit 0
else
  echo "  ❌  $FAIL critical failures — DO NOT launch rehearsal."
  exit 1
fi
