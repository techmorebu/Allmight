'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Size Ladder Analysis by Threshold Tier  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/size_ladder_report.js
//  STATUS    : NEW — Boss ruling 2026-04-19
//
//  PURPOSE
//  ───────
//  Run the execution realism simulator across a size ladder, broken out by
//  threshold tier (CONFIRMED_STRICT / ADAPTIVE_BUFFER).
//
//  For each tier × size combination, report:
//    - viable rate (EXECUTION_VIABLE / total)
//    - avg expected real net USD
//    - avg worst-case net USD
//    - worst-case positivity rate (worstCaseNetUsd > 0)
//    - fail rate (EXECUTION_FAIL / total)
//    - avg failure probability
//
//  Also emits a comparison section:
//    - marginal gain from adding Band B (extra viable count, extra avg net)
//    - extra risk introduced by Band B vs Band A at same size
//    - recommendation: whether Band B stays watch-only or is lightly executable
//
//  THIS MODULE DOES NOT:
//    ✗ Send transactions
//    ✗ Change filter rules or thresholds
//    ✗ Modify blueprint data
//
//  USAGE
//  ─────
//  node scripts/tools/size_ladder_report.js \
//    --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl
//
//  node scripts/tools/size_ladder_report.js \
//    --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
//    --json > logs/session_YYYYMMDD_HHMM/size_ladder.json
//
//  node scripts/tools/size_ladder_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { simulateExecutionRealism } = require('../execution/execution_realism_simulator');
const { classifyThresholdTier,
        TIER_CONFIRMED_SPREAD,
        TIER_ADAPTIVE_SPREAD_LO,
        TIER_ADAPTIVE_MIN_CONF }   = require('../execution/candidate_audit');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i  = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST = ARGS.includes('--self-test');
const FLAG_JSON      = ARGS.includes('--json');

const BLUEPRINTS_PATH = argVal('--blueprints', 'logs/trade_blueprints.jsonl');

// ─── SIZE LADDER ──────────────────────────────────────────────────────────────
// Boss ruling 2026-04-19:
//   CONFIRMED_STRICT : $200, $300, $500, $750, $1000
//   ADAPTIVE_BUFFER  : $200, $300 (do not assume same scaling as strict)

const LADDER_STRICT  = [200, 300, 500, 750, 1000];
const LADDER_ADAPTIVE = [200, 300];

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

/**
 * Classify a blueprint into a threshold tier.
 * Adapts candidate_audit's classifyThresholdTier to work directly on blueprint
 * objects (which don't have execution_confidence or worstCaseNetUsd yet).
 *
 * For ladder analysis, we use a simplified tier split:
 *   CONFIRMED_STRICT : spreadPct >= TIER_CONFIRMED_SPREAD
 *   ADAPTIVE_BUFFER  : TIER_ADAPTIVE_SPREAD_LO <= spreadPct < TIER_CONFIRMED_SPREAD
 *
 * The full safety conditions (conf >= 0.70, worst > 0, etc.) are applied when
 * classifying audit records. For blueprints pre-simulation, we use spread only
 * as the tier gate — the realism simulator output will reveal whether the record
 * actually passes the safety conditions for Band B.
 */
function bpTier(bp) {
  const spread = bp?.economics?.spreadPct ?? 0;
  if (spread >= TIER_CONFIRMED_SPREAD) return 'CONFIRMED_STRICT';
  if (spread >= TIER_ADAPTIVE_SPREAD_LO) return 'ADAPTIVE_BUFFER';
  return 'BELOW_BUFFER';
}

/**
 * Override the targetUsd in a blueprint for ladder simulation.
 * Returns a shallow-cloned blueprint — does NOT mutate the original.
 */
function withSize(bp, sizeUsd) {
  return {
    ...bp,
    sizing: { ...(bp.sizing ?? {}), targetUsd: sizeUsd },
    _context: { ...(bp._context ?? {}), targetExecutionSizeUsd: sizeUsd },
  };
}

// ─── CORE ANALYSIS ────────────────────────────────────────────────────────────

/**
 * Run the size ladder for a single tier's blueprints.
 *
 * @param {object[]} blueprints   Blueprints for this tier
 * @param {number[]} ladder       Size steps to test
 * @param {string}   tierLabel    For output labeling
 * @returns {object}  { tier, blueprintCount, ladder: [ { sizeUsd, stats } ] }
 */
