#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Phase 2A.2 Behavioral Analyzer :: Arbitrum DAI/USDC
//  PLACEMENT: scripts/research/dai_usdc_behavioral_report.js
//  STATUS:    Boss Phase 2A.2 approved — SEPARATE INTERPRETATION LAYER
//
//  ┌───────────────────────────────────────────────────────────────────────┐
//  │  INTERPRETATION ONLY. Reads the collector's raw jsonl (acquisition).   │
//  │  NEVER touches Redis, NEVER touches the collector. Pure file-in/       │
//  │  report-out, separate by design (Boss: constitutional separation).     │
//  └───────────────────────────────────────────────────────────────────────┘
//
//  INPUT:  logs/research/dai_usdc_arb/spread_observations.jsonl   (collector)
//  OUTPUT: logs/research/dai_usdc_arb/behavioral_report.{json,txt}
//
//  COMPUTES (sameBlock observations only; cross-block excluded by mandate)
//    DISTRIBUTION    n, min, P50, P75, P90, P95, max, mean (spreadBps)
//    FREQUENCY       per-threshold (2.7 / 3.0 / 4.0 / 5.0 bp):
//                      observations above; obs_fraction (time fraction);
//                      observations/hr; distinct event count; events/hr
//    PERSISTENCE     per-threshold contiguous-run buckets:
//                      1-scan / 2-4 scan / 5+ scan; max/avg run length
//    DATA QUALITY    total obs, sameBlock %, crossBlock count, hours covered
//    DESCRIPTIVE HINT (clearly flagged, NOT a verdict; Boss decides)
//
//  CONSTRAINTS: READ-ONLY. No threshold mutation. No promotion. No execution.
//               NOT COMPARABLE TO FLASH SCORE (different economic model).
//
//  USAGE
//    node scripts/research/dai_usdc_behavioral_report.js              # report + files
//    node scripts/research/dai_usdc_behavioral_report.js --json       # JSON to stdout
//    node scripts/research/dai_usdc_behavioral_report.js --self-test
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const RESEARCH_DIR = path.join(REPO, 'logs', 'research', 'dai_usdc_arb');
const IN_JSONL     = path.join(RESEARCH_DIR, 'spread_observations.jsonl');
const OUT_JSON     = path.join(RESEARCH_DIR, 'behavioral_report.json');
const OUT_TXT      = path.join(RESEARCH_DIR, 'behavioral_report.txt');

// Boss-specified frontier thresholds (per-trade inventory breakeven = 2.7 bp;
// 3/4/5 bp = increasing margin headroom). DO NOT mutate per project rules.
const THRESHOLDS_BPS  = [2.7, 3.0, 4.0, 5.0];
const MIN_OBS_FOR_HINT = 60;   // below this, hint is INSUFFICIENT_DATA

// ─── pure analytics (testable, no I/O) ──────────────────────────────────────

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
    count : sorted.length,
    min   : +sorted[0].toFixed(6),
    p50   : percentile(sorted, 50),
    p75   : percentile(sorted, 75),
    p90   : percentile(sorted, 90),
    p95   : percentile(sorted, 95),
    max   : +sorted[sorted.length - 1].toFixed(6),
    mean  : +(sum / sorted.length).toFixed(6),
  };
}

// observations assumed sorted by ts; each has spreadBps (or null for cross-block)
function thresholdAnalysis(observations, hoursCovered) {
  return THRESHOLDS_BPS.map(t => {
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

    const eventCount     = runs.length;
    const eventsPerHour  = hoursCovered > 0 ? +(eventCount / hoursCovered).toFixed(4) : null;
    const obsPerHour     = hoursCovered > 0 ? +(above / hoursCovered).toFixed(4)      : null;
    const obsFraction    = observations.length > 0 ? +(above / observations.length).toFixed(4) : 0;

    let bucket1 = 0, bucket24 = 0, bucket5plus = 0;
    for (const r of runs) {
      if (r === 1)        bucket1++;
      else if (r <= 4)    bucket24++;
      else                bucket5plus++;
    }
    const maxRun = runs.length ? Math.max(...runs) : 0;
    const avgRun = runs.length ? +(runs.reduce((a, b) => a + b, 0) / runs.length).toFixed(2) : 0;

    return {
      thresholdBps         : t,
      observationsAbove    : above,
      observationsFraction : obsFraction,
      observationsPerHour  : obsPerHour,
      eventCount,
      eventsPerHour,
      persistence          : { '1_scan': bucket1, '2_to_4_scan': bucket24, '5plus_scan': bucket5plus },
      maxRunScans          : maxRun,
      avgRunScans          : avgRun,
    };
  });
}

