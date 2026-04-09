'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Heat Correlation Check  v1.0  (Wave 2 — Boss Step 2)
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/heat_correlation_check.js
//  STATUS    : NEW — Boss directive 2026-04-09
//
//  PURPOSE
//  ─────────
//  Answer the Boss's Step 2 question:
//
//    "Do heat spikes occur BEFORE execution windows, or only at the same time?"
//
//  This tool is ANALYSIS ONLY. No execution, no RPC, no state changes.
//
//  METHOD
//  ──────
//  1. Read activator JSONL log → extract EXECUTION_READY events (with ts)
//  2. Read heat timeseries JSONL log → build sorted heat history per surface
//  3. For each EXECUTION_READY signal:
//       - Find the surface's heat score at T-0, T-30s, T-60s, T-120s, T-300s
//       - Record when heatClass first reached HOT or EXTREME before the signal
//       - Compute lead time in seconds
//  4. Summarize:
//       - Median / mean lead time
//       - % of signals where heat was HOT/EXTREME before vs at vs after
//       - Per-surface breakdown
//       - Conclusion: LEADING / CONCURRENT / LAGGING / INSUFFICIENT_DATA
//
//  USAGE
//  ─────
//  node scripts/tools/heat_correlation_check.js \
//    --activator logs/activator_eth_usdc_ramses.jsonl \
//    --heat      logs/volatility_timeseries.jsonl
//
//  node scripts/tools/heat_correlation_check.js \
//    --activator logs/activator_eth_usdc_ramses.jsonl \
//    --heat      logs/volatility_timeseries.jsonl \
//    --json
//
//  node scripts/tools/heat_correlation_check.js \
//    --activator logs/activator_eth_usdc_ramses.jsonl \
//    --heat      logs/volatility_timeseries.jsonl \
//    --lookback 600   (look back up to 600s before each signal)
//
//  OUTPUT VERDICTS (per-surface + overall)
//  ────────────────────────────────────────
//  LEADING         heat spike precedes signal by > LEAD_MIN_SEC
//  CONCURRENT      heat spike within ± CONCURRENT_BAND_SEC of signal
//  LAGGING         heat spike arrives only after signal
//  NO_HEAT_SPIKE   heat never reached HOT/EXTREME near signal window
//  INSUFFICIENT_DATA  fewer than MIN_SIGNALS_FOR_VERDICT signals found
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

// Window (seconds) to look back from each EXECUTION_READY for heat history
const DEFAULT_LOOKBACK_SEC = 300;

// Heat classes that count as a "spike" for correlation purposes
const HOT_CLASSES = new Set(['HOT', 'EXTREME']);

// Lead time thresholds (seconds)
const LEAD_MIN_SEC         = 15;   // heat must precede by > 15s to count as LEADING
const CONCURRENT_BAND_SEC  = 15;   // within ±15s = CONCURRENT

// Minimum EXECUTION_READY signals needed to issue a meaningful verdict
const MIN_SIGNALS_FOR_VERDICT = 3;

// Lookback checkpoints (seconds before signal) for the snapshot table
const LOOKBACK_CHECKPOINTS = [300, 120, 60, 30, 0];

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);

function argVal(flag, def) {
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i  = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const ACTIVATOR_LOG  = argVal('--activator', null);
const HEAT_LOG       = argVal('--heat',      null);
const LOOKBACK_SEC   = Number(argVal('--lookback', String(DEFAULT_LOOKBACK_SEC)));
const FLAG_JSON      = ARGS.includes('--json');
const FLAG_VERBOSE   = ARGS.includes('--verbose');

// ─── LOG READERS ──────────────────────────────────────────────────────────────

/**
 * Parse a JSONL file. Non-parseable lines are silently skipped.
 * Returns array sorted by ts ASC.
 * @param {string} filePath
 * @param {string} typeFilter  Optional record type filter.
 * @returns {object[]}
 */
function readJsonl(filePath, typeFilter) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const out   = [];
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (typeFilter && r.type !== typeFilter) continue;
      if (r.ts) out.push(r);
    } catch (_) {}
  }
  out.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return out;
}

/**
 * Extract EXECUTION_READY signals from activator log.
 * Returns array of { ts, tsMs, surfaceId, pair, spread, bestSize, finalEdge, regime }.
 * Derives a surface identifier from the pair field (activator uses --pair, not surfaceId).
 *
 * @param {string} logPath
 * @returns {object[]}
 */
