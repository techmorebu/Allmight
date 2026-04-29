// scripts/tools/gate_score_backtest.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Execution Gate Score Backtest
//
// Tests whether ExecutionScore actually predicts better trading outcomes.
// Joins shadow_execution_ledger → blueprints → sandbox_results per session.
//
// Key question: do higher-score signals produce better outcomes?
//   - Higher avg spread?
//   - Higher sandbox viable rate?
//   - Better estimated net profit?
//
// If yes → score is CALIBRATED (directionally correct)
// If spread alone explains outcomes better → score is DIRECTIONAL_ONLY
// If higher scores produce worse outcomes → MISALIGNED
//
// Usage:
//   node scripts/tools/gate_score_backtest.js
//   node scripts/tools/gate_score_backtest.js --session logs/sessions/session_X
//   node scripts/tools/gate_score_backtest.js --all      (all sessions)
//   node scripts/tools/gate_score_backtest.js --json
//
// Output: logs/project_metrics/gate_score_backtest.json
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const LOGS_DIR    = path.resolve(process.cwd(), 'logs');
const SESSIONS_DIR = path.join(LOGS_DIR, 'sessions');
const METRICS_DIR  = path.join(LOGS_DIR, 'project_metrics');
const OUT_FILE     = path.join(METRICS_DIR, 'gate_score_backtest.json');

const JSON_MODE    = process.argv.includes('--json');
const ALL_MODE     = process.argv.includes('--all');
const SESSION_IDX  = process.argv.indexOf('--session');
const SESSION_OVERRIDE = SESSION_IDX !== -1 ? process.argv[SESSION_IDX + 1] : null;

