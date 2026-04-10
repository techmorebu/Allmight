'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Filter Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/filter_report.js
//  STATUS    : NEW — Boss ruling 2026-04-10
//
//  PURPOSE
//  ─────────
//  Run the execution filter against paired blueprint + simulation logs.
//  Print ranked report. Append decisions to filter log.
//
//  USAGE
//  ─────
//  # Run filter against existing paired logs
//  node scripts/tools/filter_report.js \
//    --blueprints logs/trade_blueprints.jsonl \
//    --simulations logs/execution_simulations.jsonl
//
//  # Run simulator first, then filter, then report (full pipeline)
//  node scripts/tools/filter_report.js \
//    --blueprints logs/trade_blueprints.jsonl \
//    --run-sim
//
//  # Machine-readable JSON
//  node scripts/tools/filter_report.js --blueprints ... --simulations ... --json
//
//  # Built-in validation suite (4 required cases — no log files needed)
//  node scripts/tools/filter_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { applyFilter, SURFACE_RULES, SPREAD_EXECUTION_FLOOR } = require('../execution/execution_filter');
const { logFilterDecision, inspectFilterLog }                 = require('../execution/filter_logger');
const { simulateBlueprint }                                    = require('../execution/execution_simulator');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i  = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST   = ARGS.includes('--self-test');
const FLAG_JSON        = ARGS.includes('--json');
const FLAG_RUN_SIM     = ARGS.includes('--run-sim');

const BLUEPRINTS_PATH  = argVal('--blueprints',  'logs/trade_blueprints.jsonl');
const SIMULATIONS_PATH = argVal('--simulations', 'logs/execution_simulations.jsonl');
const FILTER_OUT       = argVal('--out',         'logs/execution_filter_results.jsonl');