function extractExecutionReadySignals(logPath) {
  const records = readJsonl(logPath);
  const signals = [];

  for (const r of records) {
    if (r.signal !== 'EXECUTION_READY') continue;
    const tsMs = new Date(r.ts).getTime();
    if (!isFinite(tsMs)) continue;

    signals.push({
      ts         : r.ts,
      tsMs,
      // Activator doesn't log a surfaceId but logs pair via LOG_PAIR
      pair       : r.pair || 'unknown',
      spread     : r.spread     ?? null,
      bestSize   : r.bestSize   ?? null,
      finalEdge  : r.finalEdge  ?? null,
      regime     : r.regime     ?? null,
      heatScore  : r.heatScore  ?? null,   // present if heat integration is active
      heatClass  : r.heatClass  ?? null,
    });
  }
  return signals;
}

/**
 * Build heat history from heat JSONL log.
 * Returns Map<pair, Array<{tsMs, heatScore, heatClass, heatRank, surfaceId}>>
 * sorted ASC by tsMs.
 *
 * Heat records contain a `surfaces` array. We flatten across surfaces,
 * keying by pair so we can match against activator signals.
 *
 * @param {string} logPath
 * @returns {Map<string, object[]>}
 */
function buildHeatHistory(logPath) {
  const records = readJsonl(logPath, 'heat_report');
  const byPair  = new Map();

  for (const rec of records) {
    const recTsMs = new Date(rec.ts).getTime();
    if (!isFinite(recTsMs)) continue;
    if (!Array.isArray(rec.surfaces)) continue;

    for (const s of rec.surfaces) {
      if (!s || !s.pair) continue;
      const pair = s.pair;

      if (!byPair.has(pair)) byPair.set(pair, []);
      byPair.get(pair).push({
        tsMs       : recTsMs,
        ts         : rec.ts,
        surfaceId  : s.surfaceId,
        heatScore  : s.heatScore  ?? null,
        heatClass  : s.heatClass  ?? 'UNKNOWN',
        heatRank   : s.heatRank   ?? null,
      });
    }
  }

  // Sort each array ASC by tsMs
  for (const arr of byPair.values()) {
    arr.sort((a, b) => a.tsMs - b.tsMs);
  }
  return byPair;
}

// ─── CORRELATION LOGIC ────────────────────────────────────────────────────────

/**
 * Binary search: find the last heat record at or before targetMs.
 * Returns the record, or null if none exists.
 *
 * @param {object[]} heatArr  Sorted ASC by tsMs.
 * @param {number}   targetMs
 * @returns {object|null}
 */
