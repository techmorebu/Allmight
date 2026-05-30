#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Behavioral Analyzer  (generalized, Wave 1)
//  PLACEMENT: scripts/research/surface_behavioral_report.js
//  REPLACES:  scripts/research/dai_usdc_behavioral_report.js (hardcoded predecessor)
//  STATUS:    Boss Wave 1 (post-2B.1) — "one research pipeline for every candidate"
//
//  SEPARATE interpretation layer reading any surface's collector jsonl.
//  Never touches Redis or the collector. Pure file-in/report-out.
//
//  USAGE
//    node scripts/research/surface_behavioral_report.js --surface <surfaceId>
//    node scripts/research/surface_behavioral_report.js --surface eth_usdc_ramses --mode flash
//    node scripts/research/surface_behavioral_report.js --surface dai_usdc_candidate --mode inventory
//    node scripts/research/surface_behavioral_report.js --surface eth_usdc_ramses --thresholds 18,22,24,26
//    node scripts/research/surface_behavioral_report.js --self-test
//
//  INPUT:  logs/research/<surfaceId>/spread_observations.jsonl   (collector output)
//  OUTPUT: logs/research/<surfaceId>/behavioral_report.{json,txt}
//
//  CONSTITUTIONAL SEPARATION (Boss): no Redis, no collector coupling, no
//  threshold mutation of the surface config, no execution/promotion. Read-only.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACES_DIR  = path.join(REPO, 'surfaces');
const REGISTRY_FILE = path.join(SURFACES_DIR, 'registry.json');

const MIN_OBS_FOR_HINT = 60;
const INVENTORY_REFERENCE_SIZE = 10000;   // Boss Inventory Mode v1 anchor

// ─── pure analytics (testable) ──────────────────────────────────────────────

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  if (sortedAsc.length === 1) return +sortedAsc[0].toFixed(6);
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo  = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return +sortedAsc[lo].toFixed(6);
  return +(sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (idx - lo)).toFixed(6);
}

function distribution(spreads) {
  if (!spreads.length) return { count: 0, min: null, p50: null, p75: null, p90: null, p95: null, max: null, mean: null };
  const sorted = spreads.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: +sorted[0].toFixed(6),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    max: +sorted[sorted.length - 1].toFixed(6),
    mean: +(sum / sorted.length).toFixed(6),
  };
}