function runLadder(blueprints, ladder, tierLabel) {
  if (!blueprints.length) return { tier: tierLabel, blueprintCount: 0, ladder: [] };

  const ladderResults = ladder.map(sizeUsd => {
    const results = blueprints.map(bp => {
      try {
        return simulateExecutionRealism(withSize(bp, sizeUsd));
      } catch (err) {
        return { executionClass: 'EXECUTION_FAIL', executionViable: false,
                 expectedRealNetUsd: null, worstCaseNetUsd: null,
                 failureProbability: 1.0, _error: err.message };
      }
    });

    const viable   = results.filter(r => r.executionViable);
    const failed   = results.filter(r => r.executionClass === 'EXECUTION_FAIL');
    const marginal = results.filter(r => r.executionClass === 'EXECUTION_MARGINAL');

    const nets    = viable.map(r => r.expectedRealNetUsd).filter(n => n != null);
    const worsts  = results.map(r => r.worstCaseNetUsd).filter(n => n != null);
    const failPrs = results.map(r => r.failureProbability).filter(n => n != null);

    return {
      sizeUsd,
      total        : results.length,
      viableCount  : viable.length,
      marginalCount: marginal.length,
      failCount    : failed.length,
      viableRate   : results.length ? viable.length / results.length : 0,
      failRate     : results.length ? failed.length / results.length : 0,
      avgNetUsd    : avg(nets),
      minNetUsd    : nets.length ? Math.min(...nets) : null,
      maxNetUsd    : nets.length ? Math.max(...nets) : null,
      avgWorstUsd  : avg(worsts),
      worstPosRate : worsts.length ? worsts.filter(w => w > 0).length / worsts.length : 0,
      avgFailProb  : avg(failPrs),
    };
  });

  return { tier: tierLabel, blueprintCount: blueprints.length, ladder: ladderResults };
}

/**
 * Compute the comparison section: Band B vs Band A at the same $200 baseline.
 */
function buildComparison(strictResult, adaptiveResult) {
  const s200 = strictResult.ladder.find(r => r.sizeUsd === 200);
  const a200 = adaptiveResult.ladder.find(r => r.sizeUsd === 200);
  const s300 = strictResult.ladder.find(r => r.sizeUsd === 300);
  const a300 = adaptiveResult.ladder.find(r => r.sizeUsd === 300);

  function delta(a, b, field) {
    if (!a || !b || a[field] == null || b[field] == null) return null;
    return +(b[field] - a[field]).toFixed(6);
  }

  const at200 = {
    sizeUsd           : 200,
    extraViableCount  : (a200?.viableCount ?? 0),
    extraAvgNetUsd    : a200?.avgNetUsd ?? null,
    bandBViableRate   : a200?.viableRate ?? null,
    bandBFailRate     : a200?.failRate ?? null,
    bandBWorstPosRate : a200?.worstPosRate ?? null,
    bandBAvgFailProb  : a200?.avgFailProb ?? null,
    bandAViableRate   : s200?.viableRate ?? null,
    bandAFailRate     : s200?.failRate ?? null,
    riskDeltaFailRate : delta(s200, a200, 'failRate'),
    riskDeltaWorstPos : delta(s200, a200, 'worstPosRate'),
  };

  const at300 = s300 && a300 ? {
    sizeUsd           : 300,
    extraViableCount  : (a300?.viableCount ?? 0),
    extraAvgNetUsd    : a300?.avgNetUsd ?? null,
    bandBViableRate   : a300?.viableRate ?? null,
    bandBFailRate     : a300?.failRate ?? null,
    bandBWorstPosRate : a300?.worstPosRate ?? null,
    bandAViableRate   : s300?.viableRate ?? null,
    bandAFailRate     : s300?.failRate ?? null,
    riskDeltaFailRate : delta(s300, a300, 'failRate'),
    riskDeltaWorstPos : delta(s300, a300, 'worstPosRate'),
  } : null;

  // Recommendation logic
  //  - Band B is lightly executable if: viable rate >= 50% AND worst-case positivity >= 60%
  //    AND fail rate is not more than 20pp worse than Band A
  //  - Otherwise: watch-only
  let recommendation = 'WATCH_ONLY';
  let recommendationReason = '';
  if (a200) {
    const bandAFail = s200?.failRate ?? 1;
    const bandBFail = a200.failRate ?? 1;
    const failDelta = bandBFail - bandAFail;
    const viableEnough = (a200.viableRate ?? 0) >= 0.50;
    const worstOk      = (a200.worstPosRate ?? 0) >= 0.60;
    const riskOk       = failDelta <= 0.20;

    if (viableEnough && worstOk && riskOk) {
      recommendation = 'LIGHTLY_EXECUTABLE';
      recommendationReason =
        `viableRate=${(a200.viableRate*100).toFixed(1)}% >= 50%  ` +
        `worstPosRate=${(a200.worstPosRate*100).toFixed(1)}% >= 60%  ` +
        `failDelta=+${(failDelta*100).toFixed(1)}pp <= 20pp`;
    } else {
      const reasons = [];
      if (!viableEnough) reasons.push(`viableRate=${((a200.viableRate??0)*100).toFixed(1)}% < 50%`);
      if (!worstOk)      reasons.push(`worstPosRate=${((a200.worstPosRate??0)*100).toFixed(1)}% < 60%`);
      if (!riskOk)       reasons.push(`failDelta=+${(failDelta*100).toFixed(1)}pp > 20pp`);
      recommendationReason = reasons.join('  ');
    }
  } else {
    recommendationReason = 'insufficient adaptive buffer blueprints';
  }

  return { at200, at300, recommendation, recommendationReason };
}

