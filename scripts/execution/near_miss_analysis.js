'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Near-Miss Analysis  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/near_miss_analysis.js
//  STATUS    : NEW — Boss ruling 2026-04-11
//
//  PURPOSE
//  ─────────
//  Analyse the CANDIDATE_NEAR_MISS population from the candidate audit log.
//  Groups near-misses by subtype and context dimensions to answer:
//
//    1. Which near-miss subtype dominates?
//    2. Which profile produces the most near-misses?
//    3. Which heat class dominates?
//    4. Are near-misses clustered just below threshold, or mostly SIM_MARGINAL?
//    5. Are there high-confidence near-misses worth special attention?
//
//  THIS MODULE DOES NOT:
//  ✗ Modify activator, simulator, filter, or audit rules
//  ✗ Relax any threshold
//  ✗ Make RPC calls or I/O
//  ✗ Emit execution signals
//
//  INPUT  : Array of candidate audit records (from execution_candidate_audit.jsonl)
//  OUTPUT : Deterministic summary object (see analyseSummary shape below)
// ═══════════════════════════════════════════════════════════════════════════════

// ─── BAND DEFINITIONS ─────────────────────────────────────────────────────────
// Boss-specified spread and confidence bands. Centralised — do not inline.

const SPREAD_BANDS = Object.freeze([
  { label: '<0.19',       min: 0,    max: 0.19  },
  { label: '0.19–0.2099', min: 0.19, max: 0.21  },
  { label: '0.21–0.2199', min: 0.21, max: 0.22  },
  { label: '≥0.22',       min: 0.22, max: Infinity },
]);

const CONFIDENCE_BANDS = Object.freeze([
  { label: '<0.50',    min: 0,    max: 0.50 },
  { label: '0.50–0.59',min: 0.50, max: 0.60 },
  { label: '0.60–0.69',min: 0.60, max: 0.70 },
  { label: '≥0.70',    min: 0.70, max: Infinity },
]);

// Execution-confidence threshold above which a near-miss is flagged as
// "high-confidence" and worth elevated attention.
const HIGH_CONFIDENCE_THRESHOLD = 0.65;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function bandLabel(value, bands) {
  if (value == null || !isFinite(value)) return 'unknown';
  const b = bands.find(({ min, max }) => value >= min && value < max);
  return b ? b.label : 'unknown';
}

/**
 * Increment a counter map key by 1. Returns the map.
 */
function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
  return map;
}

/**
 * Compute basic statistics for a numeric array.
 * Returns null if array is empty.
 */
function stats(arr) {
  const vals = arr.filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  const sorted = vals.slice().sort((a, b) => a - b);
  const sum    = vals.reduce((a, b) => a + b, 0);
  return {
    count  : vals.length,
    min    : +sorted[0].toFixed(4),
    max    : +sorted[sorted.length - 1].toFixed(4),
    median : +sorted[Math.floor(sorted.length / 2)].toFixed(4),
    mean   : +(sum / vals.length).toFixed(4),
  };
}

// ─── PRIMARY ANALYSIS FUNCTION ────────────────────────────────────────────────

/**
 * Analyse an array of candidate audit records.
 * Only CANDIDATE_NEAR_MISS records are analysed; others are counted and skipped.
 *
 * Deterministic: same input → same output always.
 *
 * @param {object[]} records  Candidate audit records from execution_candidate_audit.jsonl
 * @returns {object}          Analysis summary (see return shape below)
 */
