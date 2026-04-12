'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Threshold-Edge Accumulator Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/threshold_edge_accumulator_report.js
//
//  USAGE
//  ─────
//  # Single audit log (one session)
//  node scripts/tools/threshold_edge_accumulator_report.js \
//    --audit logs/execution_candidate_audit.jsonl
//
//  # Multiple session folders (cross-session analysis)
//  node scripts/tools/threshold_edge_accumulator_report.js \
//    --sessions logs/session_20260411_2019 \
//               logs/session_20260412_0800 \
//               logs/session_20260412_2000
//
//  # Machine-readable JSON
//  node scripts/tools/threshold_edge_accumulator_report.js \
//    --sessions <paths...> --json
//
//  # Self-test
//  node scripts/tools/threshold_edge_accumulator_report.js --self-test
//
//  NOTES
//  ─────
//  When using --sessions, each folder must contain execution_candidate_audit.jsonl
//  (generated automatically by start_all.sh stop).
//  Falls back to --audit path for single-log mode.
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { accumulateThresholdEdge,
        MIN_SESSIONS_FOR_VERDICT }  = require('../execution/threshold_edge_accumulator');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS        = process.argv.slice(2);
const FLAG_TEST   = ARGS.includes('--self-test');
const FLAG_JSON   = ARGS.includes('--json');
const AUDIT_PATH  = (() => {
  const i = ARGS.indexOf('--audit');
  return i !== -1 && ARGS[i+1] ? ARGS[i+1] : 'logs/execution_candidate_audit.jsonl';
})();

// --sessions folder1 folder2 ... (everything after --sessions that doesn't start with --)
const SESSION_PATHS = (() => {
  const i = ARGS.indexOf('--sessions');
  if (i === -1) return [];
  const paths = [];
  for (let j = i + 1; j < ARGS.length && !ARGS[j].startsWith('--'); j++) {
    paths.push(ARGS[j]);
  }
  return paths;
})();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

function pct(n, d) { return d ? `${(100*n/d).toFixed(1)}%` : '0%'; }

