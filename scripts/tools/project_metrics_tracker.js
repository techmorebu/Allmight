#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  scripts/tools/project_metrics_tracker.js
//  PROJECT ALLMIGHT — Lifetime Performance Ledger  v1.0
//
//  Tracks ALL completed sessions into a persistent cross-session record.
//  Analytics only — never modifies running sessions or strategy.
//
//  Usage:
//    node scripts/tools/project_metrics_tracker.js --scan logs/sessions/
//    node scripts/tools/project_metrics_tracker.js --session logs/sessions/session_YYYYMMDD_HHMM
//    node scripts/tools/project_metrics_tracker.js --summary
//    node scripts/tools/project_metrics_tracker.js --self-test
//
//  Outputs (all in logs/project_metrics/):
//    lifetime_sessions.jsonl   — one record per completed session (idempotent)
//    lifetime_summary.json     — rolling totals across all sessions
//    hourly_performance.json   — value/confirmed by UTC hour
//    strategic_metrics.json    — trends, best windows, efficiency rankings
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────
const METRICS_DIR    = path.resolve(process.cwd(), 'logs/project_metrics');
const SESSIONS_JSONL = path.join(METRICS_DIR, 'lifetime_sessions.jsonl');
const SUMMARY_JSON   = path.join(METRICS_DIR, 'lifetime_summary.json');
const HOURLY_JSON    = path.join(METRICS_DIR, 'hourly_performance.json');
const STRATEGIC_JSON = path.join(METRICS_DIR, 'strategic_metrics.json');

const PATCH_BOUNDARY = '2026-04-26T10:11:09Z'; // P1/P2/P3/SCI hot-apply boundary

// ── Helpers ───────────────────────────────────────────────────────────────────
function tsEpoch(s) {
  try { return new Date(s).getTime(); } catch { return null; }
}

