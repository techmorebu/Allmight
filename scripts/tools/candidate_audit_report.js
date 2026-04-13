'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Candidate Audit Report  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/candidate_audit_report.js
//
//  USAGE
//  ─────
//  # Run audit against a session's blueprints (runs sim + filter internally)
//  node scripts/tools/candidate_audit_report.js \
//    --blueprints logs/session_YYYYMMDD_HHMM/blueprints.jsonl
//
//  # Run against existing filter results (skip re-simulation)
//  node scripts/tools/candidate_audit_report.js \
//    --blueprints  logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
//    --simulations logs/session_YYYYMMDD_HHMM/simulations.jsonl \
//    --filter-results logs/execution_filter_results.jsonl
//
//  # Machine-readable JSON
//  node scripts/tools/candidate_audit_report.js --blueprints ... --json
//
//  # Built-in validation suite
//  node scripts/tools/candidate_audit_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { auditCandidate, auditBatch, isEdgeExecutionCandidate, NEAR_MISS_SPREAD_GAP_PCT } = require('../execution/candidate_audit');
const { logAuditRecord, inspectAuditLog }                       = require('../execution/candidate_audit_logger');
const { applyFilter }                                            = require('../execution/execution_filter');
const { simulateBlueprint }                                      = require('../execution/execution_simulator');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i  = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST     = ARGS.includes('--self-test');
const FLAG_JSON          = ARGS.includes('--json');
const FLAG_CONFIRMED_ONLY= ARGS.includes('--confirmed-only');

