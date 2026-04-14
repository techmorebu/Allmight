'use strict';
// PLACEMENT : scripts/tools/execution_realism_report.js
// USAGE: node scripts/tools/execution_realism_report.js --blueprints <path>
//        node scripts/tools/execution_realism_report.js --self-test

const fs = require('fs');
const {
  simulateExecutionRealism, simulateBatch,
  CORE_REAL_SCENARIO,
} = require('../execution/execution_realism_simulator');

const ARGS      = process.argv.slice(2);
const FLAG_TEST = ARGS.includes('--self-test');
const FLAG_JSON = ARGS.includes('--json');
const BP_PATH   = (() => { const i=ARGS.indexOf('--blueprints'); return i!==-1&&ARGS[i+1]?ARGS[i+1]:null; })();

function readJsonl(p) {
  if (!p||!fs.existsSync(p)) return [];
  return fs.readFileSync(p,'utf8').split('\n').filter(Boolean).reduce((acc,l)=>{
    try{acc.push(JSON.parse(l));}catch{}; return acc;
  },[]);
}

function mkBp(spread, profile='SAFE', gas=0.028) {
  return {
    blueprintId:`BP-REAL-${spread.toFixed(4).replace('.','')}-${profile}`,
    pair:'ETH/USDC-RAMSES', direction:'BUY_UNISWAP_V3_SELL_RAMSES_V2',
    venues:{entry:{expectedPrice:2185,feePct:0.0001},exit:{expectedPrice:2185*(1+spread/100),feePct:0.0005}},
    sizing:{targetUsd:200},
    economics:{spreadPct:spread,gasCostUsd:gas,slippageBps:1.86,expectedEdgePct:spread*0.4},
    viability:{confidenceScore:0.72},
    _context:{activeProfile:profile,heatClass:'EXTREME',heatScore:0.62,regime:'persistent_depth_regime',
              edgeBucket:'viable_zone',windowId:1,bestSizeObserved:100,
              policySize:200,targetExecutionSizeUsd:200,heatSizeAdjusted:false},
  };
}

