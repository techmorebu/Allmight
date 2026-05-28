#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Score  v1.0
//  PLACEMENT: scripts/tools/surface_score.js
//  STATUS:    Boss G2.16 approved — READ-ONLY analytics
//
//  WHAT IT DOES
//  ────────────
//  Ranks registered surfaces by ECONOMIC SURVIVABILITY (not raw spread),
//  using a margin-centric multiplier (Boss G2.16 Option B).
//
//  THE GATE: fee-floor margin = typicalDislocationBps - realisticBreakevenBps
//  Everything else only MODULATES confidence. Negative margin → score 0.
//
//  MODES (Boss G2.16 ruling 4 + 5)
//  ───────────────────────────────
//  FULL    breakeven available (config or computed) → surfaceScore
//  PREVIEW breakeven missing                        → previewScore, NEEDS_TELEMETRY
//          PREVIEW can never outrank FULL, never promotion-ready.
//
//  DESIGN RULES (Boss G2.16)
//  ─────────────────────────
//  - READ-ONLY. No execution, no arming, no contracts, no live gates.
//  - No candidate promotion. No candidate-fetch enablement (separate ruling).
//  - Report telemetry gaps explicitly (expose exactly what's missing).
//
//  FORMULA (Boss G2.16 ruling 3) — verbatim
//  ────────────────────────────────────────
//    marginBps = typicalDislocationBps - realisticBreakevenBps
//    marginScore:  <=0 →0.00 | 0-3 →0.25 | 3-6 →0.50 | 6-10 →0.75 | >10 →1.00
//                  (boundary handling: upper-bound inclusive)
//    qualityMultiplier =
//        executionRealism*0.30 + depth*0.15 + frequency*0.15
//      + persistence*0.15 + gasSensitivity*0.10 + regimeQuality*0.10
//      + competitionInv*0.05
//    surfaceScore = marginScore * qualityMultiplier * 100
//
//  BREAKEVEN SOURCE (Boss G2.16 ruling 4)
//  ──────────────────────────────────────
//    prefer config.realisticBreakevenBps      → breakevenSource:"config"
//    fallback: venue fees + Aave 5bps + gas + slip → breakevenSource:"computed"
//    none available                           → breakevenSource:"missing"
//                                               → mode=PREVIEW, confidence=LOW
//
//  USAGE
//  ─────
//    node scripts/tools/surface_score.js             # score all → print + write files
//    node scripts/tools/surface_score.js --json      # JSON to stdout
//    node scripts/tools/surface_score.js --self-test  # deterministic formula check
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── PATHS ──────────────────────────────────────────────────────────────────
const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACES_DIR   = path.join(REPO, 'surfaces');
const REGISTRY_FILE  = path.join(SURFACES_DIR, 'registry.json');
const METRICS_DIR    = path.join(REPO, 'logs', 'project_metrics');
const PORTFOLIO_JSON = path.join(METRICS_DIR, 'surface_portfolio_report.json');
const OUT_JSON       = path.join(METRICS_DIR, 'surface_score.json');
const OUT_TXT        = path.join(METRICS_DIR, 'surface_score.txt');

// ─── CONSTANTS (Boss G2.16 ruling 4 fallback components) ────────────────────
const AAVE_FLASH_FEE_BPS = 5;     // fixed flash-loan fee floor
const DEFAULT_GAS_BPS    = 1.8;   // rough gas burden (ETC baseline reference)
const DEFAULT_SLIP_BPS   = 4.3;   // configured blueprint slip (ETC baseline reference)

// Quality dimension weights (Boss G2.16 ruling 3). Sum = 1.00.
const QUALITY_WEIGHTS = Object.freeze({
  executionRealism : 0.30,
  depth            : 0.15,
  frequency        : 0.15,
  persistence      : 0.15,
  gasSensitivity   : 0.10,
  regimeQuality    : 0.10,
  competitionInv   : 0.05,
});

// ─── FORMULA ────────────────────────────────────────────────────────────────
// Boss G2.16 ruling 3. Upper-bound-inclusive bands.
function marginScore(marginBps) {
  if (marginBps == null || !isFinite(marginBps)) return 0.00;
  if (marginBps <= 0)  return 0.00;
  if (marginBps <= 3)  return 0.25;
  if (marginBps <= 6)  return 0.50;
  if (marginBps <= 10) return 0.75;
  return 1.00;
}

// qualityMultiplier — missing dims contribute 0 (honest: unmeasured != good).
function qualityMultiplier(dims) {
  let q = 0;
  for (const [k, w] of Object.entries(QUALITY_WEIGHTS)) {
    const v = dims[k];
    if (typeof v === 'number' && isFinite(v)) {
      q += Math.max(0, Math.min(1, v)) * w;
    }
  }
  return q;
}

