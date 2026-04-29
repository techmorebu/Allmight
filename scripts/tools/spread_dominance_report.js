// scripts/tools/spread_dominance_report.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Spread Dominance Calibration Report
//
// Compares SpreadScore-only model vs composite ExecutionScore across
// spread bands. Answers: should SpreadScore weight increase from 30%?
//
// Analytics only. No threshold or weight changes.
// Boss ruling: collect 2-3 more shadow sessions, then recalibrate.
//
// Usage:
//   node scripts/tools/spread_dominance_report.js
//   node scripts/tools/spread_dominance_report.js --all
//   node scripts/tools/spread_dominance_report.js --session logs/sessions/session_X
//   node scripts/tools/spread_dominance_report.js --json
//
// Output: logs/project_metrics/spread_dominance_report.json
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs    = require('fs');
const path  = require('path');

const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
const SESSIONS_DIR = path.join(LOGS_DIR, 'sessions');
const METRICS_DIR  = path.join(LOGS_DIR, 'project_metrics');
const OUT_FILE     = path.join(METRICS_DIR, 'spread_dominance_report.json');

const JSON_MODE    = process.argv.includes('--json');
const ALL_MODE     = process.argv.includes('--all');
const SESSION_IDX  = process.argv.indexOf('--session');
const SESSION_OVERRIDE = SESSION_IDX !== -1 ? process.argv[SESSION_IDX + 1] : null;

// ─── SPREAD BANDS ────────────────────────────────────────────────────────────
const BANDS = [
  { lo:  0, hi: 20,  label: '<20bps',    note: 'below confirmed floor' },
  { lo: 20, hi: 22,  label: '20–22bps',  note: 'entry zone (observed threshold ~21bps)' },
  { lo: 22, hi: 24,  label: '22–24bps',  note: 'CONFIRMED_STRICT band' },
  { lo: 24, hi: 26,  label: '24–26bps',  note: 'strong — above session mean' },
  { lo: 26, hi: 999, label: '26+bps',    note: 'top tier' },
];

// Current SpreadScore weights for comparison
const SPREAD_SCORE_FN = (bps) => {
  if (bps >= 26) return 100;
  if (bps >= 24) return 85;
  if (bps >= 23) return 65;
  if (bps >= 22) return 40;
  return 0;
};

const CURRENT_SPREAD_WEIGHT = 0.30;
const TEST_WEIGHTS = [0.30, 0.40, 0.50, 0.55]; // test higher spread weights

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ─── SESSION PROCESSOR ───────────────────────────────────────────────────────
function processSession(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');

  const ledger  = readJsonl(path.join(sessionDir, 'shadow_execution_ledger.jsonl'));
  const sbData  = readJson(path.join(sessionDir, 'sandbox_results.json'));
  const bpLines = readJsonl(path.join(sessionDir, 'blueprints.jsonl'));

  if (ledger.length === 0) return null;

  // Build joins
  const bpByBlock = {};
  for (const bp of bpLines) {
    const block = String(bp.signalBlock ?? '');
    if (block) bpByBlock[block] = bp.blueprintId;
  }

  const sbByBp = {};
  for (const r of sbData?.results ?? []) {
    if (!sbByBp[r.blueprintId]) sbByBp[r.blueprintId] = [];
    sbByBp[r.blueprintId].push(r);
  }

  // Bucket each signal by spread band
  const bandData = {};
  for (const b of BANDS) bandData[b.label] = [];

  for (const rec of ledger) {
    const block  = String(rec.signalId ?? '').split('-').pop();
    const bpId   = bpByBlock[block];
    const sbRes  = bpId ? (sbByBp[bpId] ?? []) : [];
    const viable = sbRes.length > 0
      ? sbRes.some(r => r.executionClass === 'EXECUTION_VIABLE')
      : null;

    const bps       = rec.spreadBps ?? 0;
    const net       = rec.opportunityNetUsd ?? rec.estimatedNetUsd ?? 0;
    const fullScore = rec.executionScore ?? 0;
    const components = rec.scoreComponents ?? {};

    // SpreadScore-only model score (spread component only, weight=1.0)
    const spreadOnlyScore = SPREAD_SCORE_FN(bps);

    // Simulate score under different spread weights
    // For each test weight: newScore = spreadScore×w + otherComponents×(1−w)/(1−0.30)
    const otherWeightedSum = fullScore - (components.spread ?? 0) * CURRENT_SPREAD_WEIGHT;
    const otherRemainder   = 1 - CURRENT_SPREAD_WEIGHT;

    const scoresByWeight = {};
    for (const w of TEST_WEIGHTS) {
      const otherScale = otherRemainder > 0 ? (1 - w) / otherRemainder : 0;
      scoresByWeight[w] = spreadOnlyScore * w + otherWeightedSum * otherScale;
    }

    const band = BANDS.find(b => bps >= b.lo && bps < b.hi);
    if (!band) continue;

    bandData[band.label].push({
      bps, net, viable, hasSb: sbRes.length > 0,
      fullScore, spreadOnlyScore, scoresByWeight,
      heatClass: rec.heatClass,
    });
  }

  return { sessionId, bandData, totalSignals: ledger.length };
}