function dataQuality(allObs) {
  const total      = allObs.length;
  const sameBlock  = allObs.filter(o => o.sameBlock === true).length;
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
    totalObservations     : total,
    sameBlockObservations : sameBlock,
    crossBlockObservations: crossBlock,
    sameBlockPercent      : total > 0 ? +(sameBlock / total * 100).toFixed(1) : 0,
    firstObservationTs    : firstTs,
    lastObservationTs     : lastTs,
    hoursCovered,
    uniqueBlocksObserved  : uniqueBlocks,
  };
}

// DESCRIPTIVE hint — heuristic characterization, NOT a verdict.
// Boss owns interpretation; this just describes the shape of the data.
function descriptiveHint(thresholdResults, dq) {
  if (dq.sameBlockObservations < MIN_OBS_FOR_HINT) {
    return `INSUFFICIENT_DATA — only ${dq.sameBlockObservations} same-block observations (need ${MIN_OBS_FOR_HINT}+ to characterize)`;
  }
  const t27 = thresholdResults.find(r => r.thresholdBps === 2.7);
  const ev27 = t27?.eventsPerHour ?? 0;
  const obs27 = t27?.observationsAbove ?? 0;
  const has5plus = (t27?.persistence['5plus_scan'] || 0) > 0;
  const has24    = (t27?.persistence['2_to_4_scan'] || 0) > 0;

  if (obs27 === 0) {
    return 'STRUCTURALLY_DEAD — NO observations >= 2.7bp in the sample window';
  }
  if (ev27 < 1) {
    return `STRUCTURALLY_SPARSE — ${ev27}/hr events above 2.7bp (episodic/rare)`;
  }
  if (ev27 < 5) {
    const persistTag = (has5plus || has24) ? 'with some persistence' : 'mostly 1-scan bursts';
    return `EPISODIC_EVENTS_PRESENT — ${ev27}/hr events above 2.7bp ${persistTag}`;
  }
  if (ev27 >= 5 && has5plus) {
    return `STRUCTURALLY_ACTIVE — ${ev27}/hr events above 2.7bp with sustained (5+ scan) runs`;
  }
  return `INTERMEDIATE — ${ev27}/hr events above 2.7bp; review persistence below`;
}

function analyze(observations) {
  const dq = dataQuality(observations);
  const sameBlockObs = observations.filter(o => o.sameBlock === true);
  const spreads = sameBlockObs
    .map(o => o.spreadBps)
    .filter(s => typeof s === 'number' && isFinite(s));
  const dist = distribution(spreads);
  const thr  = thresholdAnalysis(sameBlockObs, dq.hoursCovered);
  return {
    generatedAt          : new Date().toISOString(),
    model                : 'INVENTORY',
    notComparableToFlash : true,
    notComparableNote    : 'NOT COMPARABLE TO FLASH SCORE',
    phase                : '2A.2-research',
    chainScopedId        : sameBlockObs[0]?.chainScopedId || 'arbitrum:DAI/USDC:uni_camelot',
    inputFile            : path.relative(REPO, IN_JSONL),
    dataQuality          : dq,
    distribution         : dist,
    thresholdAnalysis    : thr,
    descriptiveHint      : descriptiveHint(thr, dq),
  };
}

// ─── I/O ────────────────────────────────────────────────────────────────────

