'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Threshold-Edge Tracker  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/threshold_edge_tracker.js
//  STATUS    : NEW — Boss ruling 2026-04-12
//
//  PURPOSE
//  ─────────
//  Track and summarise the `THRESHOLD_EDGE_CANDIDATE` subset of near-miss records.
//  These are records that are:
//    • nearMissType = 'near_miss_spread'
//    • simulationVerdict = 'SIM_PASS'
//    • executionConfidence >= EDGE_CONFIDENCE_THRESHOLD (0.65)
//
//  This is analysis-only. No rules are changed. No thresholds are moved.
//  The tracker answers six Boss questions about whether this subset is a
//  recurring, stable class or incidental tail cases.
//
//  THIS MODULE DOES NOT:
//  ✗ Relax any threshold
//  ✗ Modify activator, simulator, filter, audit, or near-miss analysis
//  ✗ Emit execution signals
//  ✗ Make RPC calls or I/O
//
//  DEFINITION (per Boss ruling 2026-04-12)
//  ─────────────────────────────────────────
//  THRESHOLD_EDGE_CANDIDATE:
//    nearMissType       = 'near_miss_spread'
//    simulationVerdict  = 'SIM_PASS'
//    executionConfidence >= 0.65
//
//  This is a named analysis label. It is NOT a filter output.
//  It is NOT an admission class.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** Minimum execution confidence for threshold-edge classification. */
const EDGE_CONFIDENCE_THRESHOLD = 0.65;

/** Required nearMissType. */
const EDGE_NEAR_MISS_TYPE       = 'near_miss_spread';

/** Required simulationVerdict. */
const EDGE_SIM_VERDICT          = 'SIM_PASS';

