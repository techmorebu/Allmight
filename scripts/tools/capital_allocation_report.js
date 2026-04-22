'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Capital Allocation + Execution Realism Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/capital_allocation_report.js
//  STATUS    : NEW — Boss ruling 2026-04-22 (Capital Allocation + Execution Realism)
//
//  PURPOSE
//  ───────
//  Converts the approved adaptive size model into a deployable capital policy.
//  For each trade, selects the minimum viable size and enforces guardrails that
//  prevent unnecessary upper-band usage on thin-margin promoted trades.
//
//  Three operating modes:
//    CONSERVATIVE  — max $300, 66% capture, $315 working capital
//    STANDARD      — max $500, 89% capture, $525 working capital  ← recommended
//    AGGRESSIVE    — max $1000, 96% capture, $1050 working capital
//
//  Output per blueprint:
//    allocatedSize    — final size after guardrails (may be lower than optimalSize)
//    allocationClass  — CORE / PROMOTED / UPPER_BAND / STRUCTURAL_FAIL
//    guardrailApplied — whether a guardrail capped the size
//    expectedNet      — net PnL at allocated size
//
//  USAGE
//  ─────
//  node scripts/tools/capital_allocation_report.js \
//    --sandbox logs/session_YYYYMMDD_HHMM/sandbox_results.json \
//    --mode standard
//
//  node scripts/tools/capital_allocation_report.js \
//    --blueprints logs/.../blueprints.jsonl \
//    --replay     logs/.../price_replay.jsonl \
//    --mode standard
//
//  node scripts/tools/capital_allocation_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { AAVE_FLASH_FEE_PCT } = require('../execution/pnl_engine');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST  = ARGS.includes('--self-test');
const FLAG_JSON       = ARGS.includes('--json');
const SANDBOX_PATH    = argVal('--sandbox',    null);
const BLUEPRINTS_PATH = argVal('--blueprints', null);
const REPLAY_PATH     = argVal('--replay',     null);
const MODE_RAW        = (argVal('--mode', 'standard')).toLowerCase();

// ─── POLICY CONSTANTS ─────────────────────────────────────────────────────────

const APPROVED_LADDER   = [200, 300, 500, 750, 1000];
const VIABLE_MIN_NET    = 0.10;
const AAVE_FLASH_FEE_BPS = AAVE_FLASH_FEE_PCT * 10000;  // 5bps

// Spread thresholds (bps) below which each size becomes the MINIMUM viable size
// spread >= 17.40bps → $200 sufficient
// spread >= 15.27bps → $300 minimum
// spread >= 13.56bps → $500 minimum
// spread >= 12.71bps → $750 minimum
// spread >= 12.28bps → $1000 minimum (barely viable)
const SPREAD_THRESHOLD_FOR_SIZE = {
  200 : 17.40,
  300 : 15.27,
  500 : 13.56,
  750 : 12.71,
  1000: 12.28,
};

// Operating mode caps and guardrails
const MODES = {
  conservative: {
    maxSize    : 300,
    workingCapital: 315,
    label      : 'CONSERVATIVE',
    description: 'Bridge mode — max $300, 66% capture',
  },
  standard: {
    maxSize    : 500,
    workingCapital: 525,
    label      : 'STANDARD',
    description: 'Operating sweet spot — max $500, 89% capture',
  },
  aggressive: {
    maxSize    : 1000,
    workingCapital: 1050,
    label      : 'AGGRESSIVE',
    description: 'Near-ceiling — max $1000, 96% capture',
  },
};

const GUARDRAILS = {
  // Upper-band ($750+) only when spread >= 13.0bps AND net >= $0.12 at $500
  // (ensures upper-band is not used when $500 was sufficient)
  upperBandMinSpread   : 13.0,
  upperBandMinNet500   : 0.12,
  // $1000 only when $750 produces net < $0.10 AND spread genuinely requires it
  thousandMinSpread    : 12.60,
};

// ─── CORE LOGIC ───────────────────────────────────────────────────────────────

function findOptimalSize(spreadBps, feeBps, gasUsd) {
  if (!Number.isFinite(spreadBps) || !Number.isFinite(feeBps)) return null;
  const netSpreadBps = spreadBps - feeBps - AAVE_FLASH_FEE_BPS;
  if (netSpreadBps <= 0) return null;

  for (const sz of APPROVED_LADDER) {
    const net = sz * (netSpreadBps / 10000) - gasUsd;
    if (net >= VIABLE_MIN_NET) return sz;
  }
  return null;
}