function analyseNearMisses(records) {
  if (!Array.isArray(records) || !records.length) {
    return _emptySummary(0, 0);
  }

  const total     = records.length;
  const nearMisses= records.filter(r => r?.auditVerdict === 'CANDIDATE_NEAR_MISS');
  const confirmed = records.filter(r => r?.auditVerdict === 'CANDIDATE_CONFIRMED').length;
  const rejected  = records.filter(r => r?.auditVerdict === 'CANDIDATE_REJECTED').length;

  if (!nearMisses.length) {
    return _emptySummary(total, confirmed);
  }

  // ── Dimension accumulators ─────────────────────────────────────────────────
  const byType       = {};  // nearMissType distribution
  const byProfile    = {};  // profile distribution
  const byHeatClass  = {};  // heatClass distribution
  const byRegime     = {};  // regime distribution
  const bySimVerdict = {};  // simulationVerdict distribution
  const bySpreadBand = {};  // spread band distribution
  const byConfBand   = {};  // executionConfidence band distribution

  // ── Per-subtype detail accumulators ───────────────────────────────────────
  const simMarginalSpreads   = [];
  const simMarginalConfs     = [];
  const spreadNearSpreads    = [];
  const spreadNearGaps       = [];
  const highConfRecords      = [];

  for (const r of nearMisses) {
    const nmType    = r.nearMissType   ?? 'unknown';
    const profile   = r.profile        ?? 'unknown';
    const heatClass = r.heatClass      ?? 'unknown';
    const regime    = r.regime         ?? 'unknown';
    const simV      = r.simulationVerdict ?? 'unknown';
    const spread    = r.spreadPct;
    const conf      = r.executionConfidence;

    inc(byType,       nmType);
    inc(byProfile,    profile);
    inc(byHeatClass,  heatClass);
    inc(byRegime,     regime);
    inc(bySimVerdict, simV);
    inc(bySpreadBand, bandLabel(spread, SPREAD_BANDS));
    inc(byConfBand,   bandLabel(conf,   CONFIDENCE_BANDS));

    // Subtype-specific collection
    if (nmType === 'near_miss_sim' || nmType === 'near_miss_multi') {
      simMarginalSpreads.push(spread);
      simMarginalConfs.push(conf);
    }
    if (nmType === 'near_miss_spread' || nmType === 'near_miss_multi') {
      spreadNearSpreads.push(spread);
      // Extract gap from nearMissDetail if present
      const gapMatch = (r.nearMissDetail ?? '').match(/gap=([\d.]+)%/);
      if (gapMatch) spreadNearGaps.push(parseFloat(gapMatch[1]));
    }
    if (conf != null && conf >= HIGH_CONFIDENCE_THRESHOLD) {
      highConfRecords.push({
        candidateAuditId   : r.candidateAuditId,
        nearMissType       : nmType,
        spreadPct          : spread,
        executionConfidence: conf,
        simulationVerdict  : simV,
        profile,
        heatClass,
        regime,
        nearMissDetail     : r.nearMissDetail,
        baseNetProfitUsd   : r.baseNetProfitUsd,
      });
    }
  }

  // Sort high-confidence records by confidence desc
  highConfRecords.sort((a, b) => (b.executionConfidence ?? 0) - (a.executionConfidence ?? 0));

  // ── Answer the five Boss questions ─────────────────────────────────────────
  const dominantType    = _topKey(byType);
  const dominantProfile = _topKey(byProfile);
  const dominantHeat    = _topKey(byHeatClass);

  const spreadNearCount = (byType['near_miss_spread'] ?? 0) +
                           Math.round((byType['near_miss_multi'] ?? 0) * 0.5);
  const simMarginalCount= (byType['near_miss_sim'] ?? 0) +
                           Math.round((byType['near_miss_multi'] ?? 0) * 0.5);
  const primaryDriver   = simMarginalCount >= spreadNearCount ? 'SIM_MARGINAL' : 'SPREAD_BELOW';

  // ── Assemble summary ───────────────────────────────────────────────────────
  return {
    // Population overview
    totalRecords    : total,
    confirmed,
    nearMissCount   : nearMisses.length,
    rejected,

    // Boss question 1: dominant subtype
    dominantNearMissType: dominantType,
    primaryDriver,          // 'SIM_MARGINAL' | 'SPREAD_BELOW'

    // Boss question 2: profile breakdown
    dominantProfile,
    byProfile,

    // Boss question 3: heat class breakdown
    dominantHeatClass: dominantHeat,
    byHeatClass,

    // Boss question 4: spread vs simulation split
    bySimVerdict,
    byType,
    spreadNearMissStats: {
      count  : byType['near_miss_spread'] ?? 0,
      spreads: stats(spreadNearSpreads),
      gaps   : stats(spreadNearGaps),         // how far below threshold
    },
    simMarginalStats: {
      count  : byType['near_miss_sim'] ?? 0,
      spreads: stats(simMarginalSpreads),
      confs  : stats(simMarginalConfs),
    },
    multiNearMissCount: byType['near_miss_multi'] ?? 0,

    // Boss question 5: high-confidence near-misses
    highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
    highConfidenceCount     : highConfRecords.length,
    highConfidenceRecords   : highConfRecords.slice(0, 20),  // top 20

    // Dimensional breakdowns
    byRegime,
    bySpreadBand,
    byConfBand,

    // Spread + confidence stats across all near-misses
    spreadStats: stats(nearMisses.map(r => r.spreadPct)),
    confStats  : stats(nearMisses.map(r => r.executionConfidence)),
  };
}

function _topKey(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
}

function _emptySummary(total, confirmed) {
  return {
    totalRecords: total, confirmed, nearMissCount: 0, rejected: total - confirmed,
    dominantNearMissType: null, primaryDriver: null,
    dominantProfile: null, byProfile: {},
    dominantHeatClass: null, byHeatClass: {},
    bySimVerdict: {}, byType: {},
    spreadNearMissStats: { count: 0, spreads: null, gaps: null },
    simMarginalStats:    { count: 0, spreads: null, confs: null },
    multiNearMissCount: 0,
    highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
    highConfidenceCount: 0, highConfidenceRecords: [],
    byRegime: {}, bySpreadBand: {}, byConfBand: {},
    spreadStats: null, confStats: null,
  };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────

module.exports = {
  analyseNearMisses,
  SPREAD_BANDS,
  CONFIDENCE_BANDS,
  HIGH_CONFIDENCE_THRESHOLD,
};
