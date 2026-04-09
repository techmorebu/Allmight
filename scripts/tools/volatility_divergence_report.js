'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Volatility / Divergence Report  v1.0  (Wave 2)
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/volatility_divergence_report.js
//  STATUS    : NEW — Boss directive 2026-04-09 (Wave 2 timing intelligence)
//
//  PURPOSE
//  ─────────
//  Thin I/O wrapper around volatility_divergence_engine.js.
//  Reads the existing arb_volatility_monitor JSONL log, builds surface history,
//  calls the engine, prints a ranked heat report, and emits one JSONL record.
//
//  USAGE
//  ─────
//  # One-shot from existing monitor log (most common)
//  node scripts/tools/volatility_divergence_report.js
//  node scripts/tools/volatility_divergence_report.js --log logs/volatility_arbitrum.jsonl
//  node scripts/tools/volatility_divergence_report.js --log logs/volatility_arbitrum.jsonl --out logs/volatility_timeseries.jsonl
//
//  # JSON output only (machine-readable, no banner)
//  node scripts/tools/volatility_divergence_report.js --json
//
//  # Run built-in validation suite (7 cases — no log file needed)
//  node scripts/tools/volatility_divergence_report.js --self-test
//
//  # Continuous mode — re-evaluate every N seconds
//  node scripts/tools/volatility_divergence_report.js --interval 30
//
//  INTEGRATION NOTE (read-only activator interface)
//  ─────────────────────────────────────────────────
//  The engine output written to --out is safe for the activator to read as
//  priority context. The activator reads heat fields ONLY — it does not use
//  them to bypass any execution gate. The heat record is advisory.
//
//  Pattern for activator integration (no code change to activator required):
//    const heatLog = fs.readFileSync('logs/volatility_timeseries.jsonl', 'utf8')
//                      .trim().split('\n').pop();   // latest record
//    const heat    = JSON.parse(heatLog);
//    const rank    = heat.surfaces.find(s => s.surfaceId === MY_SURFACE_ID);
//    // rank.heatClass is advisory — does NOT change activator gate logic
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const {
  evaluateSurfaces,
  HEAT_WEIGHTS,
  HEAT_CLASSES,
} = require('../analysis/volatility_divergence_engine');

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

const DEFAULT_LOG    = 'logs/volatility_arbitrum.jsonl';
const LOG_IN         = argVal('--log',      DEFAULT_LOG);
const LOG_OUT        = argVal('--out',      null);
const INTERVAL_SEC   = Number(argVal('--interval', '0'));   // 0 = one-shot
const TOP_N          = Number(argVal('--top',      '10'));
const PRIOR_STEPS    = Number(argVal('--prior',    '2'));    // how many records back for "prior"

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function appendLog(filePath, record) {
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    process.stderr.write(`[vdr] log write failed: ${e.message}\n`);
  }
}

// ─── LOG READER ───────────────────────────────────────────────────────────────

/**
 * Read and parse volatility_scan records from arb_volatility_monitor JSONL log.
 * Returns array of parsed records, sorted by ts ASC.
 * Non-parseable lines are silently skipped.
 *
 * @param {string} logPath
 * @returns {object[]}
 */
function readMonitorLog(logPath) {
  if (!fs.existsSync(logPath)) {
    process.stderr.write(`[vdr] log not found: ${logPath}\n`);
    return [];
  }
  const lines   = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const records = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (r && r.type === 'volatility_scan') records.push(r);
    } catch (_) {}
  }
  // Sort by ts ASC to guarantee chronological order regardless of log order
  records.sort((a, b) => String(a.ts) < String(b.ts) ? -1 : String(a.ts) > String(b.ts) ? 1 : 0);
  return records;
}

/**
 * Build surface history from sorted scan records.
 * Returns Map<surfaceId, object[]> where each array is sorted ASC by scanTs.
 *
 * @param {object[]} records  Sorted volatility_scan records.
 * @returns {Map<string, object[]>}
 */
