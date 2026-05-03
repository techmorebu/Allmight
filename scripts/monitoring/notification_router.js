// scripts/monitoring/notification_router.js
// ═══════════════════════════════════════════════════════════════════════════════
//
// AllMight Notification Router
// Reads pipeline logs → sends plain-text Discord alerts.
//
// Channels:
//   OPS       — startup, heartbeat (every 5 min), DEGRADED/FAILED watchdog alerts
//   CANDIDATE — first EXECUTION_READY in session, burst thresholds
//   SUMMARY   — session stop report
//
// Patches applied:
//   duration fix   — scan activator.jsonl for first/last JSON record with ts field;
//                    skip [supervisor] text lines (was crashing JSON.parse on line 0)
//   cumulative fix — read session_totals.json for cross-restart totals; show
//                    cumulBlock in heartbeat when restartCount > 0
//
// READ-ONLY — never writes to pipeline logs.
// FAIL-SILENT — Discord errors never propagate to callers.
//
// USAGE
// ─────
//   # Continuous polling (every N seconds; default=60 if no --loop flag)
//   node -r dotenv/config scripts/monitoring/notification_router.js --loop 300
//
//   # Announce system startup
//   node -r dotenv/config scripts/monitoring/notification_router.js --startup
//
//   # Send stop summary from a session folder
//   node -r dotenv/config scripts/monitoring/notification_router.js \
//     --stop-summary logs/sessions/session_20260426_2209
//
//   # Dry-run (evaluate rules, print what would be sent, no Discord calls)
//   node -r dotenv/config scripts/monitoring/notification_router.js --dry-run
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── DISCORD SENDER ───────────────────────────────────────────────────────────
// Plain text payloads only — embed fields fail silently on this Discord setup.

const NOTIFY_ENABLED  = process.env.DISCORD_NOTIFY_ENABLED !== 'false';
const OPS_WEBHOOK     = process.env.DISCORD_OPS_WEBHOOK_URL       || '';
const CANDIDATE_WEBHOOK = process.env.DISCORD_CANDIDATE_WEBHOOK_URL || '';
const SUMMARY_WEBHOOK = process.env.DISCORD_SUMMARY_WEBHOOK_URL   || '';

