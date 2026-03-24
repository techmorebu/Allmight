'use strict';
/**
 * scripts/analysis/arb_session_analyzer.js
 *
 * Purpose:
 *   Turn completed monitoring logs into one authoritative session summary
 *   and verdict. Replaces manual forensic work after every session.
 *
 * Inputs (any subset works):
 *   --depth=./logs/depth_YYYYMMDD.jsonl       depth time-series log
 *   --events=./logs/liq_events_YYYYMMDD.jsonl  liquidity event log
 *   --activator=./logs/activator_YYYYMMDD.jsonl activator state log
 *   --glob="./logs/*.jsonl"                    auto-classify all files in dir
 *   --json                                     emit machine-readable JSON only
 *   --out=./logs/summary.json                  write JSON verdict to file
 *
 * Verdicts:
 *   NO_EXECUTABLE_WINDOWS      nothing interesting occurred
 *   DEPTH_MISSING              spread present, depth never reached usable tier
 *   SPREAD_MISSING             depth reached usable tier, no meaningful spread
 *   WINDOW_MISMATCH            both appeared, but not at the same time
 *   ARMED_ONLY                 price neared wall, full gate never passed
 *   EXECUTION_READY_OBSERVED   activator emitted EXECUTION_READY signal
 *
 * No chain calls. No execution logic. No Redis. Pure log analysis.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS (match activator/watcher definitions)
// ─────────────────────────────────────────────────────────────────────────────
const DEPTH_EXECUTION   = 15_000;  // confirmed_default: Boss-approved execution gate
const DEPTH_SUBCRITICAL =  5_000;  // confirmed_default: Boss-approved research band floor
const UNIV3_FEE_FRAC    = 0.0005;
const CAMELOT_FEE_FRAC  = 0.000249;
const FEE_BURDEN_PCT    = (UNIV3_FEE_FRAC + CAMELOT_FEE_FRAC) * 100;  // ~0.0749%
const TRIGGER_BUFFER    = 0.02;
const CHURN_RATIO_BAND  = 0.20;  // confirmed_default: mint:burn ratio within 20% of 1:1   // mint:burn ratio within 20% of 1:1 = suspected churn
const CHURN_MIN_EVENTS  = 10;    // confirmed_default: min events to classify as churn     // need at least 10 events to label churn

// ─────────────────────────────────────────────────────────────────────────────
// FILE CLASSIFIER
//   Sniffs the first record to determine which log type a file is
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// JSONL BASE ENVELOPE (Pass B1)
// ─────────────────────────────────────────────────────────────────────────────
const LOG_SOURCE = 'arb_session_analyzer';
const LOG_CHAIN  = 'arbitrum';
const LOG_PAIR   = 'ARB/USDC';

function classifyFile(filePath) {
  try {
    const firstLine = fs.readFileSync(filePath, 'utf8').split('\n').find(l => l.trim());
    if (!firstLine) return 'unknown';
    const r = JSON.parse(firstLine);
    // Activator: has 'type' field with tick_map_refresh / state_transition / EXECUTION_READY
    if (r.type === 'tick_map_refresh' || r.type === 'state_transition' ||
        r.signal === 'EXECUTION_READY' || r.type === 'STATE_UNHEALTHY' ||
        r.type === 'STATE_HEALTHY' || r.type === 'executable' ||
        r.type === 'armed_subcritical') return 'activator';
    // Events: has 'eventType' Mint/Burn
    if (r.eventType === 'Mint' || r.eventType === 'Burn') return 'events';
    // Depth: has 'depthTier' field
    if (r.depthTier !== undefined) return 'depth';
    return 'unknown';
  } catch { return 'unknown'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL READER — tolerant of blank lines and parse errors
// ─────────────────────────────────────────────────────────────────────────────
function readJsonl(filePath) {
  const records = [];
  const lines   = fs.readFileSync(filePath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    try { records.push(JSON.parse(t)); }
    catch { /* skip malformed */ }
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSERS — normalize each log type into a common tick array
// ─────────────────────────────────────────────────────────────────────────────

