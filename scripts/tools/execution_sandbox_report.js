'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution Sandbox Report
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/execution_sandbox_report.js
//  STATUS    : NEW — Boss ruling 2026-04-15
//
//  USAGE
//    node scripts/tools/execution_sandbox_report.js \
//      --blueprints logs/session_.../blueprints.jsonl \
//      --replay     logs/session_.../price_replay.jsonl \
//      [--out       logs/session_.../sandbox_results.json] \
//      [--delays    0,500,1000]
//    node scripts/tools/execution_sandbox_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const { runSandbox, simulateOne, buildReplayIndex } = require('../execution/execution_sandbox');
const { computePnL, classifyExecution } = require('../execution/pnl_engine');

const ARGS      = process.argv.slice(2);
const FLAG_TEST = ARGS.includes('--self-test');
const FLAG_JSON = ARGS.includes('--json');

function getArg(flag) {
  const i = ARGS.indexOf(flag);
  return i !== -1 ? ARGS[i+1] : null;
}

const BP_PATH  = getArg('--blueprints');
const RPL_PATH = getArg('--replay');
const OUT_PATH = getArg('--out');
const DELAYS   = (getArg('--delays') || '0,500,1000')
  .split(',').map(x => Number(x.trim())).filter(Number.isFinite);

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — '+detail : ''}`); fail++; }
  }

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Execution Sandbox — Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // ── pnl_engine tests ────────────────────────────────────────────────────────
  console.log('  pnl_engine.js:');

  // Case 1: profitable trade
  {
    const r = computePnL({ spreadBps: 30, feeBps: 6, sizeUsd: 200, gasUsd: 0.02 });
    assert('Case 1: positive netProfitUsd', r.netProfitUsd > 0, `${r.netProfitUsd}`);
    assert('Case 1: wouldRevert=false', r.wouldRevert === false);
    assert('Case 1: grossProfitUsd = sizeUsd × spread/10000',
      Math.abs(r.grossProfitUsd - 200 * 30/10000) < 0.000001);
    console.log(`    spread=30bps sizeUsd=$200: net=$${r.netProfitUsd} gross=$${r.grossProfitUsd}`);
  }

  // Case 2: losing trade (spread below fee wall)
  {
    const r = computePnL({ spreadBps: 2, feeBps: 6, sizeUsd: 200, gasUsd: 0.02 });
    assert('Case 2: negative netProfitUsd', r.netProfitUsd < 0, `${r.netProfitUsd}`);
    assert('Case 2: wouldRevert=true', r.wouldRevert === true);
    console.log(`    spread=2bps sizeUsd=$200: net=$${r.netProfitUsd} wouldRevert=${r.wouldRevert}`);
  }

  // Case 3: classifyExecution
  {
    assert('Case 3: VIABLE', classifyExecution({ realNetUsd: 0.15, worstNetUsd: 0.05 }) === 'EXECUTION_VIABLE');
    assert('Case 3: MARGINAL', classifyExecution({ realNetUsd: 0.07, worstNetUsd: -0.02 }) === 'EXECUTION_MARGINAL');
    assert('Case 3: FAIL (worstNet negative beyond threshold)',
      classifyExecution({ realNetUsd: 0.07, worstNetUsd: -0.10 }) === 'EXECUTION_FAIL');
    assert('Case 3: FAIL (thin core)',
      classifyExecution({ realNetUsd: 0.02, worstNetUsd: 0.01 }) === 'EXECUTION_FAIL');
  }

  // Case 4: invalid inputs throw
  {
    let threw = false;
    try { computePnL({ spreadBps: NaN, feeBps: 6, sizeUsd: 200 }); } catch { threw = true; }
    assert('Case 4: NaN spreadBps throws', threw);
    threw = false;
    try { computePnL({ spreadBps: 10, feeBps: 6, sizeUsd: 0 }); } catch { threw = true; }
    assert('Case 4: zero sizeUsd throws', threw);
  }
  console.log();

  // ── execution_sandbox replay logic ──────────────────────────────────────────
  console.log('  execution_sandbox.js:');

  const NOW = Date.now();
  function mkTs(offsetMs) { return new Date(NOW + offsetMs).toISOString(); }

  const replayRows = [
    { ts: mkTs(0),    pair:'ETH/USDC-RAMSES', venue:'uniswap_v3', chain:'arbitrum', price:2370, feeBps:1, blockNumber:1001 },
    { ts: mkTs(500),  pair:'ETH/USDC-RAMSES', venue:'uniswap_v3', chain:'arbitrum', price:2372, feeBps:1, blockNumber:1002 },
    { ts: mkTs(1000), pair:'ETH/USDC-RAMSES', venue:'uniswap_v3', chain:'arbitrum', price:2374, feeBps:1, blockNumber:1003 },
    { ts: mkTs(0),    pair:'ETH/USDC-RAMSES', venue:'ramses_v2',  chain:'arbitrum', price:2375, feeBps:5, blockNumber:1001 },
    { ts: mkTs(600),  pair:'ETH/USDC-RAMSES', venue:'ramses_v2',  chain:'arbitrum', price:2378, feeBps:5, blockNumber:1002 },
    { ts: mkTs(1200), pair:'ETH/USDC-RAMSES', venue:'ramses_v2',  chain:'arbitrum', price:2380, feeBps:5, blockNumber:1003 },
  ];
  const replayIndex = buildReplayIndex(replayRows);

  const mkBp = (tsOffset, size = 200) => ({
    blueprintId: `BP-TEST-${tsOffset}`,
    ts         : mkTs(tsOffset),
    pair       : 'ETH/USDC-RAMSES',
    venues     : { entry:{ venue:'uniswap_v3', feePct:0.0001 }, exit:{ venue:'ramses_v2', feePct:0.0005 } },
    sizing     : { targetUsd: size },
    economics  : { spreadPct: 0.22, gasCostUsd: 0.02 },
    _context   : { activeProfile:'SAFE', regime:'surge', heatClass:'EXTREME' },
  });

  // Case 5: clean execution at 0ms delay
  {
    const r = simulateOne({ bp: mkBp(0), replayIndex, delayMs: 0 });
    assert('Case 5: not NO_FILL', r.outcome !== 'SANDBOX_NO_FILL', r.outcome);
    assert('Case 5: has realPnL', Number.isFinite(r.realPnL), `${r.realPnL}`);
    assert('Case 5: has executionClass', !!r.executionClass);
    console.log(`    0ms delay: spread=${r.spreadBps}bps realPnL=$${r.realPnL} class=${r.executionClass}`);
  }

  // Case 6: 500ms delay — exit row shifts
  {
    const r0 = simulateOne({ bp: mkBp(0), replayIndex, delayMs: 0 });
    const r5 = simulateOne({ bp: mkBp(0), replayIndex, delayMs: 500 });
    assert('Case 6: 500ms exit is different row', r0.exitTime !== r5.exitTime || r0.exitPrice !== r5.exitPrice,
      `r0.exit=${r0.exitPrice} r5.exit=${r5.exitPrice}`);
    console.log(`    500ms delay: exitPrice=${r5.exitPrice} (was ${r0.exitPrice})`);
  }

  // Case 7: invalid blueprint → clean fail
  {
    const r = simulateOne({ bp: { blueprintId: 'BP-BAD' }, replayIndex, delayMs: 0 });
    assert('Case 7: invalid bp → SANDBOX_INVALID_BLUEPRINT', r.outcome === 'SANDBOX_INVALID_BLUEPRINT', r.outcome);
    console.log(`    invalid bp: outcome=${r.outcome}`);
  }

  // Case 8: no exit row → NO_FILL
  {
    const farBp = mkBp(-100000); // ts way in the past, no future row
    const r = simulateOne({ bp: farBp, replayIndex, delayMs: 5000 });
    assert('Case 8: no future row → SANDBOX_NO_FILL', r.outcome === 'SANDBOX_NO_FILL', r.outcome);
    console.log(`    far-past bp + 5s delay: outcome=${r.outcome}`);
  }

  // Case 9: determinism
  {
    const r1 = simulateOne({ bp: mkBp(0), replayIndex, delayMs: 500 });
    const r2 = simulateOne({ bp: mkBp(0), replayIndex, delayMs: 500 });
    assert('Case 9: deterministic output', r1.realPnL === r2.realPnL && r1.executionClass === r2.executionClass);
  }

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── REPORT SUMMARIZER ────────────────────────────────────────────────────────

