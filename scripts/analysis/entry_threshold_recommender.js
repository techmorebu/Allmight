'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Entry Threshold Recommender  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT: scripts/analysis/entry_threshold_recommender.js
//  STATUS:    NEW — Boss directive 2026-04-05 (entry optimization layer)
//
//  WHAT IT DOES
//  ─────────────
//  Reads raw activator JSONL (NOT the window_analysis output).
//  Reconstructs candidate entry points per window, then grid-searches
//  combinations of:
//    minStableSamples   — how many consecutive armed samples before entry
//    maxSpreadStdDev    — max spread variance to allow (stability gate)
//    minEntrySpread     — minimum spread to even consider
//    phaseMin/phaseMax  — allowed phase position in window
//    minDepthUsd        — minimum depth at entry
//  Scores each combination using Boss-approved objective:
//    score = 0.45 * precision_viable
//          + 0.25 * recall_viable
//          + 0.20 * mean_finalEdge_selected
//          - 0.10 * false_positive_rate
//  Emits TOP-10 configs, plus one CONSERVATIVE and one AGGRESSIVE profile.
//
//  USAGE
//  ─────
//  node scripts/analysis/entry_threshold_recommender.js \
//    --log=logs/activator_eth_usdc_ramses.jsonl \
//    [--out=logs/entry_thresholds.json] \
//    [--verbose]
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i+1]) return process.argv[i+1];
  const eq = process.argv.find(a => a.startsWith(flag+'='));
  return eq ? eq.split('=').slice(1).join('=') : def;
}

const LOG_PATH = argVal('--log', null);
const OUT_PATH = argVal('--out', null);
const VERBOSE  = process.argv.includes('--verbose');

if (!LOG_PATH) {
  console.error('Usage: node entry_threshold_recommender.js --log=<activator.jsonl> [--out=<out.json>]');
  process.exit(1);
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────

function loadJsonl(p) {
  const rows = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (t) { try { rows.push(JSON.parse(t)); } catch (_) {} }
  }
  return rows;
}

function nowIso() { return new Date().toISOString(); }
function tsMs(r)  { const t = r.ts||r.timestamp; return t ? new Date(t).getTime() : null; }
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.map(x=>(x-m)**2).reduce((a,b)=>a+b,0)/arr.length);
}

// ─── CLASSIFY SIGNAL ─────────────────────────────────────────────────────────

function classifySignal(r) {
  // GOOD = economically_viable
  // MID  = economically_marginal
  // BAD  = dust_positive, unknown, SIMULATION_LOST
  const eco = r.economicStatus;
  if (eco === 'economically_viable')   return 'GOOD';
  if (eco === 'economically_marginal') return 'MID';
  return 'BAD';
}

// ─── BUILD CANDIDATE ENTRY POINTS ─────────────────────────────────────────────
// For each simulation signal, build a feature vector representing the
// conditions at that point in the window.

function buildCandidates(rows) {
  // Group sim signals by windowKey (restart-safe) or fall back to windowId
  const transitions = rows.filter(r => r.type === 'state_transition');
  const armEvents   = transitions.filter(r => r.to === 'ARMED');
  const closeEvents = transitions.filter(r => r.from === 'ARMED' && r.to === 'PASSIVE');

  // Build window registry keyed by windowKey or windowId
  const windowRegistry = new Map();  // windowKey/id → {startMs, endMs, durationMs}
  for (const arm of armEvents) {
    const key = arm.windowKey || `id:${arm.windowId}`;
    const close = closeEvents.find(c =>
      (arm.windowKey && c.windowKey === arm.windowKey) ||
      (!arm.windowKey && c.windowId === arm.windowId)
    );
    const startMs = tsMs(arm);
    const endMs   = close ? tsMs(close) : null;
    const durMs   = endMs && startMs ? endMs - startMs : close?.windowDurationMs ?? null;
    windowRegistry.set(key, { startMs, endMs, durMs, arm });
  }

  // Get all simulation signals
  const simRows = rows.filter(r =>
    ['EXECUTION_READY','SIMULATION_LOST','SIMULATION_MARGINAL'].includes(r.signal)
  );

  // For each sim signal, compute feature vector
  const candidates = [];
  let prevByWindow = new Map();  // key → [prior spread values in window]

  for (const r of simRows.sort((a,b) => tsMs(a)-tsMs(b))) {
    const key = r.windowKey || `id:${r.windowId}`;
    const win = windowRegistry.get(key);

    const spread = r.spread ?? 0;         // spread already in pct form
    const depth  = r.uniDepth ?? 0;
    const rtsMs  = tsMs(r);

    // Phase position in window (0=start, 1=end)
    let phasePos = null;
    if (win?.startMs && win?.durMs && win.durMs > 0) {
      phasePos = Math.min(1, Math.max(0, (rtsMs - win.startMs) / win.durMs));
    }

    // Spread history for this window
    if (!prevByWindow.has(key)) prevByWindow.set(key, []);
    const hist = prevByWindow.get(key);
    hist.push(spread);

    // Feature vector
    const samplesInWindow    = hist.length;
    const spreadMeanLastN    = avg(hist.slice(-6)) ?? spread;
    const spreadStdLastN     = stddev(hist.slice(-6));
    const spreadRelToMean    = spreadMeanLastN > 0 ? spread / spreadMeanLastN : 1;
    const finalEdge          = r.finalEdge ?? null;
    const classification     = classifySignal(r);

    candidates.push({
      key, spread, depth, phasePos, samplesInWindow,
      spreadMeanLastN, spreadStdLastN, spreadRelToMean,
      finalEdge, classification,
      signal: r.signal,
    });
  }

  console.log(`[recommender] Built ${candidates.length} candidate entry points from ${simRows.length} sim signals`);
  console.log(`[recommender] Window registry: ${windowRegistry.size} windows`);

  // Baseline distribution
  const dist = { GOOD: 0, MID: 0, BAD: 0 };
  for (const c of candidates) dist[c.classification]++;
  console.log(`[recommender] Baseline: GOOD=${dist.GOOD} (${(100*dist.GOOD/candidates.length).toFixed(1)}%)  MID=${dist.MID} (${(100*dist.MID/candidates.length).toFixed(1)}%)  BAD=${dist.BAD} (${(100*dist.BAD/candidates.length).toFixed(1)}%)`);

  return { candidates, totalGood: dist.GOOD, totalMid: dist.MID, totalBad: dist.BAD };
}

