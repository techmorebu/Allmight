'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Cross-Session Execution Sandbox Accumulator  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/execution_sandbox_accumulator_report.js
//  STATUS    : NEW — Execution Timing Model phase
//
//  PURPOSE
//  ───────
//  Run the execution sandbox across multiple sessions and aggregate survivability
//  by delay tier (0ms / 500ms / 1000ms).
//
//  Answers: "Is the edge consistently executable under delay, or was one session
//  an outlier?"
//
//  Per delay tier, across all sessions, reports:
//    - sessions tested
//    - avg viable rate
//    - avg no-fill rate (replay gap exposure)
//    - avg net PnL (viable trades only)
//    - consistency verdict: CONSISTENT / DEVELOPING / INSUFFICIENT_DATA
//    - decay slope: how much viable% drops per 500ms of delay
//
//  Also emits per-session breakdown and a survivability recommendation.
//
//  THIS MODULE DOES NOT:
//    ✗ Send transactions  ✗ Change thresholds  ✗ Modify blueprints
//
//  USAGE
//  ─────
//  node scripts/tools/execution_sandbox_accumulator_report.js \
//    --sessions logs/session_20260417_1011 logs/session_20260417_2138 ...
//
//  node scripts/tools/execution_sandbox_accumulator_report.js \
//    --sessions logs/session_* \
//    --json > logs/session_LATEST/sandbox_accumulator.json
//
//  node scripts/tools/execution_sandbox_accumulator_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const { runSandbox } = require('../execution/execution_sandbox');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST = ARGS.includes('--self-test');
const FLAG_JSON      = ARGS.includes('--json');
const DELAYS         = (argVal('--delays', '0,500,1000'))
  .split(',').map(x => Number(x.trim())).filter(Number.isFinite);

function getSessionDirs() {
  const idx = ARGS.indexOf('--sessions');
  if (idx === -1) return [];
  const dirs = [];
  for (let i = idx + 1; i < ARGS.length; i++) {
    if (ARGS[i].startsWith('--')) break;
    dirs.push(ARGS[i]);
  }
  return dirs;
}

// ─── CONSISTENCY THRESHOLDS ───────────────────────────────────────────────────

const VIABLE_FLOOR           = 0.30;   // >= 30% viable in a session = "usable"
const CONSISTENCY_SESSION_PCT = 0.75;  // 75% of sessions must be usable
const MIN_SESSIONS_VERDICT    = 2;
const MIN_SESSIONS_STRONG     = 3;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ─── SINGLE-SESSION SANDBOX ───────────────────────────────────────────────────

async function runSessionSandbox(sessionDir) {
  const bpPath  = path.join(sessionDir, 'blueprints.jsonl');
  const rplPath = path.join(sessionDir, 'price_replay.jsonl');

  if (!fs.existsSync(bpPath) || !fs.existsSync(rplPath)) return null;

  const results = await runSandbox({
    blueprintsPath: bpPath,
    replayPath    : rplPath,
    delaysMs      : DELAYS,
  });

  // Per-delay stats for this session
  const byDelay = {};
  for (const delayMs of DELAYS) {
    const dr = results.filter(r => r.delayMs === delayMs);
    const viable  = dr.filter(r => r.executionClass === 'EXECUTION_VIABLE');
    const noFill  = dr.filter(r => r.outcome === 'SANDBOX_NO_FILL');
    const nets    = viable.map(r => r.realPnL).filter(n => Number.isFinite(n));

    byDelay[delayMs] = {
      total      : dr.length,
      viable     : viable.length,
      noFill     : noFill.length,
      viableRate : dr.length ? viable.length / dr.length : 0,
      noFillRate : dr.length ? noFill.length / dr.length : 0,
      avgNet     : avg(nets),
    };
  }

  return {
    label         : path.basename(sessionDir),
    blueprintCount: results.filter(r => r.delayMs === DELAYS[0]).length,
    byDelay,
  };
}

// ─── CROSS-SESSION AGGREGATION ────────────────────────────────────────────────