function summarize(results) {
  const viable   = results.filter(r => r.executionClass === 'EXECUTION_VIABLE');
  const marginal = results.filter(r => r.executionClass === 'EXECUTION_MARGINAL');
  const failed   = results.filter(r => r.executionClass === 'EXECUTION_FAIL');
  const noFill   = results.filter(r => r.outcome === 'SANDBOX_NO_FILL');

  const avgNet = arr => {
    const v = arr.filter(r => Number.isFinite(r.realPnL)).map(r => r.realPnL);
    return v.length ? +(v.reduce((a,b)=>a+b,0)/v.length).toFixed(4) : null;
  };
  const top10 = results.filter(r => Number.isFinite(r.realPnL))
    .sort((a,b) => b.realPnL - a.realPnL).slice(0, 10);

  // Delay breakdown
  const byDelay = {};
  for (const r of results) {
    if (!byDelay[r.delayMs]) byDelay[r.delayMs] = { total:0, viable:0, noFill:0, avgNet:[] };
    byDelay[r.delayMs].total++;
    if (r.executionClass === 'EXECUTION_VIABLE') byDelay[r.delayMs].viable++;
    if (r.outcome === 'SANDBOX_NO_FILL') byDelay[r.delayMs].noFill++;
    if (Number.isFinite(r.realPnL)) byDelay[r.delayMs].avgNet.push(r.realPnL);
  }

  return {
    total      : results.length,
    viable     : viable.length,
    marginal   : marginal.length,
    fail       : failed.length,
    noFill     : noFill.length,
    viableRate : results.length ? +(100*viable.length/results.length).toFixed(1) : 0,
    avgNetViable : avgNet(viable),
    avgNetAll    : avgNet(results.filter(r => r.outcome !== 'SANDBOX_NO_FILL')),
    byDelay      : Object.fromEntries(Object.entries(byDelay).map(([d,v])=>[d,{
      total:v.total, viable:v.viable, noFill:v.noFill,
      viableRate: +(100*v.viable/v.total).toFixed(1),
      avgNet: v.avgNet.length ? +(v.avgNet.reduce((a,b)=>a+b,0)/v.avgNet.length).toFixed(4) : null,
    }])),
    top10,
  };
}