// Depth log → array of normalized ticks
function parseDepthLog(records) {
  return records
    .filter(r => r.ts && r.uniDepth !== undefined)
    .map(r => ({
      ts:        r.ts,
      block:     r.block ?? null,
      uniPrice:  r.uniPrice ?? null,
      camPrice:  r.camPrice ?? null,
      uniDepth:  r.uniDepth,
      spread:    r.spread ?? null,
      direction: r.direction ?? null,
      source:    'depth',
    }));
}

// Activator log → ticks + state events
function parseActivatorLog(records) {
  const ticks  = [];
  const states = [];
  const thresholdHistory = [];

  for (const r of records) {
    const type = r.type ?? r.signal;

    if (type === 'tick_map_refresh' && r.thresholds) {
      thresholdHistory.push({
        ts:               r.ts,
        armedPrice:       r.thresholds.armedPrice,
        nearestHighTick:  r.thresholds.nearestHighTick,
        nearestHighPrice: r.thresholds.nearestHighPrice,
        nearestHighDepth: r.thresholds.nearestHighDepth,
        currentPrice:     r.thresholds.currentPrice,
        currentTick:      r.thresholds.currentTick,
      });
    }

    if (type === 'state_transition') {
      states.push({
        ts:    r.ts,
        from:  r.from,
        to:    r.to,
        block: r.block ?? null,
        price: r.uniPrice ?? null,
      });
    }

    if (type === 'STATE_UNHEALTHY' || type === 'STATE_HEALTHY') {
      states.push({ ts: r.ts, from: null, to: type, reasons: r.reasons });
    }

    // Executable signals
    if (type === 'EXECUTION_READY' || type === 'SIMULATION_MARGINAL' ||
        type === 'SIMULATION_LOST' || type === 'executable') {
      ticks.push({
        ts:       r.ts,
        block:    r.block ?? null,
        uniPrice: r.uniPrice ?? null,
        camPrice: r.camPrice ?? null,
        uniDepth: r.uniDepth ?? null,
        spread:   r.spread ?? null,
        signal:   r.signal ?? type,
        source:   'activator',
      });
    }
  }

  return { ticks, states, thresholdHistory };
}