// Spread gap bands for Q6 (dispersion analysis)
// Gap = how far below the spread threshold the candidate was
const GAP_BANDS = Object.freeze([
  { label: '0–0.005%',   min: 0,     max: 0.005  },
  { label: '0.005–0.01%',min: 0.005, max: 0.010  },
  { label: '0.01–0.02%', min: 0.010, max: 0.020  },
  { label: '0.02–0.03%', min: 0.020, max: 0.030  },
  { label: '>0.03%',     min: 0.030, max: Infinity },
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
  return map;
}

function stats(arr) {
  const vals = arr.filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  const sorted = vals.slice().sort((a, b) => a - b);
  const sum    = vals.reduce((a, b) => a + b, 0);
  return {
    count  : vals.length,
    min    : +sorted[0].toFixed(5),
    max    : +sorted[sorted.length - 1].toFixed(5),
    median : +sorted[Math.floor(sorted.length / 2)].toFixed(5),
    mean   : +(sum / vals.length).toFixed(5),
  };
}

function gapBandLabel(gap) {
  if (gap == null || !isFinite(gap)) return 'unknown';
  const b = GAP_BANDS.find(({ min, max }) => gap >= min && gap < max);
  return b ? b.label : 'unknown';
}

function topKey(obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return entries[0]?.[0] ?? 'none';
}

// ─── CLASSIFIER ───────────────────────────────────────────────────────────────

/**
 * Determine whether a candidate audit record qualifies as a THRESHOLD_EDGE_CANDIDATE.
 *
 * @param {object} record  Candidate audit record
 * @returns {boolean}
 */
function isThresholdEdge(record) {
  if (!record || record.auditVerdict !== 'CANDIDATE_NEAR_MISS') return false;
  return (
    record.nearMissType       === EDGE_NEAR_MISS_TYPE &&
    record.simulationVerdict  === EDGE_SIM_VERDICT    &&
    typeof record.executionConfidence === 'number'    &&
    record.executionConfidence >= EDGE_CONFIDENCE_THRESHOLD
  );
}

// ─── PRIMARY TRACKING FUNCTION ────────────────────────────────────────────────

/**
 * Extract and summarise threshold-edge candidates from a candidate audit log.
 *
 * Deterministic: same input → same output always.
 *
 * @param {object[]} auditRecords  From execution_candidate_audit.jsonl
 * @returns {object}               Tracker summary + sorted record list
 */
function trackThresholdEdge(auditRecords) {
  if (!Array.isArray(auditRecords) || !auditRecords.length) {
    return _emptySummary(0);
  }

  const totalAuditRecords = auditRecords.length;

  // Extract qualifying records
  const edgeRecords = auditRecords.filter(isThresholdEdge);

  if (!edgeRecords.length) {
    return _emptySummary(totalAuditRecords);
  }

  // ── Dimension accumulators ─────────────────────────────────────────────────
  const byProfile  = {};
  const byHeatClass= {};
  const byRegime   = {};
  const byGapBand  = {};

  const spreads    = [];
  const confs      = [];
  const netProfits = [];
  const gaps       = [];

  // ── Build canonical record list ────────────────────────────────────────────
  const canonicalRecords = [];

  for (const r of edgeRecords) {
    const profile  = r.profile    ?? 'unknown';
    const heat     = r.heatClass  ?? 'unknown';
    const regime   = r.regime     ?? 'unknown';
    const spread   = r.spreadPct;
    const conf     = r.executionConfidence;
    const net      = r.baseNetProfitUsd;

    // Extract spread gap from nearMissDetail
    // Format: "spreadPct=0.2186% threshold=0.22% gap=0.0014%"
    const gapMatch = (r.nearMissDetail ?? '').match(/gap=([\d.]+)%/);
    const gap      = gapMatch ? parseFloat(gapMatch[1]) : null;

    inc(byProfile,   profile);
    inc(byHeatClass, heat);
    inc(byRegime,    regime);
    inc(byGapBand,   gapBandLabel(gap));

    if (spread != null)  spreads.push(spread);
    if (conf   != null)  confs.push(conf);
    if (net    != null)  netProfits.push(net);
    if (gap    != null)  gaps.push(gap);

    canonicalRecords.push({
      candidateAuditId   : r.candidateAuditId,
      pair               : r.pair,
      spreadPct          : spread,
      executionConfidence: conf,
      baseNetProfitUsd   : net,
      profile,
      heatClass          : heat,
      regime,
      nearMissDetail     : r.nearMissDetail,
      spreadGapPct       : gap,
      fragilityScore     : r.fragilityScore,
      ts                 : r.ts,
    });
  }

  // Sort: highest confidence first, then tightest gap (closest to ALLOW)
  canonicalRecords.sort((a, b) =>
    (b.executionConfidence ?? 0) - (a.executionConfidence ?? 0) ||
    (a.spreadGapPct ?? 999) - (b.spreadGapPct ?? 999)
  );

  // ── Answer the six Boss questions ──────────────────────────────────────────

  const n = edgeRecords.length;

  // Q6: dispersion — are gaps tight (near threshold) or widely dispersed?
  const gapSt = stats(gaps);
  const dispersion = gapSt
    ? gapSt.max - gapSt.min < 0.010 ? 'TIGHT'     // all within 1bp of each other
    : gapSt.max < 0.015              ? 'CLUSTERED' // all within 1.5bp of threshold
    : gapSt.max < 0.030              ? 'MODERATE'  // spread up to 3bp below
    :                                  'DISPERSED' // some well below threshold
    : 'UNKNOWN';

  return {
    // Population
    totalAuditRecords,
    edgeCount           : n,
    edgePctOfAudit      : totalAuditRecords ? +(100 * n / totalAuditRecords).toFixed(2) : 0,

    // Q1: how many?
    count               : n,

    // Q2: spread gap range (how far below threshold)
    gapStats            : gapSt,
    byGapBand,

    // Q3: dominant profile
    dominantProfile     : topKey(byProfile),
    byProfile,

    // Q4: dominant heat class
    dominantHeatClass   : topKey(byHeatClass),
    byHeatClass,

    // Q5: dominant regime
    dominantRegime      : topKey(byRegime),
    byRegime,

    // Q6: dispersion classification
    gapDispersion       : dispersion,

    // Supporting stats
    spreadStats         : stats(spreads),
    confidenceStats     : stats(confs),
    netProfitStats      : stats(netProfits),

    // Constants for report formatting
    edgeConfidenceThreshold : EDGE_CONFIDENCE_THRESHOLD,
    edgeNearMissType        : EDGE_NEAR_MISS_TYPE,
    edgeSimVerdict          : EDGE_SIM_VERDICT,

    // Sorted canonical record list
    records             : canonicalRecords,
  };
}

function _emptySummary(totalAuditRecords) {
  return {
    totalAuditRecords,
    edgeCount         : 0,
    edgePctOfAudit    : 0,
    count             : 0,
    gapStats          : null,
    byGapBand         : {},
    dominantProfile   : null,
    byProfile         : {},
    dominantHeatClass : null,
    byHeatClass       : {},
    dominantRegime    : null,
    byRegime          : {},
    gapDispersion     : 'UNKNOWN',
    spreadStats       : null,
    confidenceStats   : null,
    netProfitStats    : null,
    edgeConfidenceThreshold : EDGE_CONFIDENCE_THRESHOLD,
    edgeNearMissType        : EDGE_NEAR_MISS_TYPE,
    edgeSimVerdict          : EDGE_SIM_VERDICT,
    records           : [],
  };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  trackThresholdEdge,
  isThresholdEdge,
  EDGE_CONFIDENCE_THRESHOLD,
  EDGE_NEAR_MISS_TYPE,
  EDGE_SIM_VERDICT,
  GAP_BANDS,
};
