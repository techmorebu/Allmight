'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Notification Router  v2.0
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
//  3-TIER NOTIFICATION SYSTEM (v2.0)
//  ────────────────────────────────────
//  TIER 1 — HEARTBEAT (every HEARTBEAT_SEC, default 300s)
//    Session snapshot: runtime, signals, confirmed, capture rate,
//    estimated value, value/hour, mode, infra status.
//    Sent to: summary channel.
//
//  TIER 2 — EVENT ALERTS (only when meaningful)
//    A. Operating mode change (STANDARD ↔ CONSERVATIVE ↔ PAUSE)
//    B. Activator silence > 10 min
//    C. Watchdog DEGRADED or FAILED
//    D. High-value burst (5+ confirmed trades in last 10 min)
//    Sent to: ops channel.
//
//  TIER 3 — SESSION SUMMARY (on --stop-summary)
//    Full session digest: duration, candidates, capture, value, anomalies.
//    Sent to: summary channel.
//
//  NEVER SENT (spam prevention):
//    - Every EXECUTION_READY signal
//    - Every blueprint
//    - Every near-miss
//    - Every raw RPC event
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

// ── TIER 1 — HEARTBEAT CONFIG ────────────────────────────────────────────────
// Default 300s (5 min). Set DISCORD_HEARTBEAT_SEC=600 for 10-min heartbeat.
const HEARTBEAT_SEC = parseInt(process.env.DISCORD_HEARTBEAT_SEC || '300', 10);

// ── TIER 2 — EVENT ALERT CONFIG ──────────────────────────────────────────────
// High-value burst: fire if >= N confirmed candidates in last BURST_WINDOW_SEC
const BURST_COUNT_THRESHOLD = parseInt(process.env.DISCORD_BURST_COUNT   || '5',   10);
const BURST_WINDOW_SEC      = parseInt(process.env.DISCORD_BURST_WINDOW  || '600', 10);