function heatAtOrBefore(heatArr, targetMs) {
  let lo = 0, hi = heatArr.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (heatArr[mid].tsMs <= targetMs) {
      best = heatArr[mid];
      lo   = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Find the earliest HOT/EXTREME record in the window [signalMs - lookbackMs, signalMs].
 * Returns { tsMs, leadSec, heatClass, heatScore } or null if no spike found.
 *
 * @param {object[]} heatArr  Sorted ASC by tsMs.
 * @param {number}   signalMs
 * @param {number}   lookbackMs
 * @returns {object|null}
 */
function findFirstSpikeBeforeSignal(heatArr, signalMs, lookbackMs) {
  const windowStart = signalMs - lookbackMs;
  for (const h of heatArr) {
    if (h.tsMs < windowStart) continue;
    if (h.tsMs > signalMs)   break;
    if (HOT_CLASSES.has(h.heatClass)) {
      return {
        tsMs      : h.tsMs,
        leadSec   : (signalMs - h.tsMs) / 1000,
        heatClass : h.heatClass,
        heatScore : h.heatScore,
      };
    }
  }
  return null;
}

/**
 * Classify correlation for a single signal.
 *
 * @param {object|null} firstSpike  Result from findFirstSpikeBeforeSignal.
 * @returns {string}  'LEADING' | 'CONCURRENT' | 'NO_HEAT_SPIKE'
 */
function classifyCorrelation(firstSpike) {
  if (!firstSpike)                                return 'NO_HEAT_SPIKE';
  if (firstSpike.leadSec > LEAD_MIN_SEC)          return 'LEADING';
  if (firstSpike.leadSec >= -CONCURRENT_BAND_SEC) return 'CONCURRENT';
  return 'LAGGING';
}

/**
 * Build the checkpoint snapshot table for one signal.
 * Shows heat score at T-300s, T-120s, T-60s, T-30s, T-0s before the signal.
 *
 * @param {object[]} heatArr
 * @param {number}   signalMs
 * @returns {object[]}  Array of {offsetSec, heatScore, heatClass}
 */
function buildCheckpointTable(heatArr, signalMs) {
  return LOOKBACK_CHECKPOINTS.map(offsetSec => {
    const targetMs = signalMs - offsetSec * 1000;
    const h        = heatAtOrBefore(heatArr, targetMs);
    return {
      offsetSec,
      heatScore : h?.heatScore ?? null,
      heatClass : h?.heatClass ?? 'NO_DATA',
    };
  });
}

// ─── ANALYSIS ENGINE ──────────────────────────────────────────────────────────

/**
 * Run full correlation analysis.
 *
 * @param {object[]}              signals   EXECUTION_READY events.
 * @param {Map<string, object[]>} heatHistory  Per-pair heat records.
 * @returns {object}  Full analysis result.
 */
function analyzeCorrelation(signals, heatHistory) {
  const results    = [];
  const perPair    = new Map();
  const lookbackMs = LOOKBACK_SEC * 1000;

  for (const sig of signals) {
    // Find heat history for this signal's pair — try exact match first, then base pair
    const basePair = sig.pair.split('-')[0];
    let heatArr    = heatHistory.get(sig.pair) || heatHistory.get(basePair) || [];

    // Also try matching any key that starts with basePair
    if (!heatArr.length) {
      for (const [key, arr] of heatHistory) {
        if (key.startsWith(basePair)) { heatArr = arr; break; }
      }
    }

    const firstSpike  = findFirstSpikeBeforeSignal(heatArr, sig.tsMs, lookbackMs);
    const correlation = classifyCorrelation(firstSpike);
    const checkpoints = buildCheckpointTable(heatArr, sig.tsMs);
    const heatAtSignal = heatAtOrBefore(heatArr, sig.tsMs);

    const result = {
      ts          : sig.ts,
      pair        : sig.pair,
      spread      : sig.spread,
      finalEdge   : sig.finalEdge,
      regime      : sig.regime,
      heatAtSignal: heatAtSignal ? {
        heatScore : heatAtSignal.heatScore,
        heatClass : heatAtSignal.heatClass,
        ageSec    : +(( sig.tsMs - heatAtSignal.tsMs) / 1000).toFixed(1),
      } : null,
      firstSpike,
      correlation,
      checkpoints,
    };
    results.push(result);

    // Accumulate per-pair stats
    if (!perPair.has(sig.pair)) perPair.set(sig.pair, { signals: 0, leading: 0, concurrent: 0, lagging: 0, noSpike: 0, leadTimes: [] });
    const ps = perPair.get(sig.pair);
    ps.signals++;
    if (correlation === 'LEADING')        { ps.leading++;    ps.leadTimes.push(firstSpike.leadSec); }
    else if (correlation === 'CONCURRENT') ps.concurrent++;
    else if (correlation === 'LAGGING')   ps.lagging++;
    else                                   ps.noSpike++;
  }

  // Overall stats
  const totalSignals  = results.length;
  const leading       = results.filter(r => r.correlation === 'LEADING').length;
  const concurrent    = results.filter(r => r.correlation === 'CONCURRENT').length;
  const lagging       = results.filter(r => r.correlation === 'LAGGING').length;
  const noSpike       = results.filter(r => r.correlation === 'NO_HEAT_SPIKE').length;
  const allLeadTimes  = results.filter(r => r.firstSpike).map(r => r.firstSpike.leadSec).sort((a,b)=>a-b);
  const medianLead    = allLeadTimes.length ? allLeadTimes[Math.floor(allLeadTimes.length / 2)] : null;
  const meanLead      = allLeadTimes.length ? allLeadTimes.reduce((a,b)=>a+b,0) / allLeadTimes.length : null;

  // Overall verdict
  let overallVerdict;
  if (totalSignals < MIN_SIGNALS_FOR_VERDICT) {
    overallVerdict = 'INSUFFICIENT_DATA';
  } else {
    const leadingPct = leading / totalSignals;
    if (leadingPct >= 0.50)      overallVerdict = 'LEADING';
    else if (leadingPct >= 0.25) overallVerdict = 'MIXED_LEADING';
    else if (concurrent / totalSignals >= 0.40) overallVerdict = 'CONCURRENT';
    else                         overallVerdict = 'NO_HEAT_SPIKE';
  }

  // Per-pair verdicts
  const pairSummaries = [];
  for (const [pair, ps] of perPair) {
    let verdict;
    if (ps.signals < MIN_SIGNALS_FOR_VERDICT) verdict = 'INSUFFICIENT_DATA';
    else if (ps.leading / ps.signals >= 0.50) verdict = 'LEADING';
    else if (ps.leading / ps.signals >= 0.25) verdict = 'MIXED_LEADING';
    else if (ps.concurrent / ps.signals >= 0.40) verdict = 'CONCURRENT';
    else verdict = 'NO_HEAT_SPIKE';

    const leads = ps.leadTimes.slice().sort((a,b)=>a-b);
    pairSummaries.push({
      pair,
      signals    : ps.signals,
      leading    : ps.leading,
      concurrent : ps.concurrent,
      noSpike    : ps.noSpike,
      leadingPct : +(ps.leading / ps.signals * 100).toFixed(1),
      medianLeadSec: leads.length ? +leads[Math.floor(leads.length/2)].toFixed(1) : null,
      verdict,
    });
  }

  return {
    ts            : new Date().toISOString(),
    activatorLog  : ACTIVATOR_LOG,
    heatLog       : HEAT_LOG,
    lookbackSec   : LOOKBACK_SEC,
    totalSignals,
    leading, concurrent, lagging, noSpike,
    leadingPct    : totalSignals ? +(leading / totalSignals * 100).toFixed(1) : 0,
    medianLeadSec : medianLead != null ? +medianLead.toFixed(1) : null,
    meanLeadSec   : meanLead   != null ? +meanLead.toFixed(1)   : null,
    overallVerdict,
    pairSummaries,
    signals       : results,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(analysis) {
  const W   = 110;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);
  const VERDICT_COLOR = {
    LEADING          : '\x1b[1;32m',
    MIXED_LEADING    : '\x1b[32m',
    CONCURRENT       : '\x1b[33m',
    NO_HEAT_SPIKE    : '\x1b[90m',
    INSUFFICIENT_DATA: '\x1b[90m',
  };
  const RESET = '\x1b[0m';

  console.log('\n' + EQ);
  console.log('  AllMight — Heat Correlation Check  v1.0  (Wave 2 Boss Step 2)');
  console.log(`  ${analysis.ts}`);
  console.log(`  Activator : ${analysis.activatorLog}`);
  console.log(`  Heat log  : ${analysis.heatLog}`);
  console.log(`  Lookback  : ${analysis.lookbackSec}s  |  Signals: ${analysis.totalSignals}  |  Min for verdict: ${MIN_SIGNALS_FOR_VERDICT}`);
  console.log(EQ);

  // Overall verdict banner
  const vc  = VERDICT_COLOR[analysis.overallVerdict] || '';
  console.log(`\n  ${vc}OVERALL VERDICT: ${analysis.overallVerdict}${RESET}`);
  console.log(`  Leading=${analysis.leading} (${analysis.leadingPct}%)  Concurrent=${analysis.concurrent}  NoSpike=${analysis.noSpike}  Lagging=${analysis.lagging}`);
  if (analysis.medianLeadSec != null) console.log(`  Median lead time: ${analysis.medianLeadSec}s  |  Mean lead time: ${analysis.meanLeadSec}s`);

  // Per-pair table
  if (analysis.pairSummaries.length > 0) {
    console.log(`\n  ${'pair'.padEnd(24)}  ${'signals'.padStart(7)}  ${'leading%'.padStart(8)}  ${'medLead'.padStart(7)}  verdict`);
    console.log('  ' + DIV);
    for (const ps of analysis.pairSummaries) {
      const pvc = VERDICT_COLOR[ps.verdict] || '';
      console.log(
        `  ${ps.pair.padEnd(24)}  ${String(ps.signals).padStart(7)}  ` +
        `${String(ps.leadingPct + '%').padStart(8)}  ` +
        `${ps.medianLeadSec != null ? String(ps.medianLeadSec + 's').padStart(7) : '      ?'}  ` +
        pvc + ps.verdict + RESET
      );
    }
  }

  // Per-signal checkpoint table (verbose or always if few signals)
  if (FLAG_VERBOSE || analysis.totalSignals <= 20) {
    console.log(`\n  Signal-by-signal detail (checkpoint = heat at T-Ns before signal):`);
    console.log(`  ${'ts'.padEnd(26)}  ${'pair'.padEnd(18)}  ${'spread'.padStart(8)}  ${'edge'.padStart(7)}  T-300  T-120  T-60  T-30  T-0   correlation`);
    console.log('  ' + DIV);
    for (const r of analysis.signals) {
      const ckpts = r.checkpoints.map(c => (c.heatClass !== 'NO_DATA' ? (c.heatClass[0] || '?') : '-').padStart(5)).join(' ');
      const corrColor = r.correlation === 'LEADING' ? '\x1b[32m' : r.correlation === 'NO_HEAT_SPIKE' ? '\x1b[90m' : '';
      console.log(
        `  ${r.ts.padEnd(26)}  ${r.pair.padEnd(18)}  ` +
        `${(r.spread != null ? r.spread.toFixed(4)+'%' : '?').padStart(8)}  ` +
        `${(r.finalEdge != null ? r.finalEdge.toFixed(4)+'%' : '?').padStart(7)}  ` +
        `${ckpts}  ` +
        corrColor + r.correlation + RESET
      );
    }
    console.log('\n  Checkpoint key: C=COLD  W=WARM  H=HOT  E=EXTREME  -=NO_DATA');
  }

  // Interpretation guide
  console.log('\n' + EQ);
  console.log('  INTERPRETATION');
  console.log('  ' + DIV);
  console.log('  LEADING      → heat consistently spikes before execution windows — module is anticipatory ✓');
  console.log('  MIXED_LEADING → heat leads in >25% of cases — useful signal, worth tuning');
  console.log('  CONCURRENT   → heat and signal arrive together — useful for confirmation, not prediction');
  console.log('  NO_HEAT_SPIKE → heat not reaching HOT/EXTREME near signals — weights may need tuning');
  console.log('  INSUFFICIENT_DATA → collect more run data, then re-run');
  console.log('\n  Next action:');
  if (analysis.overallVerdict === 'LEADING' || analysis.overallVerdict === 'MIXED_LEADING') {
    console.log('  ✓ Heat is leading — proceed to validate on ETH/USDC-RAMSES (Boss Step 3)');
  } else if (analysis.overallVerdict === 'CONCURRENT') {
    console.log('  → Heat is concurrent — useful for confirmation, not pre-arming. Report to Boss before adjusting weights.');
  } else if (analysis.overallVerdict === 'INSUFFICIENT_DATA') {
    console.log('  → Run activator + heat monitor for at least one full surge session, then re-run this tool.');
  } else {
    console.log('  → Heat not spiking near signals. Check: is the heat log populated? Are pairs matching?');
    console.log('    Diagnostic: run with --verbose to see per-signal checkpoints.');
  }
  console.log('\n' + EQ + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (!ACTIVATOR_LOG || !HEAT_LOG) {
    console.error('[hcc] Usage:');
    console.error('  node scripts/tools/heat_correlation_check.js \\');
    console.error('    --activator logs/activator_eth_usdc_ramses.jsonl \\');
    console.error('    --heat      logs/volatility_timeseries.jsonl');
    process.exit(1);
  }

  if (!fs.existsSync(ACTIVATOR_LOG)) {
    console.error(`[hcc] Activator log not found: ${ACTIVATOR_LOG}`);
    process.exit(1);
  }
  if (!fs.existsSync(HEAT_LOG)) {
    console.error(`[hcc] Heat log not found: ${HEAT_LOG}`);
    console.error('       Run volatility_divergence_report.js --out <path> first.');
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write('[hcc] Reading logs...\n');

  const signals     = extractExecutionReadySignals(ACTIVATOR_LOG);
  const heatHistory = buildHeatHistory(HEAT_LOG);

  if (!FLAG_JSON) {
    process.stdout.write(`[hcc] Found ${signals.length} EXECUTION_READY signal(s)\n`);
    process.stdout.write(`[hcc] Heat log covers ${[...heatHistory.values()].reduce((a,b)=>a+b.length,0)} records across ${heatHistory.size} pair(s)\n`);
  }

  if (signals.length === 0) {
    if (!FLAG_JSON) {
      console.warn('[hcc] No EXECUTION_READY signals found in activator log.');
      console.warn('       Either the activator has not fired yet, or the log path is wrong.');
    } else {
      console.log(JSON.stringify({ overallVerdict: 'INSUFFICIENT_DATA', reason: 'no_signals', totalSignals: 0 }));
    }
    process.exit(0);
  }

  const analysis = analyzeCorrelation(signals, heatHistory);

  if (FLAG_JSON) {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    printReport(analysis);
  }
}

main();
