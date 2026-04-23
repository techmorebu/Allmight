'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Session Policy Checker  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/session_policy_check.js
//  STATUS    : NEW — Boss ruling 2026-04-22 (Deployment Policy + Session Rules)
//
//  PURPOSE
//  ───────
//  Reads current session logs and outputs the approved operating mode
//  (CONSERVATIVE / STANDARD / AGGRESSIVE / PAUSE) based on real-time
//  infrastructure health and session performance metrics.
//
//  This is the single source of truth for:
//    - what mode to run right now
//    - when to escalate to a higher mode
//    - when to downgrade
//    - when to pause entirely
//
//  USAGE
//  ─────
//  # Check current session
//  node scripts/tools/session_policy_check.js
//
//  # Check specific session folder
//  node scripts/tools/session_policy_check.js --session logs/session_YYYYMMDD_HHMM
//
//  # JSON output (for automation)
//  node scripts/tools/session_policy_check.js --json
//
//  # self-test
//  node scripts/tools/session_policy_check.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS         = process.argv.slice(2);
const FLAG_TEST    = ARGS.includes('--self-test');
const FLAG_JSON    = ARGS.includes('--json');
const SESSION_IDX  = ARGS.indexOf('--session');
const SESSION_OVERRIDE = SESSION_IDX !== -1 ? ARGS[SESSION_IDX + 1] : null;

const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
const SESSION_FILE = path.join(LOGS_DIR, 'allmight.session');

// ─── POLICY THRESHOLDS ────────────────────────────────────────────────────────
//
// Derived from 3-session health analysis (Boss ruling 2026-04-22):
//
// Infrastructure health (per-hour sustained failures = stale + frozen events):
//   CLEAN:       0 sustained failures/h
//   ACCEPTABLE:  <= 2/h
//   DEGRADED:    <= 5/h
//   COMPROMISED: > 5/h   ← trigger downgrade / block escalation
//
// Provider rebuild failures:
//   0 = healthy
//   1-3 = acceptable
//   4+  = compromised
//
// Confirmed candidate rate (signals the surface is active):
//   LOW:    < 2/h  ← surface may be quiet; conservative preferred
//   NORMAL: 2–15/h ← standard operating range
//   HIGH:   > 15/h ← strong session; standard or aggressive eligible
//
// Session age: upper-band escalation only after >= 30 min confirmed data

const THRESHOLDS = {
  // Infrastructure health
  sustainedFailPerH_ACCEPTABLE  : 2,
  sustainedFailPerH_DEGRADED    : 5,
  rebuildFail_ACCEPTABLE        : 3,
  // Candidate rate
  confirmedPerH_LOW             : 2,
  confirmedPerH_HIGH            : 15,
  // Minimum session age before escalation
  minAgeHoursForEscalation      : 0.5,
  // Minimum session age before any non-conservative trading
  minAgeHoursForStandard        : 0.25,
  // Sustained silence (activator not writing) triggers PAUSE
  activatorSilenceSec           : 600,
};

// ─── SESSION LOADER ───────────────────────────────────────────────────────────

function getSessionDir() {
  if (SESSION_OVERRIDE) return SESSION_OVERRIDE;
  if (!fs.existsSync(SESSION_FILE)) return null;
  const id = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  return id ? path.join(LOGS_DIR, `session_${id}`) : null;
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, l) => {
    try { acc.push(JSON.parse(l)); } catch { /* skip */ }
    return acc;
  }, []);
}