// ─── BUCKETS ─────────────────────────────────────────────────────────────────
// Aligned with gate thresholds: BLOCK(<75), PAPER(75-84), DRY(85-91), MICRO(92+)
const BUCKETS = [
  { lo:  0, hi: 49, label: '0–49',  gateZone: 'BLOCK (deep)' },
  { lo: 50, hi: 64, label: '50–64', gateZone: 'BLOCK (near)' },
  { lo: 65, hi: 74, label: '65–74', gateZone: 'BLOCK (edge)' },
  { lo: 75, hi: 84, label: '75–84', gateZone: 'PAPER_ONLY'   },
  { lo: 85, hi: 91, label: '85–91', gateZone: 'DRY_WALLET'   },
  { lo: 92, hi:100, label: '92+',   gateZone: 'MICRO_ELIGIBLE'},
];

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────
function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ─── SESSION PROCESSOR ───────────────────────────────────────────────────────
function processSession(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');

  const ledger     = readJsonl(path.join(sessionDir, 'shadow_execution_ledger.jsonl'));
  const sbData     = readJson(path.join(sessionDir, 'sandbox_results.json'));
  const auditLines = readJsonl(path.join(sessionDir, 'execution_candidate_audit.jsonl'));
  const bpLines    = readJsonl(path.join(sessionDir, 'blueprints.jsonl'));

  if (ledger.length === 0) return null; // no shadow data

  // Build lookup: signalBlock → blueprintId
  const bpByBlock = {};
  for (const bp of bpLines) {
    const block = String(bp.signalBlock ?? '');
    if (block) bpByBlock[block] = bp.blueprintId;
  }

  // Build lookup: blueprintId → sandbox outcomes
  const sbByBp = {};
  for (const r of sbData?.results ?? []) {
    if (!sbByBp[r.blueprintId]) sbByBp[r.blueprintId] = [];
    sbByBp[r.blueprintId].push(r);
  }

  // Build lookup: blueprintId → audit verdict
  const auditByBp = {};
  for (const r of auditLines) {
    if (r.blueprintId) auditByBp[r.blueprintId] = r;
  }

  // Bucket signals
  const buckets = {};
  for (const b of BUCKETS) buckets[b.label] = [];

  let joined = 0;
  for (const rec of ledger) {
    const block    = String(rec.signalId ?? '').split('-').pop();
    const bpId     = bpByBlock[block];
    const sbRes    = bpId ? (sbByBp[bpId] ?? []) : [];
    const audit    = bpId ? auditByBp[bpId] : null;

    const viable   = sbRes.length > 0
      ? sbRes.some(r => r.executionClass === 'EXECUTION_VIABLE')
      : null;
    const confirmed = audit?.auditVerdict === 'CANDIDATE_CONFIRMED';

    if (bpId) joined++;

    const score = rec.executionScore ?? 0;
    const bkt   = BUCKETS.find(b => score >= b.lo && score <= b.hi);
    if (!bkt) continue;

    buckets[bkt.label].push({
      score,
      spreadBps    : rec.spreadBps ?? 0,
      estimatedNet : rec.estimatedNetUsd ?? 0,
      heatClass    : rec.heatClass ?? 'UNKNOWN',
      gateVerdict  : rec.gateVerdict ?? '',
      components   : rec.scoreComponents ?? {},
      sbViable     : viable,
      hasSandbox   : sbRes.length > 0,
      confirmed,
    });
  }

  // ── Spread-only control: does spread alone predict viability? ───────────────
  // Signals in 0-49 bucket with spread > 22bps
  const controlGroup = buckets['0–49'].filter(r => r.spreadBps > 22 && r.hasSandbox);
  const controlViable = controlGroup.filter(r => r.sbViable === true).length;
  const controlViableRate = controlGroup.length > 0
    ? (controlViable / controlGroup.length * 100) : null;

  // ── Per-bucket stats ────────────────────────────────────────────────────────
  const bucketStats = {};
  for (const b of BUCKETS) {
    const recs = buckets[b.label];
    if (recs.length === 0) {
      bucketStats[b.label] = { count: 0, gateZone: b.gateZone };
      continue;
    }
    const spreads    = recs.map(r => r.spreadBps);
    const nets       = recs.map(r => r.estimatedNet);
    const sbRecs     = recs.filter(r => r.hasSandbox);
    const viableRecs = sbRecs.filter(r => r.sbViable === true);
    const confirmed  = recs.filter(r => r.confirmed).length;
    const heatEx     = recs.filter(r => r.heatClass === 'EXTREME').length;

    // Component averages
    const compAvgs = {};
    for (const k of ['spread','heat','timing','infra','simulation','confidence']) {
      const vals = recs.map(r => r.components[k] ?? 0);
      compAvgs[k] = +(vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1);
    }

    bucketStats[b.label] = {
      gateZone      : b.gateZone,
      count         : recs.length,
      avgScore      : +(recs.reduce((a,r) => a + r.score, 0) / recs.length).toFixed(1),
      avgSpreadBps  : +(spreads.reduce((a,b) => a+b, 0) / spreads.length).toFixed(2),
      maxSpreadBps  : +Math.max(...spreads).toFixed(2),
      minSpreadBps  : +Math.min(...spreads).toFixed(2),
      avgEstNetUsd  : +(nets.reduce((a,b) => a+b, 0) / nets.length).toFixed(4),
      sbTotal       : sbRecs.length,
      sbViable      : viableRecs.length,
      sbViableRate  : sbRecs.length > 0
        ? +(viableRecs.length / sbRecs.length * 100).toFixed(1) : null,
      confirmedCount: confirmed,
      confirmedRate : +(confirmed / recs.length * 100).toFixed(1),
      extremeHeatPct: +(heatEx / recs.length * 100).toFixed(1),
      componentAvgs : compAvgs,
    };
  }

  // ── Monotonicity check ──────────────────────────────────────────────────────
  // For a calibrated model, higher buckets should have higher spread + viable rate
  const bucketOrder = BUCKETS.map(b => bucketStats[b.label]).filter(b => b.count > 0);
  const spreadMono  = checkMonotonic(bucketOrder.map(b => b.avgSpreadBps));
  const viableMono  = checkMonotonic(bucketOrder.map(b => b.sbViableRate));

  return {
    sessionId,
    signalsProcessed: ledger.length,
    joinedToSandbox : joined,
    bucketStats,
    spreadOnlyControl: {
      description    : '0-49 signals with spread>22bps (spread-only predictor baseline)',
      count          : controlGroup.length,
      viableRate     : controlViableRate != null ? +controlViableRate.toFixed(1) : null,
    },
    monotonicity: { spreadIncreasing: spreadMono, viableRateIncreasing: viableMono },
  };
}

function checkMonotonic(vals) {
  const nonNull = vals.filter(v => v != null);
  if (nonNull.length < 2) return null;
  let increasing = 0, decreasing = 0;
  for (let i = 1; i < nonNull.length; i++) {
    if (nonNull[i] > nonNull[i-1]) increasing++;
    else if (nonNull[i] < nonNull[i-1]) decreasing++;
  }
  return increasing > decreasing ? true : decreasing > increasing ? false : null;
}

