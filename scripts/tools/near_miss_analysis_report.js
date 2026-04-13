'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Near-Miss Analysis Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/near_miss_analysis_report.js
//
//  USAGE
//  ─────
//  # Analyse near-misses from a candidate audit log
//  node scripts/tools/near_miss_analysis_report.js \
//    --audit logs/execution_candidate_audit.jsonl
//
//  # JSON output
//  node scripts/tools/near_miss_analysis_report.js \
//    --audit logs/execution_candidate_audit.jsonl --json
//
//  # Built-in self-test
//  node scripts/tools/near_miss_analysis_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const { analyseNearMisses, SPREAD_BANDS, CONFIDENCE_BANDS,
        HIGH_CONFIDENCE_THRESHOLD } = require('../execution/near_miss_analysis');

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
const AUDIT_PATH     = argVal('--audit', 'logs/execution_candidate_audit.jsonl');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

function pct(n, d) {
  return d ? `${(100 * n / d).toFixed(1)}%` : '0%';
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  const { analyseNearMisses } = require('../execution/near_miss_analysis');
  let pass = 0, fail = 0;

  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  // Fixture: 4 near-miss types + 1 confirmed + 1 rejected
  const fixtures = [
    // CONFIRMED
    { auditVerdict: 'CANDIDATE_CONFIRMED', spreadPct: 0.2300, executionConfidence: 0.72,
      profile: 'SAFE', heatClass: 'HOT', regime: 'surge', simulationVerdict: 'SIM_PASS',
      nearMissType: null, nearMissDetail: null },
    // near_miss_spread
    { auditVerdict: 'CANDIDATE_NEAR_MISS', nearMissType: 'near_miss_spread',
      nearMissDetail: 'spreadPct=0.2050% threshold=0.22% gap=0.0150%',
      spreadPct: 0.2050, executionConfidence: 0.69,
      profile: 'BALANCED', heatClass: 'EXTREME', regime: 'surge', simulationVerdict: 'SIM_PASS' },
    // near_miss_sim (MARGINAL)
    { auditVerdict: 'CANDIDATE_NEAR_MISS', nearMissType: 'near_miss_sim',
      nearMissDetail: 'simulationVerdict=SIM_MARGINAL fragility=0.333',
      spreadPct: 0.1900, executionConfidence: 0.61,
      profile: 'AGGRESSIVE', heatClass: 'HOT', regime: 'persistent_depth_regime', simulationVerdict: 'SIM_MARGINAL' },
    // near_miss_sim (high confidence)
    { auditVerdict: 'CANDIDATE_NEAR_MISS', nearMissType: 'near_miss_sim',
      nearMissDetail: 'simulationVerdict=SIM_MARGINAL fragility=0.200',
      spreadPct: 0.2100, executionConfidence: 0.71,
      profile: 'BALANCED', heatClass: 'WARM', regime: 'surge', simulationVerdict: 'SIM_MARGINAL' },
    // near_miss_multi
    { auditVerdict: 'CANDIDATE_NEAR_MISS', nearMissType: 'near_miss_multi',
      nearMissDetail: 'spreadPct=0.2020% threshold=0.22% gap=0.0180% | simulationVerdict=SIM_MARGINAL fragility=0.267',
      spreadPct: 0.2020, executionConfidence: 0.66,
      profile: 'SAFE', heatClass: 'EXTREME', regime: 'surge', simulationVerdict: 'SIM_MARGINAL' },
    // near_miss_size
    { auditVerdict: 'CANDIDATE_NEAR_MISS', nearMissType: 'near_miss_size',
      nearMissDetail: 'sizeUsd=100 required=200',
      spreadPct: 0.2300, executionConfidence: 0.68,
      profile: 'AGGRESSIVE', heatClass: 'HOT', regime: 'surge', simulationVerdict: 'SIM_PASS' },
    // REJECTED
    { auditVerdict: 'CANDIDATE_REJECTED', spreadPct: 0.1400, executionConfidence: 0.30,
      profile: 'SAFE', heatClass: 'COLD', regime: 'base', simulationVerdict: 'SIM_FAIL',
      nearMissType: null, nearMissDetail: null },
  ];

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Near-Miss Analysis Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // Case 1: population counts
  console.log('  Case 1: Population counts');
  {
    const s = analyseNearMisses(fixtures);
    assert('Case 1: totalRecords = 7',     s.totalRecords === 7,     `got ${s.totalRecords}`);
    assert('Case 1: nearMissCount = 5',    s.nearMissCount === 5,    `got ${s.nearMissCount}`);
    assert('Case 1: confirmed = 1',        s.confirmed === 1,        `got ${s.confirmed}`);
    assert('Case 1: rejected = 1',         s.rejected === 1,         `got ${s.rejected}`);
    console.log(`         total=${s.totalRecords}  nearMiss=${s.nearMissCount}  confirmed=${s.confirmed}  rejected=${s.rejected}`);
  }
  console.log();

  // Case 2: dominant subtype
  console.log('  Case 2: Dominant near-miss subtype');
  {
    const s = analyseNearMisses(fixtures);
    assert('Case 2: near_miss_sim is dominant', s.dominantNearMissType === 'near_miss_sim', s.dominantNearMissType);
    assert('Case 2: primaryDriver = SIM_MARGINAL', s.primaryDriver === 'SIM_MARGINAL', s.primaryDriver);
    console.log(`         dominant=${s.dominantNearMissType}  primaryDriver=${s.primaryDriver}`);
  }
  console.log();

  // Case 3: high-confidence detection
  console.log('  Case 3: High-confidence near-misses (conf ≥ 0.65)');
  {
    const s = analyseNearMisses(fixtures);
    assert('Case 3: highConfidenceCount = 4',
      s.highConfidenceCount === 4, `got ${s.highConfidenceCount}`);
    assert('Case 3: sorted by conf desc',
      s.highConfidenceRecords[0].executionConfidence >= s.highConfidenceRecords[1]?.executionConfidence ?? 0);
    console.log(`         highConfCount=${s.highConfidenceCount}  topConf=${s.highConfidenceRecords[0]?.executionConfidence}`);
  }
  console.log();

  // Case 4: spread band distribution
  console.log('  Case 4: Spread band distribution');
  {
    const s = analyseNearMisses(fixtures);
    // near-misses at: 0.205, 0.190, 0.210, 0.202, 0.230
    assert('Case 4: bySpreadBand has expected keys',
      Object.keys(s.bySpreadBand).length > 0);
    const execZone = s.bySpreadBand['≥0.22'] ?? 0;
    assert('Case 4: one near-miss in ≥0.22 band (near_miss_size at 0.23)',
      execZone === 1, `got ${execZone}`);
    console.log(`         bySpreadBand=${JSON.stringify(s.bySpreadBand)}`);
  }
  console.log();

  // Case 5: empty input
  console.log('  Case 5: Empty input degrades cleanly');
  {
    const s1 = analyseNearMisses([]);
    const s2 = analyseNearMisses(null);
    assert('Case 5a: empty array → nearMissCount=0', s1.nearMissCount === 0);
    assert('Case 5b: null → nearMissCount=0',        s2.nearMissCount === 0);
    assert('Case 5: no crash', true);
    console.log(`         empty OK  null OK`);
  }
  console.log();

  // Case 6: determinism
  console.log('  Case 6: Determinism — same input → same output');
  {
    const s1 = analyseNearMisses(fixtures);
    const s2 = analyseNearMisses(fixtures);
    assert('Case 6: nearMissCount identical',   s1.nearMissCount === s2.nearMissCount);
    assert('Case 6: dominantType identical',    s1.dominantNearMissType === s2.dominantNearMissType);
    assert('Case 6: highConfCount identical',   s1.highConfidenceCount === s2.highConfidenceCount);
    assert('Case 6: byType identical',          JSON.stringify(s1.byType) === JSON.stringify(s2.byType));
    console.log(`         all identical ✓`);
  }
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(summary, auditPath) {
  const W   = 110;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);
  const nm  = summary.nearMissCount;

  console.log('\n' + EQ);
  console.log('  AllMight — Near-Miss Analysis Report  v1.0');
  console.log(`  ${new Date().toISOString()}  |  Source: ${auditPath}`);
  console.log(EQ);

  // Population
  console.log(`\n  Population: ${summary.totalRecords} total  ` +
    `${summary.confirmed} confirmed  ${nm} near-miss  ${summary.rejected} rejected`);

  if (!nm) {
    console.log('  No near-miss records to analyse.\n' + EQ + '\n');
    return;
  }

  // Boss question 1: dominant subtype
  console.log(`\n  Q1. Dominant subtype: \x1b[1m${summary.dominantNearMissType}\x1b[0m`);
  console.log(`      Primary driver: \x1b[1m${summary.primaryDriver}\x1b[0m`);
  console.log('      By type:');
  for (const [k, v] of Object.entries(summary.byType).sort((a,b)=>b[1]-a[1])) {
    const bar = '█'.repeat(Math.round(20 * v / nm));
    console.log(`        ${k.padEnd(22)} ${String(v).padStart(4)} (${pct(v,nm)})  ${bar}`);
  }

  // Boss question 2: profile
  console.log(`\n  Q2. Dominant profile: \x1b[1m${summary.dominantProfile}\x1b[0m`);
  for (const [k, v] of Object.entries(summary.byProfile).sort((a,b)=>b[1]-a[1])) {
    console.log(`        ${k.padEnd(14)} ${String(v).padStart(4)} (${pct(v,nm)})`);
  }

  // Boss question 3: heat class
  console.log(`\n  Q3. Dominant heat class: \x1b[1m${summary.dominantHeatClass}\x1b[0m`);
  for (const [k, v] of Object.entries(summary.byHeatClass).sort((a,b)=>b[1]-a[1])) {
    const bar = '█'.repeat(Math.round(20 * v / nm));
    console.log(`        ${k.padEnd(10)} ${String(v).padStart(4)} (${pct(v,nm)})  ${bar}`);
  }

  // Boss question 4: spread vs sim split
  const sm = summary.simMarginalStats;
  const ss = summary.spreadNearMissStats;
  console.log(`\n  Q4. Near-miss cause distribution:`);
  console.log(`      SIM_MARGINAL:   ${sm.count} (${pct(sm.count,nm)})`);
  if (sm.spreads) console.log(`        spread range: ${sm.spreads.min.toFixed(4)}% – ${sm.spreads.max.toFixed(4)}%  median=${sm.spreads.median.toFixed(4)}%`);
  if (sm.confs)   console.log(`        conf  range:  ${sm.confs.min.toFixed(3)} – ${sm.confs.max.toFixed(3)}     median=${sm.confs.median.toFixed(3)}`);
  console.log(`      SPREAD_BELOW:   ${ss.count} (${pct(ss.count,nm)})`);
  if (ss.spreads) console.log(`        spread range: ${ss.spreads.min.toFixed(4)}% – ${ss.spreads.max.toFixed(4)}%  median=${ss.spreads.median.toFixed(4)}%`);
  if (ss.gaps)    console.log(`        gap from threshold: min=${ss.gaps.min.toFixed(4)}%  max=${ss.gaps.max.toFixed(4)}%  median=${ss.gaps.median.toFixed(4)}%`);
  console.log(`      MULTI:          ${summary.multiNearMissCount} (${pct(summary.multiNearMissCount,nm)})`);

  // Boss question 5: high-confidence near-misses
  console.log(`\n  Q5. High-confidence near-misses (conf ≥ ${HIGH_CONFIDENCE_THRESHOLD}): ${summary.highConfidenceCount}`);
  if (summary.highConfidenceRecords.length) {
    console.log(`      Top records:`);
    for (const r of summary.highConfidenceRecords.slice(0, 8)) {
      console.log(`        conf=${r.executionConfidence?.toFixed(3)}  spread=${r.spreadPct?.toFixed(4)}%  ` +
                  `type=${r.nearMissType}  profile=${r.profile}  heat=${r.heatClass}`);
    }
  }

  // EDGE_EXECUTION_CANDIDATE summary line (Boss ruling 2026-04-13)
  const edgeCount = summary.edgeCandidateCount ?? 0;
  console.log(`\n  EDGE_EXECUTION_CANDIDATE: ${edgeCount} (${pct(edgeCount, nm)} of near-miss pool)  [tracking only — not admission]`);

  // Spread band
  console.log(`\n  Spread band distribution:`);
  for (const b of SPREAD_BANDS) {
    const v = summary.bySpreadBand[b.label] ?? 0;
    const bar = '█'.repeat(Math.round(20 * v / nm));
    console.log(`    ${b.label.padEnd(14)} ${String(v).padStart(4)} (${pct(v,nm)})  ${bar}`);
  }

  // Confidence band
  console.log(`\n  Execution confidence band distribution:`);
  for (const b of CONFIDENCE_BANDS) {
    const v = summary.byConfBand[b.label] ?? 0;
    const bar = '█'.repeat(Math.round(20 * v / nm));
    console.log(`    ${b.label.padEnd(14)} ${String(v).padStart(4)} (${pct(v,nm)})  ${bar}`);
  }

  // Regime
  console.log(`\n  Regime distribution:`);
  for (const [k,v] of Object.entries(summary.byRegime).sort((a,b)=>b[1]-a[1])) {
    console.log(`    ${k.padEnd(30)} ${String(v).padStart(4)} (${pct(v,nm)})`);
  }

  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(AUDIT_PATH)) {
    console.error(`[near_miss_report] Audit log not found: ${AUDIT_PATH}`);
    console.error('  Run: node scripts/tools/candidate_audit_report.js --blueprints <path>');
    process.exit(1);
  }

  const records = readJsonl(AUDIT_PATH);
  if (!FLAG_JSON) process.stdout.write(`[near_miss_report] Loaded ${records.length} audit record(s)\n\n`);

  const summary = analyseNearMisses(records);

  if (FLAG_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printReport(summary, AUDIT_PATH);
  }
}

main();