// ─── LOADERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  const { applyFilter, deriveCandidateClass } = require('../execution/execution_filter');
  let pass = 0, fail = 0;

  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  // Fixture factories
  const mkBp = (spreadPct, sizeUsd, opts = {}) => ({
    blueprintId  : `BP-TEST-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    pair         : opts.pair ?? 'ETH/USDC-RAMSES',
    direction    : 'BUY_UNISWAP_V3_SELL_RAMSES_V2',
    venues: {
      entry: { expectedPrice: 2185.0, feePct: 0.0001 },
      exit:  { expectedPrice: 2185.0 * (1 + spreadPct / 100), feePct: 0.0005 },
    },
    sizing       : { targetUsd: sizeUsd },
    economics    : { spreadPct, gasCostUsd: 0.028, slippageBps: 1.58,
                     expectedEdgePct: spreadPct - 0.06 },
    viability    : { confidenceScore: 0.72, spreadAboveFloor: spreadPct >= 0.13 },
    _context     : { activeProfile: opts.profile ?? 'SAFE', heatClass: opts.heat ?? 'WARM',
                     regime: 'surge', rpcDegraded: opts.rpcDeg ?? false },
  });

  const mkSim = (verdict, fragility = 0.15) => ({
    simulationId : `SIM-TEST-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    summary      : { simulationVerdict: verdict, fragilityScore: fragility,
                     coreCasesPass: verdict === 'SIM_PASS' },
    confidence   : { executionConfidence: 0.60, blueprintConfidence: 0.72, robustnessFactor: 0.85 },
    baseCase     : { expectedNetProfitUsd: 0.14 },
  });

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Execution Filter Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // ── Case 1: ALLOW — all rules pass ────────────────────────────────────────
  console.log('  Case 1: ALLOW — spread=0.23%, size=$200, SIM_PASS');
  {
    const r = applyFilter(mkBp(0.23, 200), mkSim('SIM_PASS'));
    assert('Case 1: filterDecision = ALLOW',        r.filterDecision === 'ALLOW',  r.filterDecision);
    assert('Case 1: candidateClass = EXECUTION_CANDIDATE',
           r.candidateClass === 'EXECUTION_CANDIDATE', r.candidateClass);
    assert('Case 1: filterReason = all_rules_passed', r.filterReason === 'all_rules_passed');
    assert('Case 1: checks array present',            Array.isArray(r.checks));
    assert('Case 1: all checks pass',                 r.checks.every(c => c.pass));
    console.log(`         decision=${r.filterDecision}  class=${r.candidateClass}  reason=${r.filterReason}`);
  }
  console.log();

  // ── Case 2: REJECT — spread too low ──────────────────────────────────────
  console.log('  Case 2: REJECT — spread=0.17% (below 0.22% threshold)');
  {
    const r = applyFilter(mkBp(0.17, 200), mkSim('SIM_PASS'));
    assert('Case 2: filterDecision = REJECT',         r.filterDecision === 'REJECT',  r.filterDecision);
    assert('Case 2: filterReason = spread_gte_min',   r.filterReason === 'spread_gte_min');
    assert('Case 2: candidateClass = BLUEPRINT_ONLY',
           r.candidateClass === 'BLUEPRINT_ONLY', r.candidateClass);
    console.log(`         decision=${r.filterDecision}  reason=${r.filterReason}  class=${r.candidateClass}`);
  }
  console.log();

  // ── Case 3: REJECT — wrong size ──────────────────────────────────────────
  console.log('  Case 3: REJECT — size=$100 (required $200)');
  {
    const r = applyFilter(mkBp(0.25, 100), mkSim('SIM_PASS'));
    assert('Case 3: filterDecision = REJECT',              r.filterDecision === 'REJECT');
    assert('Case 3: filterReason = size_equals_required',  r.filterReason === 'size_equals_required',
           r.filterReason);
    console.log(`         decision=${r.filterDecision}  reason=${r.filterReason}  detail=${r.filterDetail}`);
  }
  console.log();

  // ── Case 4: REJECT — simulation failed ───────────────────────────────────
  console.log('  Case 4: REJECT — SIM_FAIL (spread=0.25%, size=$200)');
  {
    const r = applyFilter(mkBp(0.25, 200), mkSim('SIM_FAIL', 0.65));
    assert('Case 4: filterDecision = REJECT',           r.filterDecision === 'REJECT');
    assert('Case 4: filterReason = simulation_pass',    r.filterReason === 'simulation_pass',
           r.filterReason);
    assert('Case 4: candidateClass = BLUEPRINT_ONLY',
           r.candidateClass === 'BLUEPRINT_ONLY', r.candidateClass);
    console.log(`         decision=${r.filterDecision}  reason=${r.filterReason}  class=${r.candidateClass}`);
  }
  console.log();

  // ── Case 5: candidateClass derivation ────────────────────────────────────
  console.log('  Case 5: candidateClass derivation table');
  {
    const { deriveCandidateClass } = require('../execution/execution_filter');
    const cases = [
      [mkBp(0.10, 200), mkSim('SIM_PASS'),     'DETECTION_ONLY'],
      [mkBp(0.15, 200), mkSim('SIM_FAIL'),     'BLUEPRINT_ONLY'],
      [mkBp(0.15, 200), mkSim('SIM_MARGINAL'), 'SIM_MARGINAL'],
      [mkBp(0.23, 200), mkSim('SIM_PASS'),     'EXECUTION_CANDIDATE'],
      [mkBp(0.19, 200), mkSim('SIM_PASS'),     'BLUEPRINT_ONLY'],  // SIM_PASS but below exec floor
    ];
    for (const [bp, sim, expected] of cases) {
      const got = deriveCandidateClass(bp, sim);
      assert(`  spread=${bp.economics.spreadPct.toFixed(2)}% verdict=${sim.summary.simulationVerdict} → ${expected}`,
             got === expected, `got ${got}`);
    }
  }
  console.log();

  // ── Case 6: null inputs degrade cleanly ──────────────────────────────────
  console.log('  Case 6: null/missing inputs — no crash');
  {
    const r1 = applyFilter(null, null);
    const r2 = applyFilter(mkBp(0.23, 200), null);
    assert('Case 6a: null bp+sim → REJECT no crash', r1.filterDecision === 'REJECT');
    assert('Case 6b: null sim → REJECT no crash',    r2.filterDecision === 'REJECT');
    assert('Case 6a: has filterId',                  !!r1.filterId);
    console.log(`         null case: decision=${r1.filterDecision}  class=${r1.candidateClass}`);
  }
  console.log();

  // ── Case 7: deterministic — same input same output ────────────────────────
  console.log('  Case 7: determinism — same input → same output (except filterId/ts)');
  {
    const bp  = mkBp(0.23, 200);
    const sim = mkSim('SIM_PASS');
    const r1  = applyFilter(bp, sim);
    const r2  = applyFilter(bp, sim);
    assert('Case 7: filterDecision identical',     r1.filterDecision === r2.filterDecision);
    assert('Case 7: filterReason identical',       r1.filterReason   === r2.filterReason);
    assert('Case 7: candidateClass identical',     r1.candidateClass === r2.candidateClass);
    assert('Case 7: filterIds differ (unique)',    r1.filterId !== r2.filterId);
  }
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(decisions) {
  const W   = 120;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);
  const CLR = {
    ALLOW: '\x1b[1;32m', REJECT: '\x1b[90m',
    EXECUTION_CANDIDATE: '\x1b[1;32m', SIM_MARGINAL: '\x1b[33m',
    BLUEPRINT_ONLY: '\x1b[90m', DETECTION_ONLY: '\x1b[90m',
  };
  const RST = '\x1b[0m';

  const allowed  = decisions.filter(d => d.filterDecision === 'ALLOW');
  const rejected = decisions.filter(d => d.filterDecision === 'REJECT');

  const byClass  = {};
  const byReason = {};
  for (const d of decisions) {
    byClass[d.candidateClass]  = (byClass[d.candidateClass]  || 0) + 1;
    byReason[d.filterReason]   = (byReason[d.filterReason]   || 0) + 1;
  }

  console.log('\n' + EQ);
  console.log('  AllMight — Execution Filter Report  v1.0');
  console.log(`  ${new Date().toISOString()}  |  Total: ${decisions.length}  |  Source: ${BLUEPRINTS_PATH}`);
  console.log(EQ);

  console.log(`\n  ${CLR.ALLOW}ALLOW: ${allowed.length} (${(100*allowed.length/decisions.length).toFixed(1)}%)${RST}   REJECT: ${rejected.length} (${(100*rejected.length/decisions.length).toFixed(1)}%)`);
  console.log();

  // Class breakdown
  console.log('  Candidate classes:');
  for (const [cls, n] of Object.entries(byClass).sort((a,b) => b[1]-a[1])) {
    const c = CLR[cls] || '';
    console.log(`    ${c}${cls.padEnd(24)}${RST}  ${n} (${(100*n/decisions.length).toFixed(1)}%)`);
  }
  console.log();

  // Reject reasons
  if (rejected.length) {
    console.log('  Rejection reasons:');
    for (const [rsn, n] of Object.entries(byReason).filter(([r]) => r !== 'all_rules_passed').sort((a,b) => b[1]-a[1])) {
      console.log(`    ${rsn.padEnd(28)}  ${n} (${(100*n/rejected.length).toFixed(1)}% of rejects)`);
    }
    console.log();
  }

  // Allowed (EXECUTION_CANDIDATE) detail
  if (allowed.length > 0) {
    console.log('  ' + EQ.slice(2));
    console.log(`  ${CLR.ALLOW}EXECUTION_CANDIDATE blueprints (${allowed.length}):${RST}`);
    console.log('  ' + DIV.slice(2));
    const col = (s, w) => String(s).padEnd(w);
    const rpt = (s, w) => String(s).padStart(w);
    console.log(
      `  ${'filterId'.padEnd(28)}  ${'pair'.padEnd(20)}  ${'spread'.padStart(8)}  ` +
      `${'size'.padStart(6)}  ${'execConf'.padStart(9)}  ${'net$'.padStart(7)}  direction`
    );
    console.log('  ' + DIV.slice(2));
    for (const d of allowed.slice(0, 30)) {
      const m = d.metrics || {};
      console.log(
        CLR.ALLOW +
        `  ${col(d.filterId, 28)}  ${col(d.pair, 20)}  ` +
        `${rpt((m.spreadPct?.toFixed(4) ?? '?') + '%', 8)}  ` +
        `${rpt('$' + (m.sizeUsd ?? '?'), 6)}  ` +
        `${rpt((m.executionConfidence?.toFixed(3) ?? '?'), 9)}  ` +
        `${rpt('$' + (m.baseNetProfitUsd?.toFixed(2) ?? '?'), 7)}  ` +
        (m.direction ?? '') + RST
      );
    }
    if (allowed.length > 30) console.log(`  ... and ${allowed.length - 30} more`);
    console.log();
  }

  // Surface rules in effect
  console.log('  Surface rules applied:');
  for (const [pair, rules] of Object.entries(SURFACE_RULES)) {
    console.log(`    ${pair}: spread≥${rules.minSpreadPct}%  size=$${rules.requiredSizeUsd}  requireSimPass=${rules.requireSimPass}`);
  }
  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  // Load blueprints
  if (!fs.existsSync(BLUEPRINTS_PATH)) {
    console.error(`[filter_report] Blueprint log not found: ${BLUEPRINTS_PATH}`);
    process.exit(1);
  }
  const blueprints = readJsonl(BLUEPRINTS_PATH);
  if (!FLAG_JSON) process.stdout.write(`[filter_report] Loaded ${blueprints.length} blueprint(s)\n`);

  // Load or run simulations
  let simulations;
  if (FLAG_RUN_SIM) {
    if (!FLAG_JSON) process.stdout.write(`[filter_report] Running simulator on ${blueprints.length} blueprints...\n`);
    simulations = blueprints.map(bp => simulateBlueprint(bp));
  } else {
    if (!fs.existsSync(SIMULATIONS_PATH)) {
      console.error(`[filter_report] Simulation log not found: ${SIMULATIONS_PATH}\n  Run with --run-sim to generate.`);
      process.exit(1);
    }
    simulations = readJsonl(SIMULATIONS_PATH);
    if (!FLAG_JSON) process.stdout.write(`[filter_report] Loaded ${simulations.length} simulation(s)\n`);

    if (simulations.length !== blueprints.length) {
      if (!FLAG_JSON) process.stderr.write(
        `[filter_report] WARNING: blueprint count (${blueprints.length}) ≠ simulation count (${simulations.length}). ` +
        `Using ${Math.min(blueprints.length, simulations.length)} paired records.\n`
      );
    }
  }

  const count = Math.min(blueprints.length, simulations.length);
  const decisions = [];
  for (let i = 0; i < count; i++) {
    const d = applyFilter(blueprints[i], simulations[i]);
    decisions.push(d);
    logFilterDecision(d, FILTER_OUT);
  }

  if (!FLAG_JSON) process.stdout.write(`[filter_report] Filtered ${decisions.length} pair(s) → ${FILTER_OUT}\n\n`);

  if (FLAG_JSON) {
    const allowed = decisions.filter(d => d.filterDecision === 'ALLOW');
    console.log(JSON.stringify({
      total   : decisions.length,
      allow   : allowed.length,
      reject  : decisions.length - allowed.length,
      allowPct: +(allowed.length / decisions.length * 100).toFixed(2),
      candidates: allowed,
    }, null, 2));
  } else {
    printReport(decisions);
  }
}

main();
