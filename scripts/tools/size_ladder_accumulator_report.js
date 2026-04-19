'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Cross-Session Size Ladder Accumulator  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/size_ladder_accumulator_report.js
//  STATUS    : NEW — Boss ruling 2026-04-19
//
//  PURPOSE
//  ───────
//  Run the size ladder analysis across multiple sessions and aggregate the
//  results. Answers the question: "Is Band A's performance at $500 consistent
//  across sessions, not just one unusually clean run?"
//
//  Per tier × size, across all sessions, reports:
//    - sessions tested
//    - sessions where viable rate >= CONSISTENCY_THRESHOLD (default 80%)
//    - avg viable rate across sessions
//    - avg fail rate across sessions
//    - avg worst-case positivity across sessions
//    - consistency verdict: CONSISTENT / DEVELOPING / INSUFFICIENT_DATA
//
//  Also emits per-session breakdowns so Boss can see individual session quality.
//
//  THIS MODULE DOES NOT:
//    ✗ Send transactions  ✗ Change filter rules  ✗ Modify blueprints
//
//  USAGE
//  ─────
//  node scripts/tools/size_ladder_accumulator_report.js \
//    --sessions logs/session_20260413_0810 logs/session_20260413_2012 ...
//
//  node scripts/tools/size_ladder_accumulator_report.js \
//    --sessions logs/session_* \
//    --json > logs/session_LATEST/size_ladder_accumulator.json
//
//  node scripts/tools/size_ladder_accumulator_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { simulateExecutionRealism } = require('../execution/execution_realism_simulator');
const { TIER_CONFIRMED_SPREAD, TIER_ADAPTIVE_SPREAD_LO } = require('../execution/candidate_audit');

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

// Collect session directories from --sessions arg (consumes all non-flag args after it)
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

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const LADDER_STRICT   = [200, 300, 500, 750, 1000];
const LADDER_ADAPTIVE = [200, 300];

// A size step is "consistent" when >= this fraction of sessions hit viable rate >= VIABLE_FLOOR
const CONSISTENCY_SESSION_PCT = 0.75;   // 75% of sessions must be consistent
const VIABLE_FLOOR            = 0.80;   // viable rate >= 80% in a session = "clean"

// Minimum sessions before issuing a verdict
const MIN_SESSIONS_VERDICT = 3;
const MIN_SESSIONS_STRONG  = 5;   // "strong" verdict threshold

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function bpTier(bp) {
  const spread = bp?.economics?.spreadPct ?? 0;
  if (spread >= TIER_CONFIRMED_SPREAD)   return 'CONFIRMED_STRICT';
  if (spread >= TIER_ADAPTIVE_SPREAD_LO) return 'ADAPTIVE_BUFFER';
  return 'BELOW_BUFFER';
}

function withSize(bp, sizeUsd) {
  return {
    ...bp,
    sizing:   { ...(bp.sizing   ?? {}), targetUsd: sizeUsd },
    _context: { ...(bp._context ?? {}), targetExecutionSizeUsd: sizeUsd },
  };
}

// ─── SINGLE-SESSION LADDER ────────────────────────────────────────────────────

function runSessionLadder(blueprints, ladder, tierKey) {
  if (!blueprints.length) return [];

  return ladder.map(sizeUsd => {
    const results = blueprints.map(bp => {
      try { return simulateExecutionRealism(withSize(bp, sizeUsd)); }
      catch { return { executionViable: false, executionClass: 'EXECUTION_FAIL',
                       expectedRealNetUsd: null, worstCaseNetUsd: null, failureProbability: 1 }; }
    });

    const viable  = results.filter(r => r.executionViable);
    const failed  = results.filter(r => r.executionClass === 'EXECUTION_FAIL');
    const nets    = viable.map(r => r.expectedRealNetUsd).filter(n => n != null);
    const worsts  = results.map(r => r.worstCaseNetUsd).filter(n => n != null);
    const failPrs = results.map(r => r.failureProbability).filter(n => n != null);

    return {
      sizeUsd,
      total        : results.length,
      viableCount  : viable.length,
      failCount    : failed.length,
      viableRate   : results.length ? viable.length / results.length : 0,
      failRate     : results.length ? failed.length / results.length : 0,
      avgNetUsd    : avg(nets),
      avgWorstUsd  : avg(worsts),
      worstPosRate : worsts.length ? worsts.filter(w => w > 0).length / worsts.length : 0,
      avgFailProb  : avg(failPrs),
    };
  });
}