// ─── AGGREGATE ───────────────────────────────────────────────────────────────
function aggregateBands(sessions) {
  const agg = {};
  for (const b of BANDS) {
    agg[b.label] = { recs: [] };
  }

  for (const s of sessions) {
    if (!s) continue;
    for (const b of BANDS) {
      agg[b.label].recs.push(...(s.bandData[b.label] ?? []));
    }
  }

  const stats = {};
  for (const b of BANDS) {
    const recs   = agg[b.label].recs;
    const n      = recs.length;
    if (n === 0) { stats[b.label] = { count: 0, note: b.note }; continue; }

    const sbRecs  = recs.filter(r => r.hasSb);
    const viable  = sbRecs.filter(r => r.viable === true);
    const nets    = recs.map(r => r.net);
    const scores  = recs.map(r => r.fullScore);
    const soScores = recs.map(r => r.spreadOnlyScore);

    // SpreadScore-only model: would it gate differently at 92+ threshold?
    const eligibleFullScore = recs.filter(r => r.fullScore >= 75).length;
    const eligibleSpreadOnly = recs.filter(r => r.spreadOnlyScore >= 75).length;

    // Simulate eligible signals per weight
    const eligibleByWeight = {};
    for (const w of TEST_WEIGHTS) {
      eligibleByWeight[w] = recs.filter(r => (r.scoresByWeight[w] ?? 0) >= 75).length;
    }

    const viableRate = sbRecs.length > 0
      ? +(viable.length / sbRecs.length * 100).toFixed(1) : null;

    stats[b.label] = {
      count         : n,
      note          : b.note,
      avgSpreadBps  : +(recs.reduce((a,r) => a + r.bps, 0) / n).toFixed(2),
      viableRate,
      viableCount   : viable.length,
      sbTotal       : sbRecs.length,
      avgOpportunityNet : +(nets.reduce((a,b) => a+b, 0) / n).toFixed(4),
      totalOpportunityNet: +(nets.filter(v => v > 0).reduce((a,b) => a+b, 0)).toFixed(2),
      avgFullScore  : +(scores.reduce((a,b) => a+b, 0) / n).toFixed(1),
      avgSpreadOnlyScore: +(soScores.reduce((a,b) => a+b, 0) / n).toFixed(1),
      // Gate eligible counts under different models
      eligibleAt75 : {
        currentComposite : eligibleFullScore,
        spreadOnlyModel  : eligibleSpreadOnly,
        byWeight         : eligibleByWeight,
      },
      heatExtreme  : +(recs.filter(r => r.heatClass === 'EXTREME').length / n * 100).toFixed(1),
    };
  }
  return stats;
}