function loadSessions() {
  // Multi-session mode: each path is a session folder
  if (SESSION_PATHS.length > 0) {
    const sessions = [];
    for (const sessionPath of SESSION_PATHS) {
      const auditFile = path.join(sessionPath, 'execution_candidate_audit.jsonl');
      const label     = path.basename(sessionPath);
      if (fs.existsSync(auditFile)) {
        const records = readJsonl(auditFile);
        sessions.push({ label, records });
        if (!FLAG_JSON) process.stdout.write(`  Loaded session ${label}: ${records.length} audit records\n`);
      } else {
        if (!FLAG_JSON) process.stderr.write(`  Warning: no audit log in ${sessionPath} — skipping\n`);
      }
    }
    return sessions;
  }

  // Single-log mode: treat the single file as one session
  const label   = path.basename(path.dirname(AUDIT_PATH)) || 'session_single';
  const records = readJsonl(AUDIT_PATH);
  if (!FLAG_JSON) process.stdout.write(`  Single-log mode: ${records.length} audit records from ${AUDIT_PATH}\n`);
  return [{ label, records }];
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  const { accumulateThresholdEdge } = require('../execution/threshold_edge_accumulator');
  let pass = 0, fail = 0;

  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  function mkEdge(opts = {}) {
    return {
      auditVerdict         : 'CANDIDATE_NEAR_MISS',
      nearMissType         : 'near_miss_spread',
      simulationVerdict    : 'SIM_PASS',
      executionConfidence  : opts.conf     ?? 0.70,
      spreadPct            : opts.spread   ?? 0.2185,
      baseNetProfitUsd     : opts.net      ?? 0.24,
      profile              : opts.profile  ?? 'AGGRESSIVE',
      heatClass            : opts.heat     ?? 'EXTREME',
      regime               : opts.regime   ?? 'persistent_depth_regime',
      direction            : opts.dir      ?? 'BUY_UNISWAP_V3_SELL_RAMSES_V2',
      pair                 : opts.pair     ?? 'ETH/USDC-RAMSES',
      nearMissDetail       : `spreadPct=${opts.spread ?? 0.2185}% threshold=0.22% gap=${opts.gap ?? 0.0015}%`,
      candidateAuditId     : `AUD-T-${Math.random().toString(36).slice(2,8)}`,
      ts                   : opts.ts ?? '2026-04-11T22:00:00Z',
    };
  }

  function mkConfirmed(spread = 0.2300) {
    return { auditVerdict:'CANDIDATE_CONFIRMED', spreadPct: spread, executionConfidence: 0.72 };
  }

  function mkRejected() {
    return { auditVerdict:'CANDIDATE_REJECTED', spreadPct: 0.14, executionConfidence: 0.25 };
  }

  // Three synthetic sessions
  const session1 = {
    label  : 'session_20260411_2019',
    records: [
      mkEdge({ conf:0.722, spread:0.2189, gap:0.0011 }),
      mkEdge({ conf:0.690, spread:0.2175, gap:0.0025, profile:'BALANCED' }),
      mkEdge({ conf:0.657, spread:0.2165, gap:0.0035, profile:'SAFE' }),
      mkConfirmed(0.2310),
      mkRejected(),
    ],
  };
  const session2 = {
    label  : 'session_20260412_0800',
    records: [
      mkEdge({ conf:0.705, spread:0.2183, gap:0.0017 }),
      mkEdge({ conf:0.668, spread:0.2171, gap:0.0029, profile:'AGGRESSIVE' }),
      mkConfirmed(0.2280),
      mkRejected(),
    ],
  };
  const session3_none = {
    label  : 'session_20260412_1200',
    records: [mkRejected(), mkRejected()],  // no edge records
  };

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Threshold-Edge Accumulator Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // Case 1: Basic accumulation
  console.log('  Case 1: Basic accumulation — 2 sessions with edge records');
  {
    const s = accumulateThresholdEdge([session1, session2]);
    assert('Case 1: totalEdgeRecords = 5',    s.totalEdgeRecords === 5, `got ${s.totalEdgeRecords}`);
    assert('Case 1: sessionCount = 2',         s.sessionCount === 2);
    assert('Case 1: sessionsWithEdge = 2',     s.sessionsWithEdge === 2);
    assert('Case 1: records array length = 5', s.records.length === 5);
    console.log(`         total=${s.totalEdgeRecords}  sessions=${s.sessionCount}  withEdge=${s.sessionsWithEdge}`);
  }
  console.log();

  // Case 2: Recurrence verdict with 3 sessions (one empty)
  console.log('  Case 2: Recurrence verdict — 3 sessions, 2 have edge records');
  {
    const s = accumulateThresholdEdge([session1, session2, session3_none]);
    assert('Case 2: sessionCount = 3',          s.sessionCount === 3);
    assert('Case 2: sessionsWithEdge = 2',      s.sessionsWithEdge === 2);
    assert('Case 2: verdict = RECURRING or STRUCTURAL',
      ['RECURRING','STRUCTURAL'].includes(s.recurrenceVerdict), s.recurrenceVerdict);
    assert('Case 2: q1_recurs = true',          s.q1_recurs === true);
    console.log(`         verdict=${s.recurrenceVerdict}  coverage=${s.q1_sessionCoverage}`);
  }
  console.log();

  // Case 3: Gap tightness
  console.log('  Case 3: Gap statistics (gaps: 0.0011, 0.0025, 0.0035, 0.0017, 0.0029)');
  {
    const s = accumulateThresholdEdge([session1, session2]);
    assert('Case 3: gapStats present',      s.gapStats != null);
    assert('Case 3: gap range ≤ 0.003',     (s.gapStats?.range ?? 999) <= 0.003, `range=${s.gapStats?.range}`);
    assert('Case 3: q2_gapTight = true',    s.q2_gapTight === true);
    console.log(`         gapRange=${s.gapStats?.range?.toFixed(5)}%  tight=${s.q2_gapTight}`);
  }
  console.log();

  // Case 4: Dimension dominance (Q3)
  console.log('  Case 4: Dimension dominance — AGGRESSIVE/EXTREME/persistent_depth');
  {
    const s = accumulateThresholdEdge([session1, session2]);
    assert('Case 4: q3_extremeDominant',     s.q3_extremeDominant   === true, `${s.q3_extremePct}%`);
    assert('Case 4: q3_persistentDepthDom',  s.q3_persistentDepthDom=== true, `${s.q3_persistentDepthPct}%`);
    assert('Case 4: dominantHeatClass = EXTREME', s.dominantHeatClass === 'EXTREME', s.dominantHeatClass);
    console.log(`         AGGRESSIVE=${s.q3_aggressivePct}%  EXTREME=${s.q3_extremePct}%  pDepth=${s.q3_persistentDepthPct}%`);
  }
  console.log();

  // Case 5: Direction (Q4)
  console.log('  Case 5: Direction consistency');
  {
    const s = accumulateThresholdEdge([session1, session2]);
    assert('Case 5: dominantDirection present', s.q4_dominantDirection != null);
    assert('Case 5: q4_directionConsistent',    s.q4_directionConsistent === true);
    console.log(`         dominant=${s.q4_dominantDirection}  consistent=${s.q4_directionConsistent}`);
  }
  console.log();

  // Case 6: Conversion evidence (Q5) — confirmed spreads overlap with edge spreads
  console.log('  Case 6: Conversion evidence (Q5)');
  {
    const s = accumulateThresholdEdge([session1, session2]);
    // Edge spreads: 0.2165–0.2189; confirmed: 0.2280 and 0.2310 → no overlap
    assert('Case 6: q5 result is boolean', typeof s.q5_conversionEvidence === 'boolean');
    assert('Case 6: q5_detail present',    typeof s.q5_detail === 'string');
    console.log(`         evidence=${s.q5_conversionEvidence}  detail=${s.q5_detail}`);
  }
  console.log();

  // Case 7: Insufficient sessions
  console.log('  Case 7: Single session → INSUFFICIENT_DATA');
  {
    const s = accumulateThresholdEdge([session1]);
    assert('Case 7: INSUFFICIENT_DATA for 1 session',
      s.recurrenceVerdict === 'INSUFFICIENT_DATA', s.recurrenceVerdict);
    console.log(`         verdict=${s.recurrenceVerdict}`);
  }
  console.log();

  // Case 8: Empty input
  console.log('  Case 8: Empty/null input degrades cleanly');
  {
    const s1 = accumulateThresholdEdge([]);
    const s2 = accumulateThresholdEdge(null);
    assert('Case 8a: empty → totalEdgeRecords=0', s1.totalEdgeRecords === 0);
    assert('Case 8b: null → totalEdgeRecords=0',  s2.totalEdgeRecords === 0);
    console.log('         empty OK  null OK');
  }
  console.log();

  // Case 9: Determinism
  console.log('  Case 9: Determinism — same input → same output');
  {
    const s1 = accumulateThresholdEdge([session1, session2]);
    const s2 = accumulateThresholdEdge([session1, session2]);
    assert('Case 9: verdict identical',          s1.recurrenceVerdict === s2.recurrenceVerdict);
    assert('Case 9: totalEdgeRecords identical', s1.totalEdgeRecords  === s2.totalEdgeRecords);
    assert('Case 9: gapStats identical',         JSON.stringify(s1.gapStats) === JSON.stringify(s2.gapStats));
    assert('Case 9: byProfile identical',        JSON.stringify(s1.byProfile) === JSON.stringify(s2.byProfile));
    console.log('         all identical ✓');
  }
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(summary) {
  const W   = 100;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  const VERDICT_CLR = {
    STRUCTURAL       : '\x1b[1;32m',
    RECURRING        : '\x1b[32m',
    INCIDENTAL       : '\x1b[33m',
    INSUFFICIENT_DATA: '\x1b[90m',
  };
  const RST = '\x1b[0m';
  const vc  = VERDICT_CLR[summary.recurrenceVerdict] || '';

  console.log('\n' + EQ);
  console.log('  AllMight — Threshold-Edge Accumulator  v1.0');
  console.log(`  ${new Date().toISOString()}`);
  console.log(EQ);

  console.log(`\n  Sessions: ${summary.sessionCount}  |  With edge records: ${summary.sessionsWithEdge}`);
  console.log(`  Total edge records: ${summary.totalEdgeRecords}  |  Avg per session: ${summary.avgEdgePerSession.toFixed(1)}`);
  console.log(`\n  ${vc}RECURRENCE VERDICT: ${summary.recurrenceVerdict}${RST}`);
  console.log(`  Reason: ${summary.recurrenceVerdictReason}`);

  // Q1
  console.log(`\n  Q1. Recurrence: ${summary.q1_recurs ? '✓' : '✗'}  Coverage: ${summary.q1_sessionCoverage}`);

  // Q2
  const g = summary.q2_gapStats;
  console.log(`\n  Q2. Gap tightness: ${summary.q2_gapTight ? '✓ TIGHT' : '✗ NOT TIGHT'}`);
  if (g) console.log(`      min=${g.min?.toFixed(5)}%  max=${g.max?.toFixed(5)}%  range=${g.range?.toFixed(5)}%  median=${g.median?.toFixed(5)}%`);

  // Q3
  console.log(`\n  Q3. Dimension dominance:`);
  console.log(`      AGGRESSIVE:        ${summary.q3_aggressivePct}%  ${summary.q3_aggressiveDominant ? '✓' : '✗'}`);
  console.log(`      EXTREME heat:      ${summary.q3_extremePct}%  ${summary.q3_extremeDominant ? '✓' : '✗'}`);
  console.log(`      persistent_depth:  ${summary.q3_persistentDepthPct}%  ${summary.q3_persistentDepthDom ? '✓' : '✗'}`);

  console.log('      Profile:');
  for (const [k,v] of Object.entries(summary.byProfile).sort((a,b)=>b[1]-a[1])) {
    console.log(`        ${k.padEnd(14)} ${v} (${pct(v, summary.totalEdgeRecords)})`);
  }
  console.log('      Heat:');
  for (const [k,v] of Object.entries(summary.byHeatClass).sort((a,b)=>b[1]-a[1])) {
    console.log(`        ${k.padEnd(10)} ${v} (${pct(v, summary.totalEdgeRecords)})`);
  }
  console.log('      Regime:');
  for (const [k,v] of Object.entries(summary.byRegime).sort((a,b)=>b[1]-a[1])) {
    console.log(`        ${k.padEnd(32)} ${v} (${pct(v, summary.totalEdgeRecords)})`);
  }

  // Q4
  console.log(`\n  Q4. Direction: dominant=${summary.q4_dominantDirection ?? 'none'}  consistent=${summary.q4_directionConsistent}`);
  for (const [k,v] of Object.entries(summary.byDirection).sort((a,b)=>b[1]-a[1])) {
    console.log(`        ${k.slice(0,50).padEnd(50)} ${v} (${pct(v, summary.totalEdgeRecords)})`);
  }

  // Q5
  console.log(`\n  Q5. Conversion evidence: ${summary.q5_conversionEvidence ? '✓ YES' : '✗ NO'}`);
  console.log(`      ${summary.q5_detail}`);

  // Per-session summary
  console.log(`\n  ${DIV}`);
  console.log('  Per-session summary:');
  console.log(`  ${'session'.padEnd(30)}  ${'audit'.padStart(6)}  ${'edge'.padStart(5)}  ${'conf'.padStart(5)}  ${'gap_med'.padStart(8)}`);
  console.log('  ' + DIV);
  for (const s of summary.sessionsSummary) {
    const gm = s.gapStats?.median;
    console.log(`  ${s.label.padEnd(30)}  ${String(s.totalAuditRecords).padStart(6)}  ${String(s.edgeCount).padStart(5)}  ${String(s.confirmedCount).padStart(5)}  ${gm != null ? (gm.toFixed(5)+'%').padStart(8) : '       ?'}`);
  }

  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_TEST) { runSelfTest(); return; }

  if (!FLAG_JSON) {
    console.log('\n[threshold_edge_accumulator] Loading session data...');
  }

  const sessions = loadSessions();
  if (!sessions.length) {
    console.error('[threshold_edge_accumulator] No sessions found. Use --sessions <paths> or --audit <file>');
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write(`\n  Loaded ${sessions.length} session(s)\n\n`);

  const summary = accumulateThresholdEdge(sessions);

  if (FLAG_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printReport(summary);
  }
}

main();