// ─── CROSS-SESSION AGGREGATION ────────────────────────────────────────────────

/**
 * Aggregate per-size stats across multiple session ladder results.
 * sessionLadders: Array of { label, ladder: [{sizeUsd, viableRate, failRate, ...}] }
 */
function aggregateLadder(sessionLadders, ladder) {
  return ladder.map(sizeUsd => {
    const rows = sessionLadders
      .map(s => s.ladder.find(r => r.sizeUsd === sizeUsd))
      .filter(Boolean)
      .filter(r => r.total > 0);

    if (!rows.length) return { sizeUsd, sessionCount: 0, verdict: 'INSUFFICIENT_DATA' };

    const viableRates  = rows.map(r => r.viableRate);
    const failRates    = rows.map(r => r.failRate);
    const worstRates   = rows.map(r => r.worstPosRate);
    const netVals      = rows.map(r => r.avgNetUsd).filter(n => n != null);
    const failPrVals   = rows.map(r => r.avgFailProb).filter(n => n != null);

    const cleanSessions = rows.filter(r => r.viableRate >= VIABLE_FLOOR).length;
    const consistencyPct = rows.length ? cleanSessions / rows.length : 0;

    // Verdict
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
      sizeUsd,
      sessionCount        : rows.length,
      cleanSessionCount   : cleanSessions,
      consistencyPct      : +consistencyPct.toFixed(4),
      verdict,
      avgViableRate       : avg(viableRates) != null ? +avg(viableRates).toFixed(4) : null,
      avgFailRate         : avg(failRates)   != null ? +avg(failRates).toFixed(4)   : null,
      avgWorstPosRate     : avg(worstRates)  != null ? +avg(worstRates).toFixed(4)  : null,
      avgNetUsd           : avg(netVals)     != null ? +avg(netVals).toFixed(4)     : null,
      avgFailProb         : avg(failPrVals)  != null ? +avg(failPrVals).toFixed(4)  : null,
      minViableRate       : Math.min(...viableRates),
      maxViableRate       : Math.max(...viableRates),
    };
  });
}

// ─── POLICY RECOMMENDATION ────────────────────────────────────────────────────

function buildPolicyRecommendation(strictAgg, adaptiveAgg) {
  // Find highest size where Band A has CONSISTENT or CONSISTENT_STRONG verdict
  const approvedSizes = strictAgg
    .filter(r => r.verdict === 'CONSISTENT' || r.verdict === 'CONSISTENT_STRONG')
    .map(r => r.sizeUsd);

  const highestApproved   = approvedSizes.length ? Math.max(...approvedSizes) : null;
  const nextTestCandidate = strictAgg.find(r => r.verdict === 'DEVELOPING' || r.verdict === 'INSUFFICIENT_DATA')?.sizeUsd ?? null;

  // Band B recommendation
  const bandBAt200 = adaptiveAgg.find(r => r.sizeUsd === 200);
  let bandBVerdict = 'WATCH_ONLY';
  if (bandBAt200) {
    if (bandBAt200.verdict === 'CONSISTENT' || bandBAt200.verdict === 'CONSISTENT_STRONG') {
      bandBVerdict = 'LIGHTLY_EXECUTABLE';
    } else if (bandBAt200.verdict === 'DEVELOPING') {
      bandBVerdict = 'PROVISIONAL_EXECUTABLE';
    }
  }

  return {
    bandA: {
      highestApprovedSize  : highestApproved,
      nextTestCandidateSize: nextTestCandidate,
      recommendation       : highestApproved
        ? `Band A approved up to $${highestApproved}. Next test: $${nextTestCandidate ?? 'n/a'}.`
        : 'Band A not yet approved beyond baseline — need more sessions.',
    },
    bandB: {
      verdict       : bandBVerdict,
      recommendation: bandBVerdict === 'LIGHTLY_EXECUTABLE'
        ? 'Band B is consistently safe at $200. Allow $200–$300 observational tier.'
        : bandBVerdict === 'PROVISIONAL_EXECUTABLE'
        ? 'Band B developing — allow $200 only, watch closely.'
        : 'Band B watch-only — insufficient cross-session consistency.',
    },
    globalNote: '$1000 requires CONSISTENT_STRONG verdict (>=5 sessions). Do not promote on one session alone.',
  };
}

