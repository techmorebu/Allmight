#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Cross-Class Persistence Telemetry aggregator — v1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AllMight Wave 10B, commit 5.  Implements Boss C9 ruling.
 *
 * PURPOSE
 *   Convert per-block scanner observations of A/C/D opportunity surfaces
 *   into persistence intelligence: frequency, capture windows, edge decay,
 *   binding-constraint transitions, UTC recurrence, and latency survival.
 *
 *   Answers not "is this profitable at one instant" but "is this actually
 *   capturable given detection + execution latency."
 *
 * INPUT
 *   append-only JSONL corpus (one observation per line).  Path via CLI arg
 *   or default fixtures/observations_v1.jsonl.
 *
 * OUTPUT
 *   stdout: canonical JSON (schema persistence_telemetry_v1)
 *   stderr: human-readable summary
 *
 * DESIGN CONSTRAINTS (Boss C9)
 *   1. Deterministic aggregation only.  No RPC.  No scheduler.  No daemon.
 *   2. Cross-class unified schema (extensions: {} for per-class extras).
 *   3. surfaceId and routeId are separate identifiers.  Every observation
 *      has surfaceId; routeId only where order matters beyond surface.
 *   4. candidate=false observations are MANDATORY (frequency needs them).
 *   5. Retain both candidateHitRate and economicHitRate — the delta between
 *      them is the actionable diagnostic.
 *   6. Latency survival buckets: 0, +1, +2, +5, +10 blocks.  Emit null when
 *      corpus cannot support the calculation.
 *   7. Analytics only — no execution, no broadcast, no capital movement.
 *
 * NON-GOALS FOR v1
 *   - Live RPC polling
 *   - Cron/watcher wiring
 *   - Session-folder integration
 *   - Persistence-informed routing (that's c6)
 *
 * CAPITAL LOCKED. EXECUTION LOCKED. BROADCAST LOCKED.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SCHEMA_VERSION = 'persistence_telemetry_v1';

const LATENCY_BUCKETS_BLOCKS = [0, 1, 2, 5, 10];

const DEFAULT_INPUT_PATH = path.join(
  __dirname, 'fixtures', 'observations_v1.jsonl'
);

// ─────────────────────────────────────────────────────────────────────────────
// Corpus loader
// ─────────────────────────────────────────────────────────────────────────────

function loadCorpus(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`corpus not found at ${inputPath}`);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const rec = JSON.parse(lines[i]);
      // Validate required fields
      if (typeof rec.block !== 'number') {
        throw new Error(`missing 'block' field`);
      }
      if (typeof rec.surfaceId !== 'string') {
        throw new Error(`missing 'surfaceId' field`);
      }
      if (typeof rec.candidate !== 'boolean') {
        throw new Error(`missing 'candidate' boolean field`);
      }
      if (typeof rec.economic !== 'boolean') {
        throw new Error(`missing 'economic' boolean field`);
      }
      records.push(rec);
    } catch (e) {
      throw new Error(`invalid JSON at line ${i + 1}: ${e.message}`);
    }
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group observations by surfaceId (or routeId if present, since ordered
 * routes need to aggregate under the routeId not surfaceId).  Sort each
 * group by block ascending.
 */
function groupBySurface(records) {
  const groups = new Map();
  for (const rec of records) {
    const key = rec.routeId || rec.surfaceId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }
  for (const observations of groups.values()) {
    observations.sort((a, b) => a.block - b.block);
  }
  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statistical helpers
// ─────────────────────────────────────────────────────────────────────────────

function median(sortedValues) {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n % 2 === 1) return sortedValues[Math.floor(n / 2)];
  return (sortedValues[n / 2 - 1] + sortedValues[n / 2]) / 2;
}

function percentile(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 0) return null;
  const rank = (p / 100) * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (rank - lower) * (sortedValues[upper] - sortedValues[lower]);
}