// ─── GRID SEARCH ─────────────────────────────────────────────────────────────

function gridSearch(candidates, totalGood, totalBad) {
  // Grid dimensions (Boss-specified ranges)
  const minStableSamplesGrid = [2, 3, 4, 5, 6, 8];
  const maxSpreadStdGrid     = [0.002, 0.004, 0.006, 0.008, 0.010, 0.015];  // pct
  const minEntrySpreadGrid   = [0.07, 0.08, 0.09, 0.10, 0.11, 0.12, 0.13]; // pct
  const phaseMinGrid         = [0.0, 0.1, 0.2, 0.3, 0.4];
  const phaseMaxGrid         = [0.6, 0.7, 0.8, 1.0];
  const minDepthGrid         = [0, 100_000, 150_000, 175_000, 200_000];

  const results = [];
  let searched = 0;
  const total = minStableSamplesGrid.length * maxSpreadStdGrid.length *
                minEntrySpreadGrid.length * phaseMinGrid.length *
                phaseMaxGrid.length * minDepthGrid.length;
  console.log(`[recommender] Grid size: ${total.toLocaleString()} combinations...`);

  for (const minSamples  of minStableSamplesGrid)
  for (const maxStd      of maxSpreadStdGrid)
  for (const minSpread   of minEntrySpreadGrid)
  for (const phaseMin    of phaseMinGrid)
  for (const phaseMax    of phaseMaxGrid)
  for (const minDepth    of minDepthGrid) {
    if (phaseMin >= phaseMax) continue;

    searched++;

    // Apply filter to candidates
    const selected = candidates.filter(c =>
      c.samplesInWindow >= minSamples &&
      c.spreadStdLastN  <= maxStd     &&
      c.spread          >= minSpread   &&
      (c.phasePos == null || (c.phasePos >= phaseMin && c.phasePos <= phaseMax)) &&
      c.depth           >= minDepth
    );

    if (selected.length < 5) continue;  // too few — skip

    const good = selected.filter(c => c.classification === 'GOOD').length;
    const mid  = selected.filter(c => c.classification === 'MID').length;
    const bad  = selected.filter(c => c.classification === 'BAD').length;
    const n    = selected.length;

    const precision = good / n;
    const recall    = totalGood > 0 ? good / totalGood : 0;
    const fpRate    = totalBad  > 0 ? bad  / totalBad  : 0;

    const edges = selected.map(c => c.finalEdge).filter(e => e != null && e > 0);
    const meanEdge = edges.length > 0 ? avg(edges) : 0;

    // Boss scoring formula
    const score = (0.45 * precision) +
                  (0.25 * recall)    +
                  (0.20 * meanEdge * 100) +  // scale edge to 0–1 range (typical 0–0.05)
                  (-0.10 * fpRate);

    results.push({
      minStableSamples: minSamples,
      maxSpreadStdDevPct: maxStd,
      minEntrySpreadPct: minSpread,
      phaseMin, phaseMax,
      minDepthUsd: minDepth,
      selectedSignals: n,
      goodCount: good, midCount: mid, badCount: bad,
      precision: +precision.toFixed(4),
      recall:    +recall.toFixed(4),
      fpRate:    +fpRate.toFixed(4),
      meanFinalEdgePct: meanEdge ? +(meanEdge*100).toFixed(4) : 0,
      score: +score.toFixed(6),
      coveragePct: +(n / candidates.length * 100).toFixed(1),
    });
  }

  results.sort((a,b) => b.score - a.score);
  console.log(`[recommender] Searched ${searched.toLocaleString()} valid combos → ${results.length} scored`);
  return results;
}

