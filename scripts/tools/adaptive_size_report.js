'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Adaptive Size Execution Model  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/adaptive_size_report.js
//  STATUS    : NEW — Boss ruling 2026-04-22 (Size-Based Execution Optimization)
//
//  PURPOSE
//  ───────
//  For each blueprint, find the SMALLEST approved size that clears the
//  EXECUTION_VIABLE threshold ($0.10 net, worst > $0).
//
//  Uses replay-backed spread data from execution_sandbox — requires that the
//  sandbox has already run and produced sandbox_results.json, OR runs the
//  sandbox inline when given blueprints + replay directly.
//
//  Approved size ladder (Boss ruling 2026-04-19):
//    Band A: $200, $300, $500, $750, $1000
//    Band B: $200, $300 (observational only)
//
//  Output per blueprint:
//    optimalSize     — smallest size reaching EXECUTION_VIABLE ($200 if already viable)
//    optimalNet      — expected net at optimal size
//    baselineClass   — execution class at $200 (current baseline)
//    promoted        — true if optimal size > $200 (would be missed at $200)
//    sizeStep        — how many ladder steps above $200 to reach viability
//
//  Report output:
//    - capture rate at each size
//    - optimal size distribution histogram
//    - average net improvement vs $200 baseline
//    - % of trades requiring >$500
//    - realistic capture ceiling
//
//  USAGE
//  ─────
//  # From pre-run sandbox results:
//  node scripts/tools/adaptive_size_report.js \
//    --sandbox logs/session_YYYYMMDD_HHMM/sandbox_results.json
//
//  # Inline (runs sandbox automatically):
//  node scripts/tools/adaptive_size_report.js \
//    --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
//    --replay     logs/session_YYYYMMDD_HHMM/price_replay.jsonl
//
//  # JSON output:
//  node scripts/tools/adaptive_size_report.js \
//    --sandbox logs/session_YYYYMMDD_HHMM/sandbox_results.json \
//    --json > logs/session_YYYYMMDD_HHMM/adaptive_size.json
//
//  node scripts/tools/adaptive_size_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { computePnL, classifyExecution, AAVE_FLASH_FEE_PCT } = require('../execution/pnl_engine');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST   = ARGS.includes('--self-test');
const FLAG_JSON        = ARGS.includes('--json');
const SANDBOX_PATH     = argVal('--sandbox',    null);
const BLUEPRINTS_PATH  = argVal('--blueprints', null);
const REPLAY_PATH      = argVal('--replay',     null);

// ─── APPROVED LADDER ──────────────────────────────────────────────────────────
// Boss ruling 2026-04-19: Band A approved through $1000 (CONSISTENT_STRONG × 5 sessions)
const APPROVED_LADDER = [200, 300, 500, 750, 1000];
const VIABLE_MIN_NET  = 0.10;   // EXECUTION_VIABLE floor

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

// ─── OPTIMAL SIZE COMPUTATION ─────────────────────────────────────────────────

/**
 * Given a sandbox result record (which carries actual execution spread/fees),
 * find the smallest approved size that produces EXECUTION_VIABLE net.
 *
 * Formula (from pnl_engine):
 *   net = size × (spreadBps - feeBps - aaveBps) / 10000 - gasUsd
 *   viable when net >= VIABLE_MIN_NET AND net > 0
 *
 * gasUsd is treated as FIXED (does not scale with size) — this is the key
 * mechanic that makes larger sizes more efficient on thin spreads.
 *
 * @param {object} rec  sandbox result record (0ms delay used for spread truth)
 * @returns {object}    { optimalSize, optimalNet, sizeStep, promoted }
 */
