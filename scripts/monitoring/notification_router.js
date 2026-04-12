'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Notification Router  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/monitoring/notification_router.js
//
//  PURPOSE
//  ─────────
//  Watch current session JSONL logs, apply notification rules,
//  and send selective Discord alerts via discord_notifier.js.
//
//  READ-ONLY — never writes to pipeline logs.
//  FAIL-SILENT — Discord errors never propagate to caller.
//
//  USAGE
//  ─────
//  # One-time check (reads latest records, sends any pending alerts)
//  node -r dotenv/config scripts/monitoring/notification_router.js
//
//  # Continuous polling (every N seconds, default 60)
//  node -r dotenv/config scripts/monitoring/notification_router.js --loop 60
//
//  # Dry-run (evaluate rules, print what would be sent, no Discord calls)
//  node -r dotenv/config scripts/monitoring/notification_router.js --dry-run
//
//  # Announce system startup
//  node -r dotenv/config scripts/monitoring/notification_router.js --startup
//
//  # Send stop summary from a session folder
//  node -r dotenv/config scripts/monitoring/notification_router.js \
//    --stop-summary logs/session_20260412_0800
//
//  WHAT TRIGGERS NOTIFICATIONS
//  ────────────────────────────
//  V1 (this build) sends alerts on:
//    1. System startup (--startup flag)
//    2. Watchdog DEGRADED (from watchdog.jsonl)
//    3. Watchdog FAILED (from watchdog.jsonl)
//    4. First CANDIDATE_CONFIRMED in a session (from audit log)
//    5. Candidate count crossing threshold (default 10)
//    6. System stop summary (--stop-summary flag)
//
//  NOT triggered in V1 (spam prevention):
//    - Every EXECUTION_READY
//    - Every blueprint
//    - Every near-miss
//    - Every heat change
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const {
  sendOpsNotification,
  sendCandidateNotification,
  sendSummaryNotification,
  NOTIFY_ENABLED,
} = require('./discord_notifier');

// ─── CONFIG FROM ENV ──────────────────────────────────────────────────────────

const LOOP_SEC          = 0;     // set from CLI
const DRY_RUN           = process.argv.includes('--dry-run');
const STARTUP_FLAG      = process.argv.includes('--startup');
const STOP_SUMMARY_IDX  = process.argv.indexOf('--stop-summary');
const STOP_SESSION_PATH = STOP_SUMMARY_IDX !== -1 ? process.argv[STOP_SUMMARY_IDX + 1] : null;

const LOOP_IDX   = process.argv.indexOf('--loop');
const LOOP_SECS  = LOOP_IDX !== -1 ? parseInt(process.argv[LOOP_IDX + 1], 10) || 60 : 0;

const MIN_CONFIDENCE   = parseFloat(process.env.DISCORD_NOTIFY_MIN_CONFIDENCE   || '0.65');
const FIRST_CAND_ONLY  = process.env.DISCORD_NOTIFY_FIRST_CANDIDATE_ONLY !== 'false';
const COOLDOWN_SEC     = parseInt(process.env.DISCORD_NOTIFY_COOLDOWN_SEC        || '300', 10);
const CAND_COUNT_ALERT = parseInt(process.env.DISCORD_NOTIFY_CANDIDATE_COUNT     || '10',  10);

const LOGS_DIR        = path.resolve(process.cwd(), 'logs');
const SESSION_FILE    = path.join(LOGS_DIR, 'allmight.session');

// ─── STATE (in-memory, reset on restart) ──────────────────────────────────────
// These are intentionally ephemeral — router restart won't flood Discord.