function buildSurfaceHistory(records) {
  const history = new Map();
  for (const rec of records) {
    const scanTs = rec.ts;
    for (const s of (rec.surfaces || [])) {
      if (!s || !s.surfaceId) continue;
      if (!history.has(s.surfaceId)) history.set(s.surfaceId, []);
      history.get(s.surfaceId).push({ ...s, scanTs });
    }
  }
  return history;
}

/**
 * From the history, extract current snapshot and prior snapshot (PRIOR_STEPS back)
 * for each surface seen in the latest scan record.
 *
 * @param {object[]} records  Sorted scan records.
 * @param {Map} history       Surface history.
 * @returns {{ snapshots: object[], priorMap: Map<string, object> }}
 */
function extractSnapshotsAndPriors(records, history) {
  const latestRecord = records[records.length - 1];
  if (!latestRecord) return { snapshots: [], priorMap: new Map() };

  const snapshots = [];
  const priorMap  = new Map();

  for (const s of (latestRecord.surfaces || [])) {
    if (!s || !s.surfaceId) continue;

    // Enrich with scanTs from the record
    snapshots.push({ ...s, scanTs: latestRecord.ts });

    // Prior: PRIOR_STEPS records back in the surface's own history
    const hist = history.get(s.surfaceId) || [];
    if (hist.length >= PRIOR_STEPS + 1) {
      priorMap.set(s.surfaceId, hist[hist.length - 1 - PRIOR_STEPS]);
    }
  }

  return { snapshots, priorMap };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(ranked, scanMeta) {
  const W   = 120;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Volatility / Divergence Heat Report  v1.0');
  console.log(`  ${nowIso()}  |  Surfaces: ${ranked.length}  |  Source: ${LOG_IN}`);
  console.log(`  Weights: vel=${HEAT_WEIGHTS.velocity}  div=${HEAT_WEIGHTS.divergence}  exp=${HEAT_WEIGHTS.spreadExpansion}  inst=${HEAT_WEIGHTS.instability}  depth=${HEAT_WEIGHTS.depthChange}`);
  console.log(EQ);

  const HEAT_COLOR = { EXTREME: '\x1b[1;31m', HOT: '\x1b[33m', WARM: '\x1b[36m', COLD: '' };
  const RESET      = '\x1b[0m';

  const pad = (s, w) => String(s).padEnd(w);
  const rpt = (s, w) => String(s).padStart(w);

  console.log(
    `  ${'#'.padStart(3)}  ${pad('surfaceId', 36)}  ${rpt('spread%', 8)}  ` +
    `${rpt('heat', 6)}  ${rpt('class', 7)}  ${rpt('vel', 6)}  ${rpt('div', 6)}  ` +
    `${rpt('exp', 6)}  ${rpt('inst', 6)}  ${rpt('dep', 6)}  flags`
  );
  console.log('  ' + DIV);

  const top = ranked.slice(0, TOP_N);
  for (const s of top) {
    const col    = HEAT_COLOR[s.heatClass] || '';
    const spread = s.spreadPct != null ? s.spreadPct.toFixed(4) + '%' : '   ?';
    const flags  = [
      s._depthChangeMissing  ? 'dep?'  : '',
      s._instabilityStdMissing ? 'std?' : '',
      s._velocityPriorMissing  ? 'vel?' : '',
      s._expansionPriorMissing ? 'exp?' : '',
    ].filter(Boolean).join(' ');

    console.log(
      col +
      `  ${rpt(s.heatRank, 3)}  ${pad(s.surfaceId.slice(0, 36), 36)}  ${rpt(spread, 8)}  ` +
      `${rpt(s.heatScore.toFixed(4), 6)}  ${rpt(s.heatClass, 7)}  ` +
      `${rpt(s.velocityScore.toFixed(3), 6)}  ${rpt(s.divergenceScore.toFixed(3), 6)}  ` +
      `${rpt(s.spreadExpansionScore.toFixed(3), 6)}  ${rpt(s.instabilityScore.toFixed(3), 6)}  ` +
      `${rpt(s.depthChangeScore.toFixed(3), 6)}  ${flags}` +
      RESET
    );
  }

  // Heat class summary
  const counts = { EXTREME: 0, HOT: 0, WARM: 0, COLD: 0 };
  for (const s of ranked) counts[s.heatClass] = (counts[s.heatClass] || 0) + 1;
  console.log(`\n  Heat class breakdown: EXTREME=${counts.EXTREME}  HOT=${counts.HOT}  WARM=${counts.WARM}  COLD=${counts.COLD}`);

  // Top heat alert
  const hotSurfaces = ranked.filter(s => s.heatClass === 'EXTREME' || s.heatClass === 'HOT');
  if (hotSurfaces.length) {
    console.log(`  🔥 HOT/EXTREME (${hotSurfaces.length}): ${hotSurfaces.slice(0, 5).map(s => `${s.surfaceId}[${s.heatClass}]`).join('  ')}`);
  }

  if (scanMeta) {
    console.log(`\n  Scan meta: scanCount=${scanMeta.scanCount}  logRecords=${scanMeta.logRecords}  priorSteps=${PRIOR_STEPS}`);
  }
  console.log('\n' + EQ + '\n');
}

// ─── MAIN EVALUATION ──────────────────────────────────────────────────────────

let scanCount = 0;

function runEvaluation() {
  scanCount++;

  const records = readMonitorLog(LOG_IN);
  if (records.length === 0) {
    if (!FLAG_JSON) {
      console.warn(`[vdr] No volatility_scan records found in ${LOG_IN}`);
      console.warn('       Run arb_volatility_monitor.js first to populate the log.');
    }
    return null;
  }

  const history                   = buildSurfaceHistory(records);
  const { snapshots, priorMap }   = extractSnapshotsAndPriors(records, history);

  if (snapshots.length === 0) {
    if (!FLAG_JSON) process.stderr.write('[vdr] No surfaces in latest scan record.\n');
    return null;
  }

  const ranked = evaluateSurfaces(snapshots, priorMap);

  const scanMeta = {
    scanCount,
    logRecords : records.length,
    logPath    : LOG_IN,
    priorSteps : PRIOR_STEPS,
  };

  if (FLAG_JSON) {
    // Machine-readable output: one JSON object
    console.log(JSON.stringify({
      type      : 'heat_report',
      ts        : nowIso(),
      ...scanMeta,
      surfaces  : ranked,
    }));
  } else {
    printReport(ranked, scanMeta);
  }

  // JSONL append
  const outRecord = {
    type      : 'heat_report',
    ts        : nowIso(),
    ...scanMeta,
    surfaces  : ranked,
  };
  appendLog(LOG_OUT, outRecord);

  return ranked;
}

// ─── SELF-TEST (7 required validation cases) ──────────────────────────────────

function runSelfTest() {
  const {
    evaluateSurfaces,
    evaluateSurface,
    normalizeSurfaceObservation,
    computeVelocityScore,
    computeDivergenceScore,
    computeSpreadExpansionScore,
    computeInstabilityScore,
    computeDepthChangeScore,
    computeHeatScore,
    classifyHeat,
    rankSurfaces,
  } = require('../analysis/volatility_divergence_engine');

  let passed = 0;
  let failed = 0;

  function assert(label, condition, detail) {
    if (condition) {
      console.log(`  ✓ [PASS] ${label}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
      failed++;
    }
  }

  // Fixture factory
  const mkSurface = (id, spreadPct, opts = {}) => ({
    surfaceId      : id,
    pair           : opts.pair     || 'ETH/USDC',
    venueA         : opts.venueA   || 'uniswapv3',
    venueB         : opts.venueB   || 'camelotv3',
    spreadPct,
    spreadVelocity : opts.velocity ?? 0,
    spreadStd      : opts.std      ?? null,
    depthA         : opts.depthA   ?? null,
    depthB         : opts.depthB   ?? null,
    historyDepth   : opts.hist     ?? 0,
  });

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Volatility/Divergence Engine Self-Test  v1.0');
  console.log('  ════════════════════════════════════════════════════════════\n');

  // ─── Case 1: No prior sample ─────────────────────────────────────────────
  console.log('  Case 1: No prior sample');
  {
    const cur = mkSurface('A:X↔Y', 0.10, { velocity: 0.01, std: 0.005, hist: 5 });
    const res = evaluateSurface(cur, null);
    assert('Case 1: result not null', res !== null);
    assert('Case 1: heatScore is finite [0,1]', res.heatScore >= 0 && res.heatScore <= 1,
      `heatScore=${res.heatScore}`);
    assert('Case 1: depthChangeMissing flag set', res._depthChangeMissing === true);
    assert('Case 1: heatRank=0 before ranking (pre-rankSurfaces)', res.heatRank === 0);
    console.log(`         heatScore=${res.heatScore}  class=${res.heatClass}`);
  }
  console.log();

  // ─── Case 2: Flat market ──────────────────────────────────────────────────
  console.log('  Case 2: Flat market (velocity=0, std=0, expansion=0)');
  {
    const cur   = mkSurface('B:P↔Q', 0.02, { velocity: 0, std: 0, hist: 6 });
    const prior = mkSurface('B:P↔Q', 0.02, { velocity: 0, std: 0, hist: 5 });
    const res   = evaluateSurface(cur, prior);
    assert('Case 2: result not null', res !== null);
    assert('Case 2: velocityScore = 0', res.velocityScore === 0,  `got ${res.velocityScore}`);
    assert('Case 2: instabilityScore = 0', res.instabilityScore === 0, `got ${res.instabilityScore}`);
    assert('Case 2: heatClass is COLD or WARM', res.heatClass === 'COLD' || res.heatClass === 'WARM',
      `got ${res.heatClass}`);
    console.log(`         heatScore=${res.heatScore}  class=${res.heatClass}`);
  }
  console.log();

  // ─── Case 3: Widening spread ──────────────────────────────────────────────
  console.log('  Case 3: Widening spread (expansion should dominate)');
  {
    const cur   = mkSurface('C:R↔S', 0.15, { velocity: 0.06, std: 0.01, hist: 8 });
    const prior = mkSurface('C:R↔S', 0.05, { velocity: 0.00, std: 0.01, hist: 7 });
    const res   = evaluateSurface(cur, prior);
    assert('Case 3: result not null', res !== null);
    assert('Case 3: spreadExpansionScore > 0.7', res.spreadExpansionScore > 0.7,
      `got ${res.spreadExpansionScore}`);
    assert('Case 3: heatClass is HOT or EXTREME',
      res.heatClass === 'HOT' || res.heatClass === 'EXTREME',
      `got ${res.heatClass} (score=${res.heatScore})`);
    console.log(`         heatScore=${res.heatScore}  class=${res.heatClass}  expansionScore=${res.spreadExpansionScore}`);
  }
  console.log();

  // ─── Case 4: High divergence but low velocity ─────────────────────────────
  console.log('  Case 4: High divergence, low velocity');
  {
    const cur   = mkSurface('D:T↔U', 0.25, { velocity: 0.001, std: 0.001, hist: 10 });
    const prior = mkSurface('D:T↔U', 0.25, { velocity: 0.001, std: 0.001, hist: 9  });
    const res   = evaluateSurface(cur, prior);
    assert('Case 4: result not null', res !== null);
    assert('Case 4: divergenceScore > velocityScore',
      res.divergenceScore > res.velocityScore,
      `div=${res.divergenceScore}  vel=${res.velocityScore}`);
    assert('Case 4: divergenceScore > 0.5',
      res.divergenceScore > 0.5,
      `got ${res.divergenceScore}`);
    assert('Case 4: velocityScore < 0.1',
      res.velocityScore < 0.1,
      `got ${res.velocityScore}`);
    console.log(`         divergenceScore=${res.divergenceScore}  velocityScore=${res.velocityScore}  heat=${res.heatScore}`);
  }
  console.log();

  // ─── Case 5: Velocity spike, no depth data ────────────────────────────────
  console.log('  Case 5: Velocity spike, no depth (depthChangeScore must be 0 with flag)');
  {
    const cur   = mkSurface('E:V↔W', 0.10, { velocity: 0.08, std: 0.02, hist: 4 });
    const prior = mkSurface('E:V↔W', 0.02, { velocity: 0.00, std: 0.01, hist: 3 });
    const res   = evaluateSurface(cur, prior);
    assert('Case 5: result not null', res !== null);
    assert('Case 5: velocityScore > 0.5',        res.velocityScore > 0.5,     `got ${res.velocityScore}`);
    assert('Case 5: depthChangeScore = 0',        res.depthChangeScore === 0,  `got ${res.depthChangeScore}`);
    assert('Case 5: _depthChangeMissing = true',  res._depthChangeMissing === true);
    assert('Case 5: heatScore is finite',         isFinite(res.heatScore));
    console.log(`         velocityScore=${res.velocityScore}  depthChangeScore=${res.depthChangeScore}  heat=${res.heatScore}`);
  }
  console.log();

  // ─── Case 6: Stable ranking / tie-break ───────────────────────────────────
  console.log('  Case 6: Stable ranking — tie-break determinism');
  {
    // Two surfaces with identical scores except surfaceId
    const s1 = mkSurface('Z:identical_A↔B', 0.10, { velocity: 0.02, std: 0.01, hist: 5 });
    const s2 = mkSurface('A:identical_A↔B', 0.10, { velocity: 0.02, std: 0.01, hist: 5 });
    const ranked1 = evaluateSurfaces([s1, s2], new Map());
    const ranked2 = evaluateSurfaces([s2, s1], new Map()); // reversed input order

    assert('Case 6: 2 results returned', ranked1.length === 2 && ranked2.length === 2);
    assert('Case 6: rank 1 is same regardless of input order',
      ranked1[0].surfaceId === ranked2[0].surfaceId,
      `ranked1[0]=${ranked1[0].surfaceId}  ranked2[0]=${ranked2[0].surfaceId}`
    );
    assert('Case 6: lexicographic tie-break (A before Z → A gets rank 1)',
      ranked1[0].surfaceId === 'A:identical_A↔B',
      `got ${ranked1[0].surfaceId}`
    );
    console.log(`         rank1=${ranked1[0].surfaceId}  rank2=${ranked1[1].surfaceId}`);
  }
  console.log();

  // ─── Case 7: Bad surface does not break batch ─────────────────────────────
  console.log('  Case 7: Bad surface in batch — others must succeed');
  {
    const badSurface  = { surfaceId: null, spreadPct: 'not-a-number' };
    const goodSurface = mkSurface('G:OK↔surface', 0.15, { velocity: 0.03, std: 0.01, hist: 6 });
    const ranked      = evaluateSurfaces([badSurface, goodSurface], new Map());
    assert('Case 7: only 1 result (bad surface silently skipped)', ranked.length === 1,
      `got ${ranked.length} results`);
    assert('Case 7: good surface ranked 1', ranked[0]?.heatRank === 1,
      `heatRank=${ranked[0]?.heatRank}`);
    assert('Case 7: good surface has valid heatScore',
      ranked[0]?.heatScore >= 0 && ranked[0]?.heatScore <= 1);
    console.log(`         batch size=2 (1 bad): output=${ranked.length}  goodRank=${ranked[0]?.heatRank}`);
  }
  console.log();

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test complete: ${passed} passed  ${failed} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (FLAG_SELF_TEST) {
    runSelfTest();
    return;
  }

  if (INTERVAL_SEC <= 0) {
    // One-shot
    runEvaluation();
    return;
  }

  // Continuous mode
  if (!FLAG_JSON) {
    console.log(`[vdr] Continuous mode  interval=${INTERVAL_SEC}s  log=${LOG_IN}`);
    if (LOG_OUT) console.log(`[vdr] JSONL output: ${LOG_OUT}`);
    console.log('[vdr] Ctrl+C to stop.\n');
  }

  const sleep   = ms => new Promise(r => setTimeout(r, ms));
  let running   = true;
  process.on('SIGINT',  () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    const start = Date.now();
    try {
      runEvaluation();
    } catch (e) {
      process.stderr.write(`[vdr] scan error: ${e.message}\n`);
    }
    const elapsed = Date.now() - start;
    const wait    = Math.max(0, INTERVAL_SEC * 1000 - elapsed);
    if (running) await sleep(wait);
  }

  if (!FLAG_JSON) console.log('[vdr] Stopped.');
}

main().catch(e => {
  console.error('[vdr] FATAL:', e.message);
  process.exit(1);
});