function findOptimalSize(rec) {
  const spreadBps = rec.spreadBps;
  const feeBps    = rec.feeBps;
  const gasUsd    = rec.gasUsd ?? 0.028;

  if (!Number.isFinite(spreadBps) || !Number.isFinite(feeBps)) {
    return { optimalSize: null, optimalNet: null, sizeStep: null, promoted: false,
             reason: 'missing spread/fee data' };
  }

  const aaveBps      = AAVE_FLASH_FEE_PCT * 10000;  // 5bps
  const netSpreadBps = spreadBps - feeBps - aaveBps;

  if (netSpreadBps <= 0) {
    // Spread can't overcome fees even at infinite size
    return { optimalSize: null, optimalNet: null, sizeStep: null, promoted: false,
             reason: 'net spread <= 0 — structural fail' };
  }

  for (let i = 0; i < APPROVED_LADDER.length; i++) {
    const sizeUsd = APPROVED_LADDER[i];
    const net     = sizeUsd * (netSpreadBps / 10000) - gasUsd;
    if (net >= VIABLE_MIN_NET) {
      return {
        optimalSize  : sizeUsd,
        optimalNet   : +net.toFixed(4),
        sizeStep     : i,                    // 0 = $200, 1 = $300, 2 = $500 ...
        promoted     : sizeUsd > 200,        // true if $200 is insufficient
      };
    }
  }

  // Even $1000 can't reach viable — structural thin spread
  const maxNet = APPROVED_LADDER[APPROVED_LADDER.length - 1] * (netSpreadBps / 10000) - gasUsd;
  return { optimalSize: null, optimalNet: +maxNet.toFixed(4), sizeStep: null, promoted: false,
           reason: `even $1000 insufficient (max net $${maxNet.toFixed(4)})` };
}

// ─── CORE ANALYSIS ────────────────────────────────────────────────────────────