const LOGS_DIR        = path.resolve(process.cwd(), 'logs');
const SESSIONS_DIR    = path.join(LOGS_DIR, 'sessions');   // v1.5+ layout
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
  // v2 additions
  lastHeartbeatSent      : 0,          // timestamp of last heartbeat message
  lastKnownMode          : null,       // for mode-change detection
  lastBurstAlert         : 0,          // timestamp of last burst alert
  sessionStartMs         : null,       // when session was first seen
  recentConfirmedTs      : [],         // timestamps of recent confirmed records (for burst)
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
    _state.sessionDir            = path.join(SESSIONS_DIR, `session_${newId}`);
    _state.firstCandidateSent    = false;
    _state.candidateCount        = 0;
    _state.candidateCountAlerted = 0;
    _state.lastWatchdogStatus    = 'HEALTHY';
    _state.lastWatchdogAlert     = 0;
    _state.lastWatchdogLine      = 0;
    _state.lastAuditLine         = 0;
    // v2 additions
    _state.lastHeartbeatSent     = 0;
    _state.lastKnownMode         = null;
    _state.lastBurstAlert        = 0;
    _state.sessionStartMs        = Date.now();
    _state.recentConfirmedTs     = [];
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

      // Derive primary component and issue for Boss format
      const primaryStale = (rec.staleComponents || [])[0]?.split(':')[0] || 'pipeline';
      const primaryIssue = stale !== 'none' ? `stale output (${stale})` : dead !== 'none' ? `process not found (${dead})` : warnings;

      const extraFields = [];
      if (dead !== 'none') extraFields.push({ name: 'Dead PIDs',   value: dead   });
      if (warnings !== 'none') extraFields.push({ name: 'Warnings', value: warnings });

      log(`Sending watchdog ${status} alert`);
      await maybeSend('ops', sendOpsNotification, {
        title    : `${icon}  SYSTEM ${status} — ${_state.sessionId}`,
        status,
        component: primaryStale,
        issue    : primaryIssue,
        rebuilds : `${rec.rebuildSuccessCount ?? 0} ok / ${rec.rebuildFailCount ?? 0} fail`,
        description: status === 'FAILED' ? 'Manual intervention may be required.' : null,
        fields   : extraFields,
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
  if (!_state.sessionDir) return [];
  const auditPath = path.join(_state.sessionDir, 'execution_candidate_audit.jsonl');
  const { records, nextByte } = readJsonl(auditPath, _state.lastAuditLine);
  _state.lastAuditLine = nextByte;

  const newConfirmedRecs = [];

  for (const rec of records) {
    if (rec.auditVerdict !== 'CANDIDATE_CONFIRMED') continue;
    newConfirmedRecs.push(rec);
    if ((rec.executionConfidence ?? 0) < MIN_CONFIDENCE) continue;

    _state.candidateCount++;

    // First candidate in session
    if (!_state.firstCandidateSent) {
      log(`Sending first candidate alert (conf=${rec.executionConfidence})`);
      await maybeSend('candidate', sendCandidateNotification, {
        pair               : rec.pair,
        spreadPct          : rec.spreadPct,
        expectedEdgePct    : rec.expectedEdgePct ?? rec.finalEdge,
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

  // Session duration from activator log first/last ts.
  // Lines[0] is often a raw "[supervisor]" text line (not JSON) — scan for
  // the first and last parseable record that carries a ts field.
  let durationH = '?';
  const actPath = path.join(sessionDir, 'activator.jsonl');
  if (fs.existsSync(actPath)) {
    try {
      const lines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
      let firstTs = null, lastTs = null;
      for (const line of lines) {
        try { const r = JSON.parse(line); if (r.ts) { if (!firstTs) firstTs = r.ts; lastTs = r.ts; } }
        catch { /* skip non-JSON supervisor lines */ }
      }
      if (firstTs && lastTs) {
        durationH = ((new Date(lastTs) - new Date(firstTs)) / 3_600_000).toFixed(1);
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

// ─── RULE 3 — ACTIVATOR HEARTBEAT CHECK ──────────────────────────────────────
//
// Detect when the activator has gone silent — i.e., no heartbeat record written
// to activator.jsonl for longer than ACTIVATOR_SILENCE_SEC.
//
// This fires even if the watchdog is not running, providing a safety net for the
// case where the activator exits cleanly but nobody is watching.
//
// Alert fires at most once per COOLDOWN_SEC to prevent spam after recovery.

const ACTIVATOR_SILENCE_SEC = parseInt(
  process.env.ACTIVATOR_HEARTBEAT_SILENCE_SEC || '600', 10  // 10 min default
);

async function checkActivatorHeartbeat() {
  if (!_state.sessionDir) return;
  const actPath = path.join(_state.sessionDir, 'activator.jsonl');
  if (!fs.existsSync(actPath)) return;

  try {
    const stat = fs.statSync(actPath);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;

    if (ageSec > ACTIVATOR_SILENCE_SEC) {
      if (!cooldownExpired(_state.lastWatchdogAlert)) return;  // respect cooldown

      const ageMin = (ageSec / 60).toFixed(1);
      log(`Activator silent for ${ageMin} min — sending alert`);
      await maybeSend('ops', sendOpsNotification, {
        title      : `💀  ACTIVATOR SILENT — ${_state.sessionId}`,
        status     : 'FAILED',
        component  : 'activator',
        issue      : `No output for ${ageMin} minutes (threshold ${ACTIVATOR_SILENCE_SEC / 60}m)`,
        rebuilds   : 'unknown — activator not writing',
        description: 'Activator may have exited. Check process status and restart if needed.',
        fields     : [
          { name: 'Session',    value: _state.sessionId },
          { name: 'Last write', value: `${ageMin} minutes ago` },
          { name: 'Action',     value: 'bash scripts/tools/start_all.sh restart-activator' },
        ],
      });
      _state.lastWatchdogAlert = Date.now();
    }
  } catch { /* fail-silent */ }
}


// ─── TIER 1 — SESSION HEARTBEAT ───────────────────────────────────────────────
//
// Sends a clean session snapshot every HEARTBEAT_SEC.
// Reads live session files — reads everything from scratch each time (not incremental)
// so the snapshot always reflects current totals, not just recent deltas.

async function sendHeartbeat() {
  if (!_state.sessionDir || !_state.sessionId) return;

  const now = Date.now();
  if ((now - _state.lastHeartbeatSent) < HEARTBEAT_SEC * 1000) return;

  try {
    const actPath   = path.join(_state.sessionDir, 'activator.jsonl');
    const auditPath = path.join(_state.sessionDir, 'execution_candidate_audit.jsonl');
    if (!fs.existsSync(actPath)) return;

    // ── Fix 2: Read activator.jsonl using correct field names ─────────────────
    // The activator heartbeat uses readySignals/simRuns/ticks — not signal/confirmed.
    // We scan all lines for:
    //   - firstTs/lastTs  : session runtime bounds
    //   - signals         : count of type==='signal' records (EXECUTION_READY events)
    //   - latestHB        : most recent heartbeat record (for live surface stats)
    const actLines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
    let firstTs = null, lastTs = null;
    let signals = 0;
    let latestHB = null;  // most recent activator heartbeat record
    for (const line of actLines) {
      try {
        const r = JSON.parse(line);
        if (r.ts) { if (!firstTs) firstTs = r.ts; lastTs = r.ts; }
        if (r.type === 'signal') signals++;
        // Capture latest heartbeat for live surface metrics
        if (r.type === 'heartbeat') latestHB = r;
      } catch { /* skip */ }
    }

    // Fix 4: Real-time candidate count ─────────────────────────────────────────
    // execution_candidate_audit.jsonl only exists after the stop pipeline runs.
    // During a live session use readySignals from the latest activator heartbeat
    // as a real-time proxy. Switch to audit count once the file exists.
    let confirmed = 0;
    let confirmedSource = 'live';
    if (fs.existsSync(auditPath)) {
      // Stop pipeline has run — use the definitive audit count
      const auditContent = fs.readFileSync(auditPath, 'utf8');
      confirmed = (auditContent.match(/"CANDIDATE_CONFIRMED"/g) || []).length;
      confirmedSource = 'audit';
    } else if (latestHB) {
      // Live session — use readySignals from the latest activator heartbeat
      // readySignals = signals that passed the ready-check gate (best live proxy)
      confirmed = latestHB.readySignals ?? latestHB.simRuns ?? 0;
      confirmedSource = 'live';
    }

    const runtimeH = (firstTs && lastTs)
      ? ((new Date(lastTs) - new Date(firstTs)) / 3_600_000).toFixed(1)
      : '?';

    // Adaptive capture rate
    const captureRatePct = signals > 0 ? (confirmed / signals * 100).toFixed(1) : '0.0';

    // Estimated session value: confirmed × $0.15 avg (from cross-session data)
    const estValue    = (confirmed * 0.15).toFixed(2);
    const runtimeNum  = parseFloat(runtimeH) || 1;
    const valuePerHr  = runtimeNum > 0 ? (confirmed * 0.15 / runtimeNum).toFixed(2) : '0.00';

    // Live surface stats from latest activator heartbeat (Fix 2)
    const liveSpreadBps  = latestHB ? (latestHB.netSpreadFrac  ? (latestHB.netSpreadFrac  * 10000).toFixed(1) : '?') : '?';
    const liveHeatClass  = latestHB ? (latestHB.heatClass       ?? '?')  : '?';
    const liveTicks      = latestHB ? (latestHB.ticks            ?? '?')  : '?';
    const liveRegime     = latestHB ? (latestHB.regime           ?? '?')  : '?';

    // Current policy mode
    let modeStr = 'UNKNOWN';
    try {
      const { evaluatePolicy, measureSession } = require('../tools/session_policy_check');
      const metrics = measureSession(_state.sessionDir);
      const policy  = evaluatePolicy(metrics);
      modeStr = policy.mode;
    } catch {
      // session_policy_check not importable — read infra grade from watchdog
      const wdPath = path.join(_state.sessionDir, 'watchdog.jsonl');
      if (fs.existsSync(wdPath)) {
        const wdLines = fs.readFileSync(wdPath, 'utf8').split('\n').filter(Boolean);
        if (wdLines.length) {
          try { modeStr = JSON.parse(wdLines[wdLines.length-1]).overallStatus ?? 'UNKNOWN'; }
          catch { /* skip */ }
        }
      }
    }

    // Infra status from watchdog last record
    let infraStr = 'UNKNOWN';
    const wdPath = path.join(_state.sessionDir, 'watchdog.jsonl');
    if (fs.existsSync(wdPath)) {
      try {
        const wdLines = fs.readFileSync(wdPath, 'utf8').split('\n').filter(Boolean);
        if (wdLines.length) infraStr = JSON.parse(wdLines[wdLines.length-1]).overallStatus ?? 'UNKNOWN';
      } catch { /* skip */ }
    }

    const confirmedLabel = confirmedSource === 'live' ? `${confirmed} (live)` : `${confirmed}`;
    const body = [
      `Runtime: ${runtimeH}h`,
      `Signals: ${signals.toLocaleString()}`,
      `Confirmed: ${confirmedLabel}`,
      `Capture: ${captureRatePct}%`,
      ``,
      `Est. Value: $${estValue}`,
      `Value/hr: $${valuePerHr}`,
      ``,
      `Spread: ${liveSpreadBps}bps  Heat: ${liveHeatClass}`,
      `Ticks: ${liveTicks}  Regime: ${liveRegime}`,
      ``,
      `Mode: ${modeStr} ($500 max)`,
      `Infra: ${infraStr}`,
    ].join('\n');

    log(`Sending heartbeat (${runtimeH}h runtime, ${confirmedLabel} confirmed [${confirmedSource}])`);
    await maybeSend('ops', (opts) =>
      require('./discord_notifier').sendEmbed('ops', {
        title      : `📡  SESSION STATUS — ${_state.sessionId}`,
        description: body,
        color      : 0x5DADE2,
      }), {});

    _state.lastHeartbeatSent = Date.now();
  } catch (err) {
    // fail-silent
    process.stderr.write(`[notification_router] heartbeat error: ${err.message}\n`);
  }
}

// ─── TIER 2 — MODE CHANGE ALERT ───────────────────────────────────────────────

async function checkModeChange() {
  if (!_state.sessionDir) return;

  let currentMode = null;
  try {
    // Try to get mode from session_policy_check module
    const { evaluatePolicy, measureSession } = require('../tools/session_policy_check');
    const metrics = measureSession(_state.sessionDir);
    currentMode = evaluatePolicy(metrics).mode;
  } catch {
    return;  // module not available — skip silently
  }

  if (!currentMode) return;

  const prev = _state.lastKnownMode;
  _state.lastKnownMode = currentMode;

  // No alert on first poll or no change
  if (!prev || prev === currentMode) return;

  const icon = currentMode === 'PAUSE' ? '🛑' : currentMode === 'CONSERVATIVE' ? '⬇️' : '⬆️';
  const direction = `${prev} → ${currentMode}`;

  log(`Mode change detected: ${direction}`);
  await maybeSend('ops', (opts) =>
    require('./discord_notifier').sendEmbed('ops', {
      title      : `${icon}  MODE CHANGE — ${_state.sessionId}`,
      description: [
        `**${direction}**`,
        ``,
        currentMode === 'PAUSE'        ? 'Operation suspended. Investigate immediately.' :
        currentMode === 'CONSERVATIVE' ? 'Reduced to $300 max. Infrastructure or warmup issue.' :
        currentMode === 'STANDARD'     ? 'Restored to $500 max operating mode.' :
                                         `Now in ${currentMode} mode.`,
        ``,
        `Run: node scripts/tools/session_policy_check.js`,
      ].join('\n'),
      color: currentMode === 'PAUSE' ? 0xED4245 : currentMode === 'STANDARD' ? 0x57F287 : 0xFEE75C,
    }), {});
}

// ─── TIER 2 — HIGH-VALUE BURST ALERT ─────────────────────────────────────────
//
// Fire when >= BURST_COUNT_THRESHOLD confirmed candidates arrive in BURST_WINDOW_SEC.
// Reads recent confirmed records from audit log.

async function checkBurst(newConfirmed) {
  if (!newConfirmed.length) return;

  const now = Date.now();

  // Add new confirmed timestamps
  for (const rec of newConfirmed) {
    const ts = rec.ts ? new Date(rec.ts).getTime() : now;
    _state.recentConfirmedTs.push(ts);
  }

  // Trim to burst window
  const windowStart = now - BURST_WINDOW_SEC * 1000;
  _state.recentConfirmedTs = _state.recentConfirmedTs.filter(t => t >= windowStart);

  if (_state.recentConfirmedTs.length < BURST_COUNT_THRESHOLD) return;
  if ((now - _state.lastBurstAlert) < BURST_WINDOW_SEC * 1000) return;  // cooldown

  const nets = newConfirmed
    .filter(r => r.baseNetProfitUsd != null)
    .map(r => r.baseNetProfitUsd);
  const avgNet = nets.length ? (nets.reduce((a,b)=>a+b,0)/nets.length).toFixed(3) : '?';
  const totalVal = nets.length ? nets.reduce((a,b)=>a+b,0).toFixed(2) : '?';

  log(`High-value burst detected: ${_state.recentConfirmedTs.length} trades in ${BURST_WINDOW_SEC}s`);
  await maybeSend('candidate', (opts) =>
    require('./discord_notifier').sendEmbed('candidate', {
      title      : `🔥  HIGH-VALUE BURST — ${_state.sessionId}`,
      description: [
        `**${_state.recentConfirmedTs.length} confirmed trades** in last ${BURST_WINDOW_SEC/60}min`,
        `Avg net: $${avgNet}`,
        `Total value: $${totalVal}`,
        ``,
        `Surface is highly active.`,
      ].join('\n'),
      color: 0x57F287,
    }), {});

  _state.lastBurstAlert = now;
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function runOnce() {
  if (!refreshSession()) {
    log('No active session found.');
    return;
  }
  await checkWatchdog();
  await checkActivatorHeartbeat();
  const newConfirmed = await checkCandidates();
  await checkBurst(newConfirmed || []);
  await checkModeChange();
  await sendHeartbeat();
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