function runSelfTest() {
  let pass=0, fail=0;
  function assert(label, cond, detail) {
    if(cond){console.log(`  ✓ [PASS] ${label}`);pass++;}
    else{console.error(`  ✗ [FAIL] ${label}${detail?' — '+detail:''}`);fail++;}
  }

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Execution Realism Simulator Self-Test  v2.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // Case 1: Strong spread → VIABLE
  console.log('  Case 1: Strong spread (0.4099%) → EXECUTION_VIABLE');
  {
    const r = simulateExecutionRealism(mkBp(0.4099));
    assert('Case 1: EXECUTION_VIABLE', r.executionClass==='EXECUTION_VIABLE', r.executionClass);
    assert('Case 1: executionViable=true', r.executionViable===true);
    assert('Case 1: coreNet > 0.10', r.expectedRealNetUsd > 0.10, `${r.expectedRealNetUsd}`);
    assert('Case 1: has latencyCases[3]', r.latencyCases?.length===3);
    assert('Case 1: has gasCases[4]', r.gasCases?.length===4);
    assert('Case 1: has mevCases[4]', r.mevCases?.length===4);
    assert('Case 1: has failCases[3]', r.failCases?.length===3);
    console.log(`    class=${r.executionClass}  core=$${r.expectedRealNetUsd}  worst=$${r.worstCaseNetUsd}`);
    console.log(`    latency=${r.sensitivity.latency}  drift=${r.sensitivity.drift}  gas=${r.sensitivity.gas}`);
  }
  console.log();

  // Case 2: Thin spread → not VIABLE
  console.log('  Case 2: Thin spread (0.2209%) → MARGINAL or FAIL');
  {
    const r = simulateExecutionRealism(mkBp(0.155));
    assert('Case 2: not VIABLE (0.155% → MARGINAL)', r.executionClass!=='EXECUTION_VIABLE', r.executionClass);
    assert('Case 2: coreNet < 0.10', r.expectedRealNetUsd < 0.10, `${r.expectedRealNetUsd}`);
    console.log(`    class=${r.executionClass}  core=$${r.expectedRealNetUsd}`);
  }
  console.log();

  // Case 3: Latency cases ordered correctly
  console.log('  Case 3: Latency cases — ideal > realistic > degraded');
  {
    const r = simulateExecutionRealism(mkBp(0.35));
    const nets = r.latencyCases.map(c=>c.netUsd);
    assert('Case 3: latency monotone decrease', nets.every((v,i)=>i===0||v<=nets[i-1]), JSON.stringify(nets));
    assert('Case 3: ideal positive', nets[0]>0, `${nets[0]}`);
    console.log(`    latency nets: ${nets.join(', ')}`);
  }
  console.log();

  // Case 4: MEV cases monotone
  console.log('  Case 4: MEV cases — higher MEV = lower net');
  {
    const r = simulateExecutionRealism(mkBp(0.30));
    const nets = r.mevCases.map(c=>c.netUsd);
    assert('Case 4: MEV monotone', nets.every((v,i)=>i===0||v<=nets[i-1]), JSON.stringify(nets));
    console.log(`    mev nets: ${nets.join(', ')}`);
  }
  console.log();

  // Case 5: worst ≤ core ≤ best
  console.log('  Case 5: worst ≤ core ≤ best ordering');
  {
    const r = simulateExecutionRealism(mkBp(0.2849));
    assert('Case 5: worst ≤ core', r.worstCaseNetUsd <= r.expectedRealNetUsd,
      `worst=${r.worstCaseNetUsd} core=${r.expectedRealNetUsd}`);
    assert('Case 5: core ≤ best', r.expectedRealNetUsd <= r.bestCaseNetUsd,
      `core=${r.expectedRealNetUsd} best=${r.bestCaseNetUsd}`);
    console.log(`    best=$${r.bestCaseNetUsd}  core=$${r.expectedRealNetUsd}  worst=$${r.worstCaseNetUsd}`);
  }
  console.log();

  // Case 6: determinism
  console.log('  Case 6: Determinism');
  {
    const bp = mkBp(0.2985);
    const r1=simulateExecutionRealism(bp), r2=simulateExecutionRealism(bp);
    assert('Case 6: class identical', r1.executionClass===r2.executionClass);
    assert('Case 6: coreNet identical', r1.expectedRealNetUsd===r2.expectedRealNetUsd);
    assert('Case 6: worstCase identical', r1.worstCaseNetUsd===r2.worstCaseNetUsd);
    console.log(`    deterministic ✓  class=${r1.executionClass}`);
  }
  console.log();

  // Case 7: null batch
  console.log('  Case 7: null/bad inputs → no crash');
  {
    const results = simulateBatch([null, {}, null]);
    assert('Case 7: 3 results returned', results.length===3);
    assert('Case 7: all EXECUTION_FAIL', results.every(r=>r.executionClass==='EXECUTION_FAIL'));
    console.log(`    ${results.length} results, all safe ✓`);
  }
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if(fail>0) process.exit(1);
}

