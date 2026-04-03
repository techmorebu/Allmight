'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Session Analyzer  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/analysis/arb_session_analyzer.js
//  STATUS:     CURRENT — Observation phase (Boss directive 2026-03-28)
//
//  PURPOSE
//  ───────
//  Reads logs/surface_timeseries.jsonl (or any JSONL log) and computes the
//  Boss-required summary metrics for the ARB/USDC surface:
//
//    min priceDistanceBps     — closest the price came to the liquidity zone
//    min tickDistance         — same in ticks
//    max depthMin             — highest active-tick depth reached
//    max consecutive ≥$10k   — longest run where both depth≥10k AND net>0
//    surface verdict          — REJECT / WEAK / PROMOTE
//
//  DOES NOT:
//    - modify fetchers, configs, or thresholds
//    - write any files
//    - make RPC calls
//
//  USAGE
//  ─────
//  node scripts/analysis/arb_session_analyzer.js
//  node scripts/analysis/arb_session_analyzer.js --log ./logs/surface_timeseries.jsonl
//  node scripts/analysis/arb_session_analyzer.js --json
//  node scripts/analysis/arb_session_analyzer.js --log ./logs/activator_proximity.jsonl
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2);
const useJson = args.includes('--json');
const logIdx  = args.indexOf('--log');
const logPath = logIdx >= 0
  ? args[logIdx + 1]
  : path.join(process.cwd(), 'logs', 'surface_timeseries.jsonl');

// ─── THRESHOLDS (Boss-defined, do not change without ruling) ──────────────────

const DEPTH_CANDIDATE_USD  = 10_000;  // hard floor for promotion
const ARM_MIN_DEPTH_USD    =  7_000;  // arm floor
const REJECT_BPS_THRESHOLD =    500;  // never got below this → reject
const REJECT_DEPTH_MAX     = 10_000;  // never got above this → reject
const PROMOTE_CONSEC_SCANS =      3;  // must hold ≥3 consecutive scans
const WEAK_BPS_LOWER       =    250;
const WEAK_BPS_UPPER       =    500;

// ─── LOAD LOG ─────────────────────────────────────────────────────────────────

if (!fs.existsSync(logPath)) {
  console.error(`[analyzer] log not found: ${logPath}`);
  console.error(`  Run the timeseries monitor first, or specify --log <path>`);
  process.exit(1);
}

const raw   = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
const recs  = raw.map((line, i) => {
  try { return JSON.parse(line); }
  catch { console.warn(`[analyzer] skip bad line ${i + 1}`); return null; }
}).filter(Boolean);

// Accept both timeseries scan records and heartbeat records from the activator
// Timeseries: type='scan', fields: priceDistanceBps, tickDistance, depthMin, netSpreadFrac
// Activator:  type='heartbeat', same field names
const scans = recs.filter(r =>
  r.type === 'scan' || r.type === 'heartbeat'
).filter(r =>
  typeof r.priceDistanceBps === 'number' &&
  typeof r.tickDistance     === 'number' &&
  typeof r.depthMin         === 'number'
);

if (scans.length === 0) {
  console.error(`[analyzer] no usable scan/heartbeat records found in ${logPath}`);
  console.error(`  Found record types: ${[...new Set(recs.map(r => r.type))].join(', ')}`);
  process.exit(1);
}

// ─── COMPUTE METRICS ─────────────────────────────────────────────────────────

let minBps       = Infinity;
let minTicks     = Infinity;
let maxDepth     = 0;
let maxConsec    = 0;
let curConsec    = 0;
let totalScans   = scans.length;
let armedScans   = 0;
let positiveNet  = 0;

// Time window
const firstTs = scans[0].ts;
const lastTs  = scans[scans.length - 1].ts;
const durationMin = (new Date(lastTs) - new Date(firstTs)) / 60_000;

// Geometry trends — first vs last
const first = scans[0];
const last  = scans[scans.length - 1];

for (const s of scans) {
  if (s.priceDistanceBps < minBps)  minBps  = s.priceDistanceBps;
  if (s.tickDistance     < minTicks) minTicks = s.tickDistance;
  if (s.depthMin         > maxDepth) maxDepth = s.depthMin;

  const netPositive = typeof s.netSpreadFrac === 'number' ? s.netSpreadFrac > 0 : false;
  if (netPositive) positiveNet++;

  // Consecutive ≥10k AND net > 0
  if (s.depthMin >= DEPTH_CANDIDATE_USD && netPositive) {
    curConsec++;
    if (curConsec > maxConsec) maxConsec = curConsec;
  } else {
    curConsec = 0;
  }

  // Armed scans (depth ≥ ARM_MIN_DEPTH for quality gate reference)
  if (s.depthMin >= ARM_MIN_DEPTH_USD) armedScans++;
}

// ─── VERDICT ─────────────────────────────────────────────────────────────────

let verdict, verdictReason;

