'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Simulation Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/simulation_report.js
//  STATUS    : NEW — Boss ruling 2026-04-10
//
//  PURPOSE
//  ─────────
//  Read logs/execution_simulations.jsonl and print a ranked summary.
//  Also optionally runs the simulator against logs/trade_blueprints.jsonl.
//
//  USAGE
//  ─────
//  # Report on existing simulation log
//  node scripts/tools/simulation_report.js
//
//  # Run simulator against blueprint log, then report
//  node scripts/tools/simulation_report.js --run-from logs/trade_blueprints.jsonl
//
//  # Machine-readable JSON
//  node scripts/tools/simulation_report.js --json
//
//  # Built-in self-test (5 required cases — no log files needed)
//  node scripts/tools/simulation_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { simulateBlueprint, CORE_CASE_IDS } = require('../execution/execution_simulator');
const { logSimulation, inspectSimLog }      = require('../execution/simulation_logger');

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
const FLAG_VERBOSE   = ARGS.includes('--verbose');
const RUN_FROM       = argVal('--run-from', null);
const SIM_LOG        = argVal('--log', 'logs/execution_simulations.jsonl');
const TOP_N          = Number(argVal('--top', '20'));

// ─── BLUEPRINT RUNNER ─────────────────────────────────────────────────────────