// fraction of quality weight actually measured (telemetry completeness, 0..1)
function qualityCompleteness(dims) {
  let measured = 0;
  for (const [k, w] of Object.entries(QUALITY_WEIGHTS)) {
    const v = dims[k];
    if (typeof v === 'number' && isFinite(v)) measured += w;
  }
  return measured;
}

// ─── BREAKEVEN (Boss G2.16 ruling 4) ────────────────────────────────────────
function resolveBreakeven(cfg) {
  if (typeof cfg.realisticBreakevenBps === 'number' && isFinite(cfg.realisticBreakevenBps)) {
    return { bps: cfg.realisticBreakevenBps, source: 'config' };
  }
  // fallback: compute from venue fees + aave + gas + slip
  if (Array.isArray(cfg.venues) && cfg.venues.length >= 2) {
    const feeBpsSum = cfg.venues.reduce((s, v) => s + (Number(v.feeBps) || 0), 0);
    if (feeBpsSum > 0) {
      const bps = +(feeBpsSum + AAVE_FLASH_FEE_BPS + DEFAULT_GAS_BPS + DEFAULT_SLIP_BPS).toFixed(4);
      return { bps, source: 'computed' };
    }
  }
  return { bps: null, source: 'missing' };
}

// ─── DISLOCATION ────────────────────────────────────────────────────────────
// FULL scoring wants OBSERVED dislocation. Config preferred is an ASSUMPTION
// fallback (flagged), never silently treated as measured.
function resolveDislocation(cfg, tele) {
  if (tele && typeof tele.observedMedianSpreadBps === 'number' && isFinite(tele.observedMedianSpreadBps)) {
    return { bps: tele.observedMedianSpreadBps, source: 'observed' };
  }
  if (typeof cfg.preferredSpreadBps === 'number' && isFinite(cfg.preferredSpreadBps)) {
    return { bps: cfg.preferredSpreadBps, source: 'config' };
  }
  return { bps: null, source: 'missing' };
}

// ─── QUALITY DIMENSIONS ─────────────────────────────────────────────────────
// v1 sources: executionRealism from telemetry survivalRate, else config
// validated.v2AccuracyPct. All other dims require dedicated telemetry; absent →
// reported as gaps (Boss ruling 7: expose exactly what telemetry is missing).
function gatherQuality(cfg, tele) {
  const dims = {};
  const gaps = [];

  // executionRealism
  if (tele && typeof tele.survivalRate === 'number' && isFinite(tele.survivalRate)) {
    dims.executionRealism = tele.survivalRate;       // expected 0..1
  } else if (cfg.validated && typeof cfg.validated.v2AccuracyPct === 'number') {
    dims.executionRealism = cfg.validated.v2AccuracyPct / 100;
  } else {
    gaps.push('executionRealism');
  }

  // remaining dims: telemetry-only in v1
  for (const k of ['depth', 'frequency', 'persistence', 'gasSensitivity', 'regimeQuality', 'competitionInv']) {
    if (tele && typeof tele[k] === 'number' && isFinite(tele[k])) {
      dims[k] = tele[k];
    } else {
      gaps.push(k);
    }
  }
  return { dims, gaps };
}

// ─── SCORE ONE SURFACE ──────────────────────────────────────────────────────
function scoreOneSurface(cfg, tele) {
  const be  = resolveBreakeven(cfg);
  const dis = resolveDislocation(cfg, tele);
  const { dims, gaps } = gatherQuality(cfg, tele);

  const mode = (be.source === 'missing') ? 'PREVIEW' : 'FULL';

  let marginBps = null;
  let mScore = 0;
  if (be.bps != null && dis.bps != null) {
    marginBps = +(dis.bps - be.bps).toFixed(4);
    mScore = marginScore(marginBps);
  }

  const qMult     = qualityMultiplier(dims);
  const qComplete = qualityCompleteness(dims);
  const rawScore  = +(mScore * qMult * 100).toFixed(2);

  // confidence
  let confidence;
  if (mode === 'PREVIEW') {
    confidence = 'LOW';
  } else if (dis.source !== 'observed' || qComplete < 0.50) {
    confidence = 'LOW';     // breakeven known but dislocation assumed, or <half measured
  } else if (qComplete < 0.85) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'HIGH';
  }

  const result = {
    surfaceId           : cfg.surfaceId,
    displayName         : cfg.displayName || cfg.surfaceId,
    chain               : cfg.chain || null,
    promotionStatus     : cfg.promotionStatus || null,
    enabled             : cfg.enabled === true,
    mode,
    confidence,
    breakevenBps        : be.bps,
    breakevenSource     : be.source,
    typicalDislocationBps: dis.bps,
    dislocationSource   : dis.source,
    marginBps,
    marginScore         : mScore,
    quality             : dims,
    qualityMultiplier   : +qMult.toFixed(4),
    qualityCompleteness : +qComplete.toFixed(4),
    telemetryGaps       : gaps,
    promotionReady      : false,   // Boss G2.16: no promotion in this patch
  };

  if (mode === 'FULL') {
    result.surfaceScore = rawScore;
    result.previewScore = null;
  } else {
    result.surfaceScore  = null;    // PREVIEW gets NO surfaceScore (Boss ruling 5)
    result.previewScore  = rawScore;
    result.needsTelemetry = true;
  }
  return result;
}