function aggregateDelays(sessionResults) {
  return DELAYS.map(delayMs => {
    const rows = sessionResults
      .map(s => s.byDelay[delayMs])
      .filter(r => r && r.total > 0);

    if (!rows.length) return { delayMs, sessionCount: 0, verdict: 'INSUFFICIENT_DATA' };

    const viableRates  = rows.map(r => r.viableRate);
    const noFillRates  = rows.map(r => r.noFillRate);
    const nets         = rows.map(r => r.avgNet).filter(n => n != null);

    const usableSessions  = rows.filter(r => r.viableRate >= VIABLE_FLOOR).length;
    const consistencyPct  = rows.length ? usableSessions / rows.length : 0;

    let verdict;
    if (rows.length < MIN_SESSIONS_VERDICT) {
      verdict = 'INSUFFICIENT_DATA';
    } else if (consistencyPct >= CONSISTENCY_SESSION_PCT) {
      verdict = rows.length >= MIN_SESSIONS_STRONG ? 'CONSISTENT_STRONG' : 'CONSISTENT';
    } else if (consistencyPct >= 0.5) {
      verdict = 'DEVELOPING';
    } else {
      verdict = 'INCONSISTENT';
    }

    return {
      delayMs,
      sessionCount     : rows.length,
      usableSessionCount: usableSessions,
      consistencyPct   : +consistencyPct.toFixed(4),
      verdict,
      avgViableRate    : avg(viableRates) != null ? +avg(viableRates).toFixed(4) : null,
      minViableRate    : Math.min(...viableRates),
      maxViableRate    : Math.max(...viableRates),
      avgNoFillRate    : avg(noFillRates) != null ? +avg(noFillRates).toFixed(4) : null,
      avgNetUsd        : avg(nets) != null ? +avg(nets).toFixed(4) : null,
    };
  });
}

// ─── DECAY SLOPE ──────────────────────────────────────────────────────────────

function computeDecay(aggregate) {
  const at0    = aggregate.find(r => r.delayMs === 0);
  const at500  = aggregate.find(r => r.delayMs === 500);
  const at1000 = aggregate.find(r => r.delayMs === 1000);

  if (!at0 || !at500 || !at1000) return null;

  const drop0to500  = at0.avgViableRate != null && at500.avgViableRate != null
    ? +(at0.avgViableRate - at500.avgViableRate).toFixed(4) : null;
  const drop500to1000 = at500.avgViableRate != null && at1000.avgViableRate != null
    ? +(at500.avgViableRate - at1000.avgViableRate).toFixed(4) : null;
  const drop0to1000 = at0.avgViableRate != null && at1000.avgViableRate != null
    ? +(at0.avgViableRate - at1000.avgViableRate).toFixed(4) : null;

  // Survivability verdict
  let survivalVerdict, survivalReason;
  const v1000 = at1000.avgViableRate ?? 0;
  const v0    = at0.avgViableRate ?? 0;
  const relRetention = v0 > 0 ? v1000 / v0 : 0;

  if (v1000 >= 0.60 && relRetention >= 0.70) {
    survivalVerdict = 'ROBUST';
    survivalReason  = `${(v1000*100).toFixed(1)}% viable at 1000ms — retains ${(relRetention*100).toFixed(0)}% of 0ms viability`;
  } else if (v1000 >= 0.30 && relRetention >= 0.40) {
    survivalVerdict = 'ACCEPTABLE';
    survivalReason  = `${(v1000*100).toFixed(1)}% viable at 1000ms — some decay but edge survives`;
  } else if (v1000 > 0) {
    survivalVerdict = 'FRAGILE';
    survivalReason  = `only ${(v1000*100).toFixed(1)}% viable at 1000ms — edge is delay-sensitive`;
  } else {
    survivalVerdict = 'FAILS_UNDER_DELAY';
    survivalReason  = `0% viable at 1000ms — execution must be near-instantaneous`;
  }

  return {
    drop0to500, drop500to1000, drop0to1000,
    survivalVerdict, survivalReason,
    relRetentionAt1000ms: +relRetention.toFixed(4),
  };
}

// ─── MAIN ANALYSIS ────────────────────────────────────────────────────────────