function loadObservations() {
  if (!fs.existsSync(IN_JSONL)) return [];
  const text = fs.readFileSync(IN_JSONL, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  // sort by ts ascending (collector writes in order; defensive sort)
  out.sort((a, b) => (a.ts > b.ts ? 1 : a.ts < b.ts ? -1 : 0));
  return out;
}

function pad(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }

function buildTextReport(a) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push('  AllMight — Phase 2A.2 Behavioral Viability Report :: Arbitrum DAI/USDC');
  L.push(`  *** MODEL = INVENTORY — ${a.notComparableNote} ***`);
  L.push(`  generatedAt: ${a.generatedAt}    chainScopedId: ${a.chainScopedId}`);
  L.push(`  source: ${a.inputFile}`);
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
  L.push('  THRESHOLD ANALYSIS (frequency + persistence above each bp)');
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
  L.push('  DESCRIPTIVE HINT (NOT a verdict; Boss decides interpretation)');
  L.push(`    ${a.descriptiveHint}`);
  L.push('');
  L.push(bar);
  L.push('  NOTES');
  L.push('  - Same-block only. Cross-block observations excluded from spread analysis (invalid).');
  L.push('  - 2.7 bp = arbitrum inventory per-trade breakeven (Inventory Mode v1).');
  L.push('  - "events" = contiguous runs above threshold; "obs_abv" = individual observations.');
  L.push('  - Descriptive hint is heuristic; NOT a promotion, threshold change, or execution decision.');
  L.push('  - NOT COMPARABLE TO FLASH SCORE. Separate economic model. (Boss Phase 2B)');
  L.push(bar);
  return L.join('\n');
}

function main() {
  const jsonMode = process.argv.includes('--json');
  const obs = loadObservations();
  if (obs.length === 0) {
    console.error(`[analyzer] no observations found at ${path.relative(REPO, IN_JSONL)} — run the collector first`);
    process.exit(1);
  }
  const a = txt_safe_analyze(obs);
  if (jsonMode) { console.log(JSON.stringify(a, null, 2)); return; }
  const txt = buildTextReport(a);
  console.log(txt);
  try {
    fs.mkdirSync(RESEARCH_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(a, null, 2));
    fs.writeFileSync(OUT_TXT, txt + '\n');
    console.log(`\n[analyzer] wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_TXT)}`);
  } catch (e) {
    console.error(`[analyzer] could not write artifacts: ${e.message}`);
  }
}

function txt_safe_analyze(obs) {
  try { return analyze(obs); }
  catch (e) {
    console.error(`[analyzer] analyze failed: ${e.message}`);
    process.exit(1);
  }
}