// ─── RANKING (Boss ruling 5: PREVIEW can never outrank FULL) ─────────────────
function rankSurfaces(scored) {
  return scored.slice().sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === 'FULL' ? -1 : 1;
    const sa = a.mode === 'FULL' ? (a.surfaceScore ?? 0) : (a.previewScore ?? 0);
    const sb = b.mode === 'FULL' ? (b.surfaceScore ?? 0) : (b.previewScore ?? 0);
    if (sb !== sa) return sb - sa;
    return a.surfaceId.localeCompare(b.surfaceId);
  });
}

// ─── LOADERS (fail-soft) ─────────────────────────────────────────────────────
function loadAllSurfaceConfigs() {
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch (e) {
    return { configs: [], error: `cannot read registry.json: ${e.message}` };
  }
  const configs = [];
  for (const entry of (registry.surfaces || [])) {
    const file = entry.file || `${entry.surfaceId}.json`;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(SURFACES_DIR, file), 'utf8'));
      cfg.surfaceId       = cfg.surfaceId || entry.surfaceId;
      cfg.promotionStatus = cfg.promotionStatus || entry.promotionStatus || null;
      if (typeof cfg.enabled !== 'boolean') cfg.enabled = entry.enabled === true;
      configs.push(cfg);
    } catch { /* skip unreadable config */ }
  }
  return { configs, error: null };
}

function loadPortfolio() {
  try {
    if (!fs.existsSync(PORTFOLIO_JSON)) return null;
    return JSON.parse(fs.readFileSync(PORTFOLIO_JSON, 'utf8'));
  } catch { return null; }
}

function teleForSurface(portfolio, surfaceId) {
  if (!portfolio) return null;
  const arr = portfolio.surfaces || portfolio.entries || [];
  const row = Array.isArray(arr) ? arr.find(s => s && s.surfaceId === surfaceId) : null;
  if (!row) return null;
  const tele = {};
  if (typeof row.survivalRate === 'number') {
    tele.survivalRate = row.survivalRate > 1 ? row.survivalRate / 100 : row.survivalRate;
  }
  if (typeof row.observedMedianSpreadBps === 'number') tele.observedMedianSpreadBps = row.observedMedianSpreadBps;
  for (const k of ['depth', 'frequency', 'persistence', 'gasSensitivity', 'regimeQuality', 'competitionInv']) {
    if (typeof row[k] === 'number') tele[k] = row[k];
  }
  return Object.keys(tele).length ? tele : null;
}

