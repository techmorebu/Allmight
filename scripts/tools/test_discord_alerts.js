'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Discord Notification Test  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/test_discord_alerts.js
//
//  Fires every Discord alert type used by notification_router.js and reports
//  the HTTP result for each one. Run this to verify webhooks are configured
//  correctly before starting a session.
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/test_discord_alerts.js
//
//  # Test a specific alert only
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only startup
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only heartbeat
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only candidate
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only watchdog
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only silent
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only mode_change
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only burst
//  node -r dotenv/config scripts/tools/test_discord_alerts.js --only summary
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');

// ── Args ──────────────────────────────────────────────────────────────────────
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i !== -1 ? process.argv[i + 1] : null;
})();

// ── Load the monitoring discord_notifier ─────────────────────────────────────
// This is the file used by notification_router.js.
// NOT the legacy discord_notifier.js in the project root.
const NOTIFIER_PATH = path.resolve(__dirname, '../monitoring/discord_notifier');
let notifier;
try {
  notifier = require(NOTIFIER_PATH);
} catch (err) {
  console.error(`\n  ERROR: Could not load discord_notifier from ${NOTIFIER_PATH}`);
  console.error(`  ${err.message}\n`);
  process.exit(1);
}

const {
  sendOpsNotification,
  sendCandidateNotification,
  sendSummaryNotification,
  sendEmbed,
  CHANNELS,
  NOTIFY_ENABLED,
} = notifier;

// ── Pre-flight checks ─────────────────────────────────────────────────────────
function preflight() {
  const W = 78;
  const EQ = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Discord Notification Test  v1.0');
  console.log('  ' + new Date().toISOString());
  console.log(EQ);

  console.log('\n  PRE-FLIGHT');
  console.log('  ' + DIV);

  let ok = true;

  // NOTIFY_ENABLED
  const enabledIcon = NOTIFY_ENABLED ? '✅' : '❌';
  console.log(`  ${enabledIcon} DISCORD_NOTIFY_ENABLED = ${NOTIFY_ENABLED}`);
  if (!NOTIFY_ENABLED) {
    console.log('     Set DISCORD_NOTIFY_ENABLED=true in .env to enable notifications');
    ok = false;
  }

  // Webhook URLs
  const channelEnvMap = {
    ops      : 'DISCORD_OPS_WEBHOOK_URL',
    candidate: 'DISCORD_CANDIDATE_WEBHOOK_URL',
    summary  : 'DISCORD_SUMMARY_WEBHOOK_URL',
  };

  for (const [channel, envVar] of Object.entries(channelEnvMap)) {
    const url = CHANNELS[channel];
    if (!url) {
      console.log(`  ❌ ${envVar} not set — ${channel} alerts will be dropped`);
      ok = false;
    } else if (url.endsWith('>') || url.endsWith('<')) {
      console.log(`  ❌ ${envVar} has trailing > or < — URL was pasted incorrectly`);
      ok = false;
    } else if (url.split('/').pop().length < 40) {
      console.log(`  ⚠️  ${envVar} token looks short — may be truncated (${url.split('/').pop().length} chars, expected ~68)`);
      // not fatal — still try
    } else {
      const preview = url.slice(0, 50) + '...';
      console.log(`  ✅ ${envVar} = ${preview}`);
    }
  }

  if (!ok) {
    console.log('\n  Fix the issues above in your .env file, then re-run.\n');
    process.exit(1);
  }

  console.log('\n  Pre-flight passed. Firing all alert types with 1s delay between...\n');
  return ok;
}

// ── Test harness ──────────────────────────────────────────────────────────────
const SESSION_ID = 'TEST_' + new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
const results = [];

async function fire(name, fn) {
  if (ONLY && ONLY !== name) return;
  process.stdout.write(`  Sending [${name.padEnd(12)}] ... `);
  const t0 = Date.now();
  try {
    const sent = await fn();
    const ms = Date.now() - t0;
    if (sent === false) {
      // returned false — URL missing or NOTIFY_ENABLED=false
      console.log(`DROPPED  (${ms}ms) — URL missing or notify disabled`);
      results.push({ name, status: 'DROPPED', ms });
    } else {
      console.log(`OK  (${ms}ms)`);
      results.push({ name, status: 'OK', ms });
    }
  } catch (err) {
    const ms = Date.now() - t0;
    console.log(`FAILED  (${ms}ms) — ${err.message}`);
    results.push({ name, status: 'FAILED', ms, error: err.message });
  }
  // 1 second between sends to respect Discord rate limit
  await new Promise(r => setTimeout(r, 1200));
}