// ─── SELF-TEST (synthetic jsonl; no real data needed) ────────────────────────
function selfTest() {
  const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  const cases = [];

  // percentile
  cases.push(['percentile [1..5] P50 = 3', percentile([1,2,3,4,5], 50) === 3]);
  cases.push(['percentile [1..5] P75 = 4', percentile([1,2,3,4,5], 75) === 4]);
  cases.push(['percentile single = self', percentile([7.5], 50) === 7.5]);
  cases.push(['percentile empty = null', percentile([], 50) === null]);

  // distribution
  const d = distribution([1,1,1,2,2,3,3,3,3,4,5]);
  cases.push(['dist count = 11', d.count === 11]);
  cases.push(['dist min = 1',    d.min === 1]);
  cases.push(['dist P50 = 3',    d.p50 === 3]);
  cases.push(['dist max = 5',    d.max === 5]);
  cases.push(['dist mean ~ 2.545', approx(d.mean, 2.545)]);
  cases.push(['dist empty graceful', distribution([]).count === 0]);

  // threshold runs (sequence: [1,2,3,4,3,2,5,1,3,3,1] above 2.7 → runs of [3,1,2])
  const seq = [1,2,3,4,3,2,5,1,3,3,1].map(s => ({ sameBlock:true, spreadBps:s }));
  // pretend ~50min duration = 0.833 hr → 11 obs
  const t = thresholdAnalysis(seq, 0.833);
  const t27 = t.find(r => r.thresholdBps === 2.7);
  cases.push(['t2.7 above = 6',        t27.observationsAbove === 6]);
  cases.push(['t2.7 eventCount = 3',   t27.eventCount === 3]);
  cases.push(['t2.7 maxRun = 3',       t27.maxRunScans === 3]);
  cases.push(['t2.7 avgRun = 2.0',     t27.avgRunScans === 2]);
  cases.push(['t2.7 persist 1-scan = 1', t27.persistence['1_scan'] === 1]);
  cases.push(['t2.7 persist 2-4 = 2',  t27.persistence['2_to_4_scan'] === 2]);
  cases.push(['t2.7 persist 5+ = 0',   t27.persistence['5plus_scan'] === 0]);
  // at threshold 4.0 → above: [4, 5] = 2 obs, runs [1, 1]
  const t40 = t.find(r => r.thresholdBps === 4.0);
  cases.push(['t4.0 above = 2',        t40.observationsAbove === 2]);
  cases.push(['t4.0 events = 2',       t40.eventCount === 2]);
  cases.push(['t4.0 all 1-scan',       t40.persistence['1_scan'] === 2]);
  // at threshold 5.0 → just the [5], 1 obs, 1 run
  const t50 = t.find(r => r.thresholdBps === 5.0);
  cases.push(['t5.0 above = 1',        t50.observationsAbove === 1]);

  // dataQuality: mixed sameBlock with cross-block
  const allObs = [
    { ts: '2026-01-01T00:00:00Z', sameBlock: true,  blockA: 100, spreadBps: 1 },
    { ts: '2026-01-01T00:05:00Z', sameBlock: false, blockA: 101, blockB: 102, spreadBps: null },
    { ts: '2026-01-01T00:10:00Z', sameBlock: true,  blockA: 103, spreadBps: 3 },
    { ts: '2026-01-01T01:00:00Z', sameBlock: true,  blockA: 200, spreadBps: 4 },
  ];
  const dq = dataQuality(allObs);
  cases.push(['dq total = 4',                  dq.totalObservations === 4]);
  cases.push(['dq sameBlock = 3',              dq.sameBlockObservations === 3]);
  cases.push(['dq crossBlock = 1',             dq.crossBlockObservations === 1]);
  cases.push(['dq sameBlock% = 75',            dq.sameBlockPercent === 75]);
  cases.push(['dq hoursCovered = 1',           dq.hoursCovered === 1]);
  cases.push(['dq uniqueBlocks = 3 (cross excluded)', dq.uniqueBlocksObserved === 3]);

  // analyze end-to-end: spread analysis uses sameBlock only
  const a = analyze(allObs);
  cases.push(['analyze distribution n = 3 (cross excluded)', a.distribution.count === 3]);
  cases.push(['analyze NOT comparable label', a.notComparableNote === 'NOT COMPARABLE TO FLASH SCORE']);
  cases.push(['analyze hint INSUFFICIENT_DATA (<60 obs)', /INSUFFICIENT_DATA/.test(a.descriptiveHint)]);

  // hint bins on adequate data
  const enoughZero = Array.from({ length: 80 }, (_, i) =>
    ({ ts: new Date(2026, 0, 1, 0, i).toISOString(), sameBlock: true, blockA: i, spreadBps: 1 }));
  cases.push(['hint STRUCTURALLY_DEAD (0 above)', /STRUCTURALLY_DEAD/.test(analyze(enoughZero).descriptiveHint)]);

  // a "sparse" sequence: 80 obs over 80 minutes (1.333h), only 1 spike above 2.7
  const sparse = enoughZero.map((o, i) => i === 40 ? { ...o, spreadBps: 3 } : o);
  cases.push(['hint STRUCTURALLY_SPARSE (<1/hr)', /STRUCTURALLY_SPARSE/.test(analyze(sparse).descriptiveHint)]);

  // an "active" sequence: 80 obs over 80 minutes, spreads >=2.7 every other obs with a long run
  const active = Array.from({ length: 80 }, (_, i) => ({
    ts: new Date(2026, 0, 1, 0, i).toISOString(),
    sameBlock: true, blockA: i,
    spreadBps: (i < 10 ? 3.5 : i % 2 === 0 ? 3.2 : 1.0)  // 10-scan run + interleaved spikes
  }));
  cases.push(['hint STRUCTURALLY_ACTIVE',
    /STRUCTURALLY_ACTIVE/.test(analyze(active).descriptiveHint)]);

  // cross-block must NOT contribute spreadBps to distribution even with stray values
  const dirty = [
    { ts: '2026-01-01T00:00:00Z', sameBlock: false, spreadBps: 999 }, // attacker-style stray
    { ts: '2026-01-01T00:01:00Z', sameBlock: true,  spreadBps: 2 },
  ];
  const adist = analyze(dirty).distribution;
  cases.push(['cross-block stray excluded from dist', adist.max === 2 && adist.count === 1]);

  let pass = 0;
  console.log('── dai_usdc_behavioral_report.js SELF-TEST (Phase 2A.2 analyzer) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
