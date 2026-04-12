'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Threshold-Edge Accumulator  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/threshold_edge_accumulator.js
//  STATUS    : NEW — Boss ruling 2026-04-12
//
//  PURPOSE
//  ─────────
//  Accumulate THRESHOLD_EDGE_CANDIDATE records across multiple session audit logs
//  to determine whether they form a recurring, stable cross-session class.
//
//  THIS MODULE DOES NOT:
//  ✗ Duplicate or redefine classification rules (uses isThresholdEdge from tracker)
//  ✗ Modify activator, simulator, filter, audit, or tracker logic
//  ✗ Move any threshold
//  ✗ Make RPC calls or I/O
//
//  RECURRENCE VERDICTS
//  ────────────────────
//  INCIDENTAL   — edges appear in <50% of sessions or gap band widens significantly
//  RECURRING    — appear in ≥50% of sessions with moderate gap consistency
//  STRUCTURAL   — appear in ≥75% of sessions, tight gap band, consistent dimensions
//
//  REQUIRED QUESTIONS (Boss ruling 2026-04-12)
//  ────────────────────────────────────────────
//  Q1. Do threshold-edge candidates recur across sessions?
//  Q2. Is the gap band still tight across sessions?
//  Q3. Are AGGRESSIVE / EXTREME / persistent_depth still dominant?
//  Q4. Are the same direction patterns recurring?
//  Q5. Do stronger sessions convert threshold-edge records into confirmed candidates?
// ═══════════════════════════════════════════════════════════════════════════════

const { isThresholdEdge } = require('./threshold_edge_tracker');

// ─── RECURRENCE THRESHOLDS ────────────────────────────────────────────────────
// How consistent does the subset need to be across sessions to graduate verdict?

const STRUCTURAL_SESSION_PCT = 0.75;  // ≥75% of sessions must have edge records
const RECURRING_SESSION_PCT  = 0.50;  // ≥50% of sessions
const STRUCTURAL_GAP_MAX_PCT = 0.010; // max gap width (max-min) for "tight" verdict
const RECURRING_GAP_MAX_PCT  = 0.020; // max gap width for "moderate" verdict

// Minimum sessions before a meaningful verdict can be issued
const MIN_SESSIONS_FOR_VERDICT = 2;

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
    range  : +(sorted[sorted.length - 1] - sorted[0]).toFixed(5),
  };
}

function topKey(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'none';
}

function pctOf(n, d) {
  return d ? +(100 * n / d).toFixed(1) : 0;
}

// ─── SESSION PARSER ───────────────────────────────────────────────────────────

/**
 * Parse a session label from a candidate audit record's timestamp or provided label.
 * Falls back to the date portion of the ts field.
 *
 * @param {object} record
 * @param {string} [sessionLabel]  Explicit session label if known
 * @returns {string}
 */
function deriveSessionLabel(record, sessionLabel) {
  if (sessionLabel) return sessionLabel;
  const ts = record.ts ?? '';
  return ts.slice(0, 10) || 'unknown'; // YYYY-MM-DD
}

// ─── QUESTION 5 HELPER ────────────────────────────────────────────────────────

/**
 * For Q5: check whether threshold-edge spread bands overlap with the
 * confirmed candidates' spread range in a session. If threshold-edge
 * records from session A appear as confirmed in session B (stronger spreads),
 * that counts as conversion evidence.
 *
 * @param {object[]} edgeRecords     All accumulated edge records
 * @param {object[]} allAuditRecords All audit records (all verdicts)
 * @returns {{ evidence: boolean, details: string }}
 */
function analyseConversionEvidence(edgeRecords, allAuditRecords) {
  if (!edgeRecords.length || !allAuditRecords.length) {
    return { evidence: false, details: 'insufficient_data' };
  }

  const confirmed = allAuditRecords.filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED');
  if (!confirmed.length) {
    return { evidence: false, details: 'no_confirmed_candidates_in_any_session' };
  }

  const edgeSpreads = edgeRecords.map(r => r.spreadPct).filter(Boolean);
  const confSpreads = confirmed.map(r => r.spreadPct).filter(Boolean);
  if (!edgeSpreads.length || !confSpreads.length) {
    return { evidence: false, details: 'missing_spread_data' };
  }

  const edgeMax  = Math.max(...edgeSpreads);
  const confMin  = Math.min(...confSpreads);
  const overlap  = edgeMax >= confMin;  // edge spreads reach into confirmed zone

  const edgeMin  = Math.min(...edgeSpreads);
  const details  = overlap
    ? `edge_max=${edgeMax.toFixed(4)}% >= confirmed_min=${confMin.toFixed(4)}% — spreads overlap`
    : `edge_max=${edgeMax.toFixed(4)}% < confirmed_min=${confMin.toFixed(4)}% — gap of ${(confMin - edgeMax).toFixed(4)}%`;

  return { evidence: overlap, details };
}

// ─── PRIMARY ACCUMULATION FUNCTION ────────────────────────────────────────────