function safeNum(v, fallback = null) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function rjsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const l of lines) {
    try { out.push(JSON.parse(l)); } catch { /* skip malformed */ }
  }
  return out;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function firstNum(obj, keys, fallback = 0) {
  for (const key of keys) {
    const v = obj?.[key];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function firstStr(obj, keys, fallback = 'none') {
  for (const key of keys) {
    const v = obj?.[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
  }
  return fallback;
}

function topReasonFromRecords(records) {
  const counts = {};
  for (const r of records) {
    const reasons = Array.isArray(r.blockedReasons) ? r.blockedReasons
      : Array.isArray(r.liveBlockedBy) ? r.liveBlockedBy
      : r.topBlockedReason ? [r.topBlockedReason]
      : r.mainBlocker ? [r.mainBlocker]
      : [];
    for (const raw of reasons) {
      const reason = String(raw || '').split(':')[0].slice(0, 60) || 'unknown';
      counts[reason] = (counts[reason] || 0) + 1;
    }
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : 'none';
}

function extractShadowMetrics(sessionDir, durationH = null) {
  const totals = readJson(path.join(sessionDir, 'shadow_execution_totals.json'));
  const ledger = rjsonl(path.join(sessionDir, 'shadow_execution_ledger.jsonl'));

  if (totals) {
    const shadowCandidates = firstNum(totals, ['totalCandidates', 'candidates', 'total'], 0);
    const wouldTrade = firstNum(totals, ['wouldTradeIfLive', 'wouldTradeCount', 'wouldTrade', 'wouldTradeSignals'], 0);
    const shadowProfit = firstNum(totals, ['shadowEstimatedProfitUsd', 'shadowEstimatedValueUsd', 'shadowProfitUsd', 'shadowValueUsd', 'estimatedProfitUsd'], 0);
    const shadowValuePerHour = firstNum(totals, ['shadowEstimatedValuePerHour', 'shadowValuePerHour', 'valuePerHour'], durationH ? shadowProfit / durationH : 0);
    const bestScore = firstNum(totals, ['bestExecutionScore', 'maxExecutionScore', 'bestScore', 'maxScore'], 0);
    const avgScore = firstNum(totals, ['avgExecutionScore', 'averageExecutionScore', 'avgScore'], 0);
    const topBlocker = firstStr(totals, ['topBlockedReason', 'mainBlocker', 'topLifetimeBlocker'], 'none');
    return { shadowSource:'totals', shadowCandidates, wouldTradeIfLive:wouldTrade, shadowEstimatedProfitUsd:+shadowProfit.toFixed(4), shadowValuePerHour:+shadowValuePerHour.toFixed(4), bestExecutionScore:+bestScore.toFixed(1), avgExecutionScore:+avgScore.toFixed(1), crossedPaper:Boolean(totals.crossedPaper ?? totals.sessionsCrossedPaper ?? bestScore >= 75), crossedDryWallet:Boolean(totals.crossedDryWallet ?? totals.crossedDry ?? totals.sessionsCrossedDryWallet ?? bestScore >= 85), crossedMicroEligible:Boolean(totals.crossedMicroEligible ?? totals.crossedMicro ?? totals.sessionsCrossedMicroEligible ?? bestScore >= 92), topShadowBlocker:topBlocker };
  }

  if (!ledger.length) {
    return { shadowSource:'missing', shadowCandidates:0, wouldTradeIfLive:0, shadowEstimatedProfitUsd:0, shadowValuePerHour:0, bestExecutionScore:0, avgExecutionScore:0, crossedPaper:false, crossedDryWallet:false, crossedMicroEligible:false, topShadowBlocker:'none' };
  }

  const scores = ledger.map(r => Number(r.executionScore ?? r.score ?? 0)).filter(Number.isFinite);
  const bestScore = scores.length ? Math.max(...scores) : 0;
  const avgScore = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;
  const wouldTrade = ledger.filter(r => r.wouldTrade === true || r.wouldTradeIfLive === true || r.gateVerdict === 'MICRO_LIVE_ELIGIBLE').length;
  const shadowProfit = ledger.reduce((sum, r) => sum + firstNum(r, ['estimatedProfitUsd', 'shadowEstimatedProfitUsd', 'estimatedNetUsd', 'shadowValueUsd'], 0), 0);
  const times = ledger.map(r => Date.parse(r.ts)).filter(Number.isFinite).sort((a,b)=>a-b);
  const durH = durationH || (times.length >= 2 ? Math.max((times[times.length-1] - times[0]) / 3600000, 0.01) : 1);
  return { shadowSource:'ledger', shadowCandidates:ledger.length, wouldTradeIfLive:wouldTrade, shadowEstimatedProfitUsd:+shadowProfit.toFixed(4), shadowValuePerHour:+(shadowProfit / durH).toFixed(4), bestExecutionScore:+bestScore.toFixed(1), avgExecutionScore:+avgScore.toFixed(1), crossedPaper:bestScore >= 75, crossedDryWallet:bestScore >= 85, crossedMicroEligible:bestScore >= 92, topShadowBlocker:topReasonFromRecords(ledger) };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function appendJsonl(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
}

// ── Session extractor ─────────────────────────────────────────────────────────
function extractSessionMetrics(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');

  // ── Load all files (fail-soft) ────────────────────────────────────────────
  const act    = rjsonl(path.join(sessionDir, 'activator.jsonl'));
  const bp     = rjsonl(path.join(sessionDir, 'blueprints.jsonl'));
  const audit  = rjsonl(path.join(sessionDir, 'execution_candidate_audit.jsonl'));
  const rpc    = rjsonl(path.join(sessionDir, 'rpc_freshness.jsonl'));
  const wd     = rjsonl(path.join(sessionDir, 'watchdog.jsonl'));
  const al     = fs.existsSync(path.join(sessionDir, 'analysis.log'))
    ? fs.readFileSync(path.join(sessionDir, 'analysis.log'), 'utf8') : '';
  const sb     = readJson(path.join(sessionDir, 'sandbox_results.json'));
  const totals = readJson(path.join(sessionDir, 'session_totals.json'));

  // ── Session timing ────────────────────────────────────────────────────────
  const actTs   = act.filter(r => r.ts).map(r => tsEpoch(r.ts)).filter(Boolean).sort((a,b)=>a-b);
  const rpcTs   = rpc.filter(r => r.ts).map(r => tsEpoch(r.ts)).filter(Boolean).sort((a,b)=>a-b);
  const firstTs = actTs[0] ?? rpcTs[0] ?? null;
  const lastTs  = actTs[actTs.length-1] ?? null;
  const durMs   = (firstTs && lastTs) ? (lastTs - firstTs) : null;
  const durH    = durMs ? durMs / 3_600_000 : null;
  const shadow  = extractShadowMetrics(sessionDir, durH);

  if (!firstTs || !durH || durH < 0.1) {
    return null; // too short or no timestamp data — skip
  }

  const sessionStart = new Date(firstTs).toISOString();
  const sessionEnd   = lastTs ? new Date(lastTs).toISOString() : null;
  const startHourUtc = new Date(firstTs).getUTCHours();
  const dateStr      = new Date(firstTs).toISOString().slice(0, 10);
  const dow          = new Date(firstTs).getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend    = (dow === 0 || dow === 6);

  // ── Detection ─────────────────────────────────────────────────────────────
  const signals   = act.filter(r => r.type === 'signal').length;
  const hbRecs    = act.filter(r => r.type === 'heartbeat');

  // Use session_totals.json if available (P1 accumulator) else audit file
  // Final fallback: viableBp.length (blueprints = signals that passed ready-check)
  let confirmed, nearMiss, rejected;
  if (totals && totals.totalConfirmed > 0) {
    confirmed = totals.totalConfirmed;
    nearMiss  = audit.filter(r => r.auditVerdict === 'CANDIDATE_NEAR_MISS').length;
    rejected  = audit.filter(r => r.auditVerdict === 'CANDIDATE_REJECTED').length;
  } else if (audit.length > 0) {
    confirmed = audit.filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED').length;
    nearMiss  = audit.filter(r => r.auditVerdict === 'CANDIDATE_NEAR_MISS').length;
    rejected  = audit.filter(r => r.auditVerdict === 'CANDIDATE_REJECTED').length;
  } else {
    // No audit file (mid-session or stop pipeline not run)
    // Use viable blueprints as confirmed proxy (best available)
    confirmed = bp.filter(r => r.viability?.economicStatus === 'economically_viable').length;
    nearMiss  = 0;
    rejected  = 0;
  }

  // ── Blueprint economics ────────────────────────────────────────────────────
  const viableBp = bp.filter(r => r.viability?.economicStatus === 'economically_viable');
  const totalNet = viableBp.reduce((s, r) => s + (r.economics?.netProfitUsd ?? 0), 0);
  const estValue = totals?.totalEstValueUsd ?? totalNet;
  const avgNet   = viableBp.length > 0 ? totalNet / viableBp.length : null;
  const avgSize  = viableBp.length > 0
    ? viableBp.reduce((s, r) => s + (r.sizing?.targetUsd ?? 0), 0) / viableBp.length : null;
  const avgSpread = viableBp.length > 0
    ? viableBp.reduce((s, r) => s + (r.economics?.spreadPct ?? 0), 0) / viableBp.length : null;
  const maxSpread = viableBp.length > 0
    ? Math.max(...viableBp.map(r => r.economics?.spreadPct ?? 0)) : null;
  const valuePerHour    = durH > 0 ? estValue / durH : null;
  const valuePerConfirmed = confirmed > 0 ? estValue / confirmed : null;

  // ── Sandbox ────────────────────────────────────────────────────────────────
  const sbSum         = sb?.summary ?? null;
  const sandboxViable = sbSum?.viableRate ?? null;
  const sandbox0ms    = sbSum?.byDelay?.['0']?.viableRate ?? null;

  // ── Adaptive capture ──────────────────────────────────────────────────────
  const AAVE = 5.0; const VIABLE_MIN = 0.10; const LADDER = [200,300,500,750,1000];
  const recs0 = (sb?.results ?? []).filter(r => r.delayMs === 0 && r.outcome !== 'SANDBOX_NO_FILL');
  let adaptiveViable = 0;
  for (const r of recs0) {
    const fbps = r.feeBps ?? 6; const sbps = r.spreadBps ?? 0; const gas = r.gasUsd ?? 0.028;
    const ns = sbps - fbps - AAVE;
    if (ns <= 0) continue;
    for (const sz of LADDER) { if (sz*(ns/10000)-gas >= VIABLE_MIN) { adaptiveViable++; break; } }
  }
  const adaptiveCapturePct = recs0.length > 0 ? (adaptiveViable / recs0.length * 100) : null;

  // ── Spread quality buckets ─────────────────────────────────────────────────
  const spreadBuckets = { lt15: 0, b15_20: 0, b20_25: 0, gt25: 0 };
  const spreadBucketValue = { lt15: 0, b15_20: 0, b20_25: 0, gt25: 0 };
  for (const r of viableBp) {
    const spr  = (r.economics?.spreadPct ?? 0) * 100; // to bps
    const val  = r.economics?.netProfitUsd ?? 0;
    const bkt  = spr < 15 ? 'lt15' : spr < 20 ? 'b15_20' : spr < 25 ? 'b20_25' : 'gt25';
    spreadBuckets[bkt]++;
    spreadBucketValue[bkt] = +(spreadBucketValue[bkt] + val).toFixed(4);
  }
  const confirmedSpreads = audit
    .filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED' && r.spreadPct)
    .map(r => r.spreadPct * 100); // to bps
  const avgConfirmedSpreadBps = confirmedSpreads.length > 0
    ? confirmedSpreads.reduce((a,b)=>a+b,0) / confirmedSpreads.length : null;
  const maxConfirmedSpreadBps = confirmedSpreads.length > 0
    ? Math.max(...confirmedSpreads) : null;

  // ── Heat effectiveness ────────────────────────────────────────────────────
  const heatClasses = ['EXTREME','HOT','WARM','COLD','UNKNOWN'];
  const confirmedByHeat = Object.fromEntries(heatClasses.map(h => [h, 0]));
  const valueByHeat     = Object.fromEntries(heatClasses.map(h => [h, 0]));
  for (const r of audit.filter(a => a.auditVerdict === 'CANDIDATE_CONFIRMED')) {
    const h = r.heatClass ?? 'UNKNOWN';
    confirmedByHeat[h] = (confirmedByHeat[h] ?? 0) + 1;
    valueByHeat[h]     = +((valueByHeat[h] ?? 0) + (r.baseNetProfitUsd ?? 0)).toFixed(4);
  }
  // False heat: heartbeat windows where heat is HOT/EXTREME but no confirmed in that window
  const hotHbWindows   = hbRecs.filter(r => r.heatClass === 'HOT' || r.heatClass === 'EXTREME').length;
  const falseHeatCount = Math.max(0, hotHbWindows - (confirmedByHeat.HOT + confirmedByHeat.EXTREME));
  const falseHeatRate  = hotHbWindows > 0 ? falseHeatCount / hotHbWindows : null;
  const bestHeatClass  = heatClasses.reduce((best, h) =>
    confirmedByHeat[h] > confirmedByHeat[best] ? h : best, 'EXTREME');

  // ── Reliability ───────────────────────────────────────────────────────────
  const restartLines  = al.split('\n').filter(l => l.includes('auto-restart attempt'));
  const restartCount  = totals?.restartCount ?? restartLines.length;

  // Silence gaps > 5 min
  const gaps = [];
  for (let i = 1; i < actTs.length; i++) {
    const dt = actTs[i] - actTs[i-1];
    if (dt > 300_000) gaps.push(dt / 60_000);
  }
  const totalGapMin   = gaps.reduce((s,g) => s+g, 0);
  const activeH       = Math.max(0, (durH ?? 0) - totalGapMin/60);
  const lostValueEst  = activeH > 0 && durH > 0
    ? (estValue / Math.max(activeH, 0.1)) * (totalGapMin/60) : 0;

  // Policy PAUSE minutes from analysis.log
  const policyLines = al.split('\n').filter(l => l.includes('Mode change detected'));
  let pauseMin = 0;
  let inPause = false; let pauseStart = null;
  for (const l of policyLines) {
    const m = l.match(/(\d{2}:\d{2}:\d{2})/);
    const ts = m ? m[1] : null;
    if (l.includes('→ PAUSE')) { inPause = true; pauseStart = ts; }
    else if (l.includes('PAUSE →') && inPause && pauseStart && ts) {
      // estimate minutes from time strings
      const [h1,m1,s1] = pauseStart.split(':').map(Number);
      const [h2,m2,s2] = ts.split(':').map(Number);
      const delta = ((h2*3600+m2*60+s2) - (h1*3600+m1*60+s1));
      if (delta > 0 && delta < 7200) pauseMin += delta / 60;
      inPause = false;
    }
  }

  // Watchdog restarts
  const wdRestarts = al.split('\n').filter(l => l.includes('PROCESS_RESTARTED')).length;
  const staleMonitor = al.split('\n').filter(l => l.includes('volatility:STALE') || l.includes('volatility:MISSING')).length;

  // ── RPC efficiency ────────────────────────────────────────────────────────
  const totalRpc    = rpc.length;
  const rpcPerSec   = durH && totalRpc > 0 ? totalRpc / (durH * 3600) : null;
  const primaryRpc  = rpc.filter(r => {
    // Primary = Tenderly (freshest endpoint, lowest penalty label)
    return r.ev === 'rpc_select' && r.url && (
      r.url.toLowerCase().includes('tenderly') ||
      (!r.url.toLowerCase().includes('infura') && !r.url.toLowerCase().includes('ankr'))
    );
  }).length;
  const failoverRpc  = rpc.filter(r => r.ev === 'rpc_select' && r.url &&
    r.url.toLowerCase().includes('infura')).length;
  const failoverPct  = (primaryRpc + failoverRpc) > 0
    ? failoverRpc / (primaryRpc + failoverRpc) * 100 : null;
  const rpcPerConfirmed = confirmed > 0 ? totalRpc / confirmed : null;
  const rpcPerDollar    = estValue > 0 ? totalRpc / estValue : null;
  const exhaustedEvents = rpc.filter(r => r.ev === 'rpc_exhausted').length;

  // Quota from last quota_snapshot
  const quotaSnaps = rpc.filter(r => r.ev === 'quota_snapshot');
  const lastQuota  = quotaSnaps[quotaSnaps.length - 1] ?? null;

  // ── Value by UTC hour ─────────────────────────────────────────────────────
  // Use blueprints.ts + netProfitUsd to build hourly value
  const valueByUtcHour  = {};
  const confirmedByUtcHour = {};
  const signalsByUtcHour   = {};
  for (const b of viableBp) {
    const hr = new Date(b.ts).getUTCHours();
    valueByUtcHour[hr]    = +((valueByUtcHour[hr]    ?? 0) + (b.economics?.netProfitUsd ?? 0)).toFixed(4);
    confirmedByUtcHour[hr]= (confirmedByUtcHour[hr] ?? 0) + 1;
  }
  for (const r of act.filter(a => a.type === 'signal')) {
    const hr = new Date(r.ts).getUTCHours();
    signalsByUtcHour[hr] = (signalsByUtcHour[hr] ?? 0) + 1;
  }
  const valueByHourTotals = totals?.valueByHour ?? {};
  const bestHourEntry  = Object.entries(valueByUtcHour).sort((a,b) => b[1]-a[1])[0];
  const worstHourEntry = Object.entries(valueByUtcHour).sort((a,b) => a[1]-b[1])[0];

  // ── Near-miss analysis ────────────────────────────────────────────────────
  const nmTypes = {};
  for (const r of audit.filter(a => a.auditVerdict === 'CANDIDATE_NEAR_MISS')) {
    const t = r.nearMissType ?? 'unknown';
    nmTypes[t] = (nmTypes[t] ?? 0) + 1;
  }

  // ── Build the record ──────────────────────────────────────────────────────
  return {
    // Identity
    sessionId,
    dateStr,
    sessionStart,
    sessionEnd,
    startHourUtc,
    isWeekend,
    dayOfWeek: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow],
    patchBoundary: firstTs < tsEpoch(PATCH_BOUNDARY) ? 'pre-patch' :
                   lastTs  > tsEpoch(PATCH_BOUNDARY) ? 'mixed'     : 'post-patch',

    // Duration
    durationH:   durH !== null ? +durH.toFixed(3) : null,
    durationMin: durH !== null ? +(durH * 60).toFixed(1) : null,

    // Validity
    validity: (() => {
      if (!durH || durH < 0.25) return 'invalid';
      if (!confirmed || !sb) return 'partial';
      return 'valid'; // Boss C9 required separately
    })(),

    // Detection
    signals,
    confirmed,
    nearMiss,
    rejected,
    confirmedPerHour:  durH ? +(confirmed / durH).toFixed(2) : null,
    signalsPerHour:    durH ? +(signals / durH).toFixed(2) : null,
    nearMissRatio:     confirmed > 0 ? +(nearMiss / confirmed).toFixed(3) : null,
    nearMissTypes:     nmTypes,

    // Economics
    totalEstValueUsd:     +estValue.toFixed(4),
    valuePerHour:         valuePerHour !== null ? +valuePerHour.toFixed(4) : null,
    valuePerConfirmed:    valuePerConfirmed !== null ? +valuePerConfirmed.toFixed(4) : null,
    avgNetPerTrade:       avgNet !== null ? +avgNet.toFixed(4) : null,
    avgTradeSizeUsd:      avgSize !== null ? +avgSize.toFixed(2) : null,
    viableBlueprintCount: viableBp.length,
    viableRate:           bp.length > 0 ? +(viableBp.length / bp.length * 100).toFixed(1) : null,
    sandboxViableRate:    sandboxViable !== null ? +sandboxViable.toFixed(2) : null,
    sandbox0msViableRate: sandbox0ms !== null ? +sandbox0ms.toFixed(2) : null,
    adaptiveCapturePct:   adaptiveCapturePct !== null ? +adaptiveCapturePct.toFixed(1) : null,

    // Shadow execution / would-have-traded analytics
    shadowSource:              shadow.shadowSource,
    shadowCandidates:          shadow.shadowCandidates,
    wouldTradeIfLive:          shadow.wouldTradeIfLive,
    shadowEstimatedProfitUsd:  shadow.shadowEstimatedProfitUsd,
    shadowValuePerHour:        shadow.shadowValuePerHour,
    bestExecutionScore:        shadow.bestExecutionScore,
    avgExecutionScore:         shadow.avgExecutionScore,
    crossedPaper:              shadow.crossedPaper,
    crossedDryWallet:          shadow.crossedDryWallet,
    crossedMicroEligible:      shadow.crossedMicroEligible,
    topShadowBlocker:          shadow.topShadowBlocker,

    // Spread quality
    avgSpreadPct:          avgSpread !== null ? +avgSpread.toFixed(4) : null,
    maxSpreadPct:          maxSpread !== null ? +maxSpread.toFixed(4) : null,
    avgConfirmedSpreadBps: avgConfirmedSpreadBps !== null ? +avgConfirmedSpreadBps.toFixed(2) : null,
    maxConfirmedSpreadBps: maxConfirmedSpreadBps !== null ? +maxConfirmedSpreadBps.toFixed(2) : null,
    spreadBuckets,
    spreadBucketValue,

    // Heat effectiveness
    confirmedByHeat,
    valueByHeat,
    bestHeatClass,
    falseHeatRate: falseHeatRate !== null ? +falseHeatRate.toFixed(3) : null,

    // Value by hour
    valueByUtcHour:    Object.fromEntries(Object.entries(valueByUtcHour).map(([k,v]) => [k, +v.toFixed(4)])),
    confirmedByUtcHour,
    signalsByUtcHour,
    bestUtcHour:       bestHourEntry  ? +bestHourEntry[0]  : null,
    worstUtcHour:      worstHourEntry ? +worstHourEntry[0] : null,

    // Reliability
    restartCount,
    silenceGapCount:   gaps.length,
    totalSilenceMin:   +totalGapMin.toFixed(1),
    downtimePct:       durH > 0 ? +(totalGapMin/60 / durH * 100).toFixed(1) : null,
    lostValueEst:      +lostValueEst.toFixed(4),
    pauseMinutes:      +pauseMin.toFixed(1),
    watchdogRestarts:  wdRestarts,
    staleMonitorEvents: staleMonitor,

    // RPC efficiency
    totalRpcCalls:    totalRpc,
    rpcPerSec:        rpcPerSec !== null ? +rpcPerSec.toFixed(3) : null,
    primaryRpcCalls:  primaryRpc,
    failoverRpcCalls: failoverRpc,
    failoverPct:      failoverPct !== null ? +failoverPct.toFixed(1) : null,
    rpcPerConfirmed:  rpcPerConfirmed !== null ? +rpcPerConfirmed.toFixed(1) : null,
    rpcPerDollar:     rpcPerDollar !== null ? +rpcPerDollar.toFixed(1) : null,
    exhaustedEvents,
    quotaUsedPct:     lastQuota?.pctUsed ? +lastQuota.pctUsed : null,

    // Cumulative (P1 accumulator if available)
    crossRestartConfirmed: totals?.totalConfirmed ?? null,
    crossRestartValueUsd:  totals?.totalEstValueUsd ?? null,

    // Metadata
    recordedAt: new Date().toISOString(),
  };
}

// ── Lifetime summary builder ──────────────────────────────────────────────────
function buildLifetimeSummary(sessions) {
  if (!sessions.length) return {};

  const valid   = sessions.filter(s => s.validity === 'valid');
  const partial = sessions.filter(s => s.validity === 'partial');
  const withVal = sessions.filter(s => s.totalEstValueUsd > 0);

  const totalRunH    = sessions.reduce((s,r) => s + (r.durationH ?? 0), 0);
  const totalConf    = sessions.reduce((s,r) => s + (r.confirmed ?? 0), 0);
  const totalValue   = sessions.reduce((s,r) => s + (r.totalEstValueUsd ?? 0), 0);
  const totalRpc     = sessions.reduce((s,r) => s + (r.totalRpcCalls ?? 0), 0);
  const totalRestarts= sessions.reduce((s,r) => s + (r.restartCount ?? 0), 0);
  const totalGapMin  = sessions.reduce((s,r) => s + (r.totalSilenceMin ?? 0), 0);

  const totalShadowProfit = sessions.reduce((s,r) => s + (r.shadowEstimatedProfitUsd ?? 0), 0);
  const totalWouldTrade   = sessions.reduce((s,r) => s + (r.wouldTradeIfLive ?? 0), 0);
  const withShadow        = sessions.filter(s => (s.shadowEstimatedProfitUsd ?? 0) > 0);
  const bestShadow        = [...withShadow].sort((a,b) => (b.shadowEstimatedProfitUsd ?? 0) - (a.shadowEstimatedProfitUsd ?? 0))[0];

  return {
    generatedAt:             new Date().toISOString(),
    sessions:                sessions.length,
    validSessions:           valid.length,
    partialSessions:         partial.length,
    invalidSessions:         sessions.filter(s => s.validity === 'invalid').length,
    totalRuntimeHours:       +totalRunH.toFixed(2),
    totalConfirmed:          totalConf,
    totalEstimatedValue:     +totalValue.toFixed(4),
    avgValuePerHour:         totalRunH > 0 ? +(totalValue / totalRunH).toFixed(4) : null,
    lifetimeShadowProfitUsd: +totalShadowProfit.toFixed(4),
    lifetimeWouldTradeCount: totalWouldTrade,
    avgShadowValuePerHour:   totalRunH > 0 ? +(totalShadowProfit / totalRunH).toFixed(4) : null,
    bestShadowSession:       bestShadow?.sessionId ?? null,
    bestShadowSessionValue:  bestShadow ? +(bestShadow.shadowEstimatedProfitUsd ?? 0).toFixed(4) : null,
    sessionsCrossedPaper:    sessions.filter(s => s.crossedPaper).length,
    sessionsCrossedDryWallet:sessions.filter(s => s.crossedDryWallet).length,
    sessionsCrossedMicroEligible: sessions.filter(s => s.crossedMicroEligible).length,
    avgConfirmedPerHour:     totalRunH > 0 ? +(totalConf / totalRunH).toFixed(2) : null,
    bestSessionValue:        withVal.length > 0 ? Math.max(...withVal.map(s => s.totalEstValueUsd)) : null,
    bestSessionId:           withVal.sort((a,b) => b.totalEstValueUsd-a.totalEstValueUsd)[0]?.sessionId ?? null,
    avgRpcCallsPerConfirmed: totalConf > 0 ? +(totalRpc / totalConf).toFixed(1) : null,
    avgRpcPerSec:            sessions.filter(s=>s.rpcPerSec).reduce((s,r)=>s+(r.rpcPerSec??0),0) /
                             Math.max(sessions.filter(s=>s.rpcPerSec).length, 1),
    totalRestarts,
    restartRatePerHour:      totalRunH > 0 ? +(totalRestarts / totalRunH).toFixed(3) : null,
    totalSilenceMinutes:     +totalGapMin.toFixed(1),
    avgDowntimePct:          sessions.filter(s=>s.downtimePct).length > 0
      ? +(sessions.reduce((s,r)=>s+(r.downtimePct??0),0) / sessions.filter(s=>s.downtimePct).length).toFixed(1) : null,
    totalLostValueEst:       +sessions.reduce((s,r)=>s+(r.lostValueEst??0),0).toFixed(4),
    avgViableRate:           sessions.filter(s=>s.viableRate).length > 0
      ? +(sessions.reduce((s,r)=>s+(r.viableRate??0),0) / sessions.filter(s=>s.viableRate).length).toFixed(1) : null,
    avgAdaptiveCapture:      sessions.filter(s=>s.adaptiveCapturePct).length > 0
      ? +(sessions.reduce((s,r)=>s+(r.adaptiveCapturePct??0),0) / sessions.filter(s=>s.adaptiveCapturePct).length).toFixed(1) : null,
  };
}

// ── Hourly performance aggregator ────────────────────────────────────────────
function buildHourlyPerformance(sessions) {
  const byHour = {};
  for (let h = 0; h < 24; h++) byHour[h] = { hour: h, sessions: 0, totalValue: 0, totalConfirmed: 0, totalSignals: 0 };

  for (const s of sessions) {
    for (const [h, v] of Object.entries(s.valueByUtcHour ?? {})) {
      byHour[+h].totalValue     += v;
      byHour[+h].sessions++;
    }
    for (const [h, c] of Object.entries(s.confirmedByUtcHour ?? {})) {
      byHour[+h].totalConfirmed += c;
    }
    for (const [h, sig] of Object.entries(s.signalsByUtcHour ?? {})) {
      byHour[+h].totalSignals   += sig;
    }
  }

  const hours = Object.values(byHour).map(h => ({
    ...h,
    avgValuePerSession:    h.sessions > 0 ? +(h.totalValue / h.sessions).toFixed(4) : 0,
    avgConfirmedPerSession:h.sessions > 0 ? +(h.totalConfirmed / h.sessions).toFixed(2) : 0,
    totalValue:            +h.totalValue.toFixed(4),
  }));

  const byValue = [...hours].sort((a,b) => b.totalValue - a.totalValue);
  return {
    generatedAt: new Date().toISOString(),
    hours,
    bestUtcHour:  byValue[0]?.hour ?? null,
    worstUtcHour: byValue[byValue.length-1]?.hour ?? null,
    topWindows:   byValue.slice(0,5).map(h => ({ hour: h.hour, totalValue: h.totalValue })),
  };
}

// ── Strategic metrics ─────────────────────────────────────────────────────────
function buildStrategicMetrics(sessions) {
  if (sessions.length < 2) return { generatedAt: new Date().toISOString(), insufficient: true };

  // Rolling 3-session averages
  const last3 = sessions.slice(-3);
  const prev3 = sessions.slice(-6, -3);
  const roll3ValueHr    = last3.reduce((s,r)=>s+(r.valuePerHour??0),0) / Math.max(last3.filter(s=>s.valuePerHour).length,1);
  const roll3ConfHr     = last3.reduce((s,r)=>s+(r.confirmedPerHour??0),0) / Math.max(last3.filter(s=>s.confirmedPerHour).length,1);
  const roll3RpcPerConf = last3.reduce((s,r)=>s+(r.rpcPerConfirmed??0),0) / Math.max(last3.filter(s=>s.rpcPerConfirmed).length,1);
  const prev3ValueHr    = prev3.reduce((s,r)=>s+(r.valuePerHour??0),0) / Math.max(prev3.filter(s=>s.valuePerHour).length,1);
  const prev3ConfHr     = prev3.reduce((s,r)=>s+(r.confirmedPerHour??0),0) / Math.max(prev3.filter(s=>s.confirmedPerHour).length,1);

  const trendValueHr  = prev3.length >= 2 && prev3ValueHr > 0 ? (roll3ValueHr - prev3ValueHr) / prev3ValueHr : null;
  const trendConfHr   = prev3.length >= 2 && prev3ConfHr  > 0 ? (roll3ConfHr  - prev3ConfHr)  / prev3ConfHr  : null;

  let trend;
  if (trendValueHr === null)          trend = 'INSUFFICIENT_DATA';
  else if (trendValueHr > 0.10)       trend = 'IMPROVING';
  else if (trendValueHr < -0.10)      trend = 'DEGRADING';
  else                                trend = 'FLAT';

  // Best/worst/most efficient sessions
  const withVal  = sessions.filter(s => s.totalEstValueUsd > 0);
  const withRpc  = sessions.filter(s => s.rpcPerConfirmed  > 0);
  const withDown = sessions.filter(s => s.downtimePct != null);
  const bestVal  = [...withVal].sort((a,b)  => b.totalEstValueUsd   - a.totalEstValueUsd)[0];
  const bestEff  = [...withRpc].sort((a,b)  => a.rpcPerConfirmed    - b.rpcPerConfirmed)[0];   // fewer = better
  const mostStab = [...withDown].sort((a,b) => a.downtimePct        - b.downtimePct)[0];       // lower = better
  const highestConf = [...sessions].sort((a,b) => (b.confirmedPerHour??0) - (a.confirmedPerHour??0))[0];

  // Best UTC operating window (aggregate across sessions)
  const hourly = buildHourlyPerformance(sessions);
  const bestWindow = hourly.topWindows.slice(0,3).map(h => `${h.hour}:00 UTC`).join(', ');

  // Heat effectiveness — which class produces most value across all sessions
  const heatTotals = { EXTREME: 0, HOT: 0, WARM: 0, COLD: 0, UNKNOWN: 0 };
  for (const s of sessions) {
    for (const [h, v] of Object.entries(s.valueByHeat ?? {})) {
      heatTotals[h] = (heatTotals[h] ?? 0) + (v ?? 0);
    }
  }
  const bestHeatClass = Object.entries(heatTotals).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 'UNKNOWN';

  // Failover trend
  const avgFailoverPct = withVal.reduce((s,r)=>s+(r.failoverPct??0),0) / Math.max(withVal.filter(s=>s.failoverPct).length,1);

  // Shadow execution / blocker intelligence
  const shadowSessions = sessions.filter(s => (s.shadowCandidates ?? 0) > 0 || (s.shadowEstimatedProfitUsd ?? 0) > 0);
  const bestShadow = [...shadowSessions].sort((a,b) => (b.shadowEstimatedProfitUsd ?? 0) - (a.shadowEstimatedProfitUsd ?? 0))[0];
  const blockerCounts = {};
  for (const s of shadowSessions) {
    const b = s.topShadowBlocker || 'none';
    blockerCounts[b] = (blockerCounts[b] || 0) + 1;
  }
  const topLifetimeBlocker = Object.entries(blockerCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 'none';

  // Recommended focus
  let operatorFocus = [];
  if ((sessions.slice(-1)[0]?.downtimePct ?? 0) > 30)   operatorFocus.push('REDUCE DOWNTIME: gaps >30% — check RPC budget and endpoint throttling');
  if ((sessions.slice(-1)[0]?.failoverPct ?? 0) > 10)   operatorFocus.push('RPC ROUTING: Infura >10% of calls — verify cold-failover is working');
  if (avgFailoverPct > 15)                               operatorFocus.push('INFURA BUDGET: excessive failover across sessions — may need plan upgrade');
  if (trend === 'DEGRADING')                             operatorFocus.push('PERFORMANCE DEGRADING: investigate RPC changes or market structure shifts');
  if (trend === 'IMPROVING')                             operatorFocus.push('CONTINUE: performance trend positive — good time for 72h burn-in');
  if (operatorFocus.length === 0)                        operatorFocus.push('STABLE: continue current operating pattern');

  return {
    generatedAt:          new Date().toISOString(),
    sessionCount:         sessions.length,
    trend,
    trendValueHrPct:      trendValueHr !== null ? +(trendValueHr * 100).toFixed(1) : null,
    trendConfHrPct:       trendConfHr  !== null ? +(trendConfHr  * 100).toFixed(1) : null,
    rolling3ValuePerHr:   +roll3ValueHr.toFixed(4),
    rolling3ConfPerHr:    +roll3ConfHr.toFixed(2),
    rolling3RpcPerConf:   +roll3RpcPerConf.toFixed(1),
    bestUtcOperatingWindow: bestWindow,
    topHourlyWindows:     hourly.topWindows,
    bestHeatClass,
    heatValueTotals:      Object.fromEntries(Object.entries(heatTotals).map(([k,v])=>[k,+v.toFixed(4)])),
    bestSessionId:        bestVal?.sessionId ?? null,
    bestSessionValue:     bestVal ? +bestVal.totalEstValueUsd.toFixed(4) : null,
    mostEfficientSessionId:  bestEff?.sessionId ?? null,
    mostEfficientRpcPerConf: bestEff ? +bestEff.rpcPerConfirmed.toFixed(1) : null,
    mostStableSessionId:     mostStab?.sessionId ?? null,
    mostStableDowntimePct:   mostStab ? +mostStab.downtimePct.toFixed(1) : null,
    highestConfRateSessionId: highestConf?.sessionId ?? null,
    avgFailoverPct:          +avgFailoverPct.toFixed(1),
    lifetimeShadowProfitUsd: +sessions.reduce((sum, r) => sum + (r.shadowEstimatedProfitUsd ?? 0), 0).toFixed(4),
    lifetimeWouldTradeCount: sessions.reduce((sum, r) => sum + (r.wouldTradeIfLive ?? 0), 0),
    bestShadowSession:       bestShadow?.sessionId ?? null,
    bestShadowSessionValue:  bestShadow ? +(bestShadow.shadowEstimatedProfitUsd ?? 0).toFixed(4) : null,
    avgShadowValuePerHour:   sessions.reduce((sum, r) => sum + (r.durationH ?? 0), 0) > 0
      ? +(sessions.reduce((sum, r) => sum + (r.shadowEstimatedProfitUsd ?? 0), 0) / sessions.reduce((sum, r) => sum + (r.durationH ?? 0), 0)).toFixed(4)
      : null,
    sessionsCrossedPaper:    sessions.filter(s => s.crossedPaper).length,
    sessionsCrossedDryWallet:sessions.filter(s => s.crossedDryWallet).length,
    sessionsCrossedMicroEligible: sessions.filter(s => s.crossedMicroEligible).length,
    topLifetimeBlocker,
    operatorFocus,
  };
}

// ── CLI commands ──────────────────────────────────────────────────────────────
function loadExistingSessions() {
  return rjsonl(SESSIONS_JSONL);
}

function sessionAlreadyTracked(sessionId, existing) {
  return existing.some(s => s.sessionId === sessionId);
}

function cmdScan(scanDir) {
  const existing   = loadExistingSessions();
  const existingIds= new Set(existing.map(s => s.sessionId));
  const dirs       = fs.readdirSync(scanDir)
    .filter(d => d.startsWith('session_'))
    .map(d => path.join(scanDir, d))
    .filter(d => fs.statSync(d).isDirectory())
    .sort();

  let added = 0; let skipped = 0;
  for (const dir of dirs) {
    const id = path.basename(dir).replace('session_', '');
    if (existingIds.has(id)) { skipped++; continue; }
    process.stdout.write(`  Processing ${id}... `);
    const rec = extractSessionMetrics(dir);
    if (!rec) { console.log('SKIP (too short or no data)'); skipped++; continue; }
    appendJsonl(SESSIONS_JSONL, rec);
    existing.push(rec);
    console.log(`OK (${rec.validity}, ${rec.durationH?.toFixed(1)}h, $${rec.totalEstValueUsd?.toFixed(2)})`);
    added++;
  }

  console.log(`\n  Added: ${added}  Skipped: ${skipped}`);
  if (added > 0) rebuildSummaries();
}

function cmdSession(sessionDir) {
  const id = path.basename(sessionDir).replace('session_', '');
  const existing = loadExistingSessions();
  if (existing.some(s => s.sessionId === id)) {
    console.log(`  Session ${id} already tracked. Use --rescan to force update.`);
    return;
  }
  const rec = extractSessionMetrics(sessionDir);
  if (!rec) { console.log('  Could not extract metrics — session too short or missing data.'); return; }
  appendJsonl(SESSIONS_JSONL, rec);
  console.log(`  Tracked: ${id}  validity=${rec.validity}  value=$${rec.totalEstValueUsd?.toFixed(2)}  dur=${rec.durationH?.toFixed(1)}h`);
  rebuildSummaries();
}

function cmdSummary() {
  const sessions = loadExistingSessions();
  if (!sessions.length) { console.log('  No sessions tracked yet. Run --scan first.'); return; }
  rebuildSummaries();
  const sum  = readJson(SUMMARY_JSON);
  const strat= readJson(STRATEGIC_JSON);
  if (!sum)  { console.log('  No summary available.'); return; }

  const D = '─'.repeat(60);
  const E = '═'.repeat(60);
  console.log(`\n${E}\n  PROJECT ALLMIGHT — LIFETIME METRICS SUMMARY\n  ${sum.generatedAt?.slice(0,19)} UTC\n${E}`);
  console.log(`\n  SESSIONS`);
  console.log(`  Total:   ${sum.sessions}  (${sum.validSessions} valid, ${sum.partialSessions} partial, ${sum.invalidSessions} invalid)`);
  console.log(`  Runtime: ${sum.totalRuntimeHours?.toFixed(1)}h total`);
  console.log(`\n  PERFORMANCE`);
  console.log(`  Confirmed:    ${sum.totalConfirmed?.toLocaleString()}`);
  console.log(`  Total value:  $${sum.totalEstimatedValue?.toFixed(2)}`);
  console.log(`  Value/hr:     $${sum.avgValuePerHour?.toFixed(4)}/h avg`);
  console.log(`  Conf/hr:      ${sum.avgConfirmedPerHour?.toFixed(2)}/h avg`);
  console.log(`  Best session: $${sum.bestSessionValue?.toFixed(2)}  (${sum.bestSessionId})`);
  console.log(`  Avg viable %: ${sum.avgViableRate?.toFixed(1)}%`);
  console.log(`\n  SHADOW EXECUTION`);
  console.log(`  Shadow value:  ${sum.lifetimeShadowProfitUsd?.toFixed(2)} lifetime`);
  console.log(`  Would trade:   ${sum.lifetimeWouldTradeCount?.toLocaleString()} signals`);
  console.log(`  Shadow $/hr:   ${sum.avgShadowValuePerHour?.toFixed(4)}/h avg`);
  console.log(`  Best shadow:   ${sum.bestShadowSessionValue?.toFixed(2)}  (${sum.bestShadowSession})`);
  console.log(`  Gate crossings: PAPER=${sum.sessionsCrossedPaper} DRY=${sum.sessionsCrossedDryWallet} MICRO=${sum.sessionsCrossedMicroEligible}`);
  console.log(`\n  RELIABILITY`);
  console.log(`  Total restarts:  ${sum.totalRestarts}`);
  console.log(`  Restart/hr:      ${sum.restartRatePerHour?.toFixed(3)}`);
  console.log(`  Avg downtime:    ${sum.avgDowntimePct?.toFixed(1)}%`);
  console.log(`  Lost value est:  $${sum.totalLostValueEst?.toFixed(2)} total`);
  console.log(`\n  RPC EFFICIENCY`);
  console.log(`  RPC per confirmed: ${sum.avgRpcCallsPerConfirmed?.toFixed(1)} calls/signal`);
  console.log(`  RPC per sec avg:   ${sum.avgRpcPerSec?.toFixed(3)}/sec`);
  if (strat && !strat.insufficient) {
    console.log(`\n  STRATEGIC INTELLIGENCE`);
    console.log(`  Trend:             ${strat.trend}  (${strat.trendValueHrPct}% value/hr change)`);
    console.log(`  Best UTC window:   ${strat.bestUtcOperatingWindow}`);
    console.log(`  Best heat class:   ${strat.bestHeatClass}`);
    console.log(`  Most efficient:    ${strat.mostEfficientSessionId}  (${strat.mostEfficientRpcPerConf} RPC/confirmed)`);
    console.log(`  Most stable:       ${strat.mostStableSessionId}  (${strat.mostStableDowntimePct}% downtime)`);
    console.log(`  Avg failover %:    ${strat.avgFailoverPct}%`);
    console.log(`  Shadow value:      ${strat.lifetimeShadowProfitUsd?.toFixed(2)} lifetime`);
    console.log(`  Would trade:       ${strat.lifetimeWouldTradeCount?.toLocaleString()} signals`);
    console.log(`  Top blocker:       ${strat.topLifetimeBlocker}`);
    console.log(`\n  OPERATOR FOCUS:`);
    for (const f of strat.operatorFocus) console.log(`  → ${f}`);
  }
  console.log(`\n  Files: ${SESSIONS_JSONL}\n         ${SUMMARY_JSON}\n         ${HOURLY_JSON}\n         ${STRATEGIC_JSON}\n${E}\n`);
}

function rebuildSummaries() {
  const sessions = loadExistingSessions();
  const summary  = buildLifetimeSummary(sessions);
  const hourly   = buildHourlyPerformance(sessions);
  const strategic= buildStrategicMetrics(sessions);
  writeJson(SUMMARY_JSON,   summary);
  writeJson(HOURLY_JSON,    hourly);
  writeJson(STRATEGIC_JSON, strategic);
  console.log(`  Summaries rebuilt (${sessions.length} sessions).`);
}

// ── Self-test ─────────────────────────────────────────────────────────────────
function selfTest() {
  const PASS=[]; const FAIL=[];
  const chk = (name, cond) => (cond ? PASS : FAIL).push(name);

  // Test extractSessionMetrics with the uploaded session
  const testDir = '/mnt/user-data/uploads';
  const rec = extractSessionMetrics(testDir);

  chk('extractSessionMetrics returns object', rec !== null && typeof rec === 'object');
  chk('sessionId present',                   typeof rec?.sessionId === 'string');
  chk('durationH > 0',                       (rec?.durationH ?? 0) > 0);
  chk('signals > 0',                         (rec?.signals ?? 0) > 0);
  chk('confirmed > 0',                       (rec?.confirmed ?? 0) > 0);
  chk('totalEstValueUsd > 0',                (rec?.totalEstValueUsd ?? 0) > 0);
  chk('valueByUtcHour is object',            typeof rec?.valueByUtcHour === 'object');
  chk('confirmedByHeat has EXTREME',         rec?.confirmedByHeat?.EXTREME !== undefined);
  chk('spreadBuckets present',               typeof rec?.spreadBuckets === 'object');
  chk('rpcPerConfirmed > 0',                 (rec?.rpcPerConfirmed ?? 0) > 0);
  chk('failoverPct is number or null',       rec?.failoverPct === null || typeof rec.failoverPct === 'number');
  chk('nearMissRatio computed',              rec?.nearMissRatio !== undefined);
  chk('restartCount >= 0',                   (rec?.restartCount ?? -1) >= 0);
  chk('validity is valid string',            ['valid','partial','invalid'].includes(rec?.validity));
  chk('patchBoundary classified',            ['pre-patch','post-patch','mixed'].includes(rec?.patchBoundary));

  // Test summary builders
  const summary = buildLifetimeSummary([rec]);
  chk('buildLifetimeSummary returns object', typeof summary === 'object');
  chk('summary.sessions = 1',               summary.sessions === 1);
  chk('summary.totalConfirmed > 0',         (summary.totalConfirmed ?? 0) > 0);

  const hourly = buildHourlyPerformance([rec]);
  chk('buildHourlyPerformance has hours',   Array.isArray(hourly.hours) && hourly.hours.length === 24);
  chk('hourly bestUtcHour is number',       typeof hourly.bestUtcHour === 'number');

  const strategic = buildStrategicMetrics([rec, rec]); // need 2 sessions
  chk('buildStrategicMetrics returns obj',  typeof strategic === 'object');
  chk('strategic.trend defined',            typeof strategic.trend === 'string');

  const total = PASS.length + FAIL.length;
  console.log(`\n${'═'.repeat(54)}`);
  console.log(`  PROJECT METRICS TRACKER — SELF-TEST  ${PASS.length}/${total}`);
  console.log(`${'═'.repeat(54)}`);
  for (const p of PASS) console.log(`  ✅  ${p}`);
  for (const f of FAIL) console.log(`  ❌  ${f}`);
  console.log(`${'═'.repeat(54)}\n`);
  process.exit(FAIL.length > 0 ? 1 : 0);
}

// ── Entry point ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args.find(a => a.startsWith('--'));
const arg2 = args.find(a => !a.startsWith('--'));

if (cmd === '--self-test') {
  selfTest();
} else if (cmd === '--scan') {
  const scanDir = arg2 || 'logs/sessions';
  if (!fs.existsSync(scanDir)) {
    console.error(`  Directory not found: ${scanDir}`);
    process.exit(1);
  }
  console.log(`\n  Scanning ${scanDir}...`);
  cmdScan(scanDir);
} else if (cmd === '--session') {
  if (!arg2) { console.error('  --session requires a path argument'); process.exit(1); }
  cmdSession(arg2);
} else if (cmd === '--summary') {
  cmdSummary();
} else if (cmd === '--rebuild') {
  rebuildSummaries();
} else {
  console.log(`
  Project AllMight — Lifetime Metrics Tracker v1.0

  Usage:
    node scripts/tools/project_metrics_tracker.js --scan logs/sessions/
    node scripts/tools/project_metrics_tracker.js --session logs/sessions/session_YYYYMMDD_HHMM
    node scripts/tools/project_metrics_tracker.js --summary
    node scripts/tools/project_metrics_tracker.js --self-test
    node scripts/tools/project_metrics_tracker.js --rebuild
  `);
}