// ─── REPORT PRINTER ──────────────────────────────────────────────────────────
function buildTextReport(ranked, meta) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push('  AllMight — Surface Score (Boss G2.16, margin-centric)  READ-ONLY');
  L.push(`  generatedAt: ${meta.generatedAt}`);
  L.push(`  surfaces: ${ranked.length}  |  portfolio telemetry: ${meta.portfolioFound ? 'present' : 'ABSENT'}`);
  L.push(bar);
  L.push('');

  for (const s of ranked) {
    const scoreLabel = s.mode === 'FULL'
      ? `surfaceScore ${s.surfaceScore}`
      : `previewScore ${s.previewScore} (NEEDS_TELEMETRY)`;
    L.push(`▸ ${s.displayName}  [${s.surfaceId}]`);
    L.push(`    mode: ${s.mode}   confidence: ${s.confidence}   ${scoreLabel}`);
    L.push(`    margin: ${s.marginBps == null ? 'n/a' : s.marginBps + ' bps'}` +
           `  (dislocation ${s.typicalDislocationBps == null ? 'n/a' : s.typicalDislocationBps} [${s.dislocationSource}]` +
           ` − breakeven ${s.breakevenBps == null ? 'n/a' : s.breakevenBps} [${s.breakevenSource}])`);
    L.push(`    marginScore: ${s.marginScore.toFixed(2)}   qualityMult: ${s.qualityMultiplier}` +
           `   qualityMeasured: ${(s.qualityCompleteness * 100).toFixed(0)}%`);
    if (s.telemetryGaps.length) {
      L.push(`    telemetry GAPS: ${s.telemetryGaps.join(', ')}`);
    } else {
      L.push(`    telemetry GAPS: none`);
    }
    L.push('');
  }

  L.push(bar);
  L.push('  NOTES');
  L.push('  - PREVIEW surfaces cannot outrank FULL and are never promotion-ready.');
  L.push('  - dislocationSource "config" = ASSUMED preferred spread, not measured.');
  L.push('  - No surface promoted. No execution. No contracts touched. (Boss G2.16)');
  L.push(bar);
  return L.join('\n');
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
function main() {
  const jsonMode = process.argv.includes('--json');
  const { configs, error } = loadAllSurfaceConfigs();

  if (error) {
    console.error(`[surface_score] ${error}`);
    process.exit(1);
  }
  if (!configs.length) {
    console.error('[surface_score] no surface configs found');
    process.exit(1);
  }

  const portfolio = loadPortfolio();
  const scored = configs.map(cfg => scoreOneSurface(cfg, teleForSurface(portfolio, cfg.surfaceId)));
  const ranked = rankSurfaces(scored);

  const meta = {
    generatedAt   : new Date().toISOString(),
    portfolioFound: !!portfolio,
    bossRuling    : 'G2.16',
    model         : 'margin-centric (Option B)',
  };

  const out = { meta, surfaces: ranked };

  if (jsonMode) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const txt = buildTextReport(ranked, meta);
  console.log(txt);

  // write artifacts (fail-soft)
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
    fs.writeFileSync(OUT_TXT, txt + '\n');
    console.log(`\n[surface_score] wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_TXT)}`);
  } catch (e) {
    console.error(`[surface_score] could not write artifacts: ${e.message}`);
  }
}