function tsToMs(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

// ─── SESSION METRICS ──────────────────────────────────────────────────────────

function measureSession(sessionDir) {
  const actPath   = path.join(sessionDir, 'activator.jsonl');
  const auditPath = path.join(sessionDir, 'execution_candidate_audit.jsonl');

  if (!fs.existsSync(actPath)) {
    return { error: 'activator.jsonl not found', sessionDir };
  }

  const act = readJsonl(actPath);
  if (!act.length) return { error: 'activator.jsonl empty', sessionDir };

  // Session duration
  const tsList = act.map(r => tsToMs(r.ts)).filter(Boolean).sort();
  const firstMs = tsList[0];
  const lastMs  = tsList[tsList.length - 1];
  const ageMs   = Date.now() - firstMs;
  const durMs   = lastMs - firstMs;
  const durH    = durMs / 3_600_000;
  const ageH    = ageMs / 3_600_000;

  // Activator silence check (is it still running?)
  const actStat = fs.statSync(actPath);
  const silenceSec = (Date.now() - actStat.mtimeMs) / 1000;
  const activatorSilent = silenceSec > THRESHOLDS.activatorSilenceSec;

  // Infrastructure health
  const unhealthy = act.filter(r => r.type === 'STATE_UNHEALTHY');
  const sustainedFail = unhealthy.filter(r =>
    (r.reasons || []).some(s => s.includes('stale') || s.includes('frozen'))
  ).length;
  const rebuildsOk   = act.filter(r => r.type === 'provider_rebuild_success').length;
  const rebuildsFail = act.filter(r => r.type === 'provider_rebuild_failed').length;

  const sustainedPerH = durH > 0 ? sustainedFail / durH : 0;

  // Candidate rate
  const audit     = readJsonl(auditPath);
  const confirmed = audit.filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED').length;
  const confirmedPerH = durH > 0 ? confirmed / durH : 0;

  // Infrastructure quality grade
  let infraGrade;
  if (sustainedPerH === 0 && rebuildsFail === 0) {
    infraGrade = 'CLEAN';
  } else if (sustainedPerH <= THRESHOLDS.sustainedFailPerH_ACCEPTABLE &&
             rebuildsFail  <= THRESHOLDS.rebuildFail_ACCEPTABLE) {
    infraGrade = 'ACCEPTABLE';
  } else if (sustainedPerH <= THRESHOLDS.sustainedFailPerH_DEGRADED) {
    infraGrade = 'DEGRADED';
  } else {
    infraGrade = 'COMPROMISED';
  }

  return {
    sessionDir,
    ageH            : +ageH.toFixed(2),
    durH            : +durH.toFixed(2),
    silenceSec      : +silenceSec.toFixed(0),
    activatorSilent,
    sustainedFail,
    sustainedPerH   : +sustainedPerH.toFixed(2),
    rebuildsOk,
    rebuildsFail,
    infraGrade,
    confirmed,
    confirmedPerH   : +confirmedPerH.toFixed(2),
    signals         : act.filter(r => r.type === 'signal').length,
  };
}

// ─── POLICY EVALUATION ────────────────────────────────────────────────────────

function evaluatePolicy(metrics) {
  const T = THRESHOLDS;

  // ── PAUSE conditions (always checked first) ────────────────────────────────
  const pauseReasons = [];

  if (metrics.error) {
    return { mode: 'PAUSE', reasons: [`session error: ${metrics.error}`],
             allowedSizes: [], maxSize: 0, escalationAllowed: false };
  }

  if (metrics.activatorSilent) {
    pauseReasons.push(`activator silent for ${metrics.silenceSec}s (>${T.activatorSilenceSec}s threshold)`);
  }

  if (metrics.infraGrade === 'COMPROMISED') {
    pauseReasons.push(`infrastructure COMPROMISED (${metrics.sustainedPerH.toFixed(1)} sustained failures/h, `
                    + `${metrics.rebuildsFail} rebuild failures)`);
  }

  if (pauseReasons.length) {
    return {
      mode            : 'PAUSE',
      reasons         : pauseReasons,
      allowedSizes    : [],
      maxSize         : 0,
      escalationAllowed: false,
      metrics,
    };
  }

  // ── Determine base mode ────────────────────────────────────────────────────
  let mode    = 'CONSERVATIVE';
  let reasons = [];
  let allowedSizes = [200, 300];

  // Standard requires: infra CLEAN or ACCEPTABLE + session age >= 15 min
  const standardEligible =
    (metrics.infraGrade === 'CLEAN' || metrics.infraGrade === 'ACCEPTABLE') &&
    metrics.ageH >= T.minAgeHoursForStandard;

  if (standardEligible) {
    mode         = 'STANDARD';
    allowedSizes = [200, 300, 500];
    reasons.push(`infra ${metrics.infraGrade}, age ${metrics.ageH.toFixed(1)}h >= ${T.minAgeHoursForStandard}h`);
  } else {
    if (metrics.infraGrade === 'DEGRADED') {
      reasons.push(`infra DEGRADED (${metrics.sustainedPerH.toFixed(1)}/h sustained failures) → conservative`);
    }
    if (metrics.ageH < T.minAgeHoursForStandard) {
      reasons.push(`session too young (${metrics.ageH.toFixed(2)}h < ${T.minAgeHoursForStandard}h warmup)`);
    }
  }

  // ── Escalation to AGGRESSIVE ───────────────────────────────────────────────
  // Requires: STANDARD mode + CLEAN infra + age >= 30 min + confirmed rate HIGH
  const escalationAllowed =
    mode === 'STANDARD' &&
    metrics.infraGrade === 'CLEAN' &&
    metrics.ageH >= T.minAgeHoursForEscalation &&
    metrics.confirmedPerH >= T.confirmedPerH_HIGH;

  if (escalationAllowed) {
    // Escalation is allowed but NOT automatic — operator must explicitly enable
    reasons.push(`escalation ELIGIBLE: infra CLEAN, rate ${metrics.confirmedPerH.toFixed(1)}/h >= ${T.confirmedPerH_HIGH}/h`);
    reasons.push(`to use AGGRESSIVE: pass --mode aggressive explicitly`);
  }

  // ── Upper-band block ───────────────────────────────────────────────────────
  // $750+ blocked by default in CONSERVATIVE and STANDARD modes.
  // Only allowed if mode is AGGRESSIVE AND guardrail conditions met.
  const upperBandBlocked = mode !== 'AGGRESSIVE';

  return {
    mode,
    reasons,
    allowedSizes,
    maxSize          : Math.max(...allowedSizes),
    escalationAllowed,
    upperBandBlocked,
    infraGrade       : metrics.infraGrade,
    confirmedPerH    : metrics.confirmedPerH,
    ageH             : metrics.ageH,
    metrics,
  };
}

// ─── DOWNGRADE RULES ──────────────────────────────────────────────────────────
// Called at runtime by the activator to check if current mode should drop.

function shouldDowngrade(metrics, currentMode) {
  const T = THRESHOLDS;
  const reasons = [];

  if (metrics.activatorSilent) {
    reasons.push('PAUSE: activator silent');
    return { downgrade: true, toMode: 'PAUSE', reasons };
  }

  if (metrics.infraGrade === 'COMPROMISED') {
    reasons.push('DOWNGRADE: infrastructure COMPROMISED');
    return { downgrade: true, toMode: currentMode === 'AGGRESSIVE' ? 'STANDARD' : 'PAUSE', reasons };
  }

  if (currentMode === 'AGGRESSIVE' && metrics.infraGrade === 'DEGRADED') {
    reasons.push('DOWNGRADE: AGGRESSIVE requires CLEAN infra; current is DEGRADED');
    return { downgrade: true, toMode: 'STANDARD', reasons };
  }

  if (currentMode === 'STANDARD' && metrics.infraGrade === 'DEGRADED' &&
      metrics.sustainedPerH > T.sustainedFailPerH_DEGRADED) {
    reasons.push(`DOWNGRADE: STANDARD requires <= ${T.sustainedFailPerH_DEGRADED}/h sustained failures`);
    return { downgrade: true, toMode: 'CONSERVATIVE', reasons };
  }

  return { downgrade: false, toMode: currentMode, reasons: [] };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printPolicy(policy) {
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  const modeColor = {
    CONSERVATIVE: '\x1b[33m',
    STANDARD    : '\x1b[32m',
    AGGRESSIVE  : '\x1b[1;32m',
    PAUSE       : '\x1b[31m',
  };

  console.log('\n' + EQ);
  console.log('  AllMight — Session Policy Check  v1.0');
  console.log(`  ${new Date().toISOString()}`);
  console.log(EQ);

  const m = policy.metrics;
  if (m && !m.error) {
    console.log(`\n  Session age:       ${m.ageH.toFixed(1)}h`);
    console.log(`  Infra grade:       ${m.infraGrade}  (${m.sustainedPerH.toFixed(1)} sustained fail/h, ` +
                `${m.rebuildsFail} rebuild failures)`);
    console.log(`  Confirmed rate:    ${m.confirmedPerH.toFixed(1)}/h  (${m.confirmed} total)`);
    console.log(`  Activator silent:  ${m.activatorSilent ? `YES — ${m.silenceSec}s` : 'no'}`);
  }

  console.log(`\n${EQ}`);
  console.log(`  ${modeColor[policy.mode] ?? ''}APPROVED MODE: ${policy.mode}\x1b[0m`);
  console.log(`  Allowed sizes:     ${policy.allowedSizes?.length ? policy.allowedSizes.map(s=>'$'+s).join(', ') : 'none'}`);
  console.log(`  Max size:          ${policy.maxSize ? '$'+policy.maxSize : 'BLOCKED'}`);
  console.log(`  Upper-band ($750+): ${policy.upperBandBlocked ? 'BLOCKED' : 'ALLOWED (guardrail applies)'}`);

  console.log(`\n  Reasons:`);
  for (const r of policy.reasons ?? []) console.log(`    • ${r}`);

  if (policy.escalationAllowed) {
    console.log(`\n  \x1b[1;32mEscalation to AGGRESSIVE is ELIGIBLE this session.\x1b[0m`);
  }

  // Expected output
  const valueByMode = { CONSERVATIVE: 527, STANDARD: 705, AGGRESSIVE: 752 };
  if (policy.mode !== 'PAUSE') {
    console.log(`\n  Expected session value: ~$${valueByMode[policy.mode] ?? '?'}/session`);
    console.log(`  Working capital needed: $${policy.mode === 'CONSERVATIVE' ? '315' : policy.mode === 'STANDARD' ? '525' : '1,050'}`);
  }

  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, got) {
    if (cond) { pass++; }
    else { fail++; console.log(`    ✗ FAIL: ${label}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); }
  }

  console.log('\n  Session Policy Check — Self-Test\n');

  function mkMetrics(overrides) {
    return {
      ageH: 1.0, durH: 1.0, silenceSec: 30, activatorSilent: false,
      sustainedFail: 0, sustainedPerH: 0, rebuildsOk: 5, rebuildsFail: 0,
      infraGrade: 'CLEAN', confirmed: 10, confirmedPerH: 10, signals: 100,
      ...overrides,
    };
  }

  // ── PAUSE conditions ──────────────────────────────────────────────────────
  console.log('  Case 1: PAUSE conditions');
  {
    const p1 = evaluatePolicy(mkMetrics({ activatorSilent: true, silenceSec: 700 }));
    assert('activator silent → PAUSE', p1.mode === 'PAUSE', p1.mode);

    const p2 = evaluatePolicy(mkMetrics({ infraGrade: 'COMPROMISED', sustainedPerH: 8 }));
    assert('COMPROMISED → PAUSE', p2.mode === 'PAUSE', p2.mode);

    const p3 = evaluatePolicy({ error: 'no file', sessionDir: '?' });
    assert('error → PAUSE', p3.mode === 'PAUSE', p3.mode);

    console.log(`    silent=${p1.mode}  compromised=${p2.mode}  error=${p3.mode}`);
  }
  console.log();

  // ── CONSERVATIVE conditions ────────────────────────────────────────────────
  console.log('  Case 2: CONSERVATIVE conditions');
  {
    const p1 = evaluatePolicy(mkMetrics({ ageH: 0.1 }));  // too young
    assert('too young → CONSERVATIVE', p1.mode === 'CONSERVATIVE', p1.mode);

    const p2 = evaluatePolicy(mkMetrics({ infraGrade: 'DEGRADED', sustainedPerH: 3 }));
    assert('DEGRADED → CONSERVATIVE', p2.mode === 'CONSERVATIVE', p2.mode);

    console.log(`    young=${p1.mode}  degraded=${p2.mode}`);
  }
  console.log();

  // ── STANDARD conditions ────────────────────────────────────────────────────
  console.log('  Case 3: STANDARD conditions');
  {
    const p = evaluatePolicy(mkMetrics({ ageH: 0.5, infraGrade: 'CLEAN' }));
    assert('clean + age >= 0.25h → STANDARD', p.mode === 'STANDARD', p.mode);
    assert('STANDARD allows $200/$300/$500', p.allowedSizes.includes(500));
    assert('STANDARD blocks $750+', p.upperBandBlocked === true);
    console.log(`    mode=${p.mode}  sizes=${p.allowedSizes}  upperBandBlocked=${p.upperBandBlocked}`);
  }
  console.log();

  // ── Escalation eligibility ─────────────────────────────────────────────────
  console.log('  Case 4: AGGRESSIVE escalation eligibility');
  {
    const p = evaluatePolicy(mkMetrics({
      ageH: 1.0, infraGrade: 'CLEAN', confirmedPerH: 20,
    }));
    assert('CLEAN + high rate → escalation eligible', p.escalationAllowed === true, p.escalationAllowed);
    assert('default mode still STANDARD (not auto-escalate)', p.mode === 'STANDARD', p.mode);
    console.log(`    mode=${p.mode}  escalationAllowed=${p.escalationAllowed}`);
  }
  console.log();

  // ── Downgrade logic ────────────────────────────────────────────────────────
  console.log('  Case 5: shouldDowngrade');
  {
    const d1 = shouldDowngrade(mkMetrics({ activatorSilent: true }), 'STANDARD');
    assert('silent → downgrade to PAUSE', d1.downgrade && d1.toMode === 'PAUSE');

    const d2 = shouldDowngrade(mkMetrics({ infraGrade: 'DEGRADED', sustainedPerH: 7 }), 'AGGRESSIVE');
    assert('AGGRESSIVE + DEGRADED → downgrade to STANDARD', d2.downgrade && d2.toMode === 'STANDARD', d2.toMode);

    const d3 = shouldDowngrade(mkMetrics({ infraGrade: 'CLEAN' }), 'STANDARD');
    assert('CLEAN → no downgrade', d3.downgrade === false);

    console.log(`    silent→${d1.toMode}  aggr+degraded→${d2.toMode}  clean→${d3.downgrade?'downgrade':'hold'}`);
  }
  console.log();

  console.log('  ' + '═'.repeat(62));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(62) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_TEST) { runSelfTest(); return; }

  const sessionDir = getSessionDir();
  if (!sessionDir) {
    console.error('[session_policy_check] No active session found.');
    console.error('  Start a session first, or pass --session logs/session_YYYYMMDD_HHMM');
    process.exit(1);
  }

  const metrics = measureSession(sessionDir);
  const policy  = evaluatePolicy(metrics);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(policy, null, 2) + '\n');
  } else {
    printPolicy(policy);
  }
}

module.exports = { evaluatePolicy, shouldDowngrade, measureSession, THRESHOLDS };

// Only run main() when executed directly, not when required as a module
if (require.main === module) main();