// ─── CROSS-SESSION AGGREGATION ────────────────────────────────────────────────
function aggregate(sessions) {
  const combined = {};
  for (const b of BUCKETS) combined[b.label] = { count: 0, spreads: [], nets: [], sbViable: 0, sbTotal: 0, confirmed: 0 };

  for (const s of sessions) {
    if (!s) continue;
    for (const b of BUCKETS) {
      const bs = s.bucketStats[b.label];
      if (!bs || bs.count === 0) continue;
      combined[b.label].count       += bs.count;
      combined[b.label].sbViable    += bs.sbViable ?? 0;
      combined[b.label].sbTotal     += bs.sbTotal  ?? 0;
      combined[b.label].confirmed   += bs.confirmedCount ?? 0;
      // Weighted avg spread
      combined[b.label].spreads.push({ avg: bs.avgSpreadBps, n: bs.count });
      combined[b.label].nets.push({ avg: bs.avgEstNetUsd, n: bs.count });
    }
  }

  const summary = {};
  for (const b of BUCKETS) {
    const c = combined[b.label];
    if (c.count === 0) { summary[b.label] = { count: 0 }; continue; }
    const wAvgSpread = c.spreads.reduce((a,x) => a + x.avg * x.n, 0) / c.count;
    const wAvgNet    = c.nets.reduce((a,x) => a + x.avg * x.n, 0) / c.count;
    summary[b.label] = {
      count        : c.count,
      avgSpreadBps : +wAvgSpread.toFixed(2),
      avgEstNetUsd : +wAvgNet.toFixed(4),
      sbViableRate : c.sbTotal > 0 ? +(c.sbViable / c.sbTotal * 100).toFixed(1) : null,
      confirmedRate: +(c.confirmed / c.count * 100).toFixed(1),
    };
  }
  return summary;
}

