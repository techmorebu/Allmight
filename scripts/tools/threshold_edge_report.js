'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Threshold-Edge Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/threshold_edge_report.js
//
//  USAGE
//  ─────
//  node scripts/tools/threshold_edge_report.js \
//    --audit logs/execution_candidate_audit.jsonl
//
//  node scripts/tools/threshold_edge_report.js --json \
//    --audit logs/execution_candidate_audit.jsonl
//
//  node scripts/tools/threshold_edge_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');

const { trackThresholdEdge, EDGE_CONFIDENCE_THRESHOLD,
        EDGE_NEAR_MISS_TYPE, GAP_BANDS }  = require('../execution/threshold_edge_tracker');

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

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

function pct(n, d) { return d ? `${(100*n/d).toFixed(1)}%` : '0%'; }

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  const { trackThresholdEdge, isThresholdEdge } = require('../execution/threshold_edge_tracker');
  let pass = 0, fail = 0;

  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  // Fixture: mix of edge + non-edge records
  const fixtures = [
    // THRESHOLD_EDGE_CANDIDATE — qualifies
    { auditVerdict:'CANDIDATE_NEAR_MISS', nearMissType:'near_miss_spread',
      simulationVerdict:'SIM_PASS', executionConfidence:0.722,
      spreadPct:0.2189, baseNetProfitUsd:0.26, profile:'BALANCED',
      heatClass:'EXTREME', regime:'surge',
      nearMissDetail:'spreadPct=0.2189% threshold=0.22% gap=0.0011%',
      candidateAuditId:'AUD-T1', fragilityScore:0.10, ts:'2026-04-11T22:00:00Z' },

    { auditVerdict:'CANDIDATE_NEAR_MISS', nearMissType:'near_miss_spread',
      simulationVerdict:'SIM_PASS', executionConfidence:0.657,
      spreadPct:0.2165, baseNetProfitUsd:0.24, profile:'SAFE',
      heatClass:'EXTREME', regime:'persistent_depth_regime',
      nearMissDetail:'spreadPct=0.2165% threshold=0.22% gap=0.0035%',
      candidateAuditId:'AUD-T2', fragilityScore:0.12, ts:'2026-04-11T23:00:00Z' },

    { auditVerdict:'CANDIDATE_NEAR_MISS', nearMissType:'near_miss_spread',
      simulationVerdict:'SIM_PASS', executionConfidence:0.690,
      spreadPct:0.2150, baseNetProfitUsd:0.25, profile:'AGGRESSIVE',
      heatClass:'HOT', regime:'surge',
      nearMissDetail:'spreadPct=0.2150% threshold=0.22% gap=0.0050%',
      candidateAuditId:'AUD-T3', fragilityScore:0.11, ts:'2026-04-12T01:00:00Z' },

    // Does NOT qualify — near_miss_sim (wrong type)
    { auditVerdict:'CANDIDATE_NEAR_MISS', nearMissType:'near_miss_sim',
      simulationVerdict:'SIM_MARGINAL', executionConfidence:0.71,
      spreadPct:0.2100, profile:'BALANCED', heatClass:'HOT', regime:'surge',
      nearMissDetail:'simulationVerdict=SIM_MARGINAL fragility=0.333',
      candidateAuditId:'AUD-T4' },

    // Does NOT qualify — conf below threshold
    { auditVerdict:'CANDIDATE_NEAR_MISS', nearMissType:'near_miss_spread',
      simulationVerdict:'SIM_PASS', executionConfidence:0.60,
      spreadPct:0.2180, profile:'SAFE', heatClass:'EXTREME', regime:'surge',
      nearMissDetail:'spreadPct=0.2180% threshold=0.22% gap=0.0020%',
      candidateAuditId:'AUD-T5' },

    // Does NOT qualify — CONFIRMED (not near-miss)
    { auditVerdict:'CANDIDATE_CONFIRMED', spreadPct:0.2300, executionConfidence:0.75,
      candidateAuditId:'AUD-T6' },

    // Does NOT qualify — REJECTED
    { auditVerdict:'CANDIDATE_REJECTED', spreadPct:0.1400, executionConfidence:0.30,
      candidateAuditId:'AUD-T7' },
  ];

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Threshold-Edge Tracker Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // Case 1: correct count
  console.log('  Case 1: Correct edge record count');
  {
    const s = trackThresholdEdge(fixtures);
    assert('Case 1: edgeCount = 3',   s.edgeCount === 3,   `got ${s.edgeCount}`);
    assert('Case 1: records.length = 3', s.records.length === 3, `got ${s.records.length}`);
    assert('Case 1: totalAuditRecords = 7', s.totalAuditRecords === 7);
    console.log(`         edgeCount=${s.edgeCount}  total=${s.totalAuditRecords}  pct=${s.edgePctOfAudit}%`);
  }
  console.log();

  // Case 2: correct exclusions
  console.log('  Case 2: Non-qualifying records excluded');
  {
    const s = trackThresholdEdge(fixtures);
    const ids = s.records.map(r => r.candidateAuditId);
    assert('Case 2: AUD-T1 included', ids.includes('AUD-T1'));
    assert('Case 2: AUD-T4 excluded (wrong type)', !ids.includes('AUD-T4'));
    assert('Case 2: AUD-T5 excluded (low conf)', !ids.includes('AUD-T5'));
    assert('Case 2: AUD-T6 excluded (confirmed)', !ids.includes('AUD-T6'));
    console.log(`         included IDs: ${ids.join(', ')}`);
  }
  console.log();

  // Case 3: gap stats
  console.log('  Case 3: Gap statistics (gaps: 0.0011, 0.0035, 0.0050)');
  {
    const s = trackThresholdEdge(fixtures);
    assert('Case 3: gapStats present',         s.gapStats != null);
    assert('Case 3: min gap = 0.00110',        s.gapStats?.min === 0.00110, `got ${s.gapStats?.min}`);
    assert('Case 3: max gap = 0.00500',        s.gapStats?.max === 0.00500, `got ${s.gapStats?.max}`);
    assert('Case 3: gapDispersion = CLUSTERED or TIGHT',
      ['CLUSTERED','TIGHT'].includes(s.gapDispersion), s.gapDispersion);
    console.log(`         gap min=${s.gapStats?.min}%  max=${s.gapStats?.max}%  dispersion=${s.gapDispersion}`);
  }
  console.log();

  // Case 4: dominant dimensions
  console.log('  Case 4: Dominant dimensions');
  {
    const s = trackThresholdEdge(fixtures);
    assert('Case 4: dominant profile identified', s.dominantProfile != null);
    assert('Case 4: dominant heat identified',    s.dominantHeatClass != null);
    assert('Case 4: dominant regime identified',  s.dominantRegime != null);
    assert('Case 4: EXTREME dominates heat',      s.dominantHeatClass === 'EXTREME',
      `got ${s.dominantHeatClass}`);
    console.log(`         profile=${s.dominantProfile}  heat=${s.dominantHeatClass}  regime=${s.dominantRegime}`);
  }
  console.log();

  // Case 5: sorting — highest confidence first
  console.log('  Case 5: Records sorted by confidence DESC');
  {
    const s = trackThresholdEdge(fixtures);
    const confs = s.records.map(r => r.executionConfidence);
    const sorted = [...confs].sort((a,b) => b-a);
    assert('Case 5: sorted correctly', JSON.stringify(confs) === JSON.stringify(sorted),
      `got ${JSON.stringify(confs)}`);
    console.log(`         confs (sorted desc): ${confs.join(', ')}`);
  }
  console.log();

  // Case 6: empty input
  console.log('  Case 6: Empty / null input degrades cleanly');
  {
    const s1 = trackThresholdEdge([]);
    const s2 = trackThresholdEdge(null);
    assert('Case 6a: empty → edgeCount=0', s1.edgeCount === 0);
    assert('Case 6b: null → edgeCount=0',  s2.edgeCount === 0);
    assert('Case 6: records empty',        s1.records.length === 0);
    console.log('         empty OK  null OK');
  }
  console.log();

  // Case 7: determinism
  console.log('  Case 7: Determinism');
  {
    const s1 = trackThresholdEdge(fixtures);
    const s2 = trackThresholdEdge(fixtures);
    assert('Case 7: edgeCount identical',      s1.edgeCount === s2.edgeCount);
    assert('Case 7: gapDispersion identical',  s1.gapDispersion === s2.gapDispersion);
    assert('Case 7: dominantProfile identical',s1.dominantProfile === s2.dominantProfile);
    assert('Case 7: record order identical',
      s1.records.map(r=>r.candidateAuditId).join(',') ===
      s2.records.map(r=>r.candidateAuditId).join(','));
    console.log('         all identical ✓');
  }
  console.log();

  // Case 8: isThresholdEdge classifier directly
  console.log('  Case 8: isThresholdEdge classifier');
  {
    const { isThresholdEdge } = require('../execution/threshold_edge_tracker');
    assert('Case 8: near_miss_spread+SIM_PASS+conf≥0.65 → true',
      isThresholdEdge(fixtures[0]) === true);
    assert('Case 8: near_miss_sim → false',
      isThresholdEdge(fixtures[3]) === false);
    assert('Case 8: low conf → false',
      isThresholdEdge(fixtures[4]) === false);
    assert('Case 8: CONFIRMED → false',
      isThresholdEdge(fixtures[5]) === false);
    assert('Case 8: null → false',
      isThresholdEdge(null) === false);
    console.log('         classifier correct on all 5 variants');
  }
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(summary) {
  const W   = 100;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);
  const EDGE_CLR = '\x1b[1;33m';
  const RST      = '\x1b[0m';

  const n = summary.edgeCount;

  console.log('\n' + EQ);
  console.log('  AllMight — Threshold-Edge Tracker  v1.0');
  console.log(`  ${new Date().toISOString()}  |  Source: ${AUDIT_PATH}`);
  console.log(`  Definition: nearMissType=${EDGE_NEAR_MISS_TYPE}  simVerdict=SIM_PASS  conf≥${EDGE_CONFIDENCE_THRESHOLD}`);
  console.log(EQ);

  console.log(`\n  Audit pool: ${summary.totalAuditRecords}  |  ${EDGE_CLR}THRESHOLD_EDGE_CANDIDATES: ${n} (${summary.edgePctOfAudit}% of audit)${RST}`);

  if (!n) {
    console.log('  No threshold-edge candidates found in this audit log.\n' + EQ + '\n');
    return;
  }

  // Q1: count
  console.log(`\n  Q1. Count: ${n} threshold-edge candidates`);

  // Q2: gap range
  const g = summary.gapStats;
  console.log(`\n  Q2. Spread gap from threshold (how close to ALLOW):`);
  console.log(`      min=${g?.min?.toFixed(5)}%  max=${g?.max?.toFixed(5)}%  median=${g?.median?.toFixed(5)}%  mean=${g?.mean?.toFixed(5)}%`);
  console.log(`      Gap dispersion: ${EDGE_CLR}${summary.gapDispersion}${RST}`);
  console.log('      By gap band:');
  for (const b of GAP_BANDS) {
    const v = summary.byGapBand[b.label] ?? 0;
    if (!v) continue;
    const bar = '█'.repeat(Math.round(20 * v / n));
    console.log(`        ${b.label.padEnd(14)} ${String(v).padStart(4)} (${pct(v,n)})  ${bar}`);
  }

  // Q3: profile
  console.log(`\n  Q3. Dominant profile: ${EDGE_CLR}${summary.dominantProfile}${RST}`);
  for (const [k,v] of Object.entries(summary.byProfile).sort((a,b)=>b[1]-a[1])) {
    console.log(`      ${k.padEnd(14)} ${String(v).padStart(4)} (${pct(v,n)})`);
  }

  // Q4: heat
  console.log(`\n  Q4. Dominant heat class: ${EDGE_CLR}${summary.dominantHeatClass}${RST}`);
  for (const [k,v] of Object.entries(summary.byHeatClass).sort((a,b)=>b[1]-a[1])) {
    console.log(`      ${k.padEnd(10)} ${String(v).padStart(4)} (${pct(v,n)})`);
  }

  // Q5: regime
  console.log(`\n  Q5. Dominant regime: ${EDGE_CLR}${summary.dominantRegime}${RST}`);
  for (const [k,v] of Object.entries(summary.byRegime).sort((a,b)=>b[1]-a[1])) {
    console.log(`      ${k.padEnd(30)} ${String(v).padStart(4)} (${pct(v,n)})`);
  }

  // Q6: dispersion conclusion
  console.log(`\n  Q6. Dispersion: ${EDGE_CLR}${summary.gapDispersion}${RST}`);
  const disp = summary.gapDispersion;
  if (disp === 'TIGHT')     console.log('      All records within 0.5bp of each other — highly clustered. Recurring pattern likely.');
  if (disp === 'CLUSTERED') console.log('      Records within 1.5bp of threshold — structurally close. Worth tracking across sessions.');
  if (disp === 'MODERATE')  console.log('      Records spread up to 3bp below threshold — moderate dispersion. Check for session clusters.');
  if (disp === 'DISPERSED') console.log('      Records spread >3bp below threshold — may be a mix of structural and incidental cases.');

  // Spread + confidence stats
  const sp = summary.spreadStats, cs = summary.confidenceStats;
  if (sp) console.log(`\n  Spread:     ${sp.min?.toFixed(4)}% – ${sp.max?.toFixed(4)}%  median=${sp.median?.toFixed(4)}%`);
  if (cs) console.log(`  Confidence: ${cs.min?.toFixed(3)} – ${cs.max?.toFixed(3)}   median=${cs.median?.toFixed(3)}`);

  // Record table
  console.log(`\n  ${DIV}`);
  console.log('  Record list (sorted: highest conf first, then tightest gap):');
  console.log(`  ${'candidateAuditId'.padEnd(26)}  ${'spread'.padStart(8)}  ${'gap'.padStart(7)}  ${'conf'.padStart(6)}  ${'net$'.padStart(6)}  ${'profile'.padEnd(11)}  heat`);
  console.log('  ' + DIV);
  for (const r of summary.records) {
    console.log(EDGE_CLR +
      `  ${r.candidateAuditId.padEnd(26)}  ` +
      `${(r.spreadPct?.toFixed(4)+'%').padStart(8)}  ` +
      `${(r.spreadGapPct != null ? r.spreadGapPct.toFixed(4)+'%' : '?').padStart(7)}  ` +
      `${(r.executionConfidence?.toFixed(3) ?? '?').padStart(6)}  ` +
      `${'$'+(r.baseNetProfitUsd?.toFixed(2) ?? '?')}.padStart(6)}  ` +
      `${(r.profile ?? '?').padEnd(11)}  ${r.heatClass ?? '?'}` + RST
    );
  }
  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(AUDIT_PATH)) {
    console.error(`[threshold_edge_report] Audit log not found: ${AUDIT_PATH}`);
    console.error('  Run: node scripts/tools/candidate_audit_report.js --blueprints <path>');
    process.exit(1);
  }

  const records = readJsonl(AUDIT_PATH);
  if (!FLAG_JSON) process.stdout.write(`[threshold_edge_report] Loaded ${records.length} audit record(s)\n\n`);

  const summary = trackThresholdEdge(records);

  if (FLAG_JSON) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printReport(summary);
  }
}

main();