async function analyze(sessionDirs) {
  const sessionResults = [];
  const skipped        = [];

  for (const dir of sessionDirs) {
    const label = path.basename(dir);
    if (!FLAG_JSON) process.stdout.write(`  [sandbox] ${label}...`);
    try {
      const r = await runSessionSandbox(dir);
      if (!r) {
        skipped.push(label);
        if (!FLAG_JSON) process.stdout.write(' SKIPPED (missing files)\n');
      } else {
        sessionResults.push(r);
        if (!FLAG_JSON) {
          const d0 = r.byDelay[0];
          process.stdout.write(` done — ${r.blueprintCount} bps, 0ms viable=${(d0?.viableRate*100).toFixed(0)}%\n`);
        }
      }
    } catch (err) {
      skipped.push(label);
      if (!FLAG_JSON) process.stdout.write(` ERROR: ${err.message}\n`);
    }
  }

  sessionResults.sort((a, b) => a.label.localeCompare(b.label));

  const aggregate = aggregateDelays(sessionResults);
  const decay     = computeDecay(aggregate);

  return {
    generatedAt      : new Date().toISOString(),
    delays           : DELAYS,
    sessionsAnalyzed : sessionResults.length,
    sessionsSkipped  : skipped,
    consistencyFloor : VIABLE_FLOOR,
    aggregate,
    decay,
    perSession       : sessionResults,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function verdictClr(v) {
  const map = {
    CONSISTENT_STRONG : '\x1b[1;32m',
    CONSISTENT        : '\x1b[32m',
    DEVELOPING        : '\x1b[33m',
    INSUFFICIENT_DATA : '\x1b[90m',
    INCONSISTENT      : '\x1b[31m',
  };
  return (map[v] ?? '') + v + '\x1b[0m';
}

function survivalClr(v) {
  const map = {
    ROBUST           : '\x1b[1;32m',
    ACCEPTABLE       : '\x1b[32m',
    FRAGILE          : '\x1b[33m',
    FAILS_UNDER_DELAY: '\x1b[31m',
  };
  return (map[v] ?? '') + v + '\x1b[0m';
}

function printReport(result) {
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Cross-Session Execution Sandbox Accumulator  v1.0');
  console.log(`  ${result.generatedAt}`);
  console.log(EQ);
  console.log(`\n  Sessions analyzed:   ${result.sessionsAnalyzed}`);
  if (result.sessionsSkipped.length) {
    console.log(`  Sessions skipped:    ${result.sessionsSkipped.join(', ')}`);
  }
  console.log(`  Delays tested:       ${result.delays.join('ms, ')}ms`);
  console.log(`  Usable floor:        viable rate >= ${(result.consistencyFloor*100).toFixed(0)}%`);

  // ── Aggregate delay table ─────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  CROSS-SESSION AGGREGATE — by delay tier');
  console.log(`  ${DIV}`);
  console.log(
    '  ' + [
      'delay'.padStart(7), 'sessions'.padStart(9), 'usable'.padStart(7),
      'consist%'.padStart(9), 'avgViable%'.padStart(11),
      'minViable%'.padStart(11), 'avgNoFill%'.padStart(11),
      'avgNet$'.padStart(8), 'verdict',
    ].join('  ')
  );
  console.log('  ' + DIV);

  for (const r of result.aggregate) {
    if (!r.sessionCount) {
      console.log(`  ${(r.delayMs+'ms').padStart(7)}  (no data)`);
      continue;
    }
    console.log(
      '  ' + [
        (r.delayMs + 'ms').padStart(7),
        String(r.sessionCount).padStart(9),
        String(r.usableSessionCount).padStart(7),
        ((r.consistencyPct * 100).toFixed(0) + '%').padStart(9),
        ((r.avgViableRate * 100).toFixed(1) + '%').padStart(11),
        ((r.minViableRate * 100).toFixed(1) + '%').padStart(11),
        ((r.avgNoFillRate * 100).toFixed(1) + '%').padStart(11),
        (r.avgNetUsd != null ? '$' + r.avgNetUsd.toFixed(4) : '-').padStart(8),
        verdictClr(r.verdict),
      ].join('  ')
    );
  }

  // ── Decay analysis ────────────────────────────────────────────────────────
  if (result.decay) {
    const d = result.decay;
    console.log(`\n${EQ}`);
    console.log('  DECAY ANALYSIS — viable rate drop under delay');
    console.log(`  ${DIV}`);
    console.log(`  0ms → 500ms drop:   ${d.drop0to500 != null ? (d.drop0to500*100).toFixed(1)+'pp' : '-'}`);
    console.log(`  500ms → 1000ms drop:${d.drop500to1000 != null ? (d.drop500to1000*100).toFixed(1)+'pp' : '-'}`);
    console.log(`  0ms → 1000ms total: ${d.drop0to1000 != null ? (d.drop0to1000*100).toFixed(1)+'pp' : '-'}`);
    console.log(`  Retention at 1000ms:${d.relRetentionAt1000ms != null ? (d.relRetentionAt1000ms*100).toFixed(0)+'%' : '-'} of 0ms viability`);
    console.log(`\n  Survivability:  ${survivalClr(d.survivalVerdict)}`);
    console.log(`  Reason:         ${d.survivalReason}`);
  }

  // ── Per-session breakdown ─────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  PER-SESSION BREAKDOWN');
  console.log(`  ${DIV}`);
  const hdr = '  ' + 'session'.padEnd(30) + ' bps' +
    result.delays.map(d => (d + 'ms').padStart(9)).join('') + '  (viable%)';
  console.log(hdr);
  console.log('  ' + DIV);

  for (const s of result.perSession) {
    const rates = result.delays.map(d => {
      const r = s.byDelay[d];
      return r ? ((r.viableRate * 100).toFixed(0) + '%').padStart(9) : '        -';
    });
    console.log('  ' + s.label.padEnd(30) + String(s.blueprintCount).padStart(4) + rates.join(''));
  }

  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

async function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, got) {
    if (cond) { pass++; }
    else { fail++; console.log(`    ✗ FAIL: ${label}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); }
  }

  console.log('\n  Cross-Session Sandbox Accumulator — Self-Test\n');

  // ── aggregateDelays verdict thresholds ─────────────────────────────────────
  console.log('  Case 1: aggregateDelays verdict thresholds');
  {
    const mk = (viableRate) => ({
      byDelay: { 0: { total:10, viable: Math.round(viableRate*10), noFill:0,
                      viableRate, noFillRate:0, avgNet:0.18 } }
    });

    // 3 sessions all viable >= 30% → CONSISTENT
    const s3 = [mk(0.8), mk(0.9), mk(0.7)];
    const a3 = aggregateDelays(s3);
    assert('3 usable → CONSISTENT_STRONG (>=3)', a3[0].verdict === 'CONSISTENT_STRONG', a3[0].verdict);

    // 3+ strong sessions → CONSISTENT_STRONG
    const s4 = [mk(0.8), mk(0.9), mk(0.7), mk(0.85)];
    const a4 = aggregateDelays(s4);
    assert('4 usable → CONSISTENT_STRONG (>=3)', a4[0].verdict === 'CONSISTENT_STRONG', a4[0].verdict);

    // 1 session → INSUFFICIENT_DATA
    const s1 = [mk(0.8)];
    const a1 = aggregateDelays(s1);
    assert('1 session → INSUFFICIENT_DATA', a1[0].verdict === 'INSUFFICIENT_DATA', a1[0].verdict);

    // mixed — only 1 of 3 usable → INCONSISTENT
    const sMix = [mk(0.8), mk(0.1), mk(0.05)];
    const aMix = aggregateDelays(sMix);
    assert('1/3 usable → INCONSISTENT', aMix[0].verdict === 'INCONSISTENT', aMix[0].verdict);

    console.log(`    3-sess=${a3[0].verdict}  4-sess=${a4[0].verdict}  1-sess=${a1[0].verdict}  mix=${aMix[0].verdict}`);
  }
  console.log();

  // ── computeDecay ─────────────────────────────────────────────────────────
  console.log('  Case 2: computeDecay survivability verdicts');
  {
    const mkAgg = (v0, v500, v1000) => [
      { delayMs: 0,    avgViableRate: v0 },
      { delayMs: 500,  avgViableRate: v500 },
      { delayMs: 1000, avgViableRate: v1000 },
    ];

    const robust     = computeDecay(mkAgg(0.9, 0.85, 0.75));
    const acceptable = computeDecay(mkAgg(0.8, 0.5, 0.35));
    const fragile    = computeDecay(mkAgg(0.8, 0.3, 0.15));
    const fails      = computeDecay(mkAgg(0.8, 0.1, 0.0));

    assert('ROBUST',            robust.survivalVerdict     === 'ROBUST',            robust.survivalVerdict);
    assert('ACCEPTABLE',        acceptable.survivalVerdict === 'ACCEPTABLE',        acceptable.survivalVerdict);
    assert('FRAGILE',           fragile.survivalVerdict    === 'FRAGILE',           fragile.survivalVerdict);
    assert('FAILS_UNDER_DELAY', fails.survivalVerdict      === 'FAILS_UNDER_DELAY', fails.survivalVerdict);
    console.log(`    robust=${robust.survivalVerdict}  acceptable=${acceptable.survivalVerdict}  fragile=${fragile.survivalVerdict}  fails=${fails.survivalVerdict}`);
  }
  console.log();

  console.log('  ' + '═'.repeat(62));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(62) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (FLAG_SELF_TEST) { await runSelfTest(); return; }

  const sessionDirs = getSessionDirs();
  if (!sessionDirs.length) {
    console.error('[execution_sandbox_accumulator_report] No session directories provided.');
    console.error('  Usage: node scripts/tools/execution_sandbox_accumulator_report.js --sessions logs/session_* ...');
    process.exit(1);
  }

  if (!FLAG_JSON) {
    console.log(`[execution_sandbox_accumulator] Analyzing ${sessionDirs.length} session(s) at delays: ${DELAYS.join('ms, ')}ms`);
  }

  const result = await analyze(sessionDirs);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result);
  }
}

main().catch(err => {
  console.error(`execution_sandbox_accumulator_report error: ${err.message}`);
  process.exit(1);
});