// ─── VERDICT ─────────────────────────────────────────────────────────────────
function emitVerdict(crossSession, sessionCount, controlViableRates) {
  const populated = BUCKETS.filter(b => (crossSession[b.label]?.count ?? 0) > 0);

  // Need at least 2 populated buckets to assess monotonicity
  if (populated.length < 2) {
    return {
      verdict      : 'INSUFFICIENT_DATA',
      sessionCount,
      reason       : `Only ${populated.length} score bucket(s) populated. Need signals across multiple score ranges. Run 3-4 more sessions.`,
      recommendation: ['collect_more_data'],
    };
  }

  // Check if spread alone explains variance (control group analysis)
  const avgControl = controlViableRates.filter(v => v != null);
  const highBucketViable = crossSession['50–64']?.sbViableRate ?? crossSession['65–74']?.sbViableRate ?? null;
  const spreadAloneExplains = avgControl.length > 0 && highBucketViable != null
    && (avgControl.reduce((a,b) => a+b, 0) / avgControl.length) >= highBucketViable;

  // Check spread monotonicity
  const spreads  = populated.map(b => crossSession[b.label]?.avgSpreadBps ?? 0);
  const viables  = populated.map(b => crossSession[b.label]?.sbViableRate);
  const spreadMono = checkMonotonic(spreads);
  const viableMono = checkMonotonic(viables);

  let verdict, reason, recommendation;

  if (spreadAloneExplains && sessionCount < 3) {
    verdict = 'DIRECTIONAL_ONLY';
    reason  = 'Spread alone appears to predict viability as well as the composite score. ' +
              'Score components beyond spread (timing, infra, confidence) may not add signal. ' +
              `Control group viable rate (${avgControl[0]?.toFixed(1)}%) >= high-bucket rate (${highBucketViable?.toFixed(1)}%).`;
    recommendation = ['collect_more_data', 'consider_reducing_weight_on_timing', 'spread_weight_may_need_increase'];
  } else if (spreadMono && viableMono) {
    verdict = 'CALIBRATED';
    reason  = 'Higher score buckets show monotonically increasing spread and viable rate. Score is directionally correct.';
    recommendation = ['keep_weights', 'validate_thresholds_with_more_data'];
  } else if (spreadMono && !viableMono) {
    verdict = 'DIRECTIONAL_ONLY';
    reason  = 'Spread increases with score (good) but sandbox viability does not track cleanly. Non-spread components may be adding noise.';
    recommendation = ['collect_more_data', 'review_non_spread_component_weights'];
  } else {
    verdict = 'MISALIGNED';
    reason  = 'Higher score buckets do not consistently produce better outcomes. Weights need recalibration.';
    recommendation = ['review_all_weights', 'collect_more_data_before_adjusting'];
  }

  // Threshold assessment
  const thresholdAssessment = [];
  if (crossSession['75–84']?.count === 0) {
    thresholdAssessment.push('PAPER threshold (75): no signals reached this range yet — cannot validate');
  }
  if (crossSession['85–91']?.count === 0) {
    thresholdAssessment.push('DRY_WALLET threshold (85): no signals reached this range yet — cannot validate');
  }
  if (crossSession['92+']?.count === 0) {
    thresholdAssessment.push('MICRO threshold (92): no signals reached this range yet — cannot validate');
  }

  return { verdict, sessionCount, reason, recommendation, thresholdAssessment };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
function main() {
  fs.mkdirSync(METRICS_DIR, { recursive: true });

  // Determine which sessions to process
  let sessionDirs = [];
  if (SESSION_OVERRIDE) {
    sessionDirs = [path.resolve(SESSION_OVERRIDE)];
  } else if (ALL_MODE) {
    if (!fs.existsSync(SESSIONS_DIR)) {
      console.error('No sessions directory found');
      process.exit(1);
    }
    sessionDirs = fs.readdirSync(SESSIONS_DIR)
      .filter(d => d.startsWith('session_'))
      .map(d => path.join(SESSIONS_DIR, d))
      .sort();
  } else {
    // Default: current session
    const ptr = path.join(LOGS_DIR, 'allmight.session');
    if (!fs.existsSync(ptr)) {
      console.error('No active session. Use --session <path> or --all');
      process.exit(1);
    }
    const sid = fs.readFileSync(ptr, 'utf8').trim();
    sessionDirs = [path.join(SESSIONS_DIR, `session_${sid}`)];
  }

  // Process each session
  const sessionResults = sessionDirs.map(processSession).filter(Boolean);

  if (sessionResults.length === 0) {
    console.error('No sessions with shadow execution data found. Run shadow_execution_engine.js first.');
    process.exit(1);
  }

  // Aggregate across sessions
  const crossSession = aggregate(sessionResults);
  const controlViableRates = sessionResults
    .map(s => s.spreadOnlyControl?.viableRate)
    .filter(v => v != null);

  const verdict = emitVerdict(crossSession, sessionResults.length, controlViableRates);

  const output = {
    generatedAt     : new Date().toISOString(),
    sessionsAnalyzed: sessionResults.length,
    totalSignals    : sessionResults.reduce((a, s) => a + s.signalsProcessed, 0),
    crossSessionBuckets: crossSession,
    verdict,
    spreadOnlyControl: {
      description: 'Low-score (0-49) signals with spread > 22bps — tests if spread alone predicts viability',
      avgViableRate: controlViableRates.length > 0
        ? +(controlViableRates.reduce((a,b) => a+b,0) / controlViableRates.length).toFixed(1)
        : null,
      sessions: controlViableRates.length,
    },
    perSession: sessionResults,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  if (JSON_MODE) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // ── Human-readable report ──────────────────────────────────────────────────
  const EQ = '═══════════════════════════════════════════════════════';
  const DIV = '───────────────────────────────────────────────────────';
  const VERDICT_ICONS = {
    CALIBRATED: '🟢', DIRECTIONAL_ONLY: '🟡', MISALIGNED: '🔴', INSUFFICIENT_DATA: '⚪'
  };

  console.log('');
  console.log(EQ);
  console.log('  AllMight — Gate Score Backtest');
  console.log(`  ${new Date().toISOString().slice(0,19)}Z`);
  console.log(`  Sessions: ${sessionResults.length}  Signals: ${output.totalSignals.toLocaleString()}`);
  console.log(DIV);
  console.log('');
  console.log('  Score Bucket Analysis:');
  console.log('');
  console.log(`  ${'Bucket'.padEnd(8)} ${'Gate Zone'.padEnd(18)} ${'n'.padStart(6)} ${'Spread'.padStart(9)} ${'Viable%'.padStart(8)} ${'Confirmed%'.padStart(11)}`);
  console.log(`  ${'-'.repeat(70)}`);
  for (const b of BUCKETS) {
    const s = crossSession[b.label];
    if (!s || s.count === 0) {
      console.log(`  ${b.label.padEnd(8)} ${b.gateZone.padEnd(18)} ${'0'.padStart(6)}   (no data)`);
      continue;
    }
    const viable = s.sbViableRate != null ? `${s.sbViableRate}%` : 'N/A';
    console.log(
      `  ${b.label.padEnd(8)} ${b.gateZone.padEnd(18)} ` +
      `${String(s.count).padStart(6)} ` +
      `${(s.avgSpreadBps + 'bps').padStart(9)} ` +
      `${viable.padStart(8)} ` +
      `${(s.confirmedRate + '%').padStart(11)}`
    );
  }
  console.log('');
  console.log(DIV);
  console.log('  Spread-Only Control (0-49 bucket, spread > 22bps):');
  const ctrl = output.spreadOnlyControl;
  console.log(`    Viable rate: ${ctrl.avgViableRate != null ? ctrl.avgViableRate + '%' : 'N/A'}`);
  console.log(`    (If this >= high-bucket viable rate → spread alone explains outcomes)`);
  console.log('');
  console.log(DIV);
  const v = verdict;
  console.log(`  ${VERDICT_ICONS[v.verdict]} Verdict: ${v.verdict}`);
  console.log(`  ${v.reason}`);
  console.log('');
  if (v.thresholdAssessment?.length > 0) {
    console.log('  Threshold assessment:');
    for (const t of v.thresholdAssessment) console.log(`    • ${t}`);
    console.log('');
  }
  console.log('  Recommendations:');
  for (const r of v.recommendation) console.log(`    → ${r}`);
  console.log('');
  console.log(`  Output: ${OUT_FILE}`);
  console.log(EQ);
  console.log('');
}

main();
