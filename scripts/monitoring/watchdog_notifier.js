'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Watchdog Notifier
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/monitoring/watchdog_notifier.js
//  STATUS    : NEW — Boss ruling 2026-04-15
//
//  PURPOSE
//  ───────
//  Bridge between allmight_watchdog.sh and discord_notifier.js.
//  Called by the watchdog after each check when a state TRANSITION occurs.
//  Reads a single watchdog JSONL record from stdin, sends a Discord ops alert.
//
//  ALERT POLICY
//  ─────────────
//  Only fires on state TRANSITIONS — not on every check.
//  The watchdog tracks previous state externally (via a small state file) and
//  only calls this script when status changes.
//
//  Alert classes:
//    HEALTHY→DEGRADED   — ⚠ warning (DEGRADED status)
//    HEALTHY→FAILED     — 🚨 critical (FAILED status)
//    DEGRADED→FAILED    — 🚨 critical (escalation)
//    FAILED→DEGRADED    — ⚡ recovering (DEGRADED, was FAILED)
//    FAILED→HEALTHY     — ✅ recovered (back to HEALTHY)
//    DEGRADED→HEALTHY   — ✅ recovered
//    dead PIDs detected — 💀 always alert regardless of transition
//    rpc_exhausted spike — ⚡ always alert if count > threshold
//
//  USAGE (called by watchdog.sh)
//    echo '{"overallStatus":"FAILED",...}' | \
//      node scripts/monitoring/watchdog_notifier.js --prev HEALTHY
//
//  FAIL-SILENT: any error in this script must not affect watchdog operation.
// ═══════════════════════════════════════════════════════════════════════════════

const { sendOpsNotification } = require('./discord_notifier');

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const RPC_EXHAUSTED_ALERT_THRESHOLD = 50;  // fire alert if rpcExhaustedCount > N

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS     = process.argv.slice(2);
const PREV_IDX = ARGS.indexOf('--prev');
const PREV     = PREV_IDX !== -1 ? ARGS[PREV_IDX + 1] : null;  // previous status

// ─── READ WATCHDOG RECORD FROM STDIN ──────────────────────────────────────────

async function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => { buf += d; });
    process.stdin.on('end', () => resolve(buf.trim()));
    process.stdin.on('error', reject);
    setTimeout(() => resolve(buf.trim()), 3000);  // 3s timeout — fail-silent
  });
}

// ─── ALERT DECISION ───────────────────────────────────────────────────────────

function shouldAlert(rec, prev) {
  const curr = rec.overallStatus;

  // Always alert on dead PIDs (regardless of transition)
  const deadPids = (rec.deadPids || []).filter(Boolean);
  if (deadPids.length > 0) return true;

  // Always alert on RPC exhaustion spike
  if ((rec.rpcExhaustedCount || 0) > RPC_EXHAUSTED_ALERT_THRESHOLD) return true;

  // Alert on status transitions only
  if (!prev) return curr === 'FAILED';   // first check — only alert if already FAILED
  return curr !== prev;
}

// ─── MESSAGE BUILDER ──────────────────────────────────────────────────────────

function buildAlert(rec, prev) {
  const curr     = rec.overallStatus;
  const session  = rec.session  || 'unknown';
  const ts       = rec.ts?.slice(0, 19) || new Date().toISOString().slice(0, 19);
  const stale    = (rec.staleComponents || []).filter(Boolean);
  const dead     = (rec.deadPids || []).filter(Boolean);
  const warnings = (rec.warningFlags || []).filter(Boolean);
  const grace    = rec.recoveryGraceActive === true;
  const rpcExh   = rec.rpcExhaustedCount || 0;

  // Determine icon + status label
  let icon, status, direction;
  if (dead.length > 0) {
    icon = '💀'; status = 'CRITICAL'; direction = 'DEAD_PROCESS';
  } else if (curr === 'FAILED' && prev === 'FAILED') {
    icon = '🚨'; status = 'CRITICAL'; direction = 'SUSTAINED_FAILED';
  } else if (curr === 'FAILED') {
    icon = '🚨'; status = 'CRITICAL'; direction = `${prev || '?'} → FAILED`;
  } else if (curr === 'DEGRADED' && prev === 'FAILED') {
    icon = '⚡'; status = 'WARNING';  direction = 'FAILED → DEGRADED (recovering)';
  } else if (curr === 'HEALTHY' && (prev === 'FAILED' || prev === 'DEGRADED')) {
    icon = '✅'; status = 'OK';       direction = `${prev} → HEALTHY (recovered)`;
  } else if (curr === 'DEGRADED') {
    icon = '⚠️'; status = 'WARNING';  direction = `${prev || '?'} → DEGRADED`;
  } else if (rpcExh > RPC_EXHAUSTED_ALERT_THRESHOLD) {
    icon = '⚡'; status = 'WARNING';  direction = 'RPC_EXHAUSTION';
  } else {
    icon = 'ℹ️'; status = 'INFO';    direction = curr;
  }

  const title = `${icon}  WATCHDOG — ${direction}`;

  // Body lines
  const lines = [`Session: \`${session}\``, `Time: ${ts}`];
  if (stale.length)    lines.push(`Stale: ${stale.join(', ')}`);
  if (dead.length)     lines.push(`**Dead PIDs: ${dead.join(', ')}**`);
  if (grace)           lines.push(`Recovery grace: active (rebuild detected)`);
  if (rpcExh > RPC_EXHAUSTED_ALERT_THRESHOLD)
    lines.push(`RPC exhausted: ${rpcExh} events (threshold: ${RPC_EXHAUSTED_ALERT_THRESHOLD})`);
  if (warnings.filter(w => !w.startsWith('recovery_grace')).length)
    lines.push(`Warnings: ${warnings.join(', ')}`);

  // Stats fields
  const fields = [
    { name: 'Signals (recent)', value: String(rec.recentSignals  ?? '?'), inline: true },
    { name: 'Blueprints',       value: String(rec.recentBlueprints ?? '?'), inline: true },
    { name: 'Confirmed',        value: String(rec.confirmedCount  ?? '?'), inline: true },
    { name: 'Rebuilds',
      value: `${rec.rebuildTotalCount ?? 0} total  ${rec.rebuildSuccessCount ?? 0} ok  ${rec.rebuildFailCount ?? 0} fail`,
      inline: false },
  ];

  return { title, description: lines.join('\n'), status, fields };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const raw = await readStdin();
    if (!raw) process.exit(0);

    let rec;
    try { rec = JSON.parse(raw); }
    catch { process.exit(0); }   // bad JSON — fail-silent

    if (!shouldAlert(rec, PREV)) process.exit(0);

    const { title, description, status, fields } = buildAlert(rec, PREV);

    await sendOpsNotification({ title, description, status, fields });

    process.exit(0);
  } catch (err) {
    // Fail-silent — watchdog must never be blocked by notifier errors
    process.stderr.write(`[watchdog_notifier] ${err.message}\n`);
    process.exit(0);
  }
}

main();