// ─── SELF-TEST (deterministic formula validation, Boss "B" pattern) ──────────
function selfTest() {
  const approx = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
  const cases = [];

  // marginScore bands
  cases.push(['marginScore(-2) = 0.00', marginScore(-2) === 0.00]);
  cases.push(['marginScore(0)  = 0.00', marginScore(0)  === 0.00]);
  cases.push(['marginScore(3)  = 0.25', marginScore(3)  === 0.25]);
  cases.push(['marginScore(4.6)= 0.50', marginScore(4.6)=== 0.50]);
  cases.push(['marginScore(6)  = 0.50', marginScore(6)  === 0.50]);
  cases.push(['marginScore(6.6)= 0.75', marginScore(6.6)=== 0.75]);
  cases.push(['marginScore(10) = 0.75', marginScore(10) === 0.75]);
  cases.push(['marginScore(12) = 1.00', marginScore(12) === 1.00]);

  // qualityMultiplier
  const allOne = { executionRealism:1, depth:1, frequency:1, persistence:1, gasSensitivity:1, regimeQuality:1, competitionInv:1 };
  cases.push(['qMult(all 1.0) = 1.00', approx(qualityMultiplier(allOne), 1.0)]);
  cases.push(['qMult(realism .813 only) = .2439', approx(qualityMultiplier({ executionRealism: 0.813 }), 0.2439)]);

  // composite
  cases.push(['0.75 * 1.0 * 100 = 75', approx(marginScore(8) * qualityMultiplier(allOne) * 100, 75)]);
  cases.push(['neg margin → 0 regardless of quality', approx(marginScore(-1) * qualityMultiplier(allOne) * 100, 0)]);

  // FULL synthetic surface
  const fullCfg = {
    surfaceId: 'test_full', displayName: 'Test Full', chain: 'arbitrum',
    realisticBreakevenBps: 17.4, preferredSpreadBps: 24,
    validated: { v2AccuracyPct: 81.3 }, venues: [{ feeBps: 1 }, { feeBps: 5 }],
  };
  const fullTele = {
    observedMedianSpreadBps: 24, survivalRate: 0.5,
    depth: 0.6, frequency: 0.5, persistence: 0.4,
    gasSensitivity: 0.7, regimeQuality: 0.5, competitionInv: 0.8,
  };
  const rFull = scoreOneSurface(fullCfg, fullTele);
  cases.push(['FULL: mode FULL', rFull.mode === 'FULL']);
  cases.push(['FULL: breakevenSource config', rFull.breakevenSource === 'config']);
  cases.push(['FULL: dislocationSource observed', rFull.dislocationSource === 'observed']);
  cases.push(['FULL: marginBps = 6.6', approx(rFull.marginBps, 6.6)]);
  cases.push(['FULL: marginScore 0.75', rFull.marginScore === 0.75]);
  // qMult = .5*.3+.6*.15+.5*.15+.4*.15+.7*.1+.5*.1+.8*.05 = .535
  cases.push(['FULL: qMult = 0.535', approx(rFull.qualityMultiplier, 0.535)]);
  // score = 0.75 * 0.535 * 100 = 40.125
  cases.push(['FULL: surfaceScore ≈ 40.13', approx(rFull.surfaceScore, 40.125, 0.02)]);
  cases.push(['FULL: previewScore null', rFull.previewScore === null]);
  cases.push(['FULL: not promotionReady', rFull.promotionReady === false]);

  // FULL with config-only dislocation (no observed) → confidence LOW
  const rFullCfgDisl = scoreOneSurface(fullCfg, { survivalRate: 0.9 });
  cases.push(['FULL cfg-dislocation: dislocationSource config', rFullCfgDisl.dislocationSource === 'config']);
  cases.push(['FULL cfg-dislocation: confidence LOW', rFullCfgDisl.confidence === 'LOW']);
  cases.push(['FULL cfg-dislocation: 6 telemetry gaps', rFullCfgDisl.telemetryGaps.length === 6]);

  // PREVIEW synthetic surface (no breakeven, empty venues)
  const previewCfg = {
    surfaceId: 'test_preview', displayName: 'Test Preview', chain: 'arbitrum',
    preferredSpreadBps: 15, venues: [], validated: {},
  };
  const rPrev = scoreOneSurface(previewCfg, null);
  cases.push(['PREVIEW: mode PREVIEW', rPrev.mode === 'PREVIEW']);
  cases.push(['PREVIEW: breakevenSource missing', rPrev.breakevenSource === 'missing']);
  cases.push(['PREVIEW: surfaceScore null', rPrev.surfaceScore === null]);
  cases.push(['PREVIEW: has previewScore', typeof rPrev.previewScore === 'number']);
  cases.push(['PREVIEW: needsTelemetry true', rPrev.needsTelemetry === true]);
  cases.push(['PREVIEW: confidence LOW', rPrev.confidence === 'LOW']);
  cases.push(['PREVIEW: not promotionReady', rPrev.promotionReady === false]);

  // computed breakeven fallback (venues present, no realisticBreakevenBps)
  const compCfg = {
    surfaceId: 'test_comp', displayName: 'Test Computed', chain: 'arbitrum',
    preferredSpreadBps: 30, venues: [{ feeBps: 1 }, { feeBps: 5 }], validated: {},
  };
  const rComp = scoreOneSurface(compCfg, { observedMedianSpreadBps: 30, survivalRate: 1,
    depth:1, frequency:1, persistence:1, gasSensitivity:1, regimeQuality:1, competitionInv:1 });
  cases.push(['COMPUTED: breakevenSource computed', rComp.breakevenSource === 'computed']);
  // breakeven = 1+5 + 5 + 1.8 + 4.3 = 17.1 ; margin = 30 - 17.1 = 12.9 → 1.00
  cases.push(['COMPUTED: breakevenBps = 17.1', approx(rComp.breakevenBps, 17.1)]);
  cases.push(['COMPUTED: marginBps = 12.9', approx(rComp.marginBps, 12.9)]);
  cases.push(['COMPUTED: marginScore 1.00', rComp.marginScore === 1.00]);
  cases.push(['COMPUTED: mode FULL', rComp.mode === 'FULL']);

  // ranking: PREVIEW never outranks FULL even with higher raw number
  const highPrev = scoreOneSurface(
    { surfaceId: 'hp', displayName: 'High Preview', preferredSpreadBps: 99, venues: [], validated: {} },
    { observedMedianSpreadBps: 99 });
  const lowFull = scoreOneSurface(
    { surfaceId: 'lf', displayName: 'Low Full', realisticBreakevenBps: 17, preferredSpreadBps: 18, venues:[{feeBps:1},{feeBps:5}], validated: { v2AccuracyPct: 50 } },
    null);
  const ranked = rankSurfaces([highPrev, lowFull]);
  cases.push(['RANK: FULL above PREVIEW regardless of raw score', ranked[0].mode === 'FULL']);

  // print
  let pass = 0;
  console.log('── surface_score.js SELF-TEST (Boss G2.16 formula) ──\n');
  for (const [label, ok] of cases) {
    console.log(`  ${ok ? '✅' : '❌'}  ${label}`);
    if (ok) pass++;
  }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
