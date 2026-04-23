'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Dry-Run Confidence Log  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/dryrun_confidence_log.js
//  STATUS    : NEW — Boss ruling 2026-04-22 (Dry-Run Confidence Accumulation)
//
//  PURPOSE
//  ───────
//  Evaluate completed sessions against the Boss-valid controlled dry-run
//  criteria from LIVE_READINESS_GATE.md and maintain a running confidence log.
//
//  BOSS-VALID CRITERIA (9 checkpoints):
//    C1  All 5 processes ran       — activator has heartbeat + signal records
//    C2  Watchdog ran              — watchdog.jsonl with ≥1 records
//    C3  Policy was STANDARD       — duration ≥ 15min AND activator warmed
//    C4  Session duration ≥ 4h
//    C5  ≥1 confirmed candidate
//    C6  Sandbox viable% > 0       — sandbox_results.json produced by FIXED sandbox
//    C7  No analysis failures      — no ✗ in analysis.log
//    C8  Discord alerts fired      — startup + stop summary in analysis.log
//    C9  Boss summary completed    — operator confirms (PENDING until marked)
//
//  A session is VALID when C1–C8 all pass (C9 is operator-confirmed separately).
//  A session is FULLY_VALID when all 9 pass.
//
//  USAGE
//  ─────
//  # Evaluate all sessions
//  node scripts/tools/dryrun_confidence_log.js --logs logs/
//
//  # Evaluate specific sessions
//  node scripts/tools/dryrun_confidence_log.js \
//    --sessions logs/session_20260417_2138 logs/session_20260419_2004
//
//  # Mark C9 complete for a session (Boss summary submitted)
//  node scripts/tools/dryrun_confidence_log.js \
//    --mark-c9 logs/session_20260420_2210
//
//  # JSON output
//  node scripts/tools/dryrun_confidence_log.js --logs logs/ --json
//
//  node scripts/tools/dryrun_confidence_log.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}
function argList(flag) {
  const i = ARGS.indexOf(flag);
  if (i === -1) return [];
  const out = [];
  for (let j = i + 1; j < ARGS.length && !ARGS[j].startsWith('--'); j++) out.push(ARGS[j]);
  return out;
}

const FLAG_TEST  = ARGS.includes('--self-test');
const FLAG_JSON  = ARGS.includes('--json');
const LOGS_DIR   = argVal('--logs', null);
const MARK_C9    = argVal('--mark-c9', null);
const SESSIONS   = argList('--sessions');

// C9 state file — persists operator confirmations across runs
const C9_STATE_FILE = path.resolve(process.cwd(), 'logs', '.dryrun_c9_confirmed.json');

// ─── C9 STATE ─────────────────────────────────────────────────────────────────

function loadC9State() {
  try { return JSON.parse(fs.readFileSync(C9_STATE_FILE, 'utf8')); }
  catch { return {}; }
}