/**
 * Accumulate threshold-edge candidates from multiple session audit logs.
 *
 * Each session is passed as { label: string, records: object[] }.
 * Classification uses isThresholdEdge() from threshold_edge_tracker — no duplication.
 *
 * Deterministic: same input → same output always.
 *
 * @param {Array<{ label: string, records: object[] }>} sessions
 * @returns {object}  Accumulator summary
 */
function accumulateThresholdEdge(sessions) {
  if (!Array.isArray(sessions) || !sessions.length) {
    return _emptySummary(0);
  }

  const sessionCount = sessions.length;
  const sessionsSummary = [];
  const allEdgeRecords  = [];
  const allAuditRecords = [];
  let   sessionsWithEdge= 0;

  // ── Dimension accumulators (cross-session) ────────────────────────────────
  const byPair      = {};
  const byDirection = {};
  const byProfile   = {};
  const byHeatClass = {};
  const byRegime    = {};
  const bySession   = {};

  const allGaps     = [];
  const allSpreads  = [];
  const allConfs    = [];
  const allNets     = [];

  // ── Per-session processing ────────────────────────────────────────────────
  for (const { label, records } of sessions) {
    if (!Array.isArray(records)) continue;

    const sessionEdge  = records.filter(isThresholdEdge);
    const sessionConf  = records.filter(r => r?.auditVerdict === 'CANDIDATE_CONFIRMED');

    if (sessionEdge.length) sessionsWithEdge++;

    allAuditRecords.push(...records);

    const sessionGaps   = [];
    const sessionSpreads= [];
    const sessionConfs  = [];

    for (const r of sessionEdge) {
      allEdgeRecords.push({ ...r, _session: label });

      inc(byPair,      r.pair        ?? 'unknown');
      inc(byDirection, r.direction   ?? 'unknown');
      inc(byProfile,   r.profile     ?? 'unknown');
      inc(byHeatClass, r.heatClass   ?? 'unknown');
      inc(byRegime,    r.regime      ?? 'unknown');
      inc(bySession,   label);

      const gapMatch = (r.nearMissDetail ?? '').match(/gap=([\d.]+)%/);
      const gap      = gapMatch ? parseFloat(gapMatch[1]) : null;

      if (gap    != null) { allGaps.push(gap);        sessionGaps.push(gap); }
      if (r.spreadPct != null) { allSpreads.push(r.spreadPct); sessionSpreads.push(r.spreadPct); }
      if (r.executionConfidence != null) { allConfs.push(r.executionConfidence); sessionConfs.push(r.executionConfidence); }
      if (r.baseNetProfitUsd != null) allNets.push(r.baseNetProfitUsd);
    }

    sessionsSummary.push({
      label,
      totalAuditRecords : records.length,
      edgeCount         : sessionEdge.length,
      confirmedCount    : sessionConf.length,
      gapStats          : stats(sessionGaps),
      spreadStats       : stats(sessionSpreads),
      confStats         : stats(sessionConfs),
    });
  }

  // ── Recurrence verdict ────────────────────────────────────────────────────
  const sessionEdgePct = pctOf(sessionsWithEdge, sessionCount);
  const gapSt          = stats(allGaps);
  const gapRange       = gapSt?.range ?? 999;

  let recurrenceVerdict;
  if (sessionCount < MIN_SESSIONS_FOR_VERDICT) {
    recurrenceVerdict = 'INSUFFICIENT_DATA';
  } else if (
    sessionsWithEdge / sessionCount >= STRUCTURAL_SESSION_PCT &&
    gapRange <= STRUCTURAL_GAP_MAX_PCT
  ) {
    recurrenceVerdict = 'STRUCTURAL';
  } else if (
    sessionsWithEdge / sessionCount >= RECURRING_SESSION_PCT &&
    gapRange <= RECURRING_GAP_MAX_PCT
  ) {
    recurrenceVerdict = 'RECURRING';
  } else {
    recurrenceVerdict = 'INCIDENTAL';
  }

  // ── Answer Boss questions ─────────────────────────────────────────────────

  // Q3: dominant dimensions still the same?
  const dominantProfile  = topKey(byProfile);
  const dominantHeat     = topKey(byHeatClass);
  const dominantRegime   = topKey(byRegime);
  const aggressivePct    = pctOf(byProfile['AGGRESSIVE'] ?? 0, allEdgeRecords.length);
  const extremePct       = pctOf(byHeatClass['EXTREME']  ?? 0, allEdgeRecords.length);
  const pdPct            = pctOf(byRegime['persistent_depth_regime'] ?? 0, allEdgeRecords.length);

  // Q4: same direction patterns?
  const dominantDirection= topKey(byDirection);

  // Q5: conversion evidence
  const q5 = analyseConversionEvidence(allEdgeRecords, allAuditRecords);

  return {
    // Population
    sessionCount,
    sessionsWithEdge,
    sessionEdgePct,
    totalEdgeRecords  : allEdgeRecords.length,
    avgEdgePerSession : allEdgeRecords.length / sessionCount,

    // Recurrence verdict
    recurrenceVerdict,
    recurrenceVerdictReason: _verdictReason(recurrenceVerdict, sessionsWithEdge, sessionCount,
      gapRange, gapSt),

    // Q1: recurrence
    q1_recurs          : sessionsWithEdge >= Math.ceil(sessionCount * RECURRING_SESSION_PCT),
    q1_sessionCoverage : `${sessionsWithEdge}/${sessionCount} sessions (${sessionEdgePct}%)`,

    // Q2: gap band tightness
    q2_gapTight        : gapRange <= STRUCTURAL_GAP_MAX_PCT,
    q2_gapStats        : gapSt,

    // Q3: dimension dominance
    q3_aggressiveDominant  : aggressivePct >= 50,
    q3_extremeDominant     : extremePct    >= 50,
    q3_persistentDepthDom  : pdPct         >= 50,
    q3_aggressivePct       : aggressivePct,
    q3_extremePct          : extremePct,
    q3_persistentDepthPct  : pdPct,

    // Q4: direction
    q4_dominantDirection   : dominantDirection,
    q4_directionConsistent : Object.keys(byDirection).length <= 2,
    byDirection,

    // Q5: conversion
    q5_conversionEvidence  : q5.evidence,
    q5_detail              : q5.details,

    // Dimensional breakdowns
    dominantProfile,
    dominantHeatClass : dominantHeat,
    dominantRegime,
    byPair,
    byDirection,
    byProfile,
    byHeatClass,
    byRegime,

    // Cross-session stats
    spreadStats  : stats(allSpreads),
    gapStats     : gapSt,
    confStats    : stats(allConfs),
    netStats     : stats(allNets),

    // Per-session summaries
    sessionsSummary,

    // Sorted canonical records (highest conf first)
    records: allEdgeRecords.sort((a, b) =>
      (b.executionConfidence ?? 0) - (a.executionConfidence ?? 0) ||
      (a.spreadGapPct ?? 999) - (b.spreadGapPct ?? 999)
    ),

    // Constants
    minSessionsForVerdict     : MIN_SESSIONS_FOR_VERDICT,
    structuralSessionPct      : STRUCTURAL_SESSION_PCT,
    recurringSessionPct       : RECURRING_SESSION_PCT,
    structuralGapMaxPct       : STRUCTURAL_GAP_MAX_PCT,
  };
}