function printSummary(s) {
  const EQ = '═'.repeat(70), DIV = '─'.repeat(70);
  console.log('\n' + EQ);
  console.log('  AllMight — Execution Sandbox Report  v1.0');
  console.log(`  ${new Date().toISOString()}`);
  console.log(EQ);
  console.log(`\n  Total simulated:     ${s.total}`);
  console.log(`  \x1b[1;32mEXECUTION_VIABLE:    ${s.viable} (${s.viableRate}%)\x1b[0m`);
  console.log(`  EXECUTION_MARGINAL:  ${s.marginal}`);
  console.log(`  EXECUTION_FAIL:      ${s.fail}`);
  console.log(`  SANDBOX_NO_FILL:     ${s.noFill}  (no replay row found)`);
  console.log(`\n  Avg net (viable):    $${s.avgNetViable??'n/a'}`);
  console.log(`  Avg net (all fills): $${s.avgNetAll??'n/a'}`);

  console.log(`\n  ${DIV}`);
  console.log('  Delay breakdown:');
  for (const [d, v] of Object.entries(s.byDelay)) {
    console.log(`    ${(d+'ms').padEnd(8)} total=${v.total}  viable=${v.viable} (${v.viableRate}%)  noFill=${v.noFill}  avgNet=$${v.avgNet??'n/a'}`);
  }

  console.log(`\n  ${DIV}`);
  console.log('  Top 10 strongest sandbox results:');
  for (const r of s.top10) {
    console.log(`    \x1b[1;32m${r.blueprintId}  ${r.delayMs}ms  ${r.executionClass}  ` +
      `real=$${(r.realPnL||0).toFixed(4)}  spread=${r.spreadBps}bps  ${r.profile||'-'}  ${r.regime||'-'}\x1b[0m`);
  }
  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (FLAG_TEST) { runSelfTest(); return; }

  if (!BP_PATH || !RPL_PATH) {
    console.error('[execution_sandbox_report] --blueprints and --replay required');
    console.error('  Usage: node scripts/tools/execution_sandbox_report.js \\');
    console.error('           --blueprints logs/session_.../blueprints.jsonl \\');
    console.error('           --replay     logs/session_.../price_replay.jsonl');
    process.exit(1);
  }
  for (const p of [BP_PATH, RPL_PATH]) {
    if (!fs.existsSync(p)) { console.error(`Not found: ${p}`); process.exit(1); }
  }

  if (!FLAG_JSON) console.log(`[execution_sandbox_report] blueprints=${BP_PATH}  replay=${RPL_PATH}  delays=${DELAYS.join(',')}`);

  const results = await runSandbox({ blueprintsPath: BP_PATH, replayPath: RPL_PATH, delaysMs: DELAYS });
  const summary = summarize(results);

  if (FLAG_JSON) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(),
      inputs: { blueprints: path.resolve(BP_PATH), replay: path.resolve(RPL_PATH), delays: DELAYS },
      summary, results }, null, 2));
  } else {
    printSummary(summary);
  }

  if (OUT_PATH) {
    fs.writeFileSync(OUT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(),
      inputs: { blueprints: path.resolve(BP_PATH), replay: path.resolve(RPL_PATH), delays: DELAYS },
      summary, results }, null, 2) + '\n', 'utf8');
    console.log(`[execution_sandbox_report] results → ${OUT_PATH}`);
  }
}

main().catch(err => { console.error(`execution_sandbox_report error: ${err.message}`); process.exit(1); });