function statsSummary(values) {
  if (values.length === 0) {
    return { count: 0, min: null, median: null, p75: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    median: median(sorted),
    p75: percentile(sorted, 75),
    max: sorted[sorted.length - 1],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture window detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A capture window is a maximal contiguous run of observations where the
 * surface is economic=true AND blocks are strictly consecutive (block_n+1
 * = block_n + 1).  Non-contiguous economic observations start new windows.
 *
 * Returns array of { startBlock, endBlock, durationBlocks, peakNetEdgeBps,
 *                    peakAtBlockOffset, netEdgeTrajectory }.
 */
function detectCaptureWindows(observations) {
  const windows = [];
  let current = null;

  for (const obs of observations) {
    if (obs.economic) {
      if (current && obs.block === current.endBlock + 1) {
        current.endBlock = obs.block;
        current.trajectory.push({ block: obs.block, netEdgeBps: obs.netEdgeBps });
      } else {
        if (current) windows.push(finalizeWindow(current));
        current = {
          startBlock: obs.block,
          endBlock: obs.block,
          trajectory: [{ block: obs.block, netEdgeBps: obs.netEdgeBps }],
        };
      }
    } else {
      if (current) {
        windows.push(finalizeWindow(current));
        current = null;
      }
    }
  }
  if (current) windows.push(finalizeWindow(current));

  return windows;
}

function finalizeWindow(w) {
  const durationBlocks = w.endBlock - w.startBlock + 1;
  const edges = w.trajectory.map(t => t.netEdgeBps).filter(e => e !== null);
  const peak = edges.length ? Math.max(...edges) : null;
  const peakIdx = edges.indexOf(peak);
  return {
    startBlock: w.startBlock,
    endBlock: w.endBlock,
    durationBlocks,
    peakNetEdgeBps: peak,
    peakAtBlockOffset: peakIdx >= 0 ? peakIdx : null,
    netEdgeTrajectory: w.trajectory,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Onset detection (for latency survival)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An onset is a block where surface becomes economic and either (a) previous
 * consecutive block was NOT economic, or (b) it's the first observation.
 * Used for latency survival calculation.
 */
function detectOnsets(observations) {
  const byBlock = new Map();
  for (const obs of observations) byBlock.set(obs.block, obs);

  const onsets = [];
  const sortedBlocks = [...byBlock.keys()].sort((a, b) => a - b);
  for (const block of sortedBlocks) {
    const obs = byBlock.get(block);
    if (!obs.economic) continue;
    const prev = byBlock.get(block - 1);
    if (!prev || !prev.economic) {
      onsets.push(block);
    }
  }
  return onsets;
}

// ─────────────────────────────────────────────────────────────────────────────
// Latency survival calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * For each onset, check whether the surface is continuously economic from
 * onset through onset + k for each latency bucket k.  Aggregate to a
 * probability per bucket.  Emit null when the corpus can't support the
 * calculation (i.e., no observations exist at onset + k for any onset).
 */
function calculateLatencySurvival(observations, onsets) {
  const byBlock = new Map();
  for (const obs of observations) byBlock.set(obs.block, obs);

  const result = {};
  for (const k of LATENCY_BUCKETS_BLOCKS) {
    let evaluated = 0;
    let survived = 0;
    for (const onset of onsets) {
      // Check that ALL blocks from onset to onset+k exist in corpus
      let hasFullWindow = true;
      let allEconomic = true;
      for (let offset = 0; offset <= k; offset++) {
        const b = byBlock.get(onset + offset);
        if (!b) { hasFullWindow = false; break; }
        if (!b.economic) { allEconomic = false; }
      }
      if (!hasFullWindow) continue;
      evaluated += 1;
      if (allEconomic) survived += 1;
    }
    const key = `plus_${k}_block`;
    result[key] = evaluated === 0 ? null : survived / evaluated;
    result[`${key}_evaluated`] = evaluated;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding constraint transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk observations chronologically; count changes in bindingConstraint
 * (ignoring null-null transitions).  Return ordered history + unique set +
 * transition count.
 */
function analyzeBindingTransitions(observations) {
  let previous = null;
  const history = [];
  let transitions = 0;
  const unique = new Set();

  for (const obs of observations) {
    const current = obs.bindingConstraint;
    if (current !== null && current !== undefined) {
      unique.add(current);
      history.push({ block: obs.block, bindingConstraint: current });
      if (previous !== null && current !== previous) {
        transitions += 1;
      }
      previous = current;
    }
  }
  return {
    bindingConstraintHistory: history,
    bindingConstraintTransitions: transitions,
    uniqueBindingConstraints: [...unique],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recurrence by hour UTC
// ─────────────────────────────────────────────────────────────────────────────

function calculateHourRecurrence(observations) {
  const hist = {};
  for (const obs of observations) {
    if (!obs.economic) continue;
    if (!obs.observedAt) continue;
    const hour = new Date(obs.observedAt).getUTCHours();
    hist[hour] = (hist[hour] || 0) + 1;
  }
  return hist;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-surface aggregation
// ─────────────────────────────────────────────────────────────────────────────

function aggregateSurface(key, observations) {
  const first = observations[0];
  const last  = observations[observations.length - 1];

  const observationCount = observations.length;
  const candidateObs = observations.filter(o => o.candidate);
  const economicObs  = observations.filter(o => o.economic);
  const candidateCount = candidateObs.length;
  const economicCount = economicObs.length;

  const candidateHitRate = observationCount > 0 ? candidateCount / observationCount : 0;
  const economicHitRate  = observationCount > 0 ? economicCount / observationCount : 0;

  // Opportunity classes seen across observations
  const opportunityClasses = new Set();
  for (const obs of observations) {
    if (Array.isArray(obs.opportunityClass)) {
      for (const c of obs.opportunityClass) opportunityClasses.add(c);
    }
  }

  // Duration bounds
  const firstSeenBlock = candidateObs.length ? candidateObs[0].block : null;
  const lastSeenBlock  = candidateObs.length ? candidateObs[candidateObs.length - 1].block : null;
  const durationBlocks = (firstSeenBlock !== null && lastSeenBlock !== null)
    ? lastSeenBlock - firstSeenBlock + 1 : 0;
  const firstSeenAt = candidateObs.length ? candidateObs[0].observedAt : null;
  const lastSeenAt  = candidateObs.length ? candidateObs[candidateObs.length - 1].observedAt : null;
  const durationSeconds = (firstSeenAt && lastSeenAt)
    ? (new Date(lastSeenAt).getTime() - new Date(firstSeenAt).getTime()) / 1000 : null;

  // Capture windows
  const captureWindows = detectCaptureWindows(observations);
  const captureWindowDurations = captureWindows.map(w => w.durationBlocks);
  const maxCaptureWindowBlocks = captureWindowDurations.length ? Math.max(...captureWindowDurations) : 0;
  const medianCaptureWindowBlocks = median([...captureWindowDurations].sort((a, b) => a - b));

  // Onsets and consecutive-observation stats
  const onsets = detectOnsets(observations);
  const consecutiveObservationCounts = captureWindowDurations;
  const maxConsecutiveObservations = maxCaptureWindowBlocks;

  // Edge stats (across all candidate observations, and separately across economic)
  const grossEdgesCandidate = candidateObs.map(o => o.grossEdgeBps).filter(v => v !== null && v !== undefined);
  const netEdgesCandidate   = candidateObs.map(o => o.netEdgeBps).filter(v => v !== null && v !== undefined);
  const netEdgesEconomic    = economicObs.map(o => o.netEdgeBps).filter(v => v !== null && v !== undefined);

  const grossEdgeStats = statsSummary(grossEdgesCandidate);
  const netEdgeStats   = statsSummary(netEdgesCandidate);

  const peakNetEdgeBps   = netEdgesEconomic.length ? Math.max(...netEdgesEconomic) : null;
  const medianNetEdgeBps = median([...netEdgesEconomic].sort((a, b) => a - b));

  // Executable capacity stats
  const capacities = candidateObs.map(o => o.executableCapacityUsd).filter(v => v !== null && v !== undefined);
  const peakExecutableCapacityUsd   = capacities.length ? Math.max(...capacities) : null;
  const medianExecutableCapacityUsd = median([...capacities].sort((a, b) => a - b));

  // Binding constraint transitions
  const binding = analyzeBindingTransitions(observations);

  // Recurrence by UTC hour
  const recurrenceHourUTC = calculateHourRecurrence(observations);

  // Latency survival
  const captureProbabilityByLatency = calculateLatencySurvival(observations, onsets);

  // Threshold used (should be consistent across observations for a surface)
  const thresholds = [...new Set(observations.map(o => o.thresholdNetEdgeBps).filter(v => v !== null && v !== undefined))];
  const thresholdNetEdgeBps = thresholds.length === 1 ? thresholds[0] : (thresholds.length ? thresholds : null);

  // Source scanners referenced
  const sourceScanners = [...new Set(observations.map(o => o.sourceScanner).filter(Boolean))];

  return {
    surfaceId: first.surfaceId,
    routeId: first.routeId || null,
    opportunityClasses: [...opportunityClasses],
    sourceScanners,
    thresholdNetEdgeBps,

    // Frequency
    observationCount,
    candidateCount,
    economicCount,
    candidateHitRate,
    economicHitRate,

    // Persistence bounds
    firstSeenBlock,
    lastSeenBlock,
    durationBlocks,
    firstSeenAt,
    lastSeenAt,
    durationSeconds,
    consecutiveObservationCounts,
    maxConsecutiveObservations,

    // Edge statistics
    grossEdgeStats,
    netEdgeStats,
    peakNetEdgeBps,
    medianNetEdgeBps,

    // Capacity
    peakExecutableCapacityUsd,
    medianExecutableCapacityUsd,

    // Capture windows (the key metric)
    captureWindows,
    maxCaptureWindowBlocks,
    medianCaptureWindowBlocks,

    // Onsets
    onsetCount: onsets.length,
    onsetBlocks: onsets,

    // Binding constraint diagnostics
    bindingConstraintHistory: binding.bindingConstraintHistory,
    bindingConstraintTransitions: binding.bindingConstraintTransitions,
    uniqueBindingConstraints: binding.uniqueBindingConstraints,

    // Recurrence
    recurrenceHourUTC,

    // Latency survival
    captureProbabilityByLatency,

    // Extensions passthrough (per-class extras; unified aggregator ignores them)
    extensions: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall summary
// ─────────────────────────────────────────────────────────────────────────────

function computeOverall(surfaces, records) {
  return {
    totalObservations: records.length,
    surfaceCount: surfaces.length,
    surfacesWithCandidates: surfaces.filter(s => s.candidateCount > 0).length,
    surfacesWithEconomic:  surfaces.filter(s => s.economicCount > 0).length,
    surfacesNeverEconomic: surfaces.filter(s => s.candidateCount > 0 && s.economicCount === 0).length,
    totalCandidateObservations: surfaces.reduce((a, s) => a + s.candidateCount, 0),
    totalEconomicObservations:  surfaces.reduce((a, s) => a + s.economicCount, 0),
    totalCaptureWindows: surfaces.reduce((a, s) => a + s.captureWindows.length, 0),
    totalOnsets: surfaces.reduce((a, s) => a + s.onsetCount, 0),
    totalBindingTransitions: surfaces.reduce((a, s) => a + s.bindingConstraintTransitions, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output builders
// ─────────────────────────────────────────────────────────────────────────────

function buildAggregateOutput(inputPath, records) {
  const groups = groupBySurface(records);
  const surfaces = [];
  for (const [key, observations] of groups.entries()) {
    surfaces.push(aggregateSurface(key, observations));
  }
  surfaces.sort((a, b) => (a.surfaceId || '').localeCompare(b.surfaceId || ''));

  const overall = computeOverall(surfaces, records);

  return {
    $schema: SCHEMA_VERSION,
    aggregatedAt: new Date().toISOString(),
    inputPath,
    inputRecordCount: records.length,
    constitutional: {
      capitalLocked: true,
      broadcastLocked: true,
      executionLocked: true,
      analyticsOnly: true,
      note: 'c5 is a persistence telemetry aggregator. It reads observation '
        + 'records and computes capture/frequency/decay/latency metrics. '
        + 'It does NOT poll RPC, invoke scanners, or move capital. '
        + 'Per Boss C9 Wave 10B: analytics only.',
    },
    overall,
    surfaces,
  };
}

function fmt$(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  const n = Number(x);
  if (Math.abs(n) < 1)     return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1000)  return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtBps(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${Number(x).toFixed(2)} bps`;
}

function fmtPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function fmtProb(x) {
  if (x === null || x === undefined) return 'null (insufficient data)';
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function renderHumanSummary(output) {
  const L = [];
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(' Cross-Class Persistence Telemetry aggregator — v1');
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(` Schema version:      ${output.$schema}`);
  L.push(` Aggregated at:       ${output.aggregatedAt}`);
  L.push(` Input path:          ${output.inputPath}`);
  L.push(` Input records:       ${output.inputRecordCount}`);
  L.push(' Constitutional state:');
  L.push(`   Capital LOCKED:    ${output.constitutional.capitalLocked}`);
  L.push(`   Broadcast LOCKED:  ${output.constitutional.broadcastLocked}`);
  L.push(`   Execution LOCKED:  ${output.constitutional.executionLocked}`);
  L.push(`   Analytics only:    ${output.constitutional.analyticsOnly}`);
  L.push('');
  L.push(' ── OVERALL ──');
  const o = output.overall;
  L.push(`   Total observations:        ${o.totalObservations}`);
  L.push(`   Surface count:             ${o.surfaceCount}`);
  L.push(`   Surfaces w/ candidates:    ${o.surfacesWithCandidates}`);
  L.push(`   Surfaces w/ economic obs:  ${o.surfacesWithEconomic}`);
  L.push(`   Surfaces NEVER economic:   ${o.surfacesNeverEconomic}  ← key Boss C9 diagnostic`);
  L.push(`   Total candidate obs:       ${o.totalCandidateObservations}`);
  L.push(`   Total economic obs:        ${o.totalEconomicObservations}`);
  L.push(`   Total capture windows:     ${o.totalCaptureWindows}`);
  L.push(`   Total onsets:              ${o.totalOnsets}`);
  L.push(`   Total binding transitions: ${o.totalBindingTransitions}`);

  for (const s of output.surfaces) {
    L.push('');
    L.push(` ── ${s.surfaceId} ──`);
    if (s.routeId) L.push(`   routeId:                    ${s.routeId}`);
    L.push(`   opportunityClasses:         [${s.opportunityClasses.join(', ')}]`);
    L.push(`   sourceScanners:             [${s.sourceScanners.join(', ')}]`);
    L.push(`   thresholdNetEdgeBps:        ${s.thresholdNetEdgeBps}`);
    L.push('   Frequency:');
    L.push(`     observationCount:         ${s.observationCount}`);
    L.push(`     candidateCount:           ${s.candidateCount}`);
    L.push(`     economicCount:            ${s.economicCount}`);
    L.push(`     candidateHitRate:         ${fmtPct(s.candidateHitRate)}`);
    L.push(`     economicHitRate:          ${fmtPct(s.economicHitRate)}`);
    const delta = (s.candidateHitRate - s.economicHitRate);
    L.push(`     candidate−economic delta: ${fmtPct(delta)}  ← Boss diagnostic`);
    L.push('   Persistence:');
    L.push(`     firstSeenBlock:           ${s.firstSeenBlock === null ? 'n/a' : s.firstSeenBlock}`);
    L.push(`     lastSeenBlock:            ${s.lastSeenBlock  === null ? 'n/a' : s.lastSeenBlock}`);
    L.push(`     durationBlocks:           ${s.durationBlocks}`);
    L.push(`     durationSeconds:          ${s.durationSeconds === null ? 'n/a' : s.durationSeconds.toFixed(2)}`);
    L.push(`     maxConsecutiveObs:        ${s.maxConsecutiveObservations}`);
    L.push('   Edge stats:');
    L.push(`     gross edge  n/med/p75/max: ${s.grossEdgeStats.count} / ${fmtBps(s.grossEdgeStats.median)} / ${fmtBps(s.grossEdgeStats.p75)} / ${fmtBps(s.grossEdgeStats.max)}`);
    L.push(`     net edge    n/med/p75/max: ${s.netEdgeStats.count} / ${fmtBps(s.netEdgeStats.median)} / ${fmtBps(s.netEdgeStats.p75)} / ${fmtBps(s.netEdgeStats.max)}`);
    L.push(`     peakNetEdgeBps (economic): ${fmtBps(s.peakNetEdgeBps)}`);
    L.push(`     medianNetEdgeBps (economic): ${fmtBps(s.medianNetEdgeBps)}`);
    L.push('   Capacity:');
    L.push(`     peakExecutableCapacityUsd:   ${fmt$(s.peakExecutableCapacityUsd)}`);
    L.push(`     medianExecutableCapacityUsd: ${fmt$(s.medianExecutableCapacityUsd)}`);
    L.push('   Capture windows:');
    L.push(`     count:                    ${s.captureWindows.length}`);
    L.push(`     maxCaptureWindowBlocks:   ${s.maxCaptureWindowBlocks}`);
    L.push(`     medianCaptureWindowBlocks: ${s.medianCaptureWindowBlocks === null ? 'n/a' : s.medianCaptureWindowBlocks}`);
    for (const w of s.captureWindows) {
      L.push(`     window: blocks ${w.startBlock}-${w.endBlock} (${w.durationBlocks}b), peakNet=${fmtBps(w.peakNetEdgeBps)}, peakAtOffset=${w.peakAtBlockOffset}`);
    }
    L.push('   Binding constraint:');
    L.push(`     transitions:              ${s.bindingConstraintTransitions}`);
    L.push(`     unique constraints:       [${s.uniqueBindingConstraints.join(', ')}]`);
    L.push('   Recurrence (UTC hour histogram of economic obs):');
    const hours = Object.keys(s.recurrenceHourUTC).sort((a, b) => Number(a) - Number(b));
    if (hours.length === 0) {
      L.push('     (none)');
    } else {
      for (const h of hours) {
        L.push(`     ${h.padStart(2, '0')}:00 UTC → ${s.recurrenceHourUTC[h]} obs`);
      }
    }
    L.push('   Latency survival (capture probability by execution delay):');
    for (const k of LATENCY_BUCKETS_BLOCKS) {
      const key = `plus_${k}_block`;
      const evalKey = `${key}_evaluated`;
      const p = s.captureProbabilityByLatency[key];
      const n = s.captureProbabilityByLatency[evalKey];
      L.push(`     +${String(k).padStart(2, ' ')} blocks: ${fmtProb(p)}  (n=${n})`);
    }
  }

  L.push('');
  L.push(' ── Interpretation ──');
  L.push('   c5 aggregates observation records into persistence intelligence.');
  L.push('   The candidate−economic delta identifies surfaces that show basis');
  L.push('   frequently but almost never produce net-positive execution.');
  L.push('   Latency survival distinguishes atomic-only opportunities from');
  L.push('   inventory-executable ones.  Binding-constraint transitions warn');
  L.push('   the router that a surface\'s bottleneck is dynamic, not static.');
  L.push('');
  L.push(' Capital LOCKED. Proven winner UNTOUCHED. Broadcast LOCKED.');
  L.push(' c5 is a persistence primitive.  c6 Opportunity Router consumes it.');
  L.push('');

  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT_PATH;
  let records;
  try {
    records = loadCorpus(inputPath);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }

  const output = buildAggregateOutput(inputPath, records);

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.stderr.write(renderHumanSummary(output) + '\n');
}

main();