if (minBps > REJECT_BPS_THRESHOLD || maxDepth < REJECT_DEPTH_MAX) {
  verdict = 'REJECT';
  const reasons = [];
  if (minBps > REJECT_BPS_THRESHOLD)
    reasons.push(`never got below ${REJECT_BPS_THRESHOLD} bps distance (min: ${minBps.toFixed(1)})`);
  if (maxDepth < REJECT_DEPTH_MAX)
    reasons.push(`depth never exceeded $${(REJECT_DEPTH_MAX/1000).toFixed(0)}k (max: $${maxDepth.toFixed(0)})`);
  verdictReason = reasons.join(' AND ');
} else if (maxConsec >= PROMOTE_CONSEC_SCANS) {
  verdict = 'PROMOTE';
  verdictReason = `depth ≥ $10k AND net > 0 held for ${maxConsec} consecutive scans (threshold: ${PROMOTE_CONSEC_SCANS})`;
} else if (minBps >= WEAK_BPS_LOWER && minBps <= WEAK_BPS_UPPER) {
  verdict = 'WEAK';
  verdictReason = `entered ${WEAK_BPS_LOWER}–${WEAK_BPS_UPPER} bps range but never held ≥$10k for ${PROMOTE_CONSEC_SCANS} consecutive scans`;
} else {
  // Got below 500 bps and/or above 10k depth, but not consistently enough
  verdict = 'WEAK';
  verdictReason = `approaching thresholds but not holding — max depth $${maxDepth.toFixed(0)}, max consec ${maxConsec}/${PROMOTE_CONSEC_SCANS}`;
}

// ─── OUTPUT ───────────────────────────────────────────────────────────────────

const result = {
  ts          : new Date().toISOString(),
  logFile     : path.basename(logPath),
  pair        : scans[0].pair  || 'ARB/USDC',
  chain       : scans[0].chain || 'arbitrum',
  windowStart : firstTs,
  windowEnd   : lastTs,
  durationMin : +durationMin.toFixed(1),
  totalScans,

  // Boss-required summary fields
  minPriceDistanceBps : +minBps.toFixed(1),
  minTickDistance     : minTicks,
  maxDepthMin         : +maxDepth.toFixed(0),
  maxConsecAbove10k   : maxConsec,

  // Supporting context
  positiveNetScans    : positiveNet,
  armedDepthScans     : armedScans,   // scans where depth ≥ $7k
  geometryTrend: {
    bpsStart  : first.priceDistanceBps,
    bpsEnd    : last.priceDistanceBps,
    bpsDelta  : +(last.priceDistanceBps - first.priceDistanceBps).toFixed(1),
    tickStart : first.tickDistance,
    tickEnd   : last.tickDistance,
    tickDelta : last.tickDistance - first.tickDistance,
    depthStart: first.depthMin,
    depthEnd  : last.depthMin,
    depthDelta: +(last.depthMin - first.depthMin).toFixed(0),
  },

  // Verdict
  verdict,
  verdictReason,

  // Hard thresholds used (for audit trail)
  thresholds: {
    DEPTH_CANDIDATE_USD,
    ARM_MIN_DEPTH_USD,
    REJECT_BPS_THRESHOLD,
    REJECT_DEPTH_MAX,
    PROMOTE_CONSEC_SCANS,
  },
};

if (useJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// ─── HUMAN REPORT ─────────────────────────────────────────────────────────────

const W    = 72;
const LINE = '─'.repeat(W);
const DBLE = '═'.repeat(W);

const v = (label, val, unit = '') =>
  `  ${label.padEnd(32)} ${String(val).padStart(12)}${unit}`;

console.log('\n' + DBLE);
console.log(' ALLMIGHT — SURFACE SESSION ANALYZER');
console.log(` Pair: ${result.pair}  |  Chain: ${result.chain}`);
console.log(` Window: ${firstTs.slice(0,16)} → ${lastTs.slice(0,16)} UTC  (${durationMin.toFixed(0)} min)`);
console.log(` Scans: ${totalScans}  |  Log: ${path.basename(logPath)}`);
console.log(LINE);

console.log(' BOSS SUMMARY METRICS:');
console.log(v('min priceDistanceBps',   result.minPriceDistanceBps,  ' bps'));
console.log(v('min tickDistance',       result.minTickDistance,       ' ticks'));
console.log(v('max depthMin',          '$' + result.maxDepthMin,      ''));
console.log(v('max consecutive ≥$10k', result.maxConsecAbove10k,      ' scans'));
console.log(LINE);

console.log(' GEOMETRY TREND:');
const g = result.geometryTrend;
console.log(v('bps distance start→end', `${g.bpsStart} → ${g.bpsEnd}`, ` (${g.bpsDelta > 0 ? '+' : ''}${g.bpsDelta})`));
console.log(v('tick distance start→end', `${g.tickStart} → ${g.tickEnd}`, ` (${g.tickDelta > 0 ? '+' : ''}${g.tickDelta})`));
console.log(v('depth start→end', `$${g.depthStart} → $${g.depthEnd}`, ` (${g.depthDelta > 0 ? '+' : ''}${g.depthDelta})`));
console.log(v('scans with positive net', positiveNet, `/${totalScans}`));
console.log(v('scans with depth ≥ $7k', armedScans,  `/${totalScans}`));
console.log(LINE);

const ICONS = { PROMOTE: '✅', WEAK: '⚠️ ', REJECT: '❌' };
console.log(` VERDICT: ${ICONS[verdict]} ${verdict}`);
console.log(`  ${verdictReason}`);
console.log(LINE);

if (verdict === 'REJECT') {
  console.log(' NEXT ACTION: surface does not meet minimum criteria — consider pivot.');
} else if (verdict === 'PROMOTE') {
  console.log(' NEXT ACTION: surface eligible for promotion — await Boss ruling.');
} else {
  console.log(' NEXT ACTION: continue monitoring — surface is approaching but not holding.');
}
console.log(DBLE + '\n');