function netAtSize(spreadBps, feeBps, gasUsd, sizeUsd) {
  const netSpreadBps = spreadBps - feeBps - AAVE_FLASH_FEE_BPS;
  if (netSpreadBps <= 0) return null;
  return +(sizeUsd * (netSpreadBps / 10000) - gasUsd).toFixed(4);
}

function allocate(rec, mode) {
  const policy    = MODES[mode] ?? MODES.standard;
  const spreadBps = rec.spreadBps;
  const feeBps    = rec.feeBps;
  const gasUsd    = rec.gasUsd ?? 0.028;
  const noFill    = rec.outcome === 'SANDBOX_NO_FILL';

  if (noFill || !Number.isFinite(spreadBps) || !Number.isFinite(feeBps)) {
    return {
      blueprintId    : rec.blueprintId,
      allocationClass: 'NO_FILL',
      allocatedSize  : null,
      expectedNet    : null,
      guardrailApplied: false,
      reason         : noFill ? 'replay gap' : 'missing data',
    };
  }

  const optimalSize = findOptimalSize(spreadBps, feeBps, gasUsd);

  if (optimalSize === null) {
    return {
      blueprintId    : rec.blueprintId,
      allocationClass: 'STRUCTURAL_FAIL',
      allocatedSize  : null,
      expectedNet    : netAtSize(spreadBps, feeBps, gasUsd, 1000),
      guardrailApplied: false,
      reason         : 'spread too thin even at $1000',
    };
  }

  let allocatedSize    = optimalSize;
  let guardrailApplied = false;
  let guardrailReason  = null;

  // ── Guardrail 1: mode cap ──────────────────────────────────────────────────
  if (allocatedSize > policy.maxSize) {
    allocatedSize    = policy.maxSize;
    guardrailApplied = true;
    guardrailReason  = `mode cap: ${policy.label} limits to $${policy.maxSize}`;
  }

  // ── Guardrail 2: upper-band ($750+) requires spread justification ──────────
  if (allocatedSize >= 750 && !guardrailApplied) {
    const net500 = netAtSize(spreadBps, feeBps, gasUsd, 500);
    if (spreadBps < GUARDRAILS.upperBandMinSpread ||
        (net500 !== null && net500 >= VIABLE_MIN_NET)) {
      // $500 is sufficient — no need for upper band
      allocatedSize    = 500;
      guardrailApplied = true;
      guardrailReason  = `upper-band guardrail: $500 sufficient (spread ${spreadBps.toFixed(1)}bps, net500=$${net500})`;
    }
  }

  // ── Guardrail 3: $1000 requires truly thin spread ─────────────────────────
  if (allocatedSize === 1000 && !guardrailApplied) {
    if (spreadBps >= GUARDRAILS.thousandMinSpread + 0.5) {
      // Spread wide enough that $750 should have worked — use $750
      const net750 = netAtSize(spreadBps, feeBps, gasUsd, 750);
      if (net750 !== null && net750 >= VIABLE_MIN_NET) {
        allocatedSize    = 750;
        guardrailApplied = true;
        guardrailReason  = `$1000 guardrail: $750 sufficient (spread ${spreadBps.toFixed(1)}bps)`;
      }
    }
  }

  const expectedNet = netAtSize(spreadBps, feeBps, gasUsd, allocatedSize);

  // ── Classification ────────────────────────────────────────────────────────
  let allocationClass;
  if (allocatedSize === 200)                  allocationClass = 'CORE';
  else if (allocatedSize <= 500)              allocationClass = 'PROMOTED';
  else                                        allocationClass = 'UPPER_BAND';

  // If guardrail capped below viable threshold, mark as capped
  if (expectedNet !== null && expectedNet < VIABLE_MIN_NET && guardrailApplied) {
    allocationClass = 'MODE_CAPPED';
  }

  return {
    blueprintId     : rec.blueprintId,
    spreadBps,
    feeBps,
    gasUsd,
    allocationClass,
    optimalSize,
    allocatedSize   : guardrailApplied && expectedNet !== null && expectedNet < VIABLE_MIN_NET
                        ? null : allocatedSize,
    expectedNet     : (expectedNet !== null && expectedNet >= VIABLE_MIN_NET) ? expectedNet : null,
    guardrailApplied,
    guardrailReason,
  };
}