// ─── MAIN ANALYSIS ────────────────────────────────────────────────────────────

function analyze(blueprints) {
  const strict   = blueprints.filter(bp => bpTier(bp) === 'CONFIRMED_STRICT');
  const adaptive = blueprints.filter(bp => bpTier(bp) === 'ADAPTIVE_BUFFER');

  const strictResult   = runLadder(strict,   LADDER_STRICT,   'CONFIRMED_STRICT');
  const adaptiveResult = runLadder(adaptive, LADDER_ADAPTIVE, 'ADAPTIVE_BUFFER');
  const comparison     = buildComparison(strictResult, adaptiveResult);

  return {
    generatedAt       : new Date().toISOString(),
    totalBlueprints   : blueprints.length,
    confirmedCount    : strict.length,
    adaptiveCount     : adaptive.length,
    confirmedSpread   : TIER_CONFIRMED_SPREAD,
    adaptiveSpreadLo  : TIER_ADAPTIVE_SPREAD_LO,
    adaptiveMinConf   : TIER_ADAPTIVE_MIN_CONF,
    confirmedStrict   : strictResult,
    adaptiveBuffer    : adaptiveResult,
    comparison,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(result) {
  const W   = 75;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Size Ladder Analysis by Threshold Tier  v1.0');
  console.log(`  ${result.generatedAt}`);
  console.log(EQ);
  console.log(`\n  Total blueprints:       ${result.totalBlueprints}`);
  console.log(`  CONFIRMED_STRICT:       ${result.confirmedCount}  (spread >= ${result.confirmedSpread}%)`);
  console.log(`  ADAPTIVE_BUFFER:        ${result.adaptiveCount}  (${result.adaptiveSpreadLo}% – ${result.confirmedSpread}%)`);

  // ── Band A: CONFIRMED_STRICT ──────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  BAND A — CONFIRMED_STRICT  (scaling lane)');
  console.log(`  ${DIV}`);
  console.log('  ' + 'size'.padStart(6) + '  ' + 'viable%'.padStart(8) + '  ' + 'fail%'.padStart(7) + '  ' + 'avgNet$'.padStart(8) + '  ' + 'minNet$'.padStart(8) + '  ' + 'maxNet$'.padStart(8) + '  ' + 'worst>0%'.padStart(8) + '  ' + 'avgFailP'.padStart(8));
  console.log(`  ${DIV}`);
  for (const r of result.confirmedStrict.ladder) {
    const row = [
      ('$'+r.sizeUsd).padStart(6),
      ((r.viableRate*100).toFixed(1)+'%').padStart(8),
      ((r.failRate*100).toFixed(1)+'%').padStart(7),
      (r.avgNetUsd   != null ? '$'+r.avgNetUsd.toFixed(4)   : '-').padStart(8),
      (r.minNetUsd   != null ? '$'+r.minNetUsd.toFixed(4)   : '-').padStart(8),
      (r.maxNetUsd   != null ? '$'+r.maxNetUsd.toFixed(4)   : '-').padStart(8),
      ((r.worstPosRate*100).toFixed(1)+'%').padStart(8),
      (r.avgFailProb != null ? r.avgFailProb.toFixed(3) : '-').padStart(8),
    ].join('  ');
    console.log('  ' + row);
  }

  // ── Band B: ADAPTIVE_BUFFER ────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  BAND B — ADAPTIVE_BUFFER  (controlled opportunity lane)');
  console.log(`  ${DIV}`);
  if (!result.adaptiveBuffer.blueprintCount) {
    console.log('  No adaptive buffer blueprints in this session.');
  } else {
    console.log('  ' + 'size'.padStart(6) + '  ' + 'viable%'.padStart(8) + '  ' + 'fail%'.padStart(7) + '  ' + 'avgNet$'.padStart(8) + '  ' + 'minNet$'.padStart(8) + '  ' + 'maxNet$'.padStart(8) + '  ' + 'worst>0%'.padStart(8) + '  ' + 'avgFailP'.padStart(8));
    console.log(`  ${DIV}`);
    for (const r of result.adaptiveBuffer.ladder) {
      const row = [
        ('$'+r.sizeUsd).padStart(6),
        ((r.viableRate*100).toFixed(1)+'%').padStart(8),
        ((r.failRate*100).toFixed(1)+'%').padStart(7),
        (r.avgNetUsd   != null ? '$'+r.avgNetUsd.toFixed(4)   : '-').padStart(8),
        (r.minNetUsd   != null ? '$'+r.minNetUsd.toFixed(4)   : '-').padStart(8),
        (r.maxNetUsd   != null ? '$'+r.maxNetUsd.toFixed(4)   : '-').padStart(8),
        ((r.worstPosRate*100).toFixed(1)+'%').padStart(8),
        (r.avgFailProb != null ? r.avgFailProb.toFixed(3) : '-').padStart(8),
      ].join('  ');
      console.log('  ' + row);
    }
  }

  // ── Comparison ────────────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  COMPARISON — Band A vs Band B');
  console.log(`  ${DIV}`);

  for (const comp of [result.comparison.at200, result.comparison.at300].filter(Boolean)) {
    console.log(`\n  At $${comp.sizeUsd}:`);
    console.log(`    Band A viable rate:       ${comp.bandAViableRate != null ? (comp.bandAViableRate*100).toFixed(1)+'%' : '-'}`);
    console.log(`    Band B viable rate:       ${comp.bandBViableRate != null ? (comp.bandBViableRate*100).toFixed(1)+'%' : '-'}`);
    console.log(`    Band B extra viable:      ${comp.extraViableCount} records`);
    console.log(`    Band B avg net:           ${comp.extraAvgNetUsd != null ? '$'+comp.extraAvgNetUsd.toFixed(4) : '-'}`);
    console.log(`    Band B worst-case pos:    ${comp.bandBWorstPosRate != null ? (comp.bandBWorstPosRate*100).toFixed(1)+'%' : '-'}`);
    console.log(`    Fail rate delta (B–A):    ${comp.riskDeltaFailRate != null ? ((comp.riskDeltaFailRate>=0?'+':'')+(comp.riskDeltaFailRate*100).toFixed(1))+'pp' : '-'}`);
    console.log(`    Worst-case pos delta:     ${comp.riskDeltaWorstPos != null ? ((comp.riskDeltaWorstPos>=0?'+':'')+(comp.riskDeltaWorstPos*100).toFixed(1))+'pp' : '-'}`);
  }

  console.log(`\n  ${DIV}`);
  const recClr = result.comparison.recommendation === 'LIGHTLY_EXECUTABLE' ? '\x1b[1;32m' : '\x1b[33m';
  console.log(`  Recommendation:  ${recClr}${result.comparison.recommendation}\x1b[0m`);
  console.log(`  Reason:          ${result.comparison.recommendationReason}`);
  console.log(`\n  NOTE: Band A gets first size scaling tests.`);
  console.log(`        Band B stays at baseline or reduced notional`);
  console.log(`        until size-ladder analysis proves it deserves more.`);
  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, got) {
    if (cond) { pass++; }
    else { fail++; console.log(`    ✗ FAIL: ${label}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); }
  }

  console.log('\n  Size Ladder Report — Self-Test\n');

  // ── Helpers ────────────────────────────────────────────────────────────────
  function mkBp(spreadPct, sizeUsd, conf) {
    return {
      blueprintId: `TEST-${Math.random().toString(36).slice(2)}`,
      pair: 'ETH/USDC-RAMSES',
      economics : { spreadPct, gasCostUsd: 0.028, netProfitUsd: 0.15 },
      sizing    : { targetUsd: sizeUsd },
      venues    : { entry: { feePct: 0.0001 }, exit: { feePct: 0.0005 } },
      viability : { confidenceScore: conf ?? 0.72 },
      _context  : { regime: 'surge', activeProfile: 'SAFE', heatClass: 'EXTREME' },
    };
  }

  // ── Case 1: bpTier classification ─────────────────────────────────────────
  console.log('  Case 1: bpTier classification');
  assert('0.2300% → CONFIRMED_STRICT',  bpTier(mkBp(0.23,  200)) === 'CONFIRMED_STRICT');
  assert('0.2200% → CONFIRMED_STRICT',  bpTier(mkBp(0.22,  200)) === 'CONFIRMED_STRICT');
  assert('0.2195% → ADAPTIVE_BUFFER',   bpTier(mkBp(0.2195,200)) === 'ADAPTIVE_BUFFER');
  assert('0.2185% → ADAPTIVE_BUFFER',   bpTier(mkBp(0.2185,200)) === 'ADAPTIVE_BUFFER');
  assert('0.2184% → BELOW_BUFFER',      bpTier(mkBp(0.2184,200)) === 'BELOW_BUFFER');
  assert('0.1500% → BELOW_BUFFER',      bpTier(mkBp(0.15,  200)) === 'BELOW_BUFFER');
  console.log();

  // ── Case 2: withSize does not mutate ──────────────────────────────────────
  console.log('  Case 2: withSize — non-mutating');
  const orig = mkBp(0.23, 200);
  const sized = withSize(orig, 500);
  assert('original sizing unchanged',  orig.sizing.targetUsd === 200, orig.sizing.targetUsd);
  assert('cloned sizing = 500',        sized.sizing.targetUsd === 500, sized.sizing.targetUsd);
  console.log();

  // ── Case 3: runLadder produces one result per size step ───────────────────
  console.log('  Case 3: runLadder — result count');
  const bps = [mkBp(0.23, 200), mkBp(0.25, 200), mkBp(0.28, 200)];
  const lr  = runLadder(bps, LADDER_STRICT, 'CONFIRMED_STRICT');
  assert('ladder length = LADDER_STRICT.length', lr.ladder.length === LADDER_STRICT.length, lr.ladder.length);
  assert('blueprintCount = 3',                   lr.blueprintCount === 3);
  assert('each step has total = 3',              lr.ladder.every(r => r.total === 3));
  console.log();

  // ── Case 4: analyze end-to-end ────────────────────────────────────────────
  console.log('  Case 4: analyze() end-to-end');
  const mixed = [
    mkBp(0.23,   200, 0.75),  // CONFIRMED_STRICT
    mkBp(0.25,   200, 0.80),  // CONFIRMED_STRICT
    mkBp(0.2195, 200, 0.72),  // ADAPTIVE_BUFFER
    mkBp(0.15,   200, 0.65),  // BELOW_BUFFER
  ];
  const r = analyze(mixed);
  assert('confirmedCount = 2',       r.confirmedCount === 2,      r.confirmedCount);
  assert('adaptiveCount = 1',        r.adaptiveCount === 1,       r.adaptiveCount);
  assert('strict ladder has steps',  r.confirmedStrict.ladder.length === LADDER_STRICT.length);
  assert('adaptive ladder has steps',r.adaptiveBuffer.ladder.length === LADDER_ADAPTIVE.length);
  assert('comparison exists',        !!r.comparison);
  assert('recommendation is string', typeof r.comparison.recommendation === 'string');
  console.log(`    confirmedCount=${r.confirmedCount}  adaptiveCount=${r.adaptiveCount}`);
  console.log(`    recommendation=${r.comparison.recommendation}`);
  console.log();

  // ── Case 5: empty adaptive band ───────────────────────────────────────────
  console.log('  Case 5: empty adaptive band — no crash');
  const strictOnly = [mkBp(0.23, 200), mkBp(0.25, 200)];
  const r2 = analyze(strictOnly);
  assert('adaptiveCount = 0',            r2.adaptiveCount === 0);
  assert('adaptive ladder still present',Array.isArray(r2.adaptiveBuffer.ladder));
  assert('comparison recommendation set', typeof r2.comparison.recommendation === 'string');
  console.log(`    recommendation=${r2.comparison.recommendation}  reason=${r2.comparison.recommendationReason}`);
  console.log();

  console.log('  ' + '═'.repeat(60));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(60) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(BLUEPRINTS_PATH)) {
    console.error(`[size_ladder_report] Blueprint log not found: ${BLUEPRINTS_PATH}`);
    process.exit(1);
  }

  const blueprints = readJsonl(BLUEPRINTS_PATH);
  if (!FLAG_JSON) process.stdout.write(`[size_ladder_report] Loaded ${blueprints.length} blueprint(s)\n`);

  const result = analyze(blueprints);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result);
  }
}

main();