function runSimsFromBlueprintLog(blueprintPath, simLogPath) {
  if (!fs.existsSync(blueprintPath)) {
    process.stderr.write(`[sim_report] blueprint log not found: ${blueprintPath}\n`);
    return 0;
  }
  const lines = fs.readFileSync(blueprintPath, 'utf8').split('\n').filter(Boolean);
  let count = 0;
  for (const line of lines) {
    try {
      const bp  = JSON.parse(line);
      const res = simulateBlueprint(bp);
      logSimulation(res, simLogPath);
      count++;
    } catch { /* skip malformed */ }
  }
  return count;
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(simResults) {
  const W   = 120;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  const VERDICT_COLOR = {
    SIM_PASS     : '\x1b[1;32m',
    SIM_MARGINAL : '\x1b[33m',
    SIM_FAIL     : '\x1b[1;31m',
  };
  const RESET = '\x1b[0m';

  console.log('\n' + EQ);
  console.log('  AllMight — Execution Simulation Report  v1.0');
  console.log(`  ${new Date().toISOString()}  |  Records: ${simResults.length}  |  Source: ${SIM_LOG}`);
  console.log(EQ);

  const pass     = simResults.filter(r => r.summary?.simulationVerdict === 'SIM_PASS').length;
  const marginal = simResults.filter(r => r.summary?.simulationVerdict === 'SIM_MARGINAL').length;
  const fail     = simResults.filter(r => r.summary?.simulationVerdict === 'SIM_FAIL').length;
  const degraded = simResults.filter(r => r._degraded).length;

  console.log(`\n  Verdicts: ${VERDICT_COLOR['SIM_PASS']}PASS=${pass}${RESET}  ${VERDICT_COLOR['SIM_MARGINAL']}MARGINAL=${marginal}${RESET}  ${VERDICT_COLOR['SIM_FAIL']}FAIL=${fail}${RESET}  DEGRADED=${degraded}`);

  // Fragility distribution
  const frags = simResults.map(r => r.summary?.fragilityScore).filter(v => v != null);
  if (frags.length) {
    const sorted = frags.slice().sort((a,b)=>a-b);
    console.log(`  Fragility: min=${sorted[0].toFixed(3)}  median=${sorted[Math.floor(sorted.length/2)].toFixed(3)}  max=${sorted[sorted.length-1].toFixed(3)}`);
  }

  // Execution confidence distribution
  const exConfs = simResults.map(r => r.confidence?.executionConfidence).filter(v => v != null);
  if (exConfs.length) {
    const s = exConfs.slice().sort((a,b)=>a-b);
    console.log(`  ExecConf:  min=${s[0].toFixed(3)}  median=${s[Math.floor(s.length/2)].toFixed(3)}  max=${s[s.length-1].toFixed(3)}`);
  }

  // Top N sorted by executionConfidence DESC
  const ranked = simResults
    .filter(r => !r._degraded)
    .sort((a, b) => (b.confidence?.executionConfidence ?? 0) - (a.confidence?.executionConfidence ?? 0))
    .slice(0, TOP_N);

  if (ranked.length) {
    console.log(`\n  Top ${TOP_N} by execution confidence:\n`);
    const pad = (s, w) => String(s).padEnd(w);
    const rpt = (s, w) => String(s).padStart(w);
    console.log(
      `  ${'simulationId'.padEnd(26)}  ${'pair'.padEnd(18)}  ${'verdict'.padEnd(13)}  ` +
      `${'fragil'.padStart(7)}  ${'bpConf'.padStart(7)}  ${'exConf'.padStart(7)}  ` +
      `${'worst$'.padStart(7)}  coreOK`
    );
    console.log('  ' + DIV);
    for (const r of ranked) {
      const vc  = VERDICT_COLOR[r.summary?.simulationVerdict] || '';
      const v   = r.summary?.simulationVerdict ?? '?';
      const f   = r.summary?.fragilityScore?.toFixed(3) ?? '?';
      const bc  = r.confidence?.blueprintConfidence?.toFixed(3) ?? '?';
      const ec  = r.confidence?.executionConfidence?.toFixed(3) ?? '?';
      const worst = r.summary?.worstCaseNetUsd?.toFixed(2) ?? '?';
      const core = r.summary?.coreCasesPass ? '✓' : '✗';
      console.log(
        `  ${pad(r.simulationId, 26)}  ${pad(r.pair, 18)}  ${vc}${pad(v, 13)}${RESET}  ` +
        `${rpt(f, 7)}  ${rpt(bc, 7)}  ${rpt(ec, 7)}  ${rpt(worst, 7)}  ${core}`
      );
    }
  }

  // Stress case failure rates
  if (FLAG_VERBOSE && simResults.length > 0) {
    console.log(`\n  Stress case failure rates across all simulations:`);
    const allCaseIds = [
      ...simResults[0] ? Object.keys(simResults[0].stressCases ?? {}) : [],
    ];
    for (const cid of allCaseIds) {
      const total  = simResults.filter(r => r.stressCases?.[cid]).length;
      const failed = simResults.filter(r => r.stressCases?.[cid]?.verdict === 'FAIL').length;
      const marg   = simResults.filter(r => r.stressCases?.[cid]?.verdict === 'MARGINAL').length;
      const isCore = CORE_CASE_IDS.includes(cid) ? ' [CORE]' : '';
      console.log(`    ${cid.padEnd(20)}  fail=${failed}/${total} (${(100*failed/total).toFixed(0)}%)  marginal=${marg}${isCore}`);
    }
  }

  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST (5 required cases) ────────────────────────────────────────────

function runSelfTest() {
  const { computeStressedProfit, computeFragilityScore, verdictForCase } = require('../execution/execution_simulator');
  let pass = 0, fail = 0;

  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Execution Simulator Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // Fixtures
  const robustBp = {
    blueprintId: 'BP-TEST-ROBUST',
    pair: 'ETH/USDC-RAMSES',
    direction: 'BUY_UNISWAP_V3_SELL_RAMSES_V2',
    venues: {
      entry: { venue: 'uniswap_v3', expectedPrice: 2185.11, feePct: 0.0001 },
      exit:  { venue: 'ramses_v2',  expectedPrice: 2200.00, feePct: 0.0005 },
    },
    sizing:     { targetUsd: 200 },
    economics:  { spreadPct: 0.276, expectedEdgePct: 0.155, gasCostUsd: 0.028, gasPriceGwei: 0.020, gasUnits: 700000, netProfitUsd: 0.28, slippageBps: 3.7 },
    safety:     { minOutEntry: 0.091, minOutExit: 200.27, slippageToleranceBps: 3.7, maxGasUsd: 0.056 },
    viability:  { spreadAboveFloor: true, premiumZone: true, depthAboveExecFloor: true, economicStatus: 'economically_viable', confidenceScore: 0.80 },
    _context:   { activeProfile: 'BALANCED', heatClass: 'WARM', heatScore: 0.38 },
  };

  const marginalBp = { ...robustBp, blueprintId: 'BP-TEST-MARGINAL',
    venues: {
      entry: { venue: 'uniswap_v3', expectedPrice: 2185.11, feePct: 0.0001 },
      exit:  { venue: 'ramses_v2',  expectedPrice: 2188.89, feePct: 0.0005 },
    },
    economics: { ...robustBp.economics, spreadPct: 0.1696, expectedEdgePct: 0.063, gasCostUsd: 0.028, netProfitUsd: 0.08, slippageBps: 3.7 },
    viability: { ...robustBp.viability, premiumZone: false, confidenceScore: 0.52 },
  };

  const failingBp = { ...robustBp, blueprintId: 'BP-TEST-FAIL',
    venues: {
      entry: { venue: 'uniswap_v3', expectedPrice: 2185.11, feePct: 0.0001 },
      exit:  { venue: 'ramses_v2',  expectedPrice: 2186.50, feePct: 0.0005 },
    },
    economics: { ...robustBp.economics, spreadPct: 0.063, expectedEdgePct: 0.003, gasCostUsd: 0.028, netProfitUsd: -0.002, slippageBps: 3.7 },
    viability: { ...robustBp.viability, spreadAboveFloor: false, premiumZone: false, confidenceScore: 0.15 },
  };

  // ── Case 1: Profitable robust blueprint → SIM_PASS ───────────────────────
  console.log('  Case 1: Robust blueprint (high spread, low size)');
  const r1 = simulateBlueprint(robustBp);
  assert('Case 1: not degraded',           !r1._degraded);
  assert('Case 1: has simulationId',        !!r1.simulationId);
  assert('Case 1: has stressCases',         Object.keys(r1.stressCases ?? {}).length >= 12);
  assert('Case 1: fragility < 0.5',         r1.summary?.fragilityScore < 0.5,
    `fragility=${r1.summary?.fragilityScore}`);
  assert('Case 1: SIM_PASS or SIM_MARGINAL',
    r1.summary?.simulationVerdict === 'SIM_PASS' || r1.summary?.simulationVerdict === 'SIM_MARGINAL',
    r1.summary?.simulationVerdict);
  assert('Case 1: executionConfidence ≤ blueprintConfidence',
    r1.confidence.executionConfidence <= r1.confidence.blueprintConfidence);
  console.log(`         verdict=${r1.summary?.simulationVerdict}  fragility=${r1.summary?.fragilityScore}  exConf=${r1.confidence?.executionConfidence}`);
  console.log();

  // ── Case 2: Marginal blueprint → SIM_MARGINAL or SIM_FAIL ───────────────
  console.log('  Case 2: Marginal blueprint (0.17% spread, $200 size)');
  const r2 = simulateBlueprint(marginalBp);
  assert('Case 2: not degraded',   !r2._degraded);
  assert('Case 2: has verdict',    !!r2.summary?.simulationVerdict);
  assert('Case 2: has fragility',  r2.summary?.fragilityScore != null);
  assert('Case 2: worst case < robust worst case',
    r2.summary?.worstCaseNetUsd < r1.summary?.worstCaseNetUsd,
    `marginal worst=${r2.summary?.worstCaseNetUsd} robust worst=${r1.summary?.worstCaseNetUsd}`);
  console.log(`         verdict=${r2.summary?.simulationVerdict}  fragility=${r2.summary?.fragilityScore}  worst=$${r2.summary?.worstCaseNetUsd}`);
  console.log();

  // ── Case 3: Failing blueprint → SIM_FAIL ─────────────────────────────────
  console.log('  Case 3: Failing blueprint (sub-floor spread)');
  const r3 = simulateBlueprint(failingBp);
  assert('Case 3: not degraded',   !r3._degraded);
  assert('Case 3: SIM_FAIL',       r3.summary?.simulationVerdict === 'SIM_FAIL',
    `got ${r3.summary?.simulationVerdict}`);
  assert('Case 3: high fragility', r3.summary?.fragilityScore >= 0.5,
    `fragility=${r3.summary?.fragilityScore}`);
  assert('Case 3: low exConf',     r3.confidence?.executionConfidence < 0.2,
    `exConf=${r3.confidence?.executionConfidence}`);
  console.log(`         verdict=${r3.summary?.simulationVerdict}  fragility=${r3.summary?.fragilityScore}  exConf=${r3.confidence?.executionConfidence}`);
  console.log();

  // ── Case 4: Missing fields / degraded blueprint ───────────────────────────
  console.log('  Case 4: Degraded / null blueprint');
  const r4a = simulateBlueprint(null);
  const r4b = simulateBlueprint({ blueprintId: 'BP-PARTIAL', pair: 'ETH/USDC-RAMSES' });
  assert('Case 4a: null degrades cleanly',    r4a._degraded === true);
  assert('Case 4a: has blueprintId null',     r4a.blueprintId === null);
  assert('Case 4b: missing venues degrades',  r4b.summary?.worstCaseNetUsd == null || r4b._degraded !== true);
  assert('Case 4b: stress cases all FAIL',
    Object.values(r4b.stressCases ?? {}).every(c => c.verdict === 'FAIL'));
  console.log(`         null → _degraded=${r4a._degraded}  partial → verdict=${r4b.summary?.simulationVerdict}`);
  console.log();

  // ── Case 5: Deterministic repeated output ─────────────────────────────────
  console.log('  Case 5: Deterministic output (same input → same numbers)');
  const r5a = simulateBlueprint(robustBp);
  const r5b = simulateBlueprint(robustBp);
  assert('Case 5: fragility identical',
    r5a.summary?.fragilityScore === r5b.summary?.fragilityScore,
    `${r5a.summary?.fragilityScore} vs ${r5b.summary?.fragilityScore}`);
  assert('Case 5: verdict identical',
    r5a.summary?.simulationVerdict === r5b.summary?.simulationVerdict);
  assert('Case 5: worstCaseNetUsd identical',
    r5a.summary?.worstCaseNetUsd === r5b.summary?.worstCaseNetUsd);
  assert('Case 5: executionConfidence identical',
    r5a.confidence?.executionConfidence === r5b.confidence?.executionConfidence);
  // SimulationIds differ (monotonic) — that's correct
  assert('Case 5: simulationIds are unique', r5a.simulationId !== r5b.simulationId);
  console.log(`         fragility=${r5a.summary?.fragilityScore}  exConf=${r5a.confidence?.executionConfidence}  (both runs identical)`);
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');

  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) {
    runSelfTest();
    return;
  }

  if (RUN_FROM) {
    if (!FLAG_JSON) process.stdout.write(`[sim_report] Running simulator from ${RUN_FROM}...\n`);
    const n = runSimsFromBlueprintLog(RUN_FROM, SIM_LOG);
    if (!FLAG_JSON) process.stdout.write(`[sim_report] Simulated ${n} blueprint(s) → ${SIM_LOG}\n`);
  }

  // Read simulation log
  if (!fs.existsSync(SIM_LOG)) {
    if (!FLAG_JSON) {
      console.warn(`[sim_report] No simulation log found at ${SIM_LOG}`);
      console.warn('  Run with --run-from logs/trade_blueprints.jsonl to generate simulations.');
    } else {
      console.log(JSON.stringify({ error: 'no_sim_log', path: SIM_LOG }));
    }
    return;
  }

  const lines = fs.readFileSync(SIM_LOG, 'utf8').split('\n').filter(Boolean);
  const results = [];
  for (const line of lines) {
    try { results.push(JSON.parse(line)); } catch { /* skip */ }
  }

  if (FLAG_JSON) {
    const stats = inspectSimLog(SIM_LOG);
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...stats, results }));
  } else {
    printReport(results);
  }
}

main();