const _state = {
  sessionId              : null,
  sessionDir             : null,
  firstCandidateSent     : false,
  candidateCount         : 0,
  candidateCountAlerted  : 0,          // last count threshold we alerted on
  lastWatchdogStatus     : 'HEALTHY',
  lastWatchdogAlert      : 0,          // timestamp of last watchdog alert
  lastWatchdogLine       : 0,          // byte offset in watchdog.jsonl
  lastAuditLine          : 0,          // byte offset in audit jsonl
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function log(msg) { process.stdout.write(`[notification_router] ${msg}\n`); }

function readJsonl(filePath, fromByte = 0) {
  if (!fs.existsSync(filePath)) return { records: [], nextByte: fromByte };
  const fd   = fs.openSync(filePath, 'r');
  const stat = fs.fstatSync(fd);
  const size = stat.size;
  fs.closeSync(fd);

  if (size <= fromByte) return { records: [], nextByte: fromByte };

  const buf  = Buffer.allocUnsafe(size - fromByte);
  const fd2  = fs.openSync(filePath, 'r');
  fs.readSync(fd2, buf, 0, buf.length, fromByte);
  fs.closeSync(fd2);

  const records = [];
  for (const line of buf.toString('utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { records.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return { records, nextByte: size };
}

function cooldownExpired(lastTs) {
  return (Date.now() - lastTs) >= COOLDOWN_SEC * 1000;
}

async function maybeSend(channel, fn, ...args) {
  if (DRY_RUN) {
    log(`[DRY-RUN] would send to ${channel}: ${JSON.stringify(args[0]).slice(0, 80)}`);
    return;
  }
  if (!NOTIFY_ENABLED) return;
  try { await fn(...args); } catch (e) { /* fail-silent */ }
}

// ─── SESSION DISCOVERY ────────────────────────────────────────────────────────

function refreshSession() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  const newId = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  if (newId !== _state.sessionId) {
    log(`Session changed: ${_state.sessionId ?? 'none'} → ${newId}`);
    _state.sessionId             = newId;
    _state.sessionDir            = path.join(LOGS_DIR, `session_${newId}`);
    _state.firstCandidateSent    = false;
    _state.candidateCount        = 0;
    _state.candidateCountAlerted = 0;
    _state.lastWatchdogStatus    = 'HEALTHY';
    _state.lastWatchdogAlert     = 0;
    _state.lastWatchdogLine      = 0;
    _state.lastAuditLine         = 0;
  }
  return true;
}

// ─── RULE 1 — WATCHDOG ALERTS ─────────────────────────────────────────────────

async function checkWatchdog() {
  if (!_state.sessionDir) return;
  const wdPath = path.join(_state.sessionDir, 'watchdog.jsonl');
  const { records, nextByte } = readJsonl(wdPath, _state.lastWatchdogLine);
  _state.lastWatchdogLine = nextByte;

  for (const rec of records) {
    const status = rec.overallStatus;
    if (!status) continue;

    if ((status === 'DEGRADED' || status === 'FAILED') &&
        cooldownExpired(_state.lastWatchdogAlert)) {

      const stale   = (rec.staleComponents   || []).join(', ') || 'none';
      const dead    = (rec.deadPids          || []).join(', ') || 'none';
      const warnings= (rec.warningFlags      || []).join(', ') || 'none';
      const icon    = status === 'FAILED' ? '🚨' : '⚠️';

      const fields = [
        { name: 'Stale components', value: stale   || 'none', inline: false },
        { name: 'Dead PIDs',        value: dead    || 'none', inline: false },
        { name: 'Rebuilds',         value: `${rec.rebuildSuccessCount ?? 0} ok / ${rec.rebuildFailCount ?? 0} fail` },
        { name: 'UNKNOWN heat',     value: String(rec.unknownHeatCount ?? 0) },
        { name: 'Recent signals',   value: String(rec.recentSignals ?? 0) },
        { name: 'Warnings',         value: warnings, inline: false },
      ];

      log(`Sending watchdog ${status} alert`);
      await maybeSend('ops', sendOpsNotification, {
        title      : `${icon}  SYSTEM ${status} — ${_state.sessionId}`,
        description: status === 'FAILED'
          ? 'Critical component failure detected. Manual check may be required.'
          : 'One or more pipeline components are showing degraded health.',
        status,
        fields,
      });

      _state.lastWatchdogAlert  = Date.now();
      _state.lastWatchdogStatus = status;
    } else if (status === 'HEALTHY' && _state.lastWatchdogStatus !== 'HEALTHY') {
      // Recovery — send one ops message
      log('Sending watchdog recovery notification');
      await maybeSend('ops', sendOpsNotification, {
        title      : `✅  SYSTEM RECOVERED — ${_state.sessionId}`,
        description: 'All components returned to HEALTHY status.',
        status     : 'HEALTHY',
        fields     : [{ name: 'Previous status', value: _state.lastWatchdogStatus }],
      });
      _state.lastWatchdogStatus = 'HEALTHY';
      _state.lastWatchdogAlert  = 0;
    }
  }
}

// ─── RULE 2 — CANDIDATE ALERTS ────────────────────────────────────────────────

async function checkCandidates() {
  if (!_state.sessionDir) return;
  const auditPath = path.join(_state.sessionDir, 'execution_candidate_audit.jsonl');
  const { records, nextByte } = readJsonl(auditPath, _state.lastAuditLine);
  _state.lastAuditLine = nextByte;

  for (const rec of records) {
    if (rec.auditVerdict !== 'CANDIDATE_CONFIRMED') continue;
    if ((rec.executionConfidence ?? 0) < MIN_CONFIDENCE) continue;

    _state.candidateCount++;

    // First candidate in session
    if (!_state.firstCandidateSent) {
      log(`Sending first candidate alert (conf=${rec.executionConfidence})`);
      await maybeSend('candidate', sendCandidateNotification, {
        pair               : rec.pair,
        spreadPct          : rec.spreadPct,
        executionConfidence: rec.executionConfidence,
        baseNetProfitUsd   : rec.baseNetProfitUsd,
        profile            : rec.profile,
        heatClass          : rec.heatClass,
        regime             : rec.regime,
        direction          : rec.direction,
        sessionId          : _state.sessionId,
        extra              : `First confirmed candidate this session.`,
      });
      _state.firstCandidateSent = true;
      if (FIRST_CAND_ONLY) continue;
    }

    // Count-threshold alert (every CAND_COUNT_ALERT new candidates)
    const nextThreshold = _state.candidateCountAlerted + CAND_COUNT_ALERT;
    if (_state.candidateCount >= nextThreshold) {
      log(`Sending candidate count alert (total=${_state.candidateCount})`);
      await maybeSend('ops', sendOpsNotification, {
        title      : `📈  ${_state.candidateCount} CANDIDATES — ${_state.sessionId}`,
        description: `${_state.candidateCount} confirmed execution candidates produced this session.`,
        status     : 'HEALTHY',
        fields     : [
          { name: 'Session',    value: _state.sessionId },
          { name: 'Count',      value: String(_state.candidateCount) },
          { name: 'Threshold',  value: String(CAND_COUNT_ALERT) },
        ],
      });
      _state.candidateCountAlerted = _state.candidateCount;
    }
  }
}

// ─── STARTUP NOTIFICATION ─────────────────────────────────────────────────────

async function sendStartupNotification(sessionId) {
  log(`Sending startup notification for session ${sessionId}`);
  await maybeSend('ops', sendOpsNotification, {
    title      : `🟢  ALLMIGHT STARTED — ${sessionId}`,
    description: 'Session launched. Monitoring ETH/USDC-RAMSES surface.',
    status     : 'HEALTHY',
    fields     : [
      { name: 'Session',    value: sessionId },
      { name: 'Surface',    value: 'ETH/USDC-RAMSES' },
      { name: 'Chain',      value: 'Arbitrum' },
      { name: 'Mode',       value: 'Detection/Classification (pre-execution)' },
    ],
  });
}

// ─── STOP SUMMARY NOTIFICATION ───────────────────────────────────────────────

async function sendStopSummary(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');

  // Read metrics from session artifacts
  const readCount = (file, pattern) => {
    const fp = path.join(sessionDir, file);
    if (!fs.existsSync(fp)) return 0;
    return (fs.readFileSync(fp, 'utf8').match(new RegExp(pattern, 'g')) || []).length;
  };

  const confirmed  = readCount('execution_candidate_audit.jsonl', 'CANDIDATE_CONFIRMED');
  const nearMiss   = readCount('execution_candidate_audit.jsonl', 'CANDIDATE_NEAR_MISS');
  const signals    = readCount('activator.jsonl', 'EXECUTION_READY');
  const blueprints = readCount('blueprints.jsonl', 'blueprintId');
  const rebuilds   = readCount('activator.jsonl',  'provider_rebuild_success');

  // Threshold-edge count from threshold_edge.json if present
  let thresholdEdge = 0;
  const tePath = path.join(sessionDir, 'threshold_edge.json');
  if (fs.existsSync(tePath)) {
    try {
      const te = JSON.parse(fs.readFileSync(tePath, 'utf8'));
      thresholdEdge = te.edgeCount ?? 0;
    } catch { /* skip */ }
  }

  // Accumulator verdict
  let accumVerdict = 'not run';
  const acPath = path.join(sessionDir, 'threshold_edge_accumulator.json');
  if (fs.existsSync(acPath)) {
    try {
      const ac = JSON.parse(fs.readFileSync(acPath, 'utf8'));
      accumVerdict = `${ac.recurrenceVerdict} (${ac.q1_sessionCoverage})`;
    } catch { /* skip */ }
  }

  // Session duration from activator log first/last ts
  let durationH = '?';
  const actPath = path.join(sessionDir, 'activator.jsonl');
  if (fs.existsSync(actPath)) {
    try {
      const lines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
      const first = JSON.parse(lines[0]);
      const last  = JSON.parse(lines[lines.length - 1]);
      if (first.ts && last.ts) {
        durationH = ((new Date(last.ts) - new Date(first.ts)) / 3_600_000).toFixed(1);
      }
    } catch { /* skip */ }
  }

  log(`Sending stop summary for session ${sessionId}`);
  await maybeSend('summary', sendSummaryNotification, {
    sessionId,
    durationH,
    signals,
    blueprints,
    confirmed,
    nearMiss,
    thresholdEdge,
    accumVerdict,
    rebuilds,
    overallStatus: confirmed > 0 ? 'CANDIDATES PRODUCED' : 'NO CANDIDATES',
  });
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function runOnce() {
  if (!refreshSession()) {
    log('No active session found.');
    return;
  }
  await checkWatchdog();
  await checkCandidates();
}

async function main() {
  if (!NOTIFY_ENABLED) {
    log('DISCORD_NOTIFY_ENABLED=false — exiting.');
    return;
  }
  if (DRY_RUN) log('DRY-RUN mode — no Discord calls will be made.');

  // Startup announcement
  if (STARTUP_FLAG) {
    refreshSession();
    if (_state.sessionId) await sendStartupNotification(_state.sessionId);
    if (!LOOP_SECS) return;
  }

  // Stop summary
  if (STOP_SESSION_PATH) {
    await sendStopSummary(STOP_SESSION_PATH);
    return;
  }

  // Loop or single-shot
  if (LOOP_SECS > 0) {
    log(`Polling every ${LOOP_SECS}s. Ctrl+C to stop.`);
    await runOnce();
    setInterval(runOnce, LOOP_SECS * 1000);
  } else {
    await runOnce();
  }
}

main().catch(err => {
  process.stderr.write(`[notification_router] fatal: ${err.message}\n`);
  process.exit(1);
});