// ─── MAIN ANALYSIS ────────────────────────────────────────────────────────────

function analyze(sessionDirs) {
  const sessionResults = [];
  const skipped = [];

  for (const dir of sessionDirs) {
    const label = path.basename(dir);
    const bpPath = path.join(dir, 'blueprints.jsonl');
    if (!fs.existsSync(bpPath)) { skipped.push(label); continue; }

    const blueprints = readJsonl(bpPath);
    const strict   = blueprints.filter(bp => bpTier(bp) === 'CONFIRMED_STRICT');
    const adaptive = blueprints.filter(bp => bpTier(bp) === 'ADAPTIVE_BUFFER');

    if (!strict.length && !adaptive.length) { skipped.push(label); continue; }

    sessionResults.push({
      label,
      totalBlueprints  : blueprints.length,
      confirmedCount   : strict.length,
      adaptiveCount    : adaptive.length,
      strictLadder     : runSessionLadder(strict,   LADDER_STRICT,   'CONFIRMED_STRICT'),
      adaptiveLadder   : runSessionLadder(adaptive, LADDER_ADAPTIVE, 'ADAPTIVE_BUFFER'),
    });
  }

  sessionResults.sort((a, b) => a.label.localeCompare(b.label));

  const strictAgg   = aggregateLadder(
    sessionResults.map(s => ({ label: s.label, ladder: s.strictLadder })),
    LADDER_STRICT
  );
  const adaptiveAgg = aggregateLadder(
    sessionResults.map(s => ({ label: s.label, ladder: s.adaptiveLadder })),
    LADDER_ADAPTIVE
  );

  const policy = buildPolicyRecommendation(strictAgg, adaptiveAgg);

  return {
    generatedAt      : new Date().toISOString(),
    sessionsAnalyzed : sessionResults.length,
    sessionsSkipped  : skipped,
    consistencyFloor : VIABLE_FLOOR,
    consistencyPct   : CONSISTENCY_SESSION_PCT,
    minSessionsVerdict: MIN_SESSIONS_VERDICT,
    minSessionsStrong : MIN_SESSIONS_STRONG,
    confirmedSpread  : TIER_CONFIRMED_SPREAD,
    adaptiveSpreadLo : TIER_ADAPTIVE_SPREAD_LO,
    confirmedStrict  : { aggregate: strictAgg,   perSession: sessionResults.map(s => ({ label: s.label, confirmedCount: s.confirmedCount, ladder: s.strictLadder })) },
    adaptiveBuffer   : { aggregate: adaptiveAgg, perSession: sessionResults.map(s => ({ label: s.label, adaptiveCount: s.adaptiveCount,  ladder: s.adaptiveLadder })) },
    policy,
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

function printReport(result) {
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Cross-Session Size Ladder Accumulator  v1.0');
  console.log(`  ${result.generatedAt}`);
  console.log(EQ);
  console.log(`\n  Sessions analyzed:   ${result.sessionsAnalyzed}`);
  if (result.sessionsSkipped.length) {
    console.log(`  Sessions skipped:    ${result.sessionsSkipped.join(', ')}`);
  }
  console.log(`  Consistency floor:   viable rate >= ${(result.consistencyFloor*100).toFixed(0)}% in >= ${(result.consistencyPct*100).toFixed(0)}% of sessions`);
  console.log(`  Verdict threshold:   >= ${result.minSessionsVerdict} sessions (CONSISTENT), >= ${result.minSessionsStrong} sessions (CONSISTENT_STRONG)`);

  // ── Band A aggregate ──────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  BAND A — CONFIRMED_STRICT  cross-session aggregate');
  console.log(`  ${DIV}`);
  console.log('  ' + 'size'.padStart(6) + '  ' + 'sessions'.padStart(8) + '  ' + 'clean'.padStart(6) + '  ' + 'consist%'.padStart(9) + '  ' + 'avgViable%'.padStart(11) + '  ' + 'avgFail%'.padStart(9) + '  ' + 'avgNet$'.padStart(8) + '  verdict');
  console.log('  ' + DIV);
  for (const r of result.confirmedStrict.aggregate) {
    if (!r.sessionCount) { console.log(`  ${'$'+r.sizeUsd}  (no data)`); continue; }
    console.log(
      '  ' +
      ('$'+r.sizeUsd).padStart(6) + '  ' +
      String(r.sessionCount).padStart(8) + '  ' +
      String(r.cleanSessionCount).padStart(6) + '  ' +
      ((r.consistencyPct*100).toFixed(0)+'%').padStart(9) + '  ' +
      ((r.avgViableRate*100).toFixed(1)+'%').padStart(11) + '  ' +
      ((r.avgFailRate*100).toFixed(1)+'%').padStart(9) + '  ' +
      (r.avgNetUsd != null ? '$'+r.avgNetUsd.toFixed(4) : '-').padStart(8) + '  ' +
      verdictClr(r.verdict)
    );
  }

  // ── Band B aggregate ──────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  BAND B — ADAPTIVE_BUFFER  cross-session aggregate');
  console.log(`  ${DIV}`);
  const hasAdaptive = result.adaptiveBuffer.aggregate.some(r => r.sessionCount > 0);
  if (!hasAdaptive) {
    console.log('  No adaptive buffer blueprints found across sessions.');
  } else {
    console.log('  ' + 'size'.padStart(6) + '  ' + 'sessions'.padStart(8) + '  ' + 'clean'.padStart(6) + '  ' + 'consist%'.padStart(9) + '  ' + 'avgViable%'.padStart(11) + '  ' + 'avgFail%'.padStart(9) + '  ' + 'avgNet$'.padStart(8) + '  verdict');
    console.log('  ' + DIV);
    for (const r of result.adaptiveBuffer.aggregate) {
      if (!r.sessionCount) { console.log(`  ${'$'+r.sizeUsd}  (no data)`); continue; }
      console.log(
        '  ' +
        ('$'+r.sizeUsd).padStart(6) + '  ' +
        String(r.sessionCount).padStart(8) + '  ' +
        String(r.cleanSessionCount).padStart(6) + '  ' +
        ((r.consistencyPct*100).toFixed(0)+'%').padStart(9) + '  ' +
        ((r.avgViableRate*100).toFixed(1)+'%').padStart(11) + '  ' +
        ((r.avgFailRate*100).toFixed(1)+'%').padStart(9) + '  ' +
        (r.avgNetUsd != null ? '$'+r.avgNetUsd.toFixed(4) : '-').padStart(8) + '  ' +
        verdictClr(r.verdict)
      );
    }
  }

  // ── Per-session breakdown ─────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  PER-SESSION BREAKDOWN — BAND A');
  console.log(`  ${DIV}`);
  const hdr = '  ' + 'session'.padEnd(28) + ' conf  ' + LADDER_STRICT.map(s => ('$'+s).padStart(7)).join('  ');
  console.log(hdr + '  (viable%)');
  console.log('  ' + DIV);
  for (const s of result.confirmedStrict.perSession) {
    const rates = LADDER_STRICT.map(sz => {
      const r = s.ladder.find(r => r.sizeUsd === sz);
      return r ? ((r.viableRate*100).toFixed(0)+'%').padStart(7) : '     -';
    });
    console.log('  ' + s.label.padEnd(28) + ` ${String(s.confirmedCount).padStart(4)}  ` + rates.join('  '));
  }

  if (hasAdaptive) {
    console.log(`\n  ${DIV}`);
    console.log('  PER-SESSION BREAKDOWN — BAND B');
    console.log('  ' + DIV);
    const hdrB = '  ' + 'session'.padEnd(28) + ' adap  ' + LADDER_ADAPTIVE.map(s => ('$'+s).padStart(7)).join('  ');
    console.log(hdrB + '  (viable%)');
    console.log('  ' + DIV);
    for (const s of result.adaptiveBuffer.perSession) {
      if (!s.adaptiveCount) continue;
      const rates = LADDER_ADAPTIVE.map(sz => {
        const r = s.ladder.find(r => r.sizeUsd === sz);
        return r ? ((r.viableRate*100).toFixed(0)+'%').padStart(7) : '     -';
      });
      console.log('  ' + s.label.padEnd(28) + ` ${String(s.adaptiveCount).padStart(4)}  ` + rates.join('  '));
    }
  }

  // ── Policy recommendation ─────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  POLICY RECOMMENDATION');
  console.log(`  ${DIV}`);
  const p = result.policy;
  console.log(`\n  Band A:  ${p.bandA.recommendation}`);
  const bandBClr = p.bandB.verdict === 'LIGHTLY_EXECUTABLE' ? '\x1b[1;32m' : p.bandB.verdict === 'PROVISIONAL_EXECUTABLE' ? '\x1b[33m' : '\x1b[90m';
  console.log(`  Band B:  ${bandBClr}${p.bandB.verdict}\x1b[0m  —  ${p.bandB.recommendation}`);
  console.log(`\n  Note:    ${p.globalNote}`);
  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, got) {
    if (cond) { pass++; }
    else { fail++; console.log(`    ✗ FAIL: ${label}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); }
  }

  console.log('\n  Size Ladder Accumulator — Self-Test\n');

  function mkBp(spreadPct, sizeUsd) {
    return {
      blueprintId: `TEST-${Math.random().toString(36).slice(2)}`,
      pair: 'ETH/USDC-RAMSES',
      economics : { spreadPct, gasCostUsd: 0.028, netProfitUsd: 0.15 },
      sizing    : { targetUsd: sizeUsd },
      venues    : { entry: { feePct: 0.0001 }, exit: { feePct: 0.0005 } },
      viability : { confidenceScore: 0.75 },
      _context  : { regime: 'surge', activeProfile: 'SAFE', heatClass: 'EXTREME' },
    };
  }

  // Mock session dirs by creating temp files
  const os   = require('os');
  const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'accum_test_a_'));
  const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'accum_test_b_'));
  const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), 'accum_test_c_'));
  const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'accum_test_empty_'));

  const makeBps = (spreads, size) => spreads.map(s => mkBp(s, size));

  // Session A: 5 confirmed strict blueprints
  const bpsA = makeBps([0.23, 0.24, 0.25, 0.26, 0.28], 200);
  fs.writeFileSync(path.join(tmpA, 'blueprints.jsonl'), bpsA.map(b => JSON.stringify(b)).join('\n'));

  // Session B: 3 confirmed + 2 adaptive
  const bpsB = [...makeBps([0.23, 0.25, 0.27], 200), ...makeBps([0.219, 0.2195], 200)];
  fs.writeFileSync(path.join(tmpB, 'blueprints.jsonl'), bpsB.map(b => JSON.stringify(b)).join('\n'));

  // Session C: 4 confirmed
  const bpsC = makeBps([0.22, 0.23, 0.24, 0.25], 200);
  fs.writeFileSync(path.join(tmpC, 'blueprints.jsonl'), bpsC.map(b => JSON.stringify(b)).join('\n'));

  // Empty session — no blueprints.jsonl
  // (tmpEmpty has no file)

  console.log('  Case 1: analyze with 3 valid sessions + 1 empty');
  const result = analyze([tmpA, tmpB, tmpC, tmpEmpty]);
  assert('sessionsAnalyzed = 3',     result.sessionsAnalyzed === 3, result.sessionsAnalyzed);
  assert('sessionsSkipped has empty', result.sessionsSkipped.length >= 1);
  assert('confirmedStrict aggregate has ladder steps',
    result.confirmedStrict.aggregate.length === LADDER_STRICT.length);
  assert('adaptiveBuffer aggregate has ladder steps',
    result.adaptiveBuffer.aggregate.length === LADDER_ADAPTIVE.length);
  assert('policy.bandA.recommendation is string', typeof result.policy.bandA.recommendation === 'string');
  assert('policy.bandB.verdict is string',        typeof result.policy.bandB.verdict === 'string');
  console.log(`    sessions=${result.sessionsAnalyzed}  skipped=${result.sessionsSkipped.length}`);
  console.log(`    bandA recommendation: ${result.policy.bandA.recommendation}`);
  console.log(`    bandB verdict: ${result.policy.bandB.verdict}`);
  console.log();

  console.log('  Case 2: aggregateLadder verdict thresholds');
  {
    // 3 sessions all with viableRate=1.0 → CONSISTENT (>= MIN_SESSIONS_VERDICT=3)
    const sess3 = [
      { label: 's1', ladder: [{ sizeUsd: 200, total: 5, viableRate: 1.0, failRate: 0, worstPosRate: 1.0, avgNetUsd: 0.18, avgFailProb: 0.26 }] },
      { label: 's2', ladder: [{ sizeUsd: 200, total: 5, viableRate: 1.0, failRate: 0, worstPosRate: 1.0, avgNetUsd: 0.17, avgFailProb: 0.27 }] },
      { label: 's3', ladder: [{ sizeUsd: 200, total: 5, viableRate: 1.0, failRate: 0, worstPosRate: 1.0, avgNetUsd: 0.19, avgFailProb: 0.25 }] },
    ];
    const agg3 = aggregateLadder(sess3, [200]);
    assert('3 sessions 100% viable → CONSISTENT', agg3[0].verdict === 'CONSISTENT', agg3[0].verdict);

    // 5 sessions → CONSISTENT_STRONG
    const sess5 = [...sess3,
      { label: 's4', ladder: [{ sizeUsd: 200, total: 5, viableRate: 1.0, failRate: 0, worstPosRate: 1.0, avgNetUsd: 0.18, avgFailProb: 0.26 }] },
      { label: 's5', ladder: [{ sizeUsd: 200, total: 5, viableRate: 1.0, failRate: 0, worstPosRate: 1.0, avgNetUsd: 0.20, avgFailProb: 0.24 }] },
    ];
    const agg5 = aggregateLadder(sess5, [200]);
    assert('5 sessions 100% viable → CONSISTENT_STRONG', agg5[0].verdict === 'CONSISTENT_STRONG', agg5[0].verdict);

    // 2 sessions → INSUFFICIENT_DATA
    const sess2 = sess3.slice(0, 2);
    const agg2 = aggregateLadder(sess2, [200]);
    assert('2 sessions → INSUFFICIENT_DATA', agg2[0].verdict === 'INSUFFICIENT_DATA', agg2[0].verdict);

    // 3 sessions, only 1 clean (33%) → INCONSISTENT
    const sessMix = [
      { label: 's1', ladder: [{ sizeUsd: 200, total: 5, viableRate: 1.0, failRate: 0, worstPosRate: 1.0, avgNetUsd: 0.18, avgFailProb: 0.26 }] },
      { label: 's2', ladder: [{ sizeUsd: 200, total: 5, viableRate: 0.2, failRate: 0.8, worstPosRate: 0.2, avgNetUsd: null, avgFailProb: 0.80 }] },
      { label: 's3', ladder: [{ sizeUsd: 200, total: 5, viableRate: 0.3, failRate: 0.7, worstPosRate: 0.3, avgNetUsd: null, avgFailProb: 0.75 }] },
    ];
    const aggMix = aggregateLadder(sessMix, [200]);
    assert('3 sessions only 1 clean → INCONSISTENT', aggMix[0].verdict === 'INCONSISTENT', aggMix[0].verdict);
    console.log(`    3-sess verdict=${agg3[0].verdict}  5-sess verdict=${agg5[0].verdict}  2-sess verdict=${agg2[0].verdict}  mix verdict=${aggMix[0].verdict}`);
  }
  console.log();

  console.log('  Case 3: policy recommendation');
  {
    const r = analyze([tmpA, tmpB, tmpC]);
    const p = r.policy;
    assert('bandA has recommendation',   typeof p.bandA.recommendation === 'string');
    assert('bandB has recommendation',   typeof p.bandB.recommendation === 'string');
    assert('globalNote present',         typeof p.globalNote === 'string');
    console.log(`    bandA.highestApproved=${p.bandA.highestApprovedSize}  bandB=${p.bandB.verdict}`);
  }
  console.log();

  // Cleanup
  [tmpA, tmpB, tmpC, tmpEmpty].forEach(d => fs.rmSync(d, { recursive: true, force: true }));

  console.log('  ' + '═'.repeat(62));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(62) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  const sessionDirs = getSessionDirs();
  if (!sessionDirs.length) {
    console.error('[size_ladder_accumulator_report] No session directories provided.');
    console.error('  Usage: node scripts/tools/size_ladder_accumulator_report.js --sessions logs/session_* ...');
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write(`[size_ladder_accumulator_report] Analyzing ${sessionDirs.length} session(s)...\n`);

  const result = analyze(sessionDirs);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result);
  }
}

main();