const BLUEPRINTS_PATH    = argVal('--blueprints',     'logs/trade_blueprints.jsonl');
const SIMULATIONS_PATH   = argVal('--simulations',    null);
const FILTER_PATH        = argVal('--filter-results', null);
const AUDIT_OUT          = argVal('--out',            'logs/execution_candidate_audit.jsonl');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  const { auditCandidate, classifyNearMiss } = require('../execution/candidate_audit');
  let pass = 0, fail = 0;

  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`); fail++; }
  }

  // Fixture factories
  const mkBp = (spreadPct, sizeUsd, opts = {}) => ({
    blueprintId  : `BP-AUD-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    pair         : 'ETH/USDC-RAMSES',
    direction    : 'BUY_UNISWAP_V3_SELL_RAMSES_V2',
    venues: { entry: { expectedPrice: 2185, feePct: 0.0001 },
              exit:  { expectedPrice: 2185 * (1 + spreadPct/100), feePct: 0.0005 } },
    sizing       : { targetUsd: sizeUsd },
    economics    : { spreadPct, gasCostUsd: 0.028, slippageBps: 1.86, expectedEdgePct: spreadPct * 0.4 },
    viability    : { confidenceScore: 0.72 },
    _context     : { activeProfile: opts.profile ?? 'SAFE', heatClass: opts.heat ?? 'HOT',
                     heatScore: opts.heatScore ?? 0.62, regime: opts.regime ?? 'surge',
                     edgeBucket: spreadPct >= 0.18 ? 'premium' : 'viable_zone',
                     windowId: 1, bestSizeObserved: 100,
                     policySize: 200, targetExecutionSizeUsd: sizeUsd,
                     heatSizeAdjusted: false },
  });
  const mkSim = (verdict, fragility = 0.15) => ({
    simulationId : `SIM-AUD-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    summary      : { simulationVerdict: verdict, fragilityScore: fragility,
                     coreCasesPass: verdict === 'SIM_PASS', worstCaseNetUsd: verdict === 'SIM_PASS' ? 0.12 : -0.05,
                     bestCaseNetUsd: 0.31 },
    confidence   : { executionConfidence: verdict === 'SIM_PASS' ? 0.68 : 0.20,
                     blueprintConfidence: 0.72, robustnessFactor: 0.85 },
    baseCase     : { expectedNetProfitUsd: verdict === 'SIM_PASS' ? 0.25 : 0.03 },
  });
  const mkFlt = (decision, reason, candidateClass, checks = []) => ({
    filterId      : `FILT-AUD-${Math.random().toString(36).slice(2,8).toUpperCase()}`,
    filterDecision: decision,
    filterReason  : reason,
    candidateClass,
    checks,
    metrics       : {},
  });

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Candidate Audit Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // ── Case 1: CANDIDATE_CONFIRMED ───────────────────────────────────────────
  console.log('  Case 1: CANDIDATE_CONFIRMED — all rules passed');
  {
    const bp  = mkBp(0.2300, 200, { heat: 'EXTREME', heatScore: 0.85 });
    const sim = mkSim('SIM_PASS', 0.10);
    const flt = mkFlt('ALLOW', 'all_rules_passed', 'EXECUTION_CANDIDATE',
      [{rule:'spread_gte_min',pass:true,detail:'spreadPct=0.2300% required≥0.22%'},
       {rule:'size_equals_required',pass:true,detail:'sizeUsd=200 required=200'},
       {rule:'simulation_pass',pass:true,detail:'simulationVerdict=SIM_PASS'}]);
    const r = auditCandidate(bp, sim, flt);
    assert('Case 1: auditVerdict = CANDIDATE_CONFIRMED', r.auditVerdict === 'CANDIDATE_CONFIRMED', r.auditVerdict);
    assert('Case 1: auditReason = all_filter_rules_passed', r.auditReason === 'all_filter_rules_passed');
    assert('Case 1: nearMissType = null',   r.nearMissType === null);
    assert('Case 1: spreadPct present',     r.spreadPct === 0.23);
    assert('Case 1: executionConfidence',   r.executionConfidence > 0);
    assert('Case 1: heatClass = EXTREME',   r.heatClass === 'EXTREME');
    assert('Case 1: regimeFlags non-empty', r.regimeFlags.length > 0);
    assert('Case 1: has candidateAuditId',  r.candidateAuditId?.startsWith('AUD-'));
    console.log(`         verdict=${r.auditVerdict}  spread=${r.spreadPct}%  execConf=${r.executionConfidence?.toFixed(3)}  net=$${r.baseNetProfitUsd?.toFixed(2)}`);
  }
  console.log();

  // ── Case 2: CANDIDATE_NEAR_MISS — spread slightly below threshold ──────────
  console.log('  Case 2: CANDIDATE_NEAR_MISS — spread=0.2050% (gap=0.015%, within 0.03% window)');
  {
    const bp  = mkBp(0.2050, 200);
    const sim = mkSim('SIM_PASS', 0.20);
    const flt = mkFlt('REJECT', 'spread_gte_min', 'BLUEPRINT_ONLY',
      [{rule:'spread_gte_min',pass:false,detail:'spreadPct=0.2050% required≥0.22%'},
       {rule:'size_equals_required',pass:true,detail:'sizeUsd=200 required=200'},
       {rule:'simulation_pass',pass:true,detail:'simulationVerdict=SIM_PASS'}]);
    const r = auditCandidate(bp, sim, flt);
    assert('Case 2: auditVerdict = CANDIDATE_NEAR_MISS', r.auditVerdict === 'CANDIDATE_NEAR_MISS', r.auditVerdict);
    assert('Case 2: nearMissType = near_miss_spread',    r.nearMissType === 'near_miss_spread', r.nearMissType);
    assert('Case 2: nearMissDetail contains gap',        r.nearMissDetail?.includes('gap='));
    console.log(`         verdict=${r.auditVerdict}  type=${r.nearMissType}  detail=${r.nearMissDetail}`);
  }
  console.log();

  // ── Case 3: CANDIDATE_NEAR_MISS — simulation MARGINAL ──────────────────────
  console.log('  Case 3: CANDIDATE_NEAR_MISS — SIM_MARGINAL (one stress case failed)');
  {
    const bp  = mkBp(0.2300, 200);
    const sim = mkSim('SIM_MARGINAL', 0.40);
    const flt = mkFlt('REJECT', 'simulation_pass', 'SIM_MARGINAL',
      [{rule:'spread_gte_min',pass:true,detail:'spreadPct=0.2300% required≥0.22%'},
       {rule:'size_equals_required',pass:true,detail:'sizeUsd=200 required=200'},
       {rule:'simulation_pass',pass:false,detail:'simulationVerdict=SIM_MARGINAL'}]);
    const r = auditCandidate(bp, sim, flt);
    assert('Case 3: auditVerdict = CANDIDATE_NEAR_MISS', r.auditVerdict === 'CANDIDATE_NEAR_MISS', r.auditVerdict);
    assert('Case 3: nearMissType = near_miss_sim',       r.nearMissType === 'near_miss_sim', r.nearMissType);
    assert('Case 3: simulationVerdict = SIM_MARGINAL',   r.simulationVerdict === 'SIM_MARGINAL');
    console.log(`         verdict=${r.auditVerdict}  type=${r.nearMissType}  simVerdict=${r.simulationVerdict}`);
  }
  console.log();

  // ── Case 4: CANDIDATE_REJECTED — spread far below threshold ────────────────
  console.log('  Case 4: CANDIDATE_REJECTED — spread=0.15% (gap=0.07%, beyond near-miss window)');
  {
    const bp  = mkBp(0.1500, 200);
    const sim = mkSim('SIM_FAIL', 0.80);
    const flt = mkFlt('REJECT', 'spread_gte_min', 'BLUEPRINT_ONLY',
      [{rule:'spread_gte_min',pass:false,detail:'spreadPct=0.1500% required≥0.22%'},
       {rule:'size_equals_required',pass:true,detail:'sizeUsd=200 required=200'},
       {rule:'simulation_pass',pass:false,detail:'simulationVerdict=SIM_FAIL'}]);
    const r = auditCandidate(bp, sim, flt);
    assert('Case 4: auditVerdict = CANDIDATE_REJECTED',  r.auditVerdict === 'CANDIDATE_REJECTED', r.auditVerdict);
    assert('Case 4: nearMissType = null',                r.nearMissType === null, r.nearMissType);
    assert('Case 4: failedChecks has entries',           r.failedChecks?.length > 0);
    console.log(`         verdict=${r.auditVerdict}  failedChecks=${r.failedChecks?.map(c=>c.rule).join(',')}`);
  }
  console.log();

  // ── Case 5: determinism ────────────────────────────────────────────────────
  console.log('  Case 5: Determinism — same input → same output (except auditId/ts)');
  {
    const bp  = mkBp(0.2300, 200);
    const sim = mkSim('SIM_PASS', 0.10);
    const flt = mkFlt('ALLOW', 'all_rules_passed', 'EXECUTION_CANDIDATE', []);
    const r1  = auditCandidate(bp, sim, flt);
    const r2  = auditCandidate(bp, sim, flt);
    assert('Case 5: auditVerdict identical',  r1.auditVerdict === r2.auditVerdict);
    assert('Case 5: spreadPct identical',     r1.spreadPct === r2.spreadPct);
    assert('Case 5: auditIds unique',         r1.candidateAuditId !== r2.candidateAuditId);
    console.log(`         auditVerdict=${r1.auditVerdict}  ids differ=${r1.candidateAuditId !== r2.candidateAuditId}`);
  }
  console.log();

  // ── Case 6: null inputs degrade cleanly ────────────────────────────────────
  console.log('  Case 6: Null inputs — no crash');
  {
    const r = auditCandidate(null, null, null);
    assert('Case 6: has candidateAuditId',  !!r.candidateAuditId);
    assert('Case 6: auditVerdict present',  !!r.auditVerdict);
    assert('Case 6: _degraded = true',      r._degraded === true);
    console.log(`         auditVerdict=${r.auditVerdict}  _degraded=${r._degraded}`);
  }
  console.log();

  // ── Case 7: logger round-trip ──────────────────────────────────────────────
  console.log('  Case 7: Logger round-trip');
  {
    const { logAuditRecord, inspectAuditLog } = require('../execution/candidate_audit_logger');
    const tmpLog = '/tmp/test_audit.jsonl';
    const fsmod  = require('fs');
    if (fsmod.existsSync(tmpLog)) fsmod.unlinkSync(tmpLog);
    const bp  = mkBp(0.23, 200);
    const sim = mkSim('SIM_PASS');
    const flt = mkFlt('ALLOW','all_rules_passed','EXECUTION_CANDIDATE',[]);
    const r   = auditCandidate(bp, sim, flt);
    logAuditRecord(r, tmpLog);
    logAuditRecord(r, tmpLog);
    const insp = inspectAuditLog(tmpLog);
    assert('Case 7: 2 records written',   insp.count === 2, `count=${insp.count}`);
    assert('Case 7: 2 confirmed',         insp.confirmed === 2, `confirmed=${insp.confirmed}`);
    assert('Case 7: 0 near-miss',         insp.nearMiss === 0);
    console.log(`         count=${insp.count}  confirmed=${insp.confirmed}  nearMiss=${insp.nearMiss}`);
  }
  console.log();

  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(records) {
  const W   = 120;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);
  const CLR = {
    CANDIDATE_CONFIRMED : '\x1b[1;32m',
    CANDIDATE_NEAR_MISS : '\x1b[33m',
    CANDIDATE_REJECTED  : '\x1b[90m',
  };
  const RST = '\x1b[0m';

  const confirmed = records.filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED');
  const nearMiss  = records.filter(r => r.auditVerdict === 'CANDIDATE_NEAR_MISS');
  const rejected  = records.filter(r => r.auditVerdict === 'CANDIDATE_REJECTED');
  const edge      = records.filter(r => r.edgeExecutionCandidate === true);

  console.log('\n' + EQ);
  console.log('  AllMight — Candidate Audit Report  v1.0');
  console.log(`  ${new Date().toISOString()}  |  Blueprints: ${records.length}`);
  console.log(EQ);

  console.log(`\n  ${CLR.CANDIDATE_CONFIRMED}CONFIRMED: ${confirmed.length}${RST}   ` +
              `${CLR.CANDIDATE_NEAR_MISS}NEAR-MISS: ${nearMiss.length}${RST}   ` +
              `REJECTED: ${rejected.length}   ` +
              `\x1b[33mEDGE_CANDIDATES: ${edge.length}\x1b[0m`);

  // CONFIRMED detail
  if (confirmed.length) {
    console.log(`\n  ${'═'.repeat(W-2)}`);
    console.log(`  ${CLR.CANDIDATE_CONFIRMED}CANDIDATE_CONFIRMED (${confirmed.length}):${RST}`);
    console.log(`  ${DIV.slice(2)}`);
    const hdr = `  ${'auditId'.padEnd(28)}  ${'spread'.padStart(8)}  ${'size'.padStart(6)}  ${'execConf'.padStart(9)}  ${'net$'.padStart(7)}  ${'heat'.padStart(8)}  profile`;
    console.log(hdr);
    console.log('  ' + DIV.slice(2));
    for (const r of confirmed) {
      console.log(CLR.CANDIDATE_CONFIRMED +
        `  ${r.candidateAuditId.padEnd(28)}  ` +
        `${(r.spreadPct?.toFixed(4)+'%').padStart(8)}  ` +
        `${'$'+(r.targetExecutionSizeUsd??'?')  }.padStart(6)}  ` +
        `${(r.executionConfidence?.toFixed(3)??'?').padStart(9)}  ` +
        `${'$'+(r.baseNetProfitUsd?.toFixed(2)??'?')}.padStart(7)}  ` +
        `${(r.heatClass??'?').padStart(8)}  ${r.profile??'?'}` + RST
      );
    }
  }

  // NEAR-MISS detail
  if (nearMiss.length) {
    console.log(`\n  ${CLR.CANDIDATE_NEAR_MISS}CANDIDATE_NEAR_MISS (${nearMiss.length}):${RST}`);
    console.log(`  ${DIV.slice(2)}`);
    // Group by near-miss type
    const byType = {};
    for (const r of nearMiss) {
      const t = r.nearMissType ?? 'unknown';
      if (!byType[t]) byType[t] = [];
      byType[t].push(r);
    }
    for (const [type, recs] of Object.entries(byType)) {
      console.log(`\n  ${CLR.CANDIDATE_NEAR_MISS}  ${type} (${recs.length}):${RST}`);
      for (const r of recs.slice(0, 10)) {
        console.log(`    spread=${r.spreadPct?.toFixed(4)}%  execConf=${r.executionConfidence?.toFixed(3)}  ` +
                    `sim=${r.simulationVerdict}  detail=${r.nearMissDetail?.slice(0, 60)}`);
      }
      if (recs.length > 10) console.log(`    ... and ${recs.length - 10} more`);
    }
  }

  // Stats
  if (records.length) {
    const spreads = records.map(r => r.spreadPct).filter(Boolean).sort((a,b)=>a-b);
    console.log(`\n  Distribution: spread ${spreads[0]?.toFixed(4)}% – ${spreads[spreads.length-1]?.toFixed(4)}%`);
  }
  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(BLUEPRINTS_PATH)) {
    console.error(`[candidate_audit_report] Blueprint log not found: ${BLUEPRINTS_PATH}`);
    process.exit(1);
  }

  const blueprints = readJsonl(BLUEPRINTS_PATH);
  if (!FLAG_JSON) process.stdout.write(`[candidate_audit_report] Loaded ${blueprints.length} blueprint(s)\n`);

  // Run sim + filter in-memory (always fresh — no stale results)
  const auditRecords = [];
  for (const bp of blueprints) {
    let sim, flt;
    try {
      sim = simulateBlueprint(bp);
      flt = applyFilter(bp, sim);
    } catch (e) {
      process.stderr.write(`[candidate_audit_report] pipeline error for ${bp?.blueprintId}: ${e.message}\n`);
      continue;
    }

    // Filter: include CONFIRMED + NEAR_MISS + (skip pure rejects unless --all)
    const record = auditCandidate(bp, sim, flt);
    const include = record.auditVerdict === 'CANDIDATE_CONFIRMED' ||
                    record.auditVerdict === 'CANDIDATE_NEAR_MISS' ||
                    !FLAG_CONFIRMED_ONLY;
    if (include) {
      auditRecords.push(record);
      logAuditRecord(record, AUDIT_OUT);
    }
  }

  if (!FLAG_JSON) process.stdout.write(`[candidate_audit_report] Audited ${auditRecords.length} record(s) → ${AUDIT_OUT}\n\n`);

  const confirmed = auditRecords.filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED');
  const nearMiss  = auditRecords.filter(r => r.auditVerdict === 'CANDIDATE_NEAR_MISS');
  const edge      = auditRecords.filter(r => r.edgeExecutionCandidate === true);

  if (FLAG_JSON) {
    console.log(JSON.stringify({
      total         : auditRecords.length,
      confirmed     : confirmed.length,
      nearMiss      : nearMiss.length,
      rejected      : auditRecords.length - confirmed.length - nearMiss.length,
      edgeCandidates: edge.length,
      candidates    : confirmed,
      nearMisses    : nearMiss.slice(0, 20),
      edgeRecords   : edge,
    }, null, 2));
  } else {
    printReport(FLAG_CONFIRMED_ONLY ? confirmed : auditRecords);
  }
}

main();