function thresholdAnalysis(observations, thresholds, hoursCovered) {
  return thresholds.map(t => {
    let above = 0;
    const runs = [];
    let curr = 0;
    for (const o of observations) {
      if (typeof o.spreadBps === 'number' && isFinite(o.spreadBps) && o.spreadBps >= t) {
        above++; curr++;
      } else {
        if (curr > 0) runs.push(curr);
        curr = 0;
      }
    }
    if (curr > 0) runs.push(curr);

    const eventCount = runs.length;
    const eventsPerHour  = hoursCovered > 0 ? +(eventCount / hoursCovered).toFixed(4) : null;
    const obsPerHour     = hoursCovered > 0 ? +(above / hoursCovered).toFixed(4) : null;
    const obsFraction    = observations.length > 0 ? +(above / observations.length).toFixed(4) : 0;

    let b1 = 0, b24 = 0, b5p = 0;
    for (const r of runs) {
      if (r === 1) b1++;
      else if (r <= 4) b24++;
      else b5p++;
    }
    const maxRun = runs.length ? Math.max(...runs) : 0;
    const avgRun = runs.length ? +(runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(2) : 0;

    return {
      thresholdBps: t,
      observationsAbove: above,
      observationsFraction: obsFraction,
      observationsPerHour: obsPerHour,
      eventCount,
      eventsPerHour,
      persistence: { '1_scan': b1, '2_to_4_scan': b24, '5plus_scan': b5p },
      maxRunScans: maxRun,
      avgRunScans: avgRun,
    };
  });
}

function dataQuality(allObs) {
  const total = allObs.length;
  const sameBlock = allObs.filter(o => o.sameBlock === true).length;
  const crossBlock = allObs.filter(o => o.sameBlock === false).length;
  const tss = allObs.map(o => o.ts).filter(Boolean).sort();
  const firstTs = tss[0] || null;
  const lastTs  = tss[tss.length - 1] || null;
  const hoursCovered = (firstTs && lastTs)
    ? +((new Date(lastTs) - new Date(firstTs)) / 3600000).toFixed(3) : 0;
  const uniqueBlocks = new Set(
    allObs.filter(o => o.sameBlock && o.blockA != null).map(o => o.blockA)
  ).size;
  return {
    totalObservations: total,
    sameBlockObservations: sameBlock,
    crossBlockObservations: crossBlock,
    sameBlockPercent: total > 0 ? +(sameBlock / total * 100).toFixed(1) : 0,
    firstObservationTs: firstTs,
    lastObservationTs: lastTs,
    hoursCovered,
    uniqueBlocksObserved: uniqueBlocks,
  };
}

// ─── threshold resolution (mode-aware, surface-derived) ─────────────────────

function resolveThresholds(surface, mode, cliOverride) {
  // explicit CLI override wins
  if (cliOverride && cliOverride.length) {
    const sorted = cliOverride.slice().sort((a, b) => a - b);
    return { thresholds: sorted, source: 'cli-override', floor: sorted[0] };
  }
  if (mode === 'inventory') {
    const c = surface.breakevenComponents;
    if (!c) throw new Error(`mode=inventory requires surface.breakevenComponents (${surface.surfaceId} has none)`);
    const venue = Number(c.venueFeeBps) || 0;
    const slip  = Number(c.estimatedSlipBps) || 0;
    const gasUsd = Number(c.gasUsdPerTx) || 0;
    const gasBps = INVENTORY_REFERENCE_SIZE > 0 ? (gasUsd / INVENTORY_REFERENCE_SIZE) * 10000 : 0;
    const inventoryBE = +(venue + slip + gasBps).toFixed(4);   // NO aave (inventory)
    const thresholds = [inventoryBE, +(inventoryBE + 1).toFixed(4), +(inventoryBE + 2).toFixed(4), +(inventoryBE + 3).toFixed(4)];
    return { thresholds, source: 'inventory-mode-default', floor: inventoryBE,
             rationale: `inventoryBE @ $${INVENTORY_REFERENCE_SIZE} = venue ${venue} + slip ${slip} + gas ${+gasBps.toFixed(3)} = ${inventoryBE} bp; +1/+2/+3 bp steps` };
  }
  // flash mode (default): config-defined spread tiers
  const buckets = [
    surface.realisticBreakevenBps,
    surface.minSpreadBps,
    surface.preferredSpreadBps,
    surface.eliteSpreadBps,
  ].map(Number).filter(v => isFinite(v));
  if (buckets.length === 0) throw new Error(`mode=flash needs spread fields on surface (realisticBreakevenBps / min / preferred / elite)`);
  const sorted = [...new Set(buckets)].sort((a, b) => a - b);
  return { thresholds: sorted, source: 'flash-mode-default-from-surface',
           floor: sorted[0],
           rationale: 'realisticBreakevenBps + minSpread / preferred / elite from surface config' };
}

// ─── descriptive hint (heuristic, threshold-anchored) ───────────────────────

function descriptiveHint(thresholdResults, dq, floor) {
  if (dq.sameBlockObservations < MIN_OBS_FOR_HINT) {
    return `INSUFFICIENT_DATA — only ${dq.sameBlockObservations} same-block observations (need ${MIN_OBS_FOR_HINT}+ to characterize)`;
  }
  const t0 = thresholdResults[0];
  if (!t0) return 'INSUFFICIENT_DATA — no thresholds';
  const ev = t0.eventsPerHour ?? 0;
  const obs = t0.observationsAbove ?? 0;
  const obsFrac = t0.observationsFraction ?? 0;
  const has5plus = (t0.persistence['5plus_scan'] || 0) > 0;
  const has24    = (t0.persistence['2_to_4_scan'] || 0) > 0;
  if (obs === 0) return `STRUCTURALLY_DEAD — NO observations >= ${floor} bp in the sample window`;
  // sustained-regime check: if MAJORITY of observations are above floor, that's
  // structurally active even when measured as "one long event" by event count.
  if (obsFrac >= 0.5) return `STRUCTURALLY_ACTIVE — ${+(obsFrac*100).toFixed(1)}% of observations above ${floor} bp (sustained regime)`;
  if (ev < 1)    return `STRUCTURALLY_SPARSE — ${ev}/hr events above ${floor} bp (episodic/rare)`;
  if (ev < 5) {
    const persistTag = (has5plus || has24) ? 'with some persistence' : 'mostly 1-scan bursts';
    return `EPISODIC_EVENTS_PRESENT — ${ev}/hr events above ${floor} bp ${persistTag}`;
  }
  if (ev >= 5 && has5plus) return `STRUCTURALLY_ACTIVE — ${ev}/hr events above ${floor} bp with sustained (5+ scan) runs`;
  return `INTERMEDIATE — ${ev}/hr events above ${floor} bp; review persistence below`;
}

// ─── orchestration ───────────────────────────────────────────────────────────

function analyze(surface, observations, mode, cliThresholds) {
  const dq = dataQuality(observations);
  const sameBlockObs = observations.filter(o => o.sameBlock === true);
  const spreads = sameBlockObs.map(o => o.spreadBps).filter(s => typeof s === 'number' && isFinite(s));
  const dist = distribution(spreads);
  const { thresholds, source, floor, rationale } = resolveThresholds(surface, mode, cliThresholds);
  const thr = thresholdAnalysis(sameBlockObs, thresholds, dq.hoursCovered);
  return {
    generatedAt          : new Date().toISOString(),
    surface              : {
      surfaceId       : surface.surfaceId,
      chainScopedId   : surface.chainScopedId,
      displayName     : surface.displayName,
      chain           : surface.chain,
    },
    mode,
    thresholdsSource     : source,
    thresholdsRationale  : rationale || null,
    thresholdsBps        : thresholds,
    floorBps             : floor,
    dataQuality          : dq,
    distribution         : dist,
    thresholdAnalysis    : thr,
    descriptiveHint      : descriptiveHint(thr, dq, floor),
    notes                : [
      'Same-block only — cross-block observations excluded from spread analysis.',
      'thresholds derived from ' + source + (rationale ? ` (${rationale})` : ''),
      mode === 'inventory'
        ? 'inventory mode floor EXCLUDES Aave; NOT comparable to flash floors.'
        : 'flash mode floor INCLUDES Aave (deterministic per-trade floor).',
      'Descriptive hint is heuristic; not a promotion, threshold change, or execution decision.',
      'No execution, no promotion, no surface config mutation. (Boss Wave 1)',
    ],
  };
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function loadSurfaceConfig(surfaceId) {
  const direct = path.join(SURFACES_DIR, `${surfaceId}.json`);
  if (fs.existsSync(direct)) return JSON.parse(fs.readFileSync(direct, 'utf8'));
  if (fs.existsSync(REGISTRY_FILE)) {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    const entry = (reg.surfaces || []).find(e => e.surfaceId === surfaceId);
    if (entry && entry.file) {
      const p = path.join(SURFACES_DIR, entry.file);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error(`surface not found: ${surfaceId}`);
}

function loadObservations(jsonlPath) {
  if (!fs.existsSync(jsonlPath)) return [];
  const text = fs.readFileSync(jsonlPath, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  out.sort((a, b) => (a.ts > b.ts ? 1 : a.ts < b.ts ? -1 : 0));
  return out;
}

function pad(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }

function buildTextReport(a, inputJsonl) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push(`  AllMight — Surface Behavioral Viability Report (generalized, Wave 1)`);
  L.push(`  surface: ${a.surface.displayName}  [${a.surface.surfaceId}]   mode: ${a.mode.toUpperCase()}`);
  L.push(`  economic id: ${a.surface.chainScopedId}`);
  L.push(`  generatedAt: ${a.generatedAt}`);
  L.push(`  source: ${path.relative(REPO, inputJsonl)}`);
  L.push(bar);
  L.push('');
  L.push('  DATA QUALITY');
  const dq = a.dataQuality;
  L.push(`    totalObs: ${dq.totalObservations}    sameBlock: ${dq.sameBlockObservations} (${dq.sameBlockPercent}%)    crossBlock: ${dq.crossBlockObservations}`);
  L.push(`    window: ${dq.firstObservationTs || 'n/a'} → ${dq.lastObservationTs || 'n/a'}`);
  L.push(`    duration: ${dq.hoursCovered} hours    unique same-block blocks: ${dq.uniqueBlocksObserved}`);
  L.push('');
  L.push('  DISTRIBUTION (sameBlock spreadBps only)');
  const d = a.distribution;
  L.push(`    n=${d.count}    min=${d.min}    P50=${d.p50}    P75=${d.p75}    P90=${d.p90}    P95=${d.p95}    max=${d.max}    mean=${d.mean}`);
  L.push('');
  L.push(`  THRESHOLD ANALYSIS  (source: ${a.thresholdsSource}${a.thresholdsRationale ? ' — ' + a.thresholdsRationale : ''})`);
  L.push('    thr_bp   obs_abv  obs_frac    obs/hr  events   ev/hr  | persist: 1 / 2-4 / 5+   maxRun  avgRun');
  for (const t of a.thresholdAnalysis) {
    const p = t.persistence;
    L.push(
      '    ' +
      pad(t.thresholdBps, 5) + '   ' +
      pad(t.observationsAbove, 7) + '   ' +
      pad(t.observationsFraction, 7) + '   ' +
      pad(t.observationsPerHour ?? 'n/a', 7) + '   ' +
      pad(t.eventCount, 5) + '   ' +
      pad(t.eventsPerHour ?? 'n/a', 6) + '  |        ' +
      pad(p['1_scan'], 3) + ' / ' + pad(p['2_to_4_scan'], 3) + ' / ' + pad(p['5plus_scan'], 3) + '     ' +
      pad(t.maxRunScans, 3) + '    ' + pad(t.avgRunScans, 5)
    );
  }
  L.push('');
  L.push('  DESCRIPTIVE HINT (heuristic — NOT a verdict; Boss decides interpretation)');
  L.push(`    ${a.descriptiveHint}`);
  L.push('');
  L.push(bar);
  L.push('  NOTES');
  for (const n of a.notes) L.push(`  - ${n}`);
  L.push(bar);
  return L.join('\n');
}

function parseArgs(argv) {
  const a = { surface: null, mode: 'flash', thresholds: null, jsonMode: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--surface') a.surface = argv[++i];
    else if (argv[i] === '--mode') a.mode = argv[++i];
    else if (argv[i] === '--thresholds') a.thresholds = argv[++i].split(',').map(Number).filter(v => isFinite(v));
    else if (argv[i] === '--json') a.jsonMode = true;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.surface) { console.error('[report] --surface <surfaceId> required'); process.exit(1); }
  if (!['flash','inventory'].includes(args.mode)) { console.error(`[report] --mode must be flash|inventory (got ${args.mode})`); process.exit(1); }

  let surface;
  try { surface = loadSurfaceConfig(args.surface); }
  catch (e) { console.error(`[report] ${e.message}`); process.exit(1); }

  const outDir   = path.join(REPO, 'logs', 'research', args.surface);
  const inJsonl  = path.join(outDir, 'spread_observations.jsonl');
  const outJson  = path.join(outDir, 'behavioral_report.json');
  const outTxt   = path.join(outDir, 'behavioral_report.txt');

  const obs = loadObservations(inJsonl);
  if (obs.length === 0) {
    console.error(`[report] no observations at ${path.relative(REPO, inJsonl)} — run the collector first`);
    process.exit(1);
  }

  let a;
  try { a = analyze(surface, obs, args.mode, args.thresholds); }
  catch (e) { console.error(`[report] analysis failed: ${e.message}`); process.exit(1); }

  if (args.jsonMode) { console.log(JSON.stringify(a, null, 2)); return; }
  const txt = buildTextReport(a, inJsonl);
  console.log(txt);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(outJson, JSON.stringify(a, null, 2));
    fs.writeFileSync(outTxt, txt + '\n');
    console.log(`\n[report] wrote ${path.relative(REPO, outJson)} and ${path.relative(REPO, outTxt)}`);
  } catch (e) {
    console.error(`[report] could not write artifacts: ${e.message}`);
  }
}

// ─── SELF-TEST (synthetic jsonl; no real fs deps for analytics) ─────────────
function selfTest() {
  const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  const cases = [];

  // analytics preserved from predecessor
  cases.push(['percentile [1..5] P50 = 3', percentile([1,2,3,4,5], 50) === 3]);
  cases.push(['percentile [1..5] P75 = 4', percentile([1,2,3,4,5], 75) === 4]);
  const d = distribution([1,1,1,2,2,3,3,3,3,4,5]);
  cases.push(['dist count = 11',  d.count === 11]);
  cases.push(['dist P50 = 3',     d.p50 === 3]);
  cases.push(['dist max = 5',     d.max === 5]);

  // threshold runs (same as predecessor test)
  const seq = [1,2,3,4,3,2,5,1,3,3,1].map(s => ({ sameBlock:true, spreadBps:s }));
  const t = thresholdAnalysis(seq, [2.7, 4.0, 5.0], 0.833);
  const t27 = t.find(r => r.thresholdBps === 2.7);
  cases.push(['t2.7 above = 6',   t27.observationsAbove === 6]);
  cases.push(['t2.7 events = 3',  t27.eventCount === 3]);

  // resolveThresholds — flash mode (NEW)
  const flashSurf = {
    surfaceId: 'eth_usdc_ramses', chainScopedId: 'arbitrum:ETH/USDC:ramses_uni',
    chain: 'arbitrum', realisticBreakevenBps: 17.4, minSpreadBps: 22, preferredSpreadBps: 24, eliteSpreadBps: 26,
  };
  const rFlash = resolveThresholds(flashSurf, 'flash', null);
  cases.push(['flash thresholds = [17.4,22,24,26]',
    JSON.stringify(rFlash.thresholds) === JSON.stringify([17.4, 22, 24, 26])]);
  cases.push(['flash source = mode-default',          rFlash.source === 'flash-mode-default-from-surface']);
  cases.push(['flash floor = 17.4',                   rFlash.floor === 17.4]);

  // resolveThresholds — inventory mode (NEW)
  const invSurf = {
    surfaceId: 'dai_usdc_candidate', chainScopedId: 'arbitrum:DAI/USDC:uni_camelot',
    chain: 'arbitrum',
    breakevenComponents: { venueFeeBps: 1.5, aaveFeeBps: 5, estimatedSlipBps: 1, gasUsdPerTx: 0.20, referenceSizeUsd: 10000 },
  };
  const rInv = resolveThresholds(invSurf, 'inventory', null);
  // expected: inventoryBE = 1.5 + 1 + (0.20/10000*10000=0.2) = 2.7 ; thresholds [2.7, 3.7, 4.7, 5.7]
  cases.push(['inventory floor = 2.7',  approx(rInv.floor, 2.7)]);
  cases.push(['inventory thresholds = [2.7,3.7,4.7,5.7]',
    JSON.stringify(rInv.thresholds) === JSON.stringify([2.7, 3.7, 4.7, 5.7])]);
  cases.push(['inventory source labeled', rInv.source === 'inventory-mode-default']);

  // resolveThresholds — inventory without breakevenComponents throws (NEW)
  cases.push(['inventory mode w/o components throws',
    (() => { try { resolveThresholds(flashSurf, 'inventory', null); return false; } catch (e) { return /breakevenComponents/.test(e.message); } })()]);

  // resolveThresholds — CLI override wins (NEW)
  const rCli = resolveThresholds(flashSurf, 'flash', [5, 10, 15, 20]);
  cases.push(['cli override wins',     rCli.source === 'cli-override' && rCli.floor === 5]);
  cases.push(['cli override sorted',   JSON.stringify(rCli.thresholds) === JSON.stringify([5,10,15,20])]);

  // descriptiveHint — uses generalized floor (NEW)
  const enough = Array.from({ length: 80 }, (_, i) =>
    ({ ts: new Date(2026, 0, 1, 0, i).toISOString(), sameBlock: true, blockA: i, spreadBps: 5 }));
  const dq = dataQuality(enough);
  // analyze with floor 10 (no obs above) → STRUCTURALLY_DEAD with floor=10
  const thrDead = thresholdAnalysis(enough, [10, 11, 12, 13], dq.hoursCovered);
  cases.push(['hint floor parameterized = 10',
    /STRUCTURALLY_DEAD.*10\s*bp/i.test(descriptiveHint(thrDead, dq, 10))]);
  // analyze with floor 4 (lots of obs above) → ACTIVE
  const thrActive = thresholdAnalysis(enough, [4, 5, 6, 7], dq.hoursCovered);
  cases.push(['hint detects active when above floor',
    /STRUCTURALLY_ACTIVE|EPISODIC|INTERMEDIATE/.test(descriptiveHint(thrActive, dq, 4))]);

  // end-to-end analyze (NEW)
  const obsFull = [
    { ts: '2026-01-01T00:00:00Z', sameBlock: true,  blockA: 100, spreadBps: 1, chainScopedId:'arbitrum:DAI/USDC:uni_camelot' },
    { ts: '2026-01-01T00:01:00Z', sameBlock: false, blockA: 101, blockB: 102, spreadBps: null, chainScopedId:'arbitrum:DAI/USDC:uni_camelot' },
    { ts: '2026-01-01T00:02:00Z', sameBlock: true,  blockA: 103, spreadBps: 3, chainScopedId:'arbitrum:DAI/USDC:uni_camelot' },
  ];
  const a = analyze(invSurf, obsFull, 'inventory', null);
  cases.push(['analyze: mode propagated',  a.mode === 'inventory']);
  cases.push(['analyze: floor 2.7 in result', a.floorBps === 2.7]);
  cases.push(['analyze: notes mention inventory NOT comparable',
    a.notes.some(n => /NOT comparable/i.test(n))]);
  // cross-block excluded from distribution
  cases.push(['analyze: distribution n = 2 (cross excluded)', a.distribution.count === 2]);

  let pass = 0;
  console.log('── surface_behavioral_report.js SELF-TEST (generalized, Wave 1) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