async function _send(webhookUrl, text, retries = 3) {
  if (!NOTIFY_ENABLED) return;
  const url = String(webhookUrl || '').trim();
  if (!url || url.includes('YOUR_')) return;
  const fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchFn(url, {
        method  : 'POST',
        headers : { 'Content-Type': 'application/json' },
        body    : JSON.stringify({ content: text }),
        signal  : AbortSignal.timeout(8000), // 8s hard timeout per attempt
      });
      if (res.ok) return; // success
      // 429 = rate limit — wait longer; 5xx = Discord outage — retry
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) {
        log(`Discord send failed: HTTP ${res.status} (attempt ${attempt}/${retries})`);
        return;
      }
      const delay = res.status === 429 ? 5000 : 2000 * attempt;
      log(`Discord HTTP ${res.status} — retrying in ${delay}ms (attempt ${attempt}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
    } catch (e) {
      if (attempt === retries) {
        log(`Discord send error after ${retries} attempts: ${e.message?.slice(0,60)}`);
        return;
      }
      const delay = 2000 * attempt; // 2s, 4s backoff
      log(`Discord error — retrying in ${delay}ms (attempt ${attempt}/${retries}): ${e.message?.slice(0,40)}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

async function sendOpsNotification(text)       { await _send(OPS_WEBHOOK,       text); }
async function sendCandidateNotification(text) { await _send(CANDIDATE_WEBHOOK, text); }
async function sendSummaryNotification(text)   { await _send(SUMMARY_WEBHOOK,   text); }

// ─── CONFIG FROM ENV / CLI ────────────────────────────────────────────────────

const DRY_RUN           = process.argv.includes('--dry-run');
const STARTUP_FLAG      = process.argv.includes('--startup');
const STOP_IDX          = process.argv.indexOf('--stop-summary');
const STOP_SESSION_PATH = STOP_IDX !== -1 ? process.argv[STOP_IDX + 1] : null;
const LOOP_IDX          = process.argv.indexOf('--loop');
const LOOP_SECS         = LOOP_IDX !== -1 ? (parseInt(process.argv[LOOP_IDX + 1], 10) || 300) : 0;

const HEARTBEAT_SEC    = parseInt(process.env.DISCORD_HEARTBEAT_SEC    || '300',  10); // 5 min
const COOLDOWN_SEC     = parseInt(process.env.DISCORD_NOTIFY_COOLDOWN_SEC || '300', 10);
const CAND_COUNT_ALERT = parseInt(process.env.DISCORD_NOTIFY_CANDIDATE_COUNT || '10', 10);
const MIN_CONFIDENCE   = parseFloat(process.env.DISCORD_NOTIFY_MIN_CONFIDENCE || '0.65');

const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
const SESSION_FILE = path.join(LOGS_DIR, 'allmight.session');

// ─── STATE (ephemeral — reset on router restart; that's fine) ─────────────────

const _state = {
  sessionId             : null,
  sessionDir            : null,
  firstCandidateSent    : false,
  candidateCount        : 0,
  candidateCountAlerted : 0,
  lastWatchdogStatus    : 'HEALTHY',
  lastWatchdogAlert     : 0,
  lastWatchdogLine      : 0,
  lastActivatorLine     : 0,
  lastHeartbeatSent     : 0,
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
    try { records.push(JSON.parse(t)); } catch { /* skip non-JSON lines */ }
  }
  return { records, nextByte: size };
}

function cooldownExpired(lastTs) {
  return (Date.now() - lastTs) >= COOLDOWN_SEC * 1000;
}

async function maybeSend(channel, fn, text) {
  if (DRY_RUN) {
    log(`[DRY-RUN] → ${channel}: ${text.slice(0, 120).replace(/\n/g, ' ')}`);
    return;
  }
  if (!NOTIFY_ENABLED) return;
  try { await fn(text); } catch { /* fail-silent */ }
}