function saveC9State(state) {
  try {
    const dir = path.dirname(C9_STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(C9_STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch { /* skip */ }
}

// ─── SESSION EVALUATOR ────────────────────────────────────────────────────────

function tsToMs(ts) {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function evaluateSession(sessionDir, c9State) {
  const label = path.basename(sessionDir).replace('session_', '');
  const actPath   = path.join(sessionDir, 'activator.jsonl');
  const auditPath = path.join(sessionDir, 'execution_candidate_audit.jsonl');
  const wdPath    = path.join(sessionDir, 'watchdog.jsonl');
  const sbPath    = path.join(sessionDir, 'sandbox_results.json');
  const alPath    = path.join(sessionDir, 'analysis.log');

  if (!fs.existsSync(actPath)) {
    return { label, sessionDir, error: 'activator.jsonl not found', valid: false, criteria: {} };
  }

  // ── Parse activator ────────────────────────────────────────────────────────
  let durH = 0, hasHeartbeat = false, hasSignal = false;
  try {
    const actLines = fs.readFileSync(actPath, 'utf8').split('\n').filter(Boolean);
    const tsList = [];
    for (const l of actLines) {
      try {
        const r = JSON.parse(l);
        if (r.ts) tsList.push(tsToMs(r.ts));
        if (r.type === 'heartbeat') hasHeartbeat = true;
        if (r.type === 'signal')    hasSignal    = true;
      } catch { /* skip non-JSON */ }
    }
    tsList.sort((a, b) => a - b);
    if (tsList.length >= 2) {
      durH = (tsList[tsList.length - 1] - tsList[0]) / 3_600_000;
    }
  } catch { /* skip */ }

  // ── Confirmed candidates ───────────────────────────────────────────────────
  let confirmed = 0;
  try {
    confirmed = (fs.readFileSync(auditPath, 'utf8')
      .match(/"CANDIDATE_CONFIRMED"/g) || []).length;
  } catch { /* skip */ }

  // ── Watchdog ───────────────────────────────────────────────────────────────
  let wdRecords = 0;
  try {
    if (fs.existsSync(wdPath)) {
      wdRecords = fs.readFileSync(wdPath, 'utf8').split('\n')
        .filter(l => l.trim().startsWith('{')).length;
    }
  } catch { /* skip */ }

  // ── Sandbox ────────────────────────────────────────────────────────────────
  let sbViable = null, sbNote = null;
  try {
    if (fs.existsSync(sbPath)) {
      const sb = JSON.parse(fs.readFileSync(sbPath, 'utf8'));
      sbViable = sb?.summary?.viableRate ?? sb?.summary?.viable ?? null;
      // Detect pre-fix sandbox (0% due to old tolerances)
      const total   = sb?.summary?.total ?? 0;
      const noFill  = sb?.summary?.noFill ?? 0;
      if (sbViable === 0 && total > 0 && noFill === total) {
        sbNote = 'PRE-FIX: old tolerances produced 0% (re-run with fixed sandbox)';
      }
    }
  } catch { /* skip */ }

  // ── Analysis log ──────────────────────────────────────────────────────────
  let alFailures = 0, hasStartup = false, hasStop = false;
  try {
    if (fs.existsSync(alPath)) {
      const al = fs.readFileSync(alPath, 'utf8');
      alFailures = (al.match(/ ✗ /g) || []).length;
      hasStartup = /startup|ALLMIGHT STARTED/i.test(al);
      hasStop    = /stop summary|Sending stop/i.test(al);
    }
  } catch { /* skip */ }

  // ── C9 — Boss summary confirmed ────────────────────────────────────────────
  const c9Confirmed = Boolean(c9State[label] || c9State[sessionDir]);

  // ── Evaluate criteria ──────────────────────────────────────────────────────
  const criteria = {
    C1_all_processes  : hasHeartbeat && hasSignal,
    C2_watchdog       : wdRecords >= 1,
    C3_policy_standard: durH >= 0.25 && hasHeartbeat,
    C4_duration_4h    : durH >= 4.0,
    C5_candidates     : confirmed >= 1,
    C6_sandbox_viable : sbViable !== null && sbViable > 0,
    C7_no_al_failures : alFailures === 0,
    C8_discord_alerts : hasStartup && hasStop,
    C9_boss_summary   : c9Confirmed,
  };

  const passCount  = Object.values(criteria).filter(Boolean).length;
  const c1_c8_pass = Object.entries(criteria)
    .filter(([k]) => k !== 'C9_boss_summary')
    .every(([, v]) => v);

  const validity = c1_c8_pass && c9Confirmed ? 'FULLY_VALID'
                 : c1_c8_pass                ? 'VALID'
                 : passCount >= 6            ? 'PARTIAL'
                 : 'INVALID';

  const fails = Object.entries(criteria)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    label,
    sessionDir,
    durH         : +durH.toFixed(2),
    confirmed,
    wdRecords,
    sbViable     : sbViable !== null ? +sbViable.toFixed(3) : null,
    sbNote,
    alFailures,
    validity,
    passCount,
    totalCriteria: 9,
    criteria,
    fails,
    notes        : sbNote ? [sbNote] : [],
  };
}

// ─── DISCOVERY ────────────────────────────────────────────────────────────────

function discoverSessions(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir)
    .filter(d => d.startsWith('session_'))
    .map(d => path.join(logsDir, d))
    .filter(d => fs.statSync(d).isDirectory())
    .sort();
}

// ─── CONFIDENCE SUMMARY ───────────────────────────────────────────────────────

function buildSummary(evaluations) {
  const fullyValid = evaluations.filter(e => e.validity === 'FULLY_VALID');
  const valid      = evaluations.filter(e => e.validity === 'VALID');
  const partial    = evaluations.filter(e => e.validity === 'PARTIAL');
  const invalid    = evaluations.filter(e => e.validity === 'INVALID');

  // Most common failure modes
  const failCounts = {};
  for (const e of evaluations) {
    for (const f of e.fails || []) {
      failCounts[f] = (failCounts[f] || 0) + 1;
    }
  }
  const topFails = Object.entries(failCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ criterion: k, count: v }));

  // Trend: are recent sessions improving?
  const recent3 = evaluations.slice(-3);
  const recent3PassAvg = recent3.length
    ? recent3.reduce((s, e) => s + e.passCount, 0) / recent3.length
    : 0;
  const all_passAvg = evaluations.length
    ? evaluations.reduce((s, e) => s + e.passCount, 0) / evaluations.length
    : 0;

  const trend = recent3PassAvg > all_passAvg + 0.5 ? 'IMPROVING'
              : recent3PassAvg < all_passAvg - 0.5 ? 'DEGRADING'
              : 'STABLE';

  // Confidence level
  const validCount = fullyValid.length + valid.length;
  const confidence = validCount >= 5  ? 'HIGH'
                   : validCount >= 3  ? 'MODERATE'
                   : validCount >= 1  ? 'BUILDING'
                   : 'INSUFFICIENT';

  return {
    totalSessions   : evaluations.length,
    fullyValidCount : fullyValid.length,
    validCount      : valid.length,
    partialCount    : partial.length,
    invalidCount    : invalid.length,
    bossValidTotal  : fullyValid.length + valid.length,
    topFailureModes : topFails.slice(0, 5),
    trend,
    recentAvgPass   : +recent3PassAvg.toFixed(2),
    overallAvgPass  : +all_passAvg.toFixed(2),
    confidence,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(evaluations, summary) {
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  const validityColor = { FULLY_VALID:'✅', VALID:'✅', PARTIAL:'⚠️', INVALID:'❌' };

  console.log('\n' + EQ);
  console.log('  AllMight — Dry-Run Confidence Log  v1.0');
  console.log(`  ${new Date().toISOString()}`);
  console.log(EQ);

  // ── Per-session table ────────────────────────────────────────────────────
  console.log('\n  SESSION EVALUATIONS');
  console.log(`  ${DIV}`);
  console.log('  ' + 'session'.padEnd(22) + '  ' + 'dur'.padStart(5) + '  ' + 'conf'.padStart(5) + '  ' + 'wd'.padStart(4) + '  ' + 'sb'.padStart(5) + '  ' + 'pass'.padStart(5) + '  validity');
  console.log(`  ${DIV}`);

  for (const e of evaluations) {
    if (e.error) {
      console.log(`  ${e.label.padEnd(22)}  ERROR: ${e.error}`);
      continue;
    }
    const icon = validityColor[e.validity] ?? '?';
    const sbStr = e.sbViable !== null ? (e.sbViable * 100).toFixed(0) + '%' : '-';
    console.log(
      `  ${e.label.padEnd(22)}  ${e.durH.toFixed(1).padStart(5)}h` +
      `  ${String(e.confirmed).padStart(5)}  ${String(e.wdRecords).padStart(4)}` +
      `  ${sbStr.padStart(5)}  ${e.passCount}/9  ${icon} ${e.validity}`
    );
    if (e.fails.length) {
      console.log(`  ${''.padEnd(22)}  Fails: ${e.fails.join(', ')}`);
    }
    if (e.notes.length) {
      for (const n of e.notes) console.log(`  ${''.padEnd(22)}  Note: ${n}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  CONFIDENCE SUMMARY');
  console.log(`  ${DIV}`);
  console.log(`\n  Total sessions evaluated: ${summary.totalSessions}`);
  console.log(`  ✅ FULLY_VALID (C1–C9):   ${summary.fullyValidCount}`);
  console.log(`  ✅ VALID (C1–C8):         ${summary.validCount}`);
  console.log(`  ⚠️  PARTIAL:               ${summary.partialCount}`);
  console.log(`  ❌ INVALID:               ${summary.invalidCount}`);
  console.log(`\n  Boss-valid total:         ${summary.bossValidTotal}`);
  console.log(`  Confidence level:         ${summary.confidence}`);
  console.log(`  Trend (recent 3):         ${summary.trend}  (${summary.recentAvgPass} vs ${summary.overallAvgPass} avg)`);

  // ── Top failure modes ────────────────────────────────────────────────────
  if (summary.topFailureModes.length) {
    console.log(`\n  ${DIV}`);
    console.log('  TOP FAILURE MODES');
    for (const { criterion, count } of summary.topFailureModes) {
      const descriptions = {
        C2_watchdog       : 'Watchdog not running — must launch Process 5',
        C6_sandbox_viable : 'Sandbox not run or pre-fix tolerances (re-run sandbox)',
        C8_discord_alerts : 'Discord startup/stop alerts missing (v1 notifier)',
        C9_boss_summary   : 'Boss summary template not completed by operator',
        C3_policy_standard: 'Session too young or activator not warmed',
        C4_duration_4h    : 'Session < 4 hours',
        C1_all_processes  : 'Activator missing heartbeat or signal records',
      };
      const desc = descriptions[criterion] ?? '';
      console.log(`  ${criterion.padEnd(22)} ${count} session(s)${desc ? '  — ' + desc : ''}`);
    }
  }

  // ── Recommended next runs ─────────────────────────────────────────────────
  console.log(`\n  ${DIV}`);
  console.log('  RECOMMENDED ACTIONS');
  if (summary.bossValidTotal < 3) {
    const needed = 3 - summary.bossValidTotal;
    console.log(`  • Run ${needed} more Boss-valid sessions to reach MODERATE confidence`);
  }
  if (summary.topFailureModes.some(f => f.criterion === 'C2_watchdog')) {
    console.log('  • Fix: watchdog now integrated as Process 5 in start_all.sh v1.4');
    console.log('    Deploy updated start_all.sh and run new sessions');
  }
  if (summary.topFailureModes.some(f => f.criterion === 'C6_sandbox_viable')) {
    console.log('  • Fix: re-run sandbox with fixed tolerances on all sessions with replay data');
    console.log('    node scripts/tools/execution_sandbox_report.js --blueprints ... --replay ...');
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

  console.log('\n  Dry-Run Confidence Log — Self-Test\n');

  // ── buildSummary ─────────────────────────────────────────────────────────
  console.log('  Case 1: buildSummary — confidence levels');
  {
    const mk = (validity, passCount) => ({ validity, passCount, fails: [], notes: [] });
    const s0 = buildSummary([]);
    assert('empty → INSUFFICIENT', s0.confidence === 'INSUFFICIENT', s0.confidence);

    const s1 = buildSummary([mk('VALID', 8), mk('PARTIAL', 5)]);
    assert('1 valid → BUILDING', s1.confidence === 'BUILDING', s1.confidence);

    const s3 = buildSummary([mk('VALID',8), mk('VALID',8), mk('VALID',8)]);
    assert('3 valid → MODERATE', s3.confidence === 'MODERATE', s3.confidence);

    const s5 = buildSummary(Array.from({length:5}, () => mk('FULLY_VALID',9)));
    assert('5 valid → HIGH', s5.confidence === 'HIGH', s5.confidence);

    console.log(`    0→${s0.confidence}  1→${s1.confidence}  3→${s3.confidence}  5→${s5.confidence}`);
  }
  console.log();

  // ── trend detection ───────────────────────────────────────────────────────
  console.log('  Case 2: trend detection');
  {
    const older = [1,2,3,4].map(p => ({ validity:'PARTIAL', passCount: p, fails:[], notes:[] }));
    const recent = [8,8,9].map(p => ({ validity:'VALID', passCount: p, fails:[], notes:[] }));
    const s = buildSummary([...older, ...recent]);
    assert('recent better → IMPROVING', s.trend === 'IMPROVING', s.trend);

    const s2 = buildSummary([...recent, ...older]);
    assert('recent worse → DEGRADING', s2.trend === 'DEGRADING', s2.trend);
    console.log(`    improving→${s.trend}  degrading→${s2.trend}`);
  }
  console.log();

  // ── C9 state ─────────────────────────────────────────────────────────────
  console.log('  Case 3: C9 state loading');
  {
    const state = { '20260417_2138': true };
    const confirmed = Boolean(state['20260417_2138']);
    assert('C9 confirmed from state', confirmed === true, confirmed);
    const notConfirmed = Boolean(state['20260419_2004']);
    assert('C9 not confirmed from state', notConfirmed === false, notConfirmed);
    console.log(`    2138→${confirmed}  2004→${notConfirmed}`);
  }
  console.log();

  console.log('  ' + '═'.repeat(60));
  console.log(`  Self-test: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(60) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_TEST) { runSelfTest(); return; }

  // Mark C9 for a session
  if (MARK_C9) {
    const state = loadC9State();
    const label = path.basename(MARK_C9).replace('session_', '');
    state[label] = true;
    saveC9State(state);
    console.log(`[dryrun_confidence_log] C9 marked complete for ${label}`);
    return;
  }

  // Collect session directories
  let sessionDirs = SESSIONS.length ? SESSIONS : [];
  if (!sessionDirs.length && LOGS_DIR) {
    sessionDirs = discoverSessions(LOGS_DIR);
  }
  if (!sessionDirs.length) {
    console.error('[dryrun_confidence_log] Provide --logs <dir> or --sessions <dir...>');
    process.exit(1);
  }

  const c9State     = loadC9State();
  const evaluations = sessionDirs.map(d => evaluateSession(d, c9State));
  const summary     = buildSummary(evaluations.filter(e => !e.error));

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), summary, sessions: evaluations }, null, 2) + '\n');
  } else {
    printReport(evaluations, summary);
  }
}

main();