// ── Alert definitions ─────────────────────────────────────────────────────────
async function runAll() {
  preflight();

  // 1. Startup
  await fire('startup', () => sendOpsNotification({
    title      : `🟢  ALLMIGHT STARTED — ${SESSION_ID}`,
    description: '[TEST] Session launched. Monitoring ETH/USDC-RAMSES surface.',
    status     : 'HEALTHY',
  }));

  // 2. Watchdog DEGRADED
  await fire('watchdog', () => sendOpsNotification({
    title    : `⚠️  SYSTEM DEGRADED — ${SESSION_ID}`,
    status   : 'DEGRADED',
    component: 'activator',
    issue    : '[TEST] stale output (activator:WARN_299s)',
    rebuilds : '0 ok / 0 fail',
  }));

  // 3. Activator silent
  await fire('silent', () => sendOpsNotification({
    title      : `💀  ACTIVATOR SILENT — ${SESSION_ID}`,
    status     : 'FAILED',
    component  : 'activator',
    issue      : '[TEST] No output for 12.3 minutes (threshold 10m)',
    rebuilds   : 'unknown — activator not writing',
    description: '[TEST] Activator may have exited. Restart if needed.',
  }));

  // 4. Candidate confirmed
  await fire('candidate', () => sendCandidateNotification({
    pair               : 'ETH/USDC-RAMSES',
    spreadPct          : 0.2306,
    expectedEdgePct    : 0.0821,
    executionConfidence: 0.781,
    baseNetProfitUsd   : 0.1825,
    profile            : 'SAFE',
    heatClass          : 'EXTREME',
    regime             : 'persistent_depth_regime',
    direction          : 'UNI_TO_RAMSES',
    sessionId          : SESSION_ID,
    extra              : '[TEST] First confirmed candidate this session.',
  }));

  // 5. Heartbeat (Tier 1)
  await fire('heartbeat', () => sendEmbed('summary', {
    title      : `📡  SESSION STATUS — ${SESSION_ID}`,
    description: [
      'Runtime: 2.4h',
      'Signals: 312',
      'Confirmed: 42',
      'Capture: 13.5%',
      '',
      'Est. Value: $6.30',
      'Value/hr: $2.63',
      '',
      'Mode: STANDARD ($500 max)',
      'Infra: HEALTHY',
      '',
      '[TEST MESSAGE]',
    ].join('\n'),
    color: 0x5DADE2,
  }));

  // 6. Mode change (Tier 2)
  await fire('mode_change', () => sendEmbed('ops', {
    title      : `⬇️  MODE CHANGE — ${SESSION_ID}`,
    description: [
      '**STANDARD → CONSERVATIVE**',
      '',
      '[TEST] Reduced to $300 max. Infrastructure or warmup issue.',
      '',
      'Run: node scripts/tools/session_policy_check.js',
    ].join('\n'),
    color: 0xFEE75C,
  }));

  // 7. High-value burst (Tier 2)
  await fire('burst', () => sendEmbed('candidate', {
    title      : `🔥  HIGH-VALUE BURST — ${SESSION_ID}`,
    description: [
      '**5 confirmed trades** in last 10min',
      'Avg net: $0.183',
      'Total value: $0.91',
      '',
      '[TEST] Surface is highly active.',
    ].join('\n'),
    color: 0x57F287,
  }));

  // 8. Stop summary (Tier 3)
  await fire('summary', () => sendSummaryNotification({
    sessionId    : SESSION_ID,
    durationH    : 6.14,
    signals      : 563,
    blueprints   : 563,
    confirmed    : 33,
    nearMiss     : 342,
    thresholdEdge: 8,
    accumVerdict : 'INCIDENTAL (13/19)',
    rebuilds     : '0',
    overallStatus: 'CANDIDATES PRODUCED',
  }));

  // ── Results summary ────────────────────────────────────────────────────────
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  RESULTS');
  console.log('  ' + DIV);

  const ran    = results.length;
  const ok     = results.filter(r => r.status === 'OK').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const dropped= results.filter(r => r.status === 'DROPPED').length;

  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : r.status === 'DROPPED' ? '⚠️' : '❌';
    const err  = r.error ? `  — ${r.error}` : '';
    console.log(`  ${icon} ${r.name.padEnd(14)} ${r.status.padEnd(8)} ${r.ms}ms${err}`);
  }

  console.log('\n  ' + DIV);
  console.log(`  Sent: ${ok}/${ran}  Failed: ${failed}  Dropped: ${dropped}`);

  if (ok === ran) {
    console.log('\n  ✅ All alerts delivered. Check your Discord channels.');
  } else if (failed > 0) {
    console.log('\n  ❌ Some alerts failed. Check the error messages above.');
    console.log('     Most common cause: webhook URL is truncated or has trailing > in .env');
  } else if (dropped > 0) {
    console.log('\n  ⚠️  Some alerts were dropped. Check webhook URLs are set in .env.');
  }

  console.log('\n' + EQ + '\n');
}

runAll().catch(err => {
  console.error(`\n  FATAL: ${err.message}\n`);
  process.exit(1);
});