function analyze(sandboxRecords) {
  // Use only 0ms delay records — these represent the tightest spread truth.
  // If records have no delayMs field, include all.
  const recs0 = sandboxRecords.filter(r => (r.delayMs ?? 0) === 0);
  const recs   = recs0.length ? recs0 : sandboxRecords;

  const results = recs.map(rec => {
    const opt          = findOptimalSize(rec);
    const baselineClass = rec.executionClass ?? 'EXECUTION_FAIL';
    const baselineNet   = rec.realPnL ?? null;
    const noFill        = rec.outcome === 'SANDBOX_NO_FILL';

    return {
      blueprintId     : rec.blueprintId,
      pair            : rec.pair,
      regime          : rec.regime,
      profile         : rec.profile,
      spreadBps       : rec.spreadBps,
      feeBps          : rec.feeBps,
      gasUsd          : rec.gasUsd,
      baselineSize    : 200,
      baselineClass,
      baselineNet,
      noFill,
      optimalSize     : noFill ? null : opt.optimalSize,
      optimalNet      : noFill ? null : opt.optimalNet,
      sizeStep        : noFill ? null : opt.sizeStep,
      promoted        : noFill ? false : opt.promoted,
      notViableReason : opt.reason ?? null,
    };
  });

  // ── Aggregate stats ────────────────────────────────────────────────────────
  const total       = results.length;
  const noFills     = results.filter(r => r.noFill);
  const filled      = results.filter(r => !r.noFill);

  // Capture rate by fixed size (how many viable if everyone trades at that size)
  const captureBySize = {};
  for (const sz of APPROVED_LADDER) {
    const viableAtSz = filled.filter(r => r.optimalSize !== null && r.optimalSize <= sz).length;
    captureBySize[sz] = { viable: viableAtSz, rate: +(viableAtSz / total).toFixed(4) };
  }

  // Optimal size distribution
  const sizeHistogram = {};
  for (const sz of APPROVED_LADDER) sizeHistogram[sz] = 0;
  sizeHistogram['unviable'] = 0;
  for (const r of filled) {
    if (r.optimalSize !== null) sizeHistogram[r.optimalSize]++;
    else sizeHistogram['unviable']++;
  }

  // Promoted records — trades that $200 misses but larger size captures
  const promoted     = filled.filter(r => r.promoted && r.optimalSize !== null);
  const notPromoted  = filled.filter(r => !r.promoted && r.optimalSize !== null);  // viable at $200
  const structural   = filled.filter(r => r.optimalSize === null);

  // Net improvement: compare baseline $200 net vs optimal size net
  const baseNets   = notPromoted.map(r => r.baselineNet).filter(n => n != null);
  const promotedNets = promoted.map(r => r.optimalNet).filter(n => n != null);
  const allOptimalNets = filled.filter(r => r.optimalSize !== null)
    .map(r => r.optimalNet).filter(n => n != null);

  // Average net at $200 baseline (viable-only)
  const baseline200Nets = filled.filter(r => r.baselineClass === 'EXECUTION_VIABLE')
    .map(r => r.baselineNet).filter(n => n != null);

  // % requiring > $500
  const requiring_over_500 = promoted.filter(r => r.optimalSize > 500).length;

  return {
    generatedAt       : new Date().toISOString(),
    totalRecords      : total,
    noFillCount       : noFills.length,
    filledCount       : filled.length,
    approvedLadder    : APPROVED_LADDER,
    viableFloor       : VIABLE_MIN_NET,

    captureBySize,

    sizeHistogram,

    baseline200: {
      viableCount  : notPromoted.length + structural.filter(r => r.baselineClass === 'EXECUTION_VIABLE').length,
      viableRate   : +((filled.filter(r => r.baselineClass === 'EXECUTION_VIABLE').length / total).toFixed(4)),
      avgNet       : avg(baseline200Nets),
    },

    adaptiveModel: {
      viableCount      : filled.filter(r => r.optimalSize !== null).length,
      viableRate       : +(filled.filter(r => r.optimalSize !== null).length / total).toFixed(4),
      avgOptimalNet    : avg(allOptimalNets),
      promotedCount    : promoted.length,
      promotedRate     : +(promoted.length / total).toFixed(4),
      structuralFail   : structural.length,
      structuralRate   : +(structural.length / total).toFixed(4),
      requireOver500   : requiring_over_500,
      requireOver500Pct: +(requiring_over_500 / total).toFixed(4),
    },

    captureGain: {
      absolutePp     : +((filled.filter(r => r.optimalSize !== null).length / total -
                         filled.filter(r => r.baselineClass === 'EXECUTION_VIABLE').length / total) * 100).toFixed(2),
      avgNetImprovement: avg(allOptimalNets) && avg(baseline200Nets)
        ? +(avg(allOptimalNets) - avg(baseline200Nets)).toFixed(4)
        : null,
    },

    records: results,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(result) {
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Adaptive Size Execution Model  v1.0');
  console.log(`  ${result.generatedAt}`);
  console.log(EQ);
  console.log(`\n  Total records:    ${result.totalRecords}  (no-fill: ${result.noFillCount})`);
  console.log(`  Viable floor:     $${result.viableFloor} net`);

  // ── Capture rate by size ────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  CAPTURE RATE BY SIZE (if everyone traded at this size)');
  console.log(`  ${DIV}`);
  for (const [sz, v] of Object.entries(result.captureBySize)) {
    const bar    = '█'.repeat(Math.round(v.rate * 50));
    const pct    = (v.rate * 100).toFixed(1);
    const diff   = sz > 200 ? ` (+${((v.rate - result.captureBySize[200].rate) * 100).toFixed(1)}pp)` : '  baseline';
    console.log(`  $${String(sz).padEnd(4)}  ${pct.padStart(5)}%  ${bar}${diff}`);
  }

  // ── Optimal size histogram ──────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  OPTIMAL SIZE DISTRIBUTION (smallest size to reach VIABLE)');
  console.log(`  ${DIV}`);
  const total = result.totalRecords;
  for (const [sz, count] of Object.entries(result.sizeHistogram)) {
    const pct = (count / total * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / total * 40));
    const label = sz === 'unviable' ? 'UNVIABLE (structural)' : `$${sz}`;
    console.log(`  ${label.padEnd(22)} ${String(count).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  // ── Baseline vs adaptive comparison ────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  BASELINE ($200 FIXED) vs ADAPTIVE MODEL');
  console.log(`  ${DIV}`);
  const b = result.baseline200;
  const a = result.adaptiveModel;
  console.log(`\n  Baseline $200:`);
  console.log(`    Viable count:      ${b.viableCount}  (${(b.viableRate * 100).toFixed(1)}%)`);
  console.log(`    Avg net (viable):  $${b.avgNet?.toFixed(4) ?? 'n/a'}`);
  console.log(`\n  Adaptive model:`);
  console.log(`    Viable count:      ${a.viableCount}  (${(a.viableRate * 100).toFixed(1)}%)`);
  console.log(`    Avg net (all):     $${a.avgOptimalNet?.toFixed(4) ?? 'n/a'}`);
  console.log(`    Promoted (+size):  ${a.promotedCount}  (${(a.promotedRate * 100).toFixed(1)}%)`);
  console.log(`    Structural fail:   ${a.structuralFail}  (${(a.structuralRate * 100).toFixed(1)}%)`);
  console.log(`    Require >$500:     ${a.requireOver500}  (${(a.requireOver500Pct * 100).toFixed(1)}%)`);

  console.log(`\n  Capture gain:      +${result.captureGain.absolutePp}pp`);
  if (result.captureGain.avgNetImprovement != null) {
    console.log(`  Net improvement:   +$${result.captureGain.avgNetImprovement.toFixed(4)} per trade (avg)`);
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

  console.log('\n  Adaptive Size Report — Self-Test\n');

  // ── Case 1: findOptimalSize basic cases ───────────────────────────────────
  console.log('  Case 1: findOptimalSize — spread tiers');
  {
    // 19.4bps spread (viable median) → should be $200
    const r1 = findOptimalSize({ spreadBps: 19.4, feeBps: 6, gasUsd: 0.028 });
    assert('19.4bps → $200 viable',   r1.optimalSize === 200, r1.optimalSize);
    assert('19.4bps → not promoted',  r1.promoted === false);

    // 16.1bps spread (marginal median) → $300
    const r2 = findOptimalSize({ spreadBps: 16.1, feeBps: 6, gasUsd: 0.028 });
    assert('16.1bps → $300',          r2.optimalSize === 300, r2.optimalSize);
    assert('16.1bps → promoted',      r2.promoted === true);

    // 13.8bps spread (fail median) → $500
    const r3 = findOptimalSize({ spreadBps: 13.8, feeBps: 6, gasUsd: 0.028 });
    assert('13.8bps → $500',          r3.optimalSize === 500, r3.optimalSize);
    assert('13.8bps → promoted',      r3.promoted === true);

    // Negative net spread → null
    const r4 = findOptimalSize({ spreadBps: 5, feeBps: 6, gasUsd: 0.028 });
    assert('5bps → null (structural)', r4.optimalSize === null);

    console.log(`    19.4bps→$${r1.optimalSize}  16.1bps→$${r2.optimalSize}  13.8bps→$${r3.optimalSize}  5bps→${r4.optimalSize}`);
  }
  console.log();

  // ── Case 2: analyze — sandbox records ─────────────────────────────────────
  console.log('  Case 2: analyze — mixed sandbox records');
  {
    const recs = [
      // Viable at $200
      { blueprintId:'A', delayMs:0, spreadBps:19.4, feeBps:6, gasUsd:0.028,
        executionClass:'EXECUTION_VIABLE', realPnL:0.15, outcome:'SANDBOX_PROFIT' },
      // Marginal at $200 → viable at $300
      { blueprintId:'B', delayMs:0, spreadBps:16.1, feeBps:6, gasUsd:0.028,
        executionClass:'EXECUTION_MARGINAL', realPnL:0.07, outcome:'SANDBOX_BREAKEVEN' },
      // Fail at $200 → viable at $500
      { blueprintId:'C', delayMs:0, spreadBps:13.8, feeBps:6, gasUsd:0.028,
        executionClass:'EXECUTION_FAIL', realPnL:0.03, outcome:'SANDBOX_BREAKEVEN' },
      // Structural fail
      { blueprintId:'D', delayMs:0, spreadBps:5.0, feeBps:6, gasUsd:0.028,
        executionClass:'EXECUTION_FAIL', realPnL:-0.10, outcome:'SANDBOX_LOSS' },
      // No fill
      { blueprintId:'E', delayMs:0, spreadBps:null, feeBps:null, gasUsd:0.028,
        executionClass:'EXECUTION_FAIL', outcome:'SANDBOX_NO_FILL', realPnL:null },
    ];

    const result = analyze(recs);
    assert('total = 5',              result.totalRecords === 5, result.totalRecords);
    assert('noFill = 1',             result.noFillCount === 1);
    assert('baseline viable = 1',    result.baseline200.viableCount === 1, result.baseline200.viableCount);
    assert('adaptive viable = 3',    result.adaptiveModel.viableCount === 3, result.adaptiveModel.viableCount);
    assert('promoted = 2',           result.adaptiveModel.promotedCount === 2, result.adaptiveModel.promotedCount);
    assert('structural = 1',         result.adaptiveModel.structuralFail === 1, result.adaptiveModel.structuralFail);
    assert('capture gain > 0',       result.captureGain.absolutePp > 0, result.captureGain.absolutePp);
    assert('$200 histogram = 1',     result.sizeHistogram[200] === 1);
    assert('$300 histogram = 1',     result.sizeHistogram[300] === 1);
    assert('$500 histogram = 1',     result.sizeHistogram[500] === 1);
    assert('unviable histogram = 1', result.sizeHistogram['unviable'] === 1);
    console.log(`    baseline=${result.baseline200.viableRate*100}%  adaptive=${result.adaptiveModel.viableRate*100}%  gain=+${result.captureGain.absolutePp}pp`);
  }
  console.log();

  // ── Case 3: no-fill records are excluded from sizing ──────────────────────
  console.log('  Case 3: no-fill records excluded from optimal size');
  {
    const noFillRec = { blueprintId:'NF', delayMs:0, spreadBps:19.4, feeBps:6, gasUsd:0.028,
                        executionClass:'EXECUTION_FAIL', outcome:'SANDBOX_NO_FILL', realPnL:null };
    const result = analyze([noFillRec]);
    const rec = result.records[0];
    assert('no-fill → optimalSize null', rec.optimalSize === null);
    assert('no-fill → promoted false',   rec.promoted === false);
    console.log(`    optimalSize=${rec.optimalSize}  promoted=${rec.promoted}`);
  }
  console.log();

  console.log('  ' + '═'.repeat(60));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(60) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  let sandboxRecords = [];

  if (SANDBOX_PATH) {
    if (!fs.existsSync(SANDBOX_PATH)) {
      console.error(`[adaptive_size_report] Sandbox file not found: ${SANDBOX_PATH}`); process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(SANDBOX_PATH, 'utf8'));
    sandboxRecords = raw.results ?? raw;
    if (!FLAG_JSON) console.log(`[adaptive_size_report] Loaded ${sandboxRecords.length} sandbox record(s)`);

  } else if (BLUEPRINTS_PATH && REPLAY_PATH) {
    if (!FLAG_JSON) console.log('[adaptive_size_report] Running inline sandbox...');
    const { runSandbox } = require('../execution/execution_sandbox');
    sandboxRecords = await runSandbox({
      blueprintsPath: BLUEPRINTS_PATH, replayPath: REPLAY_PATH, delaysMs: [0],
    });
    if (!FLAG_JSON) console.log(`[adaptive_size_report] Sandbox complete: ${sandboxRecords.length} record(s)`);

  } else {
    console.error('[adaptive_size_report] Provide --sandbox <path> or --blueprints + --replay');
    process.exit(1);
  }

  const result = analyze(sandboxRecords);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result);
  }
}

main().catch(err => {
  console.error(`adaptive_size_report error: ${err.message}`);
  process.exit(1);
});