// ─── FORMAT PROFILE ───────────────────────────────────────────────────────────

function formatProfile(cfg, candidates, label) {
  const selected = candidates.filter(c =>
    c.samplesInWindow >= cfg.minStableSamples &&
    c.spreadStdLastN  <= cfg.maxSpreadStdDevPct &&
    c.spread          >= cfg.minEntrySpreadPct  &&
    (c.phasePos == null || (c.phasePos >= cfg.phaseMin && c.phasePos <= cfg.phaseMax)) &&
    c.depth           >= cfg.minDepthUsd
  );

  const good = selected.filter(c => c.classification === 'GOOD').length;
  const mid  = selected.filter(c => c.classification === 'MID').length;
  const bad  = selected.filter(c => c.classification === 'BAD').length;
  const edges = selected.map(c => c.finalEdge).filter(e => e != null && e > 0);

  return {
    label,
    recommended: {
      minStableSamples:    cfg.minStableSamples,
      maxSpreadStdDevPct:  cfg.maxSpreadStdDevPct,
      minEntrySpreadPct:   cfg.minEntrySpreadPct,
      phaseMin:            cfg.phaseMin,
      phaseMax:            cfg.phaseMax,
      minDepthUsd:         cfg.minDepthUsd,
    },
    backtest: {
      selectedSignals:          selected.length,
      economicallyViablePct:    +(100*good/Math.max(selected.length,1)).toFixed(1),
      economicallyMarginalPct:  +(100*mid /Math.max(selected.length,1)).toFixed(1),
      dustOrNegativePct:        +(100*bad /Math.max(selected.length,1)).toFixed(1),
      meanFinalEdgePct:         edges.length ? +(avg(edges)*100).toFixed(4) : 0,
      coveragePct:              +(100*selected.length/Math.max(candidates.length,1)).toFixed(1),
      score:                    cfg.score,
    },
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  const rows = loadJsonl(LOG_PATH);
  console.log(`[recommender] Loaded ${rows.length} records from ${path.basename(LOG_PATH)}`);

  const { candidates, totalGood, totalBad } = buildCandidates(rows);
  if (candidates.length === 0) {
    console.error('[recommender] No candidate entry points found. Check log format.');
    process.exit(1);
  }

  const ranked = gridSearch(candidates, totalGood, totalBad);
  if (ranked.length === 0) {
    console.error('[recommender] No scored configurations found (too few signals per filter?).');
    process.exit(1);
  }

  const top10 = ranked.slice(0, 10);

  // Conservative = highest precision from top quartile
  const topQ = ranked.slice(0, Math.max(1, Math.floor(ranked.length * 0.1)));
  const conservative = topQ.sort((a,b) => b.precision - a.precision)[0];

  // Aggressive = highest recall from top half (most signals while still scoring well)
  const topH = ranked.slice(0, Math.max(1, Math.floor(ranked.length * 0.25)));
  const aggressive = topH.sort((a,b) => b.recall - a.recall)[0];

  // Restore sort for output
  ranked.sort((a,b) => b.score - a.score);

  const W = 78;
  console.log('\n' + '═'.repeat(W));
  console.log('  AllMight — Entry Threshold Recommender  v1.0');
  console.log(`  Source: ${path.basename(LOG_PATH)}  |  ${nowIso()}`);
  console.log('═'.repeat(W));

  console.log(`\n  BASELINE (no filter): ${candidates.length} signals`);
  const bGood = candidates.filter(c=>c.classification==='GOOD').length;
  const bMid  = candidates.filter(c=>c.classification==='MID').length;
  const bBad  = candidates.filter(c=>c.classification==='BAD').length;
  console.log(`    GOOD=${bGood} (${(100*bGood/candidates.length).toFixed(1)}%)  MID=${bMid} (${(100*bMid/candidates.length).toFixed(1)}%)  BAD=${bBad} (${(100*bBad/candidates.length).toFixed(1)}%)`);

  console.log(`\n  TOP 10 CONFIGURATIONS`);
  console.log('  ' + '─'.repeat(W-2));
  console.log(`  ${'#'.padStart(3)}  ${'score'.padStart(8)}  ${'sel'.padStart(5)}  ${'good%'.padStart(6)}  ${'recall'.padStart(7)}  ${'edge'.padStart(7)}  ${'cov%'.padStart(5)}  thresholds`);
  for (let i = 0; i < top10.length; i++) {
    const c = top10[i];
    const thresh = `samp≥${c.minStableSamples} std≤${c.maxSpreadStdDevPct} sprd≥${c.minEntrySpreadPct}% ph[${c.phaseMin}-${c.phaseMax}] dep≥${(c.minDepthUsd/1000).toFixed(0)}k`;
    console.log(
      `  ${String(i+1).padStart(3)}  ${c.score.toFixed(5).padStart(8)}  ${String(c.selectedSignals).padStart(5)}  ` +
      `${(100*c.precision).toFixed(1).padStart(5)}%  ${(100*c.recall).toFixed(1).padStart(6)}%  ` +
      `${c.meanFinalEdgePct.toFixed(4).padStart(7)}  ${c.coveragePct.toFixed(0).padStart(4)}%  ${thresh}`
    );
  }

  const consProfile = formatProfile(conservative, candidates, 'CONSERVATIVE');
  const aggrProfile = formatProfile(aggressive,   candidates, 'AGGRESSIVE');

  console.log(`\n  RECOMMENDED PROFILES`);
  console.log('  ' + '─'.repeat(W-2));
  for (const p of [consProfile, aggrProfile]) {
    console.log(`\n  [${p.label}]`);
    console.log(`    minStableSamples:   ${p.recommended.minStableSamples}`);
    console.log(`    maxSpreadStdDevPct: ${p.recommended.maxSpreadStdDevPct}%`);
    console.log(`    minEntrySpreadPct:  ${p.recommended.minEntrySpreadPct}%`);
    console.log(`    phaseWindow:        ${p.recommended.phaseMin} – ${p.recommended.phaseMax}`);
    console.log(`    minDepthUsd:        $${p.recommended.minDepthUsd.toLocaleString()}`);
    console.log(`    → selected:         ${p.backtest.selectedSignals} signals (${p.backtest.coveragePct}% of baseline)`);
    console.log(`    → viable%:          ${p.backtest.economicallyViablePct}%`);
    console.log(`    → marginal%:        ${p.backtest.economicallyMarginalPct}%`);
    console.log(`    → dust/neg%:        ${p.backtest.dustOrNegativePct}%`);
    console.log(`    → mean edge:        ${p.backtest.meanFinalEdgePct}%`);
    console.log(`    → score:            ${p.backtest.score}`);
  }

  console.log('\n  ⚡ ACTIVATOR CONFIG PATCH');
  console.log('  ' + '─'.repeat(W-2));
  const rec = consProfile.recommended;
  console.log(`  Apply to arb_window_activator.js STABILITY constants:`);
  console.log(`    const STABILITY_MIN_SAMPLES = ${rec.minStableSamples};`);
  console.log(`    const STABILITY_MAX_STD     = ${rec.maxSpreadStdDevPct};  // pct`);
  console.log(`    // Emit sim only if spread >= ${rec.minEntrySpreadPct}%`);
  console.log(`    // Phase gate: ${rec.phaseMin} to ${rec.phaseMax} of window duration`);
  console.log(`    // Min depth:  $${rec.minDepthUsd.toLocaleString()}`);
  console.log(`  NOTE: Phase gate requires knowing window duration — use spread stability`);
  console.log(`        as a proxy (stable spread ≈ mid-window state)`);
  console.log('\n  ⚠  HUMAN APPROVAL REQUIRED before promoting to live config');
  console.log('     These are recommendations, not auto-applied changes.');
  console.log('\n' + '═'.repeat(W));

  // Output
  const output = {
    generatedAt:  nowIso(),
    source:       path.basename(LOG_PATH),
    baseline: {
      totalSignals: candidates.length, goodCount: bGood, midCount: bMid, badCount: bBad,
      baselineViablePct: +(100*bGood/candidates.length).toFixed(1),
    },
    top10: top10.map(c => ({
      recommended: {
        minStableSamples:   c.minStableSamples,
        maxSpreadStdDevPct: c.maxSpreadStdDevPct,
        minEntrySpreadPct:  c.minEntrySpreadPct,
        phaseMin:           c.phaseMin,
        phaseMax:           c.phaseMax,
        minDepthUsd:        c.minDepthUsd,
      },
      backtest: {
        selectedSignals:         c.selectedSignals,
        economicallyViablePct:   +(100*c.precision).toFixed(1),
        recall:                  +(100*c.recall).toFixed(1),
        dustOrNegativePct:       +(100*c.fpRate).toFixed(1),
        meanFinalEdgePct:        c.meanFinalEdgePct,
        coveragePct:             c.coveragePct,
        score:                   c.score,
      },
    })),
    conservative: consProfile,
    aggressive:   aggrProfile,
  };

  if (OUT_PATH) {
    fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), 'utf8');
    console.log(`  Output written: ${OUT_PATH}`);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

main();