// Events log → LP event array
function parseEventsLog(records) {
  return records
    .filter(r => r.eventType === 'Mint' || r.eventType === 'Burn')
    .map(r => ({
      ts:         r.ts,
      block:      r.block ?? null,
      eventType:  r.eventType,
      owner:      r.owner ?? null,
      tickLower:  r.tickLower ?? null,
      tickUpper:  r.tickUpper ?? null,
      amount0:    r.amount0 ?? 0,
      amount1:    r.amount1 ?? 0,
      depthDelta: r.depthDelta ?? 0,
      depthAfter: r.depthAfter ?? null,
      classification: r.classification ?? null,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// STATISTICS HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function stats(arr) {
  if (!arr.length) return { min: null, max: null, avg: null, p90: null, p99: null };
  const sorted = [...arr].sort((a, b) => a - b);
  const sum    = arr.reduce((a, b) => a + b, 0);
  const pct    = (p) => sorted[Math.floor(sorted.length * p)] ?? sorted[sorted.length - 1];
  return {
    min: +sorted[0].toFixed(5),
    max: +sorted[sorted.length - 1].toFixed(5),
    avg: +(sum / arr.length).toFixed(5),
    p90: +pct(0.90).toFixed(5),
    p99: +pct(0.99).toFixed(5),
  };
}

function depthTierLabel(d) {
  if (d >= DEPTH_EXECUTION)   return 'execution';
  if (d >= DEPTH_SUBCRITICAL) return 'subcritical';
  return 'dead';
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER CHURN ANALYSIS
// ─────────────────────────────────────────────────────────────────────────────
function analyzeOwners(events) {
  const owners = {};
  for (const e of events) {
    if (!e.owner) continue;
    if (!owners[e.owner]) owners[e.owner] = { mints: 0, burns: 0, maxDepthDelta: 0 };
    const o = owners[e.owner];
    if (e.eventType === 'Mint') o.mints++;
    else                        o.burns++;
    if (e.depthDelta > o.maxDepthDelta) o.maxDepthDelta = e.depthDelta;
  }

  let churnCount    = 0;
  let maxDepthDelta = 0;
  for (const [, o] of Object.entries(owners)) {
    const total = o.mints + o.burns;
    const ratio = o.mints === 0 ? Infinity : Math.abs(1 - o.burns / o.mints);
    if (total >= CHURN_MIN_EVENTS && ratio <= CHURN_RATIO_BAND) churnCount++;
    if (o.maxDepthDelta > maxDepthDelta) maxDepthDelta = o.maxDepthDelta;
  }

  return {
    uniqueOwners:         Object.keys(owners).length,
    suspectedChurnOwners: churnCount,
    maxDepthDelta:        +maxDepthDelta.toFixed(2),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ALIGNMENT ANALYSIS
//   Given a set of ticks with price/depth/spread, count:
//   - spread_above_fee_only: spread > FEE_BURDEN_PCT
//   - spread_above_full_threshold: spread > FEE_BURDEN_PCT + slippage + buffer
//     (slippage approximated from depth if available, else 0)
//   - depth_and_spread_aligned: both execution depth AND full threshold together
// ─────────────────────────────────────────────────────────────────────────────
function computeAlignment(ticks) {
  let feeOnly = 0, fullThresh = 0, aligned = 0;

  for (const t of ticks) {
    if (t.spread === null || t.spread === undefined) continue;
    const depth = t.uniDepth ?? 0;
    const slip  = depth > 0 ? (25 / (2 * depth)) * 100 : 0;  // $25 reference size
    const full  = FEE_BURDEN_PCT + slip + TRIGGER_BUFFER;
    const isExecDepth = depth >= DEPTH_EXECUTION;

    if (t.spread > FEE_BURDEN_PCT)  feeOnly++;
    if (t.spread > full)            fullThresh++;
    if (t.spread > full && isExecDepth) aligned++;
  }

  return { spreadAboveFeeOnly: feeOnly, spreadAboveFullThreshold: fullThresh, depthAndSpreadAligned: aligned };
}

// ─────────────────────────────────────────────────────────────────────────────
// VERDICT ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function deriveVerdict(summary) {
  const { depth, spread, alignment, states, executableSignals } = summary;

  // Best outcome first
  if (executableSignals > 0)               return 'EXECUTION_READY_OBSERVED';
  if (states.armed > 0 && states.executableAttempts === 0) return 'ARMED_ONLY';
  if (alignment.depthAndSpreadAligned > 0) return 'WINDOW_MISMATCH'; // both occurred but gate didn't pass

  const hasUsableDepth  = (depth.executionTicks + depth.subcriticalTicks) > 0;
  const hasUsableSpread = alignment.spreadAboveFullThreshold > 0 || alignment.spreadAboveFeeOnly > 10;

  if (!hasUsableDepth && !hasUsableSpread) return 'NO_EXECUTABLE_WINDOWS';
  if (!hasUsableDepth && hasUsableSpread)  return 'DEPTH_MISSING';
  if (hasUsableDepth  && !hasUsableSpread) return 'SPREAD_MISSING';
  return 'NO_EXECUTABLE_WINDOWS';
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT HUMAN-READABLE SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
function printSummary(result, fileNames) {
  const LINE = '═'.repeat(90);
  const DIV  = '─'.repeat(90);
  const { timeRange, stateDistribution, price, depth, spread, alignment, events, states, verdict } = result;

  console.log('\n' + LINE);
  console.log('  ARB SESSION ANALYZER — SUMMARY');
  console.log(LINE);

  // Files
  console.log('\n  FILES ANALYZED:');
  for (const f of fileNames) console.log(`    ${f}`);

  // Time range
  console.log('\n  TIME RANGE:');
  console.log(`    ${timeRange.start ?? 'n/a'}  →  ${timeRange.end ?? 'n/a'}`);
  if (timeRange.durationH) console.log(`    Duration: ${timeRange.durationH}h`);

  // State distribution
  console.log('\n  STATE DISTRIBUTION:');
  for (const [s, pct] of Object.entries(stateDistribution)) {
    const bar = '█'.repeat(Math.round(pct * 40));
    console.log(`    ${s.padEnd(20)} ${(pct * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
  if (states.armed > 0)              console.log(`    ARMED transitions:        ${states.armed}`);
  if (states.disarmed > 0)           console.log(`    DISARMED transitions:     ${states.disarmed}`);
  if (states.executableAttempts > 0) console.log(`    Simulation runs:          ${states.executableAttempts}`);
  if (states.unhealthyEvents > 0)    console.log(`    STATE_UNHEALTHY events:   ${states.unhealthyEvents}`);

  // Price
  console.log('\n  PRICE (USDC/ARB):');
  console.log(`    min=$${price.min?.toFixed(6)}  max=$${price.max?.toFixed(6)}  avg=$${price.avg?.toFixed(6)}`);
  if (price.armedThreshold) console.log(`    ARMED threshold (dynamic): $${price.armedThreshold.toFixed(6)}`);
  if (price.nearestHighPrice) {
    const gap = price.min && price.nearestHighPrice
      ? ((price.nearestHighPrice - price.avg) / price.avg * 100).toFixed(1)
      : null;
    console.log(`    Nearest HIGH zone:         $${price.nearestHighPrice.toFixed(6)}  (avg gap: ${gap ? gap+'%' : 'n/a'})`);
  }

  // Depth
  console.log('\n  DEPTH (UniV3 active-tick, USD):');
  console.log(`    min=$${depth.min?.toFixed(0)}  max=$${depth.max?.toFixed(0)}  avg=$${depth.avg?.toFixed(0)}`);
  const total = depth.executionTicks + depth.subcriticalTicks + depth.deadTicks;
  const pct   = (n) => total > 0 ? (n / total * 100).toFixed(1) : '0.0';
  console.log(`    execution  (>=$${DEPTH_EXECUTION.toLocaleString()}): ${depth.executionTicks} ticks  (${pct(depth.executionTicks)}%)`);
  console.log(`    subcritical ($${DEPTH_SUBCRITICAL.toLocaleString()}–$${(DEPTH_EXECUTION-1).toLocaleString()}): ${depth.subcriticalTicks} ticks  (${pct(depth.subcriticalTicks)}%)`);
  console.log(`    dead       (<$${DEPTH_SUBCRITICAL.toLocaleString()}): ${depth.deadTicks} ticks  (${pct(depth.deadTicks)}%)`);

  // Spread
  if (spread.avg !== null) {
    console.log('\n  SPREAD (%):');
    console.log(`    min=${spread.min}%  max=${spread.max}%  avg=${spread.avg}%`);
    console.log(`    p90=${spread.p90}%  p99=${spread.p99}%`);
    console.log(`    fee burden: ~${FEE_BURDEN_PCT.toFixed(4)}%`);
  }

  // Alignment
  console.log('\n  SPREAD/DEPTH ALIGNMENT:');
  console.log(`    spread > fee only:           ${alignment.spreadAboveFeeOnly} ticks`);
  console.log(`    spread > full threshold:     ${alignment.spreadAboveFullThreshold} ticks`);
  console.log(`    depth+spread BOTH aligned:   ${alignment.depthAndSpreadAligned} ticks`);

  // Events
  if (events) {
    console.log('\n  LIQUIDITY EVENTS:');
    console.log(`    mints:                ${events.mints}`);
    console.log(`    burns:                ${events.burns}`);
    console.log(`    unique owners:        ${events.uniqueOwners}`);
    console.log(`    suspected churn:      ${events.suspectedChurnOwners}`);
    console.log(`    max depth delta:      $${events.maxDepthDelta} (from any single event)`);
  }

  // Verdict
  const verdictIcon = verdict === 'EXECUTION_READY_OBSERVED' ? '★★★'
                    : verdict === 'ARMED_ONLY'               ? '◉  '
                    : verdict === 'WINDOW_MISMATCH'          ? '⚡  '
                    : verdict === 'DEPTH_MISSING'            ? '↓  '
                    : verdict === 'SPREAD_MISSING'           ? '→  '
                    :                                          '○  ';
  console.log('\n' + LINE);
  console.log(`  VERDICT: ${verdictIcon} ${verdict}`);
  console.log('  ' + DIV);

  const explanations = {
    NO_EXECUTABLE_WINDOWS:    'No conditions for execution were met. Market was in dead state throughout.',
    DEPTH_MISSING:            'Spread was present but UniV3 depth never reached execution grade. Price needs to recover toward $' + (price.nearestHighPrice?.toFixed(6) ?? '?') + '.',
    SPREAD_MISSING:           'Execution-grade depth existed but no meaningful price spread occurred.',
    WINDOW_MISMATCH:          'Both spread and depth requirements were met, but not simultaneously.',
    ARMED_ONLY:               'Price approached the liquidity wall (ARMED state triggered) but depth + spread gate did not pass.',
    EXECUTION_READY_OBSERVED: 'EXECUTION_READY signal was emitted. Review activator log for full simulation details.',
  };
  console.log(`  ${explanations[verdict] ?? ''}`);
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ANALYSIS ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function analyze(files) {
  let depthTicks      = [];
  let activatorTicks  = [];
  let activatorStates = [];
  let thresholdHistory = [];
  let eventRecords    = [];
  const loadedFiles   = [];

  for (const { filePath, type } of files) {
    const records = readJsonl(filePath);
    if (!records.length) continue;
    loadedFiles.push(path.basename(filePath));

    if (type === 'depth') {
      depthTicks.push(...parseDepthLog(records));
    } else if (type === 'activator') {
      const { ticks, states, thresholdHistory: th } = parseActivatorLog(records);
      activatorTicks.push(...ticks);
      activatorStates.push(...states);
      thresholdHistory.push(...th);
    } else if (type === 'events') {
      eventRecords.push(...parseEventsLog(records));
    }
  }

  // Merge all ticks for time/price/depth/spread analysis
  const allTicks = [...depthTicks, ...activatorTicks].sort((a, b) =>
    new Date(a.ts) - new Date(b.ts)
  );

  // ── TIME RANGE ─────────────────────────────────────────────────────────────
  const allTs = allTicks.map(t => t.ts).filter(Boolean).sort();
  const evTs  = eventRecords.map(e => e.ts).filter(Boolean);
  const allTs2 = [...allTs, ...evTs].sort();
  const timeRange = {
    start:     allTs2[0] ?? null,
    end:       allTs2[allTs2.length - 1] ?? null,
    durationH: allTs2.length >= 2
      ? +((new Date(allTs2[allTs2.length - 1]) - new Date(allTs2[0])) / 3_600_000).toFixed(2)
      : null,
  };

  // ── PRICE ──────────────────────────────────────────────────────────────────
  const prices = allTicks.map(t => t.uniPrice).filter(v => v !== null && v > 0);
  const priceStats = stats(prices);

  // Latest threshold from activator
  const latestThreshold = thresholdHistory.length
    ? thresholdHistory[thresholdHistory.length - 1]
    : null;

  const price = {
    min:              priceStats.min,
    max:              priceStats.max,
    avg:              priceStats.avg,
    armedThreshold:   latestThreshold?.armedPrice ?? null,
    nearestHighPrice: latestThreshold?.nearestHighPrice ?? null,
    nearestHighTick:  latestThreshold?.nearestHighTick ?? null,
    nearestHighDepth: latestThreshold?.nearestHighDepth ?? null,
  };

  // ── DEPTH ──────────────────────────────────────────────────────────────────
  const depths = allTicks.map(t => t.uniDepth).filter(v => v !== null && v >= 0);
  const depthStatObj = stats(depths);
  let executionTicks = 0, subcriticalTicks = 0, deadTicks = 0;
  for (const d of depths) {
    const tier = depthTierLabel(d);
    if (tier === 'execution')   executionTicks++;
    else if (tier === 'subcritical') subcriticalTicks++;
    else deadTicks++;
  }

  const depth = {
    min: depthStatObj.min, max: depthStatObj.max, avg: depthStatObj.avg,
    executionTicks, subcriticalTicks, deadTicks,
  };

  // ── SPREAD ─────────────────────────────────────────────────────────────────
  const spreads = allTicks.map(t => t.spread).filter(v => v !== null && v >= 0);
  const spread  = stats(spreads);

  // ── ALIGNMENT ─────────────────────────────────────────────────────────────
  const alignment = computeAlignment(allTicks);

  // ── STATE DISTRIBUTION ────────────────────────────────────────────────────
  // Reconstruct from state_transition events
  let currentState    = 'PASSIVE';
  let passiveTicks    = 0, armedTicksCount  = 0;
  let armedTransitions = 0, disarmedTransitions = 0;
  let executableAttempts = 0, unhealthyEvents = 0, executableSignals = 0;

  for (const s of activatorStates) {
    if (s.to === 'ARMED')           { armedTransitions++; currentState = 'ARMED'; }
    if (s.to === 'PASSIVE')         { disarmedTransitions++; currentState = 'PASSIVE'; }
    if (s.to === 'STATE_UNHEALTHY') unhealthyEvents++;
  }
  for (const t of activatorTicks) {
    if (t.signal === 'EXECUTION_READY' || t.signal === 'SIMULATION_MARGINAL' || t.signal === 'SIMULATION_LOST' || t.signal === 'executable') {
      executableAttempts++;
      if (t.signal === 'EXECUTION_READY') executableSignals++;
    }
  }

  // Approximate state time from depth ticks
  const totalTicksForDist = depths.length || 1;
  // Use price vs armed threshold as proxy when no activator state data
  if (latestThreshold?.armedPrice) {
    for (const t of allTicks) {
      if (t.uniPrice !== null) {
        if (t.uniPrice >= latestThreshold.armedPrice) armedTicksCount++;
        else passiveTicks++;
      }
    }
  } else {
    passiveTicks = totalTicksForDist;
  }

  const stateDistribution = {
    PASSIVE:          +(passiveTicks / totalTicksForDist).toFixed(4),
    ARMED:            +(armedTicksCount / totalTicksForDist).toFixed(4),
    EXECUTION_READY:  +(executableSignals / totalTicksForDist).toFixed(6),
  };

  const states = {
    armed: armedTransitions, disarmed: disarmedTransitions,
    executableAttempts, unhealthyEvents, executableSignals,
  };

  // ── EVENTS ─────────────────────────────────────────────────────────────────
  let events = null;
  if (eventRecords.length > 0) {
    const ownerAnalysis = analyzeOwners(eventRecords);
    events = {
      mints:  eventRecords.filter(e => e.eventType === 'Mint').length,
      burns:  eventRecords.filter(e => e.eventType === 'Burn').length,
      ...ownerAnalysis,
    };
  }

  // ── VERDICT ────────────────────────────────────────────────────────────────
  const summary  = { depth, spread, alignment, states, executableSignals };
  const verdict  = deriveVerdict(summary);

  return {
    source: 'arb_session_analyzer', chain: 'arbitrum', pair: 'ARB/USDC',
    timeRange, stateDistribution, price, depth, spread, alignment,
    events, states, verdict, executableSignals,
    _meta: { filesLoaded: loadedFiles, ticksAnalyzed: allTicks.length, eventRecordsAnalyzed: eventRecords.length },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args    = process.argv.slice(2);
  const getS    = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=').slice(1).join('=') : d; };
  const hasFlag = (f)    => args.includes(f);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('\narb_session_analyzer.js — analyze completed monitoring sessions\n\nUSAGE:\n  node scripts/analysis/arb_session_analyzer.js \\\n    --depth=./logs/depth.jsonl \\\n    --events=./logs/liq_events.jsonl \\\n    --activator=./logs/activator.jsonl\n\nFLAGS:\n  --depth=PATH      Depth time-series log\n  --events=PATH     Liquidity event log\n  --activator=PATH  Activator state log\n  --glob=PATTERN    Auto-classify all matching files\n  --json            Machine-readable JSON output\n  --out=PATH        Write JSON verdict to file\n  --help            Show this message\n');
    process.exit(0);
  }

  const files = [];

  // --depth, --events, --activator explicit
  const depth     = getS('--depth',     null);
  const events    = getS('--events',    null);
  const activator = getS('--activator', null);
  const globPat   = getS('--glob',      null);

  if (depth)     files.push({ filePath: depth,     type: 'depth' });
  if (events)    files.push({ filePath: events,     type: 'events' });
  if (activator) files.push({ filePath: activator,  type: 'activator' });

  // --glob: auto-classify
  if (globPat) {
    let globFiles = [];
    try {
      // Use simple filesystem search since glob may not be installed
      const dir = path.dirname(globPat.replace(/\*.*/, '')) || '.';
      const ext = globPat.endsWith('.jsonl') ? '.jsonl' : '';
      globFiles = fs.readdirSync(dir)
        .filter(f => f.endsWith(ext))
        .map(f => path.join(dir, f));
    } catch { /* skip */ }
    for (const fp of globFiles) {
      const type = classifyFile(fp);
      if (type !== 'unknown') files.push({ filePath: fp, type });
    }
  }

  return {
    files,
    jsonMode: hasFlag('--json'),
    outPath:  getS('--out', null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const { files, jsonMode, outPath } = parseArgs();

  if (files.length === 0) {
    console.error([
      '',
      '  arb_session_analyzer.js — analyzes completed monitoring sessions',
      '  Inputs: depth_*.jsonl, liq_events_*.jsonl, activator_*.jsonl',
      '  Output: session verdict + price/depth/spread/alignment summary',
      '',,
      '',
      '  node scripts/analysis/arb_session_analyzer.js \\',
      '    --depth=./logs/depth_20260322.jsonl \\',
      '    --events=./logs/liq_events_20260323.jsonl \\',
      '    --activator=./logs/activator_20260324.jsonl',
      '',
      '  Optional:  --json          (machine-readable output)',
      '             --out=FILE      (write JSON to file)',
      '             --glob="./logs/*.jsonl"  (auto-classify all)',
      '',
    ].join('\n'));
    process.exit(1);
  }

  // Verify files exist
  const validFiles = files.filter(({ filePath }) => {
    if (!fs.existsSync(filePath)) {
      process.stderr.write(`  [warn] File not found: ${filePath}\n`);
      return false;
    }
    return true;
  });

  if (validFiles.length === 0) {
    console.error('  No valid files found. Exiting.');
    process.exit(1);
  }

  const result = analyze(validFiles);

  if (jsonMode) {
    const out = JSON.stringify(result, null, 2);
    console.log(out);
    if (outPath) {
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, out);
      process.stderr.write(`  Wrote JSON to ${outPath}\n`);
    }
  } else {
    printSummary(result, result._meta.filesLoaded);
    if (outPath) {
      const dir = path.dirname(outPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(`  JSON summary written to: ${outPath}`);
    }
  }
}

main();