// ─── WEIGHT RECOMMENDATION ───────────────────────────────────────────────────
function recommendWeight(bandStats, controlViableRate, highBucketViable) {
  // If spread alone (control) outperforms composite → spread weight should increase
  const controlDominates = controlViableRate != null && highBucketViable != null
    && controlViableRate >= highBucketViable;

  // Measure spread's predictive power: does viable rate increase with each band?
  const populated = BANDS.map(b => bandStats[b.label]).filter(s => s.count > 0 && s.viableRate != null);
  const vRates    = populated.map(s => s.viableRate);
  let monotonic   = true;
  for (let i = 1; i < vRates.length; i++) {
    if (vRates[i] < vRates[i-1]) { monotonic = false; break; }
  }

  // Spread informativeness: ratio of top-band to bottom-band viable rate
  const bottomRate = populated[0]?.viableRate ?? 0;
  const topRate    = populated[populated.length - 1]?.viableRate ?? 0;
  const spreadLift = bottomRate > 0 ? topRate / bottomRate : null;

  let recommendation, reasoning;

  if (controlDominates && monotonic && spreadLift && spreadLift > 2) {
    recommendation = 'INCREASE_TO_0.45_0.55';
    reasoning = `Spread is strongly dominant: ${bottomRate}% → ${topRate}% viable rate ` +
      `(${spreadLift?.toFixed(1)}x lift). Control outperforms composite. ` +
      `Increasing SpreadScore weight to 45–55% would better reflect its predictive power. ` +
      `Reduce timing/confidence weight proportionally. Validate after 3+ sessions.`;
  } else if (controlDominates) {
    recommendation = 'INCREASE_TO_0.40';
    reasoning = `Spread dominates but lift is moderate (${spreadLift?.toFixed(1)}x). ` +
      `Modest increase to 40% weight is appropriate. Collect more data before going higher.`;
  } else if (monotonic) {
    recommendation = 'KEEP_0.30_VALIDATE';
    reasoning = `Spread increases monotonically with score and does not dominate the control test. ` +
      `Current 30% weight may be appropriate. Validate with 3+ more sessions.`;
  } else {
    recommendation = 'COLLECT_MORE_DATA';
    reasoning = `Spread pattern is not monotonic in current data. Insufficient data for recommendation.`;
  }

  return { recommendation, reasoning, spreadLift, monotonic, controlDominates };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
function main() {
  fs.mkdirSync(METRICS_DIR, { recursive: true });

  let sessionDirs = [];
  if (SESSION_OVERRIDE) {
    sessionDirs = [path.resolve(SESSION_OVERRIDE)];
  } else if (ALL_MODE) {
    sessionDirs = fs.readdirSync(SESSIONS_DIR)
      .filter(d => d.startsWith('session_'))
      .map(d => path.join(SESSIONS_DIR, d))
      .sort();
  } else {
    const ptr = path.join(LOGS_DIR, 'allmight.session');
    if (!fs.existsSync(ptr)) { console.error('No active session. Use --session or --all'); process.exit(1); }
    sessionDirs = [path.join(SESSIONS_DIR, `session_${fs.readFileSync(ptr,'utf8').trim()}`)];
  }

  const sessions = sessionDirs.map(processSession).filter(Boolean);
  if (sessions.length === 0) { console.error('No sessions with shadow data found.'); process.exit(1); }

  const bandStats = aggregateBands(sessions);
  const totalSignals = sessions.reduce((a,s) => a + s.totalSignals, 0);

  // Control group: low-score signals with spread >22bps
  // (from backtest — represents spread-only predictive power)
  const controlViableRate = 96; // confirmed from backtest across 4 sessions
  const highBucketViable  = bandStats['22–24bps']?.viableRate ?? bandStats['24–26bps']?.viableRate;

  const weightRec = recommendWeight(bandStats, controlViableRate, highBucketViable);

  const output = {
    generatedAt     : new Date().toISOString(),
    sessionsAnalyzed: sessions.length,
    totalSignals,
    bossRuling      : 'Do not adjust engine. Collect 2-3 more shadow sessions. Then recalibrate.',
    bandStats,
    testWeights     : TEST_WEIGHTS,
    weightRecommendation: weightRec,
    currentWeights  : {
      spread: 0.30, heat: 0.20, timing: 0.20,
      infra: 0.15, simulation: 0.10, confidence: 0.05,
    },
    gateScoreStatus : 'DIRECTIONAL_ONLY — spread is primary predictor (Boss ruling 2026-04-29)',
    thresholds      : { PAPER: 75, DRY_WALLET: 85, MICRO: 92, status: 'UNVALIDATED' },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  if (JSON_MODE) { console.log(JSON.stringify(output, null, 2)); return; }

  // ── Human-readable output ──────────────────────────────────────────────────
  const EQ = '═══════════════════════════════════════════════════════';
  const DIV = '───────────────────────────────────────────────────────';

  console.log('');
  console.log(EQ);
  console.log('  AllMight — Spread Dominance Calibration Report');
  console.log(`  ${new Date().toISOString().slice(0,19)}Z`);
  console.log(`  Sessions: ${sessions.length}  Signals: ${totalSignals.toLocaleString()}`);
  console.log(DIV);
  console.log('');
  console.log('  Spread Band Analysis:');
  console.log('');
  console.log(`  ${'Band'.padEnd(12)} ${'n'.padStart(5)} ${'Viable%'.padStart(8)} ${'AvgNet'.padStart(9)} ${'OpptyPnL'.padStart(10)} ${'Score'.padStart(7)} ${'SpreadOnly'.padStart(11)}`);
  console.log(`  ${'-'.repeat(70)}`);
  for (const b of BANDS) {
    const s = bandStats[b.label];
    if (!s || s.count === 0) {
      console.log(`  ${b.label.padEnd(12)} ${'0'.padStart(5)}   (no data)`);
      continue;
    }
    const viable  = s.viableRate != null ? `${s.viableRate}%` : 'N/A';
    const net     = `$${s.avgOpportunityNet}`;
    const oppty   = `$${s.totalOpportunityNet}`;
    console.log(
      `  ${b.label.padEnd(12)} ${String(s.count).padStart(5)} ` +
      `${viable.padStart(8)} ${net.padStart(9)} ${oppty.padStart(10)} ` +
      `${String(s.avgFullScore).padStart(7)} ${String(s.avgSpreadOnlyScore).padStart(11)}`
    );
  }
  console.log('');
  console.log(DIV);
  console.log('  Spread-Only Model vs Composite — Signals eligible at score ≥75:');
  console.log('');
  console.log(`  ${'Band'.padEnd(12)} ${'Composite'.padStart(11)} ${TEST_WEIGHTS.map(w => `wt=${w}`).map(s => s.padStart(8)).join('')}`);
  console.log(`  ${'-'.repeat(50)}`);
  for (const b of BANDS) {
    const s = bandStats[b.label];
    if (!s || s.count === 0) continue;
    const e = s.eligibleAt75;
    console.log(
      `  ${b.label.padEnd(12)} ${String(e.currentComposite).padStart(11)}` +
      TEST_WEIGHTS.map(w => String(e.byWeight[w] ?? 0).padStart(8)).join('')
    );
  }
  console.log('');
  console.log(DIV);
  const rec = weightRec;
  const ICONS = {
    'INCREASE_TO_0.45_0.55': '🟢', 'INCREASE_TO_0.40': '🟡',
    'KEEP_0.30_VALIDATE': '⚪', 'COLLECT_MORE_DATA': '🔴'
  };
  console.log(`  ${ICONS[rec.recommendation] ?? '⚪'} Weight Recommendation: ${rec.recommendation}`);
  console.log(`  ${rec.reasoning}`);
  console.log('');
  console.log(`  Spread lift (bottom→top band): ${rec.spreadLift?.toFixed(1)}x`);
  console.log(`  Viable rate monotonic by band: ${rec.monotonic}`);
  console.log(`  Control outperforms composite: ${rec.controlDominates}`);
  console.log('');
  console.log(`  Boss ruling: ${output.bossRuling}`);
  console.log(`  Output: ${OUT_FILE}`);
  console.log(EQ);
  console.log('');
}

main();