// ─── AGGREGATE ANALYSIS ───────────────────────────────────────────────────────

function analyze(sandboxRecords, mode) {
  const policy = MODES[mode] ?? MODES.standard;
  const recs0  = sandboxRecords.filter(r => (r.delayMs ?? 0) === 0);
  const recs   = recs0.length ? recs0 : sandboxRecords;

  const allocations = recs.map(r => allocate(r, mode));
  const total       = allocations.length;

  const classes    = { CORE:0, PROMOTED:0, UPPER_BAND:0, STRUCTURAL_FAIL:0, NO_FILL:0, MODE_CAPPED:0 };
  const bySize     = {};
  const nets       = { CORE:[], PROMOTED:[], UPPER_BAND:[] };
  let guardrailed  = 0;
  let totalValue   = 0;

  for (const a of allocations) {
    classes[a.allocationClass] = (classes[a.allocationClass] || 0) + 1;
    if (a.guardrailApplied)   guardrailed++;
    if (a.allocatedSize) {
      bySize[a.allocatedSize] = (bySize[a.allocatedSize] || 0) + 1;
    }
    if (a.expectedNet != null) {
      totalValue += a.expectedNet;
      if (nets[a.allocationClass]) nets[a.allocationClass].push(a.expectedNet);
    }
  }

  const viable = allocations.filter(a => a.expectedNet != null && a.expectedNet >= VIABLE_MIN_NET);

  // Session value by class
  const valueByClass = {};
  for (const [cls, nArr] of Object.entries(nets)) {
    valueByClass[cls] = { count: nArr.length, totalValue: +nArr.reduce((a,b)=>a+b,0).toFixed(4),
                          avgNet: nArr.length ? +(nArr.reduce((a,b)=>a+b,0)/nArr.length).toFixed(4) : null };
  }

  // Marginal return vs conservative baseline
  const conservativeValue = allocations
    .filter(a => a.allocatedSize !== null && a.allocatedSize <= 300 && a.expectedNet != null)
    .reduce((s, a) => s + a.expectedNet, 0);

  return {
    generatedAt       : new Date().toISOString(),
    mode              : policy.label,
    modeDescription   : policy.description,
    maxSize           : policy.maxSize,
    workingCapital    : policy.workingCapital,
    totalRecords      : total,
    viableCount       : viable.length,
    viableRate        : +(viable.length / total).toFixed(4),
    totalSessionValue : +totalValue.toFixed(2),
    guardrailedCount  : guardrailed,
    allocationClasses : classes,
    sizeDistribution  : bySize,
    valueByClass,
    records           : allocations,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(result) {
  const W   = 78;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Capital Allocation + Execution Realism  v1.0');
  console.log(`  Mode: ${result.mode}  |  ${result.modeDescription}`);
  console.log(`  ${result.generatedAt}`);
  console.log(EQ);
  console.log(`\n  Records:           ${result.totalRecords}`);
  console.log(`  Working capital:   $${result.workingCapital}  (trade size + 5% buffer)`);
  console.log(`  Viable trades:     ${result.viableCount}  (${(result.viableRate*100).toFixed(1)}%)`);
  console.log(`  Total session val: $${result.totalSessionValue}`);
  console.log(`  Guardrails fired:  ${result.guardrailedCount}`);

  // ── Allocation class breakdown ─────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  ALLOCATION CLASS BREAKDOWN');
  console.log(`  ${DIV}`);
  const total = result.totalRecords;
  const classDescs = {
    CORE          : 'viable at $200 (thick spread)',
    PROMOTED      : 'requires $300–$500 (thin spread, size-promotable)',
    UPPER_BAND    : 'requires $750+ (very thin spread)',
    MODE_CAPPED   : 'above mode cap — skipped in this mode',
    STRUCTURAL_FAIL: 'too thin even at $1000',
    NO_FILL       : 'replay gap (infrastructure artifact)',
  };
  for (const [cls, count] of Object.entries(result.allocationClasses)) {
    if (!count) continue;
    const pct = (count/total*100).toFixed(1);
    const bar = '█'.repeat(Math.round(count/total*35));
    console.log(`  ${cls.padEnd(16)} ${String(count).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
    console.log(`  ${''.padEnd(16)} ${classDescs[cls] ?? ''}`);
  }

  // ── Size distribution ──────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  SIZE DISTRIBUTION (allocated)');
  console.log(`  ${DIV}`);
  for (const [sz, count] of Object.entries(result.sizeDistribution).sort((a,b)=>Number(a[0])-Number(b[0]))) {
    const pct = (count/total*100).toFixed(1);
    const bar = '█'.repeat(Math.round(count/total*40));
    console.log(`  $${String(sz).padEnd(5)} ${String(count).padStart(5)}  (${pct.padStart(5)}%)  ${bar}`);
  }

  // ── Session value by class ─────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  SESSION VALUE BY CLASS');
  console.log(`  ${DIV}`);
  for (const [cls, v] of Object.entries(result.valueByClass)) {
    if (!v.count) continue;
    const pct = v.totalValue / result.totalSessionValue * 100;
    console.log(`  ${cls.padEnd(16)} trades=${String(v.count).padStart(5)}  ` +
                `total=$${v.totalValue.toFixed(2).padStart(8)}  (${pct.toFixed(1)}% of value)  ` +
                `avg=$${v.avgNet?.toFixed(4)}`);
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

  console.log('\n  Capital Allocation — Self-Test\n');

  // ── Case 1: CORE (thick spread, $200 sufficient) ──────────────────────────
  console.log('  Case 1: CORE trade — thick spread');
  {
    const r = allocate({ blueprintId:'A', delayMs:0, spreadBps:20, feeBps:6, gasUsd:0.028,
                          executionClass:'EXECUTION_VIABLE', outcome:'SANDBOX_PROFIT' }, 'standard');
    assert('CORE class',          r.allocationClass === 'CORE', r.allocationClass);
    assert('allocatedSize = 200', r.allocatedSize === 200, r.allocatedSize);
    assert('no guardrail',        r.guardrailApplied === false);
    console.log(`    class=${r.allocationClass}  size=${r.allocatedSize}  net=$${r.expectedNet}`);
  }
  console.log();

  // ── Case 2: PROMOTED trade — thin spread, needs $300 ─────────────────────
  console.log('  Case 2: PROMOTED — thin spread, needs $300');
  {
    const r = allocate({ blueprintId:'B', delayMs:0, spreadBps:16, feeBps:6, gasUsd:0.028,
                          executionClass:'EXECUTION_MARGINAL', outcome:'SANDBOX_BREAKEVEN' }, 'standard');
    assert('PROMOTED class',      r.allocationClass === 'PROMOTED', r.allocationClass);
    assert('allocatedSize = 300', r.allocatedSize === 300, r.allocatedSize);
    console.log(`    class=${r.allocationClass}  size=${r.allocatedSize}  net=$${r.expectedNet}`);
  }
  console.log();

  // ── Case 3: MODE_CAPPED — conservative mode caps $300→$200 for $500 trade ─
  console.log('  Case 3: MODE_CAPPED — conservative mode limits $500 optimal to $300');
  {
    // spread=14bps: optimal is $500, but conservative mode caps at $300
    const r = allocate({ blueprintId:'C', delayMs:0, spreadBps:14, feeBps:6, gasUsd:0.028,
                          executionClass:'EXECUTION_FAIL', outcome:'SANDBOX_BREAKEVEN' }, 'conservative');
    // At $300: net = 300*(14-6-5)/10000 - 0.028 = 300*3/10000 - 0.028 = 0.09-0.028 = 0.062 → MARGINAL
    // So allocatedSize=null (below VIABLE floor after cap)
    assert('guardrail applied',       r.guardrailApplied === true);
    console.log(`    class=${r.allocationClass}  size=${r.allocatedSize}  guardrail=${r.guardrailReason}`);
  }
  console.log();

  // ── Case 4: STRUCTURAL_FAIL ───────────────────────────────────────────────
  console.log('  Case 4: STRUCTURAL_FAIL — spread below fee wall');
  {
    const r = allocate({ blueprintId:'D', delayMs:0, spreadBps:5, feeBps:6, gasUsd:0.028,
                          executionClass:'EXECUTION_FAIL', outcome:'SANDBOX_LOSS' }, 'standard');
    assert('STRUCTURAL_FAIL class', r.allocationClass === 'STRUCTURAL_FAIL', r.allocationClass);
    assert('allocatedSize null',    r.allocatedSize === null);
    console.log(`    class=${r.allocationClass}  reason=${r.reason}`);
  }
  console.log();

  // ── Case 5: NO_FILL ───────────────────────────────────────────────────────
  console.log('  Case 5: NO_FILL passthrough');
  {
    const r = allocate({ blueprintId:'E', delayMs:0, spreadBps:20, feeBps:6, gasUsd:0.028,
                          outcome:'SANDBOX_NO_FILL' }, 'standard');
    assert('NO_FILL class', r.allocationClass === 'NO_FILL', r.allocationClass);
    assert('size null',     r.allocatedSize === null);
    console.log(`    class=${r.allocationClass}`);
  }
  console.log();

  // ── Case 6: analyze aggregate ─────────────────────────────────────────────
  console.log('  Case 6: analyze aggregate');
  {
    const recs = [
      { blueprintId:'A', delayMs:0, spreadBps:20,  feeBps:6, gasUsd:0.028, outcome:'SANDBOX_PROFIT', executionClass:'EXECUTION_VIABLE' },
      { blueprintId:'B', delayMs:0, spreadBps:16,  feeBps:6, gasUsd:0.028, outcome:'SANDBOX_BREAKEVEN', executionClass:'EXECUTION_MARGINAL' },
      { blueprintId:'C', delayMs:0, spreadBps:14,  feeBps:6, gasUsd:0.028, outcome:'SANDBOX_BREAKEVEN', executionClass:'EXECUTION_FAIL' },
      { blueprintId:'D', delayMs:0, spreadBps:5,   feeBps:6, gasUsd:0.028, outcome:'SANDBOX_LOSS', executionClass:'EXECUTION_FAIL' },
      { blueprintId:'E', delayMs:0, spreadBps:20,  feeBps:6, gasUsd:0.028, outcome:'SANDBOX_NO_FILL' },
    ];
    const r = analyze(recs, 'standard');
    assert('totalRecords = 5',   r.totalRecords === 5, r.totalRecords);
    assert('CORE = 1',           r.allocationClasses.CORE === 1, r.allocationClasses.CORE);
    assert('PROMOTED = 2',       r.allocationClasses.PROMOTED === 2, r.allocationClasses.PROMOTED);
    assert('STRUCTURAL_FAIL = 1',r.allocationClasses.STRUCTURAL_FAIL === 1);
    assert('NO_FILL = 1',        r.allocationClasses.NO_FILL === 1);
    console.log(`    core=${r.allocationClasses.CORE}  promoted=${r.allocationClasses.PROMOTED}  structural=${r.allocationClasses.STRUCTURAL_FAIL}  viable=${r.viableCount}`);
  }
  console.log();

  console.log('  ' + '═'.repeat(62));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(62) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  const mode = MODE_RAW in MODES ? MODE_RAW : 'standard';
  let sandboxRecords = [];

  if (SANDBOX_PATH) {
    if (!fs.existsSync(SANDBOX_PATH)) {
      console.error(`[capital_allocation_report] Not found: ${SANDBOX_PATH}`); process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(SANDBOX_PATH, 'utf8'));
    sandboxRecords = raw.results ?? raw;
    if (!FLAG_JSON) console.log(`[capital_allocation_report] Loaded ${sandboxRecords.length} sandbox record(s)  mode=${mode}`);

  } else if (BLUEPRINTS_PATH && REPLAY_PATH) {
    if (!FLAG_JSON) console.log(`[capital_allocation_report] Running inline sandbox...  mode=${mode}`);
    const { runSandbox } = require('../execution/execution_sandbox');
    sandboxRecords = await runSandbox({ blueprintsPath: BLUEPRINTS_PATH, replayPath: REPLAY_PATH, delaysMs: [0] });
    if (!FLAG_JSON) console.log(`[capital_allocation_report] Sandbox complete: ${sandboxRecords.length} record(s)`);

  } else {
    console.error('[capital_allocation_report] Provide --sandbox or --blueprints + --replay');
    process.exit(1);
  }

  const result = analyze(sandboxRecords, mode);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result);
  }
}

main().catch(err => {
  console.error(`capital_allocation_report error: ${err.message}`);
  process.exit(1);
});