function printReport(results, source) {
  const pct=(n,d)=>d?`${(100*n/d).toFixed(1)}%`:'0%';
  const viable   = results.filter(r=>r.executionClass==='EXECUTION_VIABLE');
  const marginal = results.filter(r=>r.executionClass==='EXECUTION_MARGINAL');
  const failed   = results.filter(r=>r.executionClass==='EXECUTION_FAIL');
  const W=110, EQ='═'.repeat(W), DIV='─'.repeat(W);

  console.log('\n'+EQ);
  console.log('  AllMight — Execution Realism Report  v2.0');
  console.log(`  ${new Date().toISOString()}  |  Source: ${source||'?'}`);
  console.log(`  Core: ${CORE_REAL_SCENARIO.driftBps}bp drift  ${CORE_REAL_SCENARIO.gasMult}×gas  ${CORE_REAL_SCENARIO.fillFraction*100}%fill  ${CORE_REAL_SCENARIO.mevLossProb*100}%MEV  ${CORE_REAL_SCENARIO.failProb*100}%fail`);
  console.log(EQ);
  console.log(`\n  Blueprints: ${results.length}`);
  console.log(`  \x1b[1;32mVIABLE:   ${viable.length} (${pct(viable.length,results.length)})\x1b[0m`);
  console.log(`  \x1b[33mMARGINAL: ${marginal.length} (${pct(marginal.length,results.length)})\x1b[0m`);
  console.log(`  \x1b[90mFAIL:     ${failed.length} (${pct(failed.length,results.length)})\x1b[0m`);

  if(viable.length) {
    const nets = viable.map(r=>r.expectedRealNetUsd);
    const worsts = viable.map(r=>r.worstCaseNetUsd);
    const avg = arr=>arr.length?(arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(4):'?';
    console.log(`\n  Viable economics:`);
    console.log(`    Core net:   $${Math.min(...nets).toFixed(4)} – $${Math.max(...nets).toFixed(4)}  avg=$${avg(nets)}`);
    console.log(`    Worst case: $${Math.min(...worsts).toFixed(4)} – $${Math.max(...worsts).toFixed(4)}`);
    const latS={CRITICAL:0,HIGH:0,MODERATE:0,LOW:0}, gasS={CRITICAL:0,HIGH:0,MODERATE:0,LOW:0};
    viable.forEach(r=>{latS[r.sensitivity.latency]=(latS[r.sensitivity.latency]||0)+1;
                       gasS[r.sensitivity.gas]=(gasS[r.sensitivity.gas]||0)+1;});
    console.log(`    Latency sensitivity: ${JSON.stringify(latS)}`);
    console.log(`    Gas sensitivity:     ${JSON.stringify(gasS)}`);
    const byP={};
    viable.forEach(r=>{const p=r.profile||'?'; byP[p]=(byP[p]||0)+1;});
    console.log(`    By profile: ${JSON.stringify(byP)}`);
  }

  // Top 10
  console.log(`\n  ${DIV}`);
  console.log('  Top 10 VIABLE by core real net:');
  const top10=viable.slice().sort((a,b)=>b.expectedRealNetUsd-a.expectedRealNetUsd).slice(0,10);
  for(const r of top10) {
    console.log(`\x1b[1;32m  spread=${(r.sourceSpreadPct||0).toFixed(4)}%  core=$${(r.expectedRealNetUsd||0).toFixed(4)}  worst=$${(r.worstCaseNetUsd||0).toFixed(4)}  lat=${r.sensitivity.latency}  gas=${r.sensitivity.gas}  ${r.profile||'?'}\x1b[0m`);
  }

  // Fail analysis
  if(failed.length) {
    let gas_kills=0, drift_kills=0, mev_kills=0;
    for(const r of failed) {
      const lat200 = r.latencyCases?.find(c=>c.id==='latency_200ms')?.netUsd??0;
      const gas15  = r.gasCases?.find(c=>c.id==='gas_1_5x')?.netUsd??0;
      if(lat200<0.01) drift_kills++;
      else if(gas15<0.01) gas_kills++;
      else mev_kills++;
    }
    console.log(`\n  Fail causes: drift_kills=${drift_kills}  gas_kills=${gas_kills}  mev_kills=${mev_kills}`);
  }
  console.log('\n'+EQ+'\n');
}

function main() {
  if(FLAG_TEST){runSelfTest();return;}
  if(!BP_PATH){console.error('[execution_realism_report] --blueprints <path> required');process.exit(1);}
  if(!fs.existsSync(BP_PATH)){console.error(`Not found: ${BP_PATH}`);process.exit(1);}

  const blueprints=readJsonl(BP_PATH);
  if(!FLAG_JSON) process.stdout.write(`[execution_realism_report] ${blueprints.length} blueprints\n\n`);

  const results=simulateBatch(blueprints);
  const viable=results.filter(r=>r.executionClass==='EXECUTION_VIABLE');
  const marginal=results.filter(r=>r.executionClass==='EXECUTION_MARGINAL');
  const failed=results.filter(r=>r.executionClass==='EXECUTION_FAIL');

  if(FLAG_JSON) {
    const nets=viable.map(r=>r.expectedRealNetUsd).filter(n=>n!=null);
    console.log(JSON.stringify({
      total:results.length, viableCount:viable.length, marginalCount:marginal.length, failCount:failed.length,
      viablePct:results.length?+(100*viable.length/results.length).toFixed(1):0,
      avgRealNetUsd:nets.length?+(nets.reduce((a,b)=>a+b,0)/nets.length).toFixed(4):null,
      top10Viable:viable.slice().sort((a,b)=>b.expectedRealNetUsd-a.expectedRealNetUsd).slice(0,10),
      allResults:results,
    },null,2));
  } else {
    printReport(results, BP_PATH);
  }
}
main();