function _verdictReason(verdict, withEdge, total, gapRange, gapSt) {
  if (verdict === 'INSUFFICIENT_DATA')
    return `only ${total} session(s) — need ≥${MIN_SESSIONS_FOR_VERDICT}`;
  if (verdict === 'STRUCTURAL')
    return `${withEdge}/${total} sessions (≥${STRUCTURAL_SESSION_PCT*100}%) + gap_range=${gapRange?.toFixed(4)}% (≤${STRUCTURAL_GAP_MAX_PCT}%)`;
  if (verdict === 'RECURRING')
    return `${withEdge}/${total} sessions (≥${RECURRING_SESSION_PCT*100}%) + gap_range=${gapRange?.toFixed(4)}%`;
  return `${withEdge}/${total} sessions (<${RECURRING_SESSION_PCT*100}%) or gap_range=${gapRange?.toFixed(4)}% too wide`;
}

function _emptySummary(sessionCount) {
  return {
    sessionCount, sessionsWithEdge: 0, sessionEdgePct: 0,
    totalEdgeRecords: 0, avgEdgePerSession: 0,
    recurrenceVerdict: sessionCount < MIN_SESSIONS_FOR_VERDICT ? 'INSUFFICIENT_DATA' : 'INCIDENTAL',
    recurrenceVerdictReason: 'no_edge_records_found',
    q1_recurs: false, q1_sessionCoverage: `0/${sessionCount}`,
    q2_gapTight: false, q2_gapStats: null,
    q3_aggressiveDominant: false, q3_extremeDominant: false, q3_persistentDepthDom: false,
    q3_aggressivePct: 0, q3_extremePct: 0, q3_persistentDepthPct: 0,
    q4_dominantDirection: null, q4_directionConsistent: true, byDirection: {},
    q5_conversionEvidence: false, q5_detail: 'no_edge_records',
    dominantProfile: null, dominantHeatClass: null, dominantRegime: null,
    byPair: {}, byProfile: {}, byHeatClass: {}, byRegime: {},
    spreadStats: null, gapStats: null, confStats: null, netStats: null,
    sessionsSummary: [], records: [],
    minSessionsForVerdict: MIN_SESSIONS_FOR_VERDICT,
    structuralSessionPct: STRUCTURAL_SESSION_PCT,
    recurringSessionPct: RECURRING_SESSION_PCT,
    structuralGapMaxPct: STRUCTURAL_GAP_MAX_PCT,
  };
}

module.exports = {
  accumulateThresholdEdge,
  MIN_SESSIONS_FOR_VERDICT,
  STRUCTURAL_SESSION_PCT,
  RECURRING_SESSION_PCT,
  STRUCTURAL_GAP_MAX_PCT,
  RECURRING_GAP_MAX_PCT,
};