function loadSessionTotals(sessionDir) {
  if (!sessionDir) return null;
  const p = path.join(sessionDir, 'session_totals.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ─── SESSION DISCOVERY ────────────────────────────────────────────────────────

function refreshSession() {
  if (!fs.existsSync(SESSION_FILE)) return false;
  const newId = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  if (newId !== _state.sessionId) {
    log(`Session changed: ${_state.sessionId ?? 'none'} → ${newId}`);
    _state.sessionId             = newId;
    _state.sessionDir            = path.join(LOGS_DIR, 'sessions', `session_${newId}`);
    _state.firstCandidateSent    = false;
    _state.candidateCount        = 0;
    _state.candidateCountAlerted = 0;
    _state.lastWatchdogStatus    = 'HEALTHY';
    _state.lastWatchdogAlert     = 0;
    _state.lastWatchdogLine      = 0;
    _state.lastActivatorLine     = 0;
    _state.lastHeartbeatSent     = 0;
    return true; // session changed
  }
  return false;
}

// ─── TIER 1 — SESSION HEARTBEAT ───────────────────────────────────────────────
// Reads activator.jsonl and session_totals.json; sends a snapshot to OPS channel.

async function sendHeartbeat() {
  if (!_state.sessionDir || !_state.sessionId) return;

  const now = Date.now();
  if ((now - _state.lastHeartbeatSent) < HEARTBEAT_SEC * 1000) return;
  _state.lastHeartbeatSent = now;

  try {
    const actPath = path.join(_state.sessionDir, 'activator.jsonl');
    if (!fs.existsSync(actPath)) return;

    // ── Runtime (duration fix: scan for first/last JSON record with ts field) ──
    // activator.jsonl line 0 is often a raw "[supervisor] Start #N" text line —
    // must skip all non-JSON lines and find the first/last record that has a ts.
    const actContent = fs.readFileSync(actPath, 'utf8');
    const actLines   = actContent.split('\n').filter(Boolean);

    let firstTs = null, lastTs = null;
    let signals = 0;
    for (const line of actLines) {
      try {
        const r = JSON.parse(line);
        if (r.ts) { if (!firstTs) firstTs = r.ts; lastTs = r.ts; }
        if (r.type === 'EXECUTION_READY' || r.type === 'signal' || r.type === 'heartbeat') {
          signals++;
        }
      } catch { /* skip non-JSON supervisor text lines */ }
    }

    const runtimeH = (firstTs && lastTs)
      ? ((new Date(lastTs) - new Date(firstTs)) / 3_600_000).toFixed(1)
      : '?';

    // ── Confirmed signals (count EXECUTION_READY events for live proxy) ─────
    let confirmed = 0;
    let confirmedSource = 'estimate';
    for (const line of actLines) {
      try {
        const r = JSON.parse(line);
        if (r.type === 'EXECUTION_READY') { confirmed++; confirmedSource = 'live'; }
      } catch { /* skip */ }
    }

    // ── Capture rate ───────────────────────────────────────────────────────
    const captureRatePct = signals > 0
      ? (confirmed / signals * 100).toFixed(1)
      : '?';

    // ── Watchdog status ────────────────────────────────────────────────────
    let watchdogStatus = _state.lastWatchdogStatus;
    const wdPath = path.join(_state.sessionDir, 'watchdog.jsonl');
    if (fs.existsSync(wdPath)) {
      const wdLines = fs.readFileSync(wdPath, 'utf8').split('\n').filter(Boolean);
      for (let i = wdLines.length - 1; i >= 0; i--) {
        try {
          const r = JSON.parse(wdLines[i]);
          if (r.overallStatus) { watchdogStatus = r.overallStatus; break; }
        } catch { /* skip */ }
      }
    }

    // ── Cumulative value fix: read session_totals.json ──────────────────────
    // session_totals.json tracks true cross-restart totals written by activator.
    // During a live session totalConfirmed == totalSignals (best available proxy).
    const st = loadSessionTotals(_state.sessionDir);

    // Use cumulative totals for value display when restarts have occurred
    let estValue, valuePerHr;
    if (st && st.totalEstValueUsd != null && st.totalRuntimeMs > 0) {
      estValue   = st.totalEstValueUsd.toFixed(2);
      valuePerHr = (st.totalEstValueUsd / (st.totalRuntimeMs / 3_600_000)).toFixed(2);
    } else {
      // Fallback: rough estimate from confirmed count
      const runtimeNum = parseFloat(runtimeH) || 1;
      estValue   = (confirmed * 0.15).toFixed(2);
      valuePerHr = runtimeNum > 0 ? (confirmed * 0.15 / runtimeNum).toFixed(2) : '?';
    }

    // ── Cumulative block (shown only when restarts have occurred) ──────────
    let cumulBlock = null;
    if (st && st.restartCount > 0) {
      const trueConfirmed = st.totalConfirmed ?? confirmed;
      const trueValueHr   = st.totalRuntimeMs > 0
        ? `$${(st.totalEstValueUsd / (st.totalRuntimeMs / 3_600_000)).toFixed(2)}/h`
        : '?';
      cumulBlock = [
        `─── Cross-restart totals ─────`,
        `Restarts: ${st.restartCount}`,
        `Total confirmed: ${trueConfirmed.toLocaleString()}`,
        `Total value: $${(st.totalEstValueUsd || 0).toFixed(2)}`,
        `Value/true-hr: ${trueValueHr}`,
      ].join('\n');
    }

    const confirmedLabel = confirmedSource === 'live'
      ? `${confirmed.toLocaleString()} (live)`
      : `${confirmed.toLocaleString()}`;

    const statusIcon = watchdogStatus === 'HEALTHY'   ? '🟢'
                     : watchdogStatus === 'DEGRADED'  ? '🟡'
                     : watchdogStatus === 'FAILED'    ? '🔴' : '⚪';

    // ── Shadow execution section (v1 opportunity + v2 realistic) ───────────────
    let shadowBlock = null;
    try {
      const v1Path = path.join(_state.sessionDir, 'shadow_execution_totals.json');
      const v2Path = path.join(_state.sessionDir, 'shadow_execution_totals_v2.json');
      if (fs.existsSync(v1Path)) {
        const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
        const v2 = fs.existsSync(v2Path)
          ? JSON.parse(fs.readFileSync(v2Path, 'utf8'))
          : null;
        const gateIcon = v1.crossedMicro ? '🟢' : v1.crossedDryWallet ? '🟠' : v1.crossedPaper ? '🟡' : '🔴';
        const oppty    = `$${(v1.shadowTheoreticalPnLUsd || 0).toFixed(2)}`;
        const realistic = v2 ? `$${(v2.shadowRealisticTheoreticalUsd || 0).toFixed(2)}` : 'pending';
        const calibrated = v2 ? `$${(v2.shadowCalibratedEstimateUsd || 0).toFixed(2)}` : '?';
        const survivors  = v2 ? `${v2.realisticPositiveCount}/${v2.totalSignals}` : '?';
        shadowBlock = [
          `─── Shadow Execution ────────`,
          `Opportunity:  ${oppty}   Realistic: ${realistic}`,
          `Calibrated:   ${calibrated}   Friction: 5bps`,
          `Survivors:    ${survivors}  Gate: ${gateIcon} ${v1.topBlockedReason?.slice(0,25) ?? 'none'}`,
        ].join('\n');
      }
    } catch { /* fail-silent */ }

    const lines = [
      `${statusIcon} **AllMight Heartbeat** | ${_state.sessionId}`,
      `\`\`\``,
      `Runtime:   ${runtimeH}h`,
      `Signals:   ${signals.toLocaleString()}`,
      `Confirmed: ${confirmedLabel}`,
      `Capture:   ${captureRatePct}%`,
      cumulBlock || null,
      ``,
      `Est. Value:  $${estValue}`,
      `Value/hr:    $${valuePerHr}/h`,
      `Watchdog:    ${watchdogStatus}`,
      shadowBlock || null,
      `\`\`\``,
    ].filter(l => l !== null);

    await maybeSend('OPS', sendOpsNotification, lines.join('\n'));
    log(`Heartbeat sent (${runtimeH}h | ${confirmed} confirmed | $${estValue})`);
  } catch (e) {
    log(`Heartbeat error: ${e.message}`);
  }
}

// ─── TIER 2 — WATCHDOG ALERTS ─────────────────────────────────────────────────

async function checkWatchdog() {
  if (!_state.sessionDir) return;
  const wdPath = path.join(_state.sessionDir, 'watchdog.jsonl');
  const { records, nextByte } = readJsonl(wdPath, _state.lastWatchdogLine);
  _state.lastWatchdogLine = nextByte;

  for (const r of records) {
    const status = r.overallStatus;
    if (!status) continue;

    const prev = _state.lastWatchdogStatus;
    _state.lastWatchdogStatus = status;

    // Alert on DEGRADED or FAILED, with cooldown
    if ((status === 'DEGRADED' || status === 'FAILED') && cooldownExpired(_state.lastWatchdogAlert)) {
      _state.lastWatchdogAlert = Date.now();
      const warnings = (r.warnings || []).join(', ') || 'none';
      const icon     = status === 'FAILED' ? '🔴' : '🟡';
      const text = [
        `${icon} **Watchdog ${status}** | ${_state.sessionId}`,
        `\`\`\``,
        `Status:   ${status}`,
        `Previous: ${prev}`,
        `Warnings: ${warnings}`,
        `At:       ${r.ts || new Date().toISOString()}`,
        `\`\`\``,
      ].join('\n');
      await maybeSend('OPS', sendOpsNotification, text);
      log(`Watchdog alert: ${status} (was ${prev})`);
    }

    // Recovery notice
    if (prev !== 'HEALTHY' && status === 'HEALTHY' && cooldownExpired(_state.lastWatchdogAlert)) {
      _state.lastWatchdogAlert = Date.now();
      const text = `🟢 **Watchdog recovered → HEALTHY** | ${_state.sessionId}`;
      await maybeSend('OPS', sendOpsNotification, text);
      log(`Watchdog recovered: ${prev} → HEALTHY`);
    }
  }
}

// ─── TIER 3 — CANDIDATE ALERTS ────────────────────────────────────────────────

async function checkCandidates() {
  if (!_state.sessionDir) return;
  const actPath = path.join(_state.sessionDir, 'activator.jsonl');
  const { records, nextByte } = readJsonl(actPath, _state.lastActivatorLine);
  _state.lastActivatorLine = nextByte;

  for (const r of records) {
    if (r.type !== 'EXECUTION_READY') continue;
    if (r.confidence != null && r.confidence < MIN_CONFIDENCE) continue;

    _state.candidateCount++;

    // First candidate in session
    if (!_state.firstCandidateSent) {
      _state.firstCandidateSent = true;
      const spread = r.netSpreadPct != null ? `${r.netSpreadPct.toFixed(4)}%` : '?';
      const conf   = r.confidence   != null ? r.confidence.toFixed(3)         : '?';
      const text = [
        `🎯 **First CANDIDATE** | ${_state.sessionId}`,
        `\`\`\``,
        `Spread:     ${spread}`,
        `Confidence: ${conf}`,
        `Profile:    ${r.activeProfile || 'UNKNOWN'}`,
        `Heat:       ${r.heatClass || '?'}`,
        `At:         ${r.ts || new Date().toISOString()}`,
        `\`\`\``,
      ].join('\n');
      await maybeSend('CANDIDATE', sendCandidateNotification, text);
      log(`First candidate sent (spread=${spread} conf=${conf})`);
    }

    // Count-threshold burst alerts
    if (
      _state.candidateCount >= CAND_COUNT_ALERT &&
      _state.candidateCount % CAND_COUNT_ALERT === 0 &&
      _state.candidateCount !== _state.candidateCountAlerted
    ) {
      _state.candidateCountAlerted = _state.candidateCount;
      const st       = loadSessionTotals(_state.sessionDir);
      const valueStr = st ? `$${(st.totalEstValueUsd || 0).toFixed(2)}` : 'tracking...';
      const text = [
        `📈 **${_state.candidateCount} Candidates** | ${_state.sessionId}`,
        `\`\`\``,
        `Count:    ${_state.candidateCount}`,
        `Est. val: ${valueStr}`,
        `At:       ${r.ts || new Date().toISOString()}`,
        `\`\`\``,
      ].join('\n');
      await maybeSend('CANDIDATE', sendCandidateNotification, text);
      log(`Burst alert: ${_state.candidateCount} candidates`);
    }
  }
}

// ─── STARTUP MESSAGE ──────────────────────────────────────────────────────────

async function sendStartupMessage() {
  const sessionId = fs.existsSync(SESSION_FILE)
    ? fs.readFileSync(SESSION_FILE, 'utf8').trim()
    : 'UNKNOWN';
  const text = [
    `🚀 **AllMight Started** | ${sessionId}`,
    `\`\`\``,
    `At: ${new Date().toISOString()}`,
    `\`\`\``,
  ].join('\n');
  await maybeSend('OPS', sendOpsNotification, text);
  log(`Startup message sent (session=${sessionId})`);
}

// ─── STOP SUMMARY ─────────────────────────────────────────────────────────────

async function sendStopSummary(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');
  log(`Building stop summary for ${sessionId}...`);

  // Duration — duration fix: scan for first/last JSON record with ts field
  let durationH = '?';
  const actPath = path.join(sessionDir, 'activator.jsonl');
  if (fs.existsSync(actPath)) {
    try {
      const lines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
      let firstTs = null, lastTs = null;
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (r.ts) { if (!firstTs) firstTs = r.ts; lastTs = r.ts; }
        } catch { /* skip [supervisor] text lines */ }
      }
      if (firstTs && lastTs) {
        durationH = ((new Date(lastTs) - new Date(firstTs)) / 3_600_000).toFixed(1);
      }
    } catch { /* skip */ }
  }

  // Signals + confirmed
  let signals = 0, confirmed = 0;
  if (fs.existsSync(actPath)) {
    try {
      const lines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (r.type === 'EXECUTION_READY') { signals++; confirmed++; }
          else if (r.type === 'heartbeat' || r.type === 'signal') { signals++; }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Cumulative totals from session_totals.json (cross-restart truth)
  const st = loadSessionTotals(sessionDir);
  const totalValue   = st ? st.totalEstValueUsd : confirmed * 0.15;
  const totalConf    = st ? st.totalConfirmed   : confirmed;
  const restartCount = st ? st.restartCount     : 0;
  const totalRunH    = st && st.totalRuntimeMs
    ? (st.totalRuntimeMs / 3_600_000).toFixed(1)
    : durationH;
  const valueHr = parseFloat(totalRunH) > 0
    ? (totalValue / parseFloat(totalRunH)).toFixed(2)
    : '?';

  const captureRatePct = signals > 0
    ? (confirmed / signals * 100).toFixed(1)
    : '?';

  // Shadow execution summary — v1 (opportunity) + v2 (realistic)
  let shadowStopLines = [];
  try {
    const v1Path = path.join(sessionDir, 'shadow_execution_totals.json');
    const v2Path = path.join(sessionDir, 'shadow_execution_totals_v2.json');
    if (fs.existsSync(v1Path)) {
      const v1 = JSON.parse(fs.readFileSync(v1Path, 'utf8'));
      const v2 = fs.existsSync(v2Path)
        ? JSON.parse(fs.readFileSync(v2Path, 'utf8'))
        : null;
      const gateIcon = v1.crossedMicro ? '🟢' : v1.crossedDryWallet ? '🟠' : v1.crossedPaper ? '🟡' : '🔴';
      const vhr = v1.shadowEstimatedValuePerHour != null
        ? `$${v1.shadowEstimatedValuePerHour.toFixed(3)}/h` : '?';
      shadowStopLines = [
        ``,
        `─── Shadow Execution ──────────────────`,
        `Opportunity:      $${(v1.shadowTheoreticalPnLUsd||0).toFixed(3)}   (all viable, gate ignored)`,
        `Realistic:        ${v2 ? `$${(v2.shadowRealisticTheoreticalUsd||0).toFixed(3)}` : 'pending'}   (5bps friction applied)`,
        `Calibrated:       ${v2 ? `$${(v2.shadowCalibratedEstimateUsd||0).toFixed(3)}` : '?'}   (×sandbox rate)`,
        `Survivors:        ${v2 ? `${v2.realisticPositiveCount}/${v2.totalSignals} (${v2.realisticSurvivalRate}%)` : '?'}`,
        `Gate Peak:        ${gateIcon} ${v1.crossedMicro ? 'MICRO' : v1.crossedDryWallet ? 'DRY_WALLET' : v1.crossedPaper ? 'PAPER' : 'BLOCK'}`,
        `Best Score:       ${v1.maxExecutionScore}  Avg: ${v1.avgExecutionScore}`,
        `Main Blocker:     ${v1.topBlockedReason?.slice(0,38) ?? 'none'}`,
        ...(v2 ? [
          `Direction (v2):   ${v2.v2DirectionAccuracyPct}%  FP: ${v2.v2FalsePositive}  FN: ${v2.v2FalseNegative}`,
          `FP reduction:     ${v2.falsePositiveReduction}%  (${v2.v1FalsePositive} → ${v2.v2FalsePositive})`,
        ] : []),
      ];
    }
  } catch { /* fail-silent */ }

  // Dry run section — fail-soft if file missing (fork runner not always run)
  let dryRunLines = [];
  try {
    const drPath = path.join(sessionDir, 'shadow_dryrun_totals.json');
    if (fs.existsSync(drPath)) {
      const dr = JSON.parse(fs.readFileSync(drPath, 'utf8'));
      if (dr.available) {
        const sr   = dr.executionSuccessRate != null ? `${dr.executionSuccessRate}%` : '?';
        const pnl  = dr.expectedExecutablePnL != null ? `$${dr.expectedExecutablePnL.toFixed(3)}` : '?';
        const gas  = dr.avgGasCostUsd != null ? `$${dr.avgGasCostUsd.toFixed(4)}` : '?';
        const fund = dr.fundingStatus ?? '?';
        dryRunLines = [
          ``,
          `─── Dry Execution (callStatic fork) ────`,
          `Executable:   ${dr.wouldExecuteCount}/${dr.attempted}  (${sr})`,
          `ExecutablePnL:${pnl}   AvgGas: ${gas}`,
          `Funding:      ${fund}   ForkResets: ${dr.forkResetFailedCount ?? 0} failed`,
          `Readiness:    ${(dr.readinessAssessment ?? '?').slice(0, 45)}`,
        ];
      } else if (dr.unavailableReason) {
        dryRunLines = [``, `─── Dry Execution ──────────────────────`,
          `Status: pending — ${dr.unavailableReason.slice(0, 50)}`];
      }
    }
  } catch { /* fail-silent */ }

  const text = [
    `🛑 **Session Stop** | ${sessionId}`,
    `\`\`\``,
    `Duration:    ${durationH}h`,
    `Signals:     ${signals.toLocaleString()}`,
    `Confirmed:   ${totalConf.toLocaleString()} (live proxy)`,
    `Capture:     ${captureRatePct}%`,
    `Restarts:    ${restartCount}`,
    ``,
    `Est. Value:  $${totalValue.toFixed(2)}`,
    `Value/hr:    $${valueHr}/h`,
    ...shadowStopLines,
    ...dryRunLines,
    `\`\`\``,
  ].join('\n');

  await maybeSend('SUMMARY', sendSummaryNotification, text);
  log(`Stop summary sent (session=${sessionId} duration=${durationH}h value=$${totalValue.toFixed(2)})`);
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function runOnce() {
  const sessionChanged = refreshSession();
  if (_state.sessionId) {
    await sendHeartbeat();
    await checkWatchdog();
    await checkCandidates();
  }
}

async function main() {
  log(`Starting (NOTIFY_ENABLED=${NOTIFY_ENABLED} DRY_RUN=${DRY_RUN} LOOP_SECS=${LOOP_SECS})`);

  if (STARTUP_FLAG) {
    await sendStartupMessage();
  }

  if (STOP_SESSION_PATH) {
    await sendStopSummary(path.resolve(STOP_SESSION_PATH));
    return;
  }

  // One-shot mode
  if (!LOOP_SECS) {
    await runOnce();
    return;
  }

  // Continuous polling mode
  // If --startup flag was set, skip the immediate first runOnce() —
  // the startup message already served as the launch notification.
  // This prevents the double-message on session start.
  if (!STARTUP_FLAG) {
    await runOnce();
  }
  setInterval(runOnce, LOOP_SECS * 1000);
}

main().catch(e => {
  log(`Fatal: ${e.message}`);
  process.exit(1);
});
