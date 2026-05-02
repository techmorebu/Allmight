// scripts/tools/project_metrics_tracker.js
// AllMight — Project Lifetime Metrics Tracker
// Aggregates all sessions: signals, shadow execution PnL, gate progression
// Usage: node scripts/tools/project_metrics_tracker.js [--summary] [--json]

'use strict';

const fs   = require('fs');
const path = require('path');

const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
const SESSIONS_DIR = path.join(LOGS_DIR, 'sessions');
const METRICS_FILE = path.join(LOGS_DIR, 'project_metrics.json');
const JSON_MODE    = process.argv.includes('--json');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function listSessions() {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  return fs.readdirSync(SESSIONS_DIR)
    .filter(d => d.startsWith('session_') && fs.statSync(path.join(SESSIONS_DIR, d)).isDirectory())
    .sort();
}

function extractSessionMetrics(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');
  const m = { sessionId };

  const actLines = (() => {
    try { return fs.readFileSync(path.join(sessionDir, 'activator.jsonl'), 'utf8').split('\n').filter(Boolean); }
    catch { return []; }
  })();

  let firstTs = null, lastTs = null, signals = 0;
  for (const l of actLines) {
    try {
      const r = JSON.parse(l);
      if (r.ts) { if (!firstTs) firstTs = r.ts; lastTs = r.ts; }
      if (r.type === 'signal') signals++;
    } catch { }
  }
  m.durationH = firstTs && lastTs ? ((new Date(lastTs) - new Date(firstTs)) / 3_600_000) : 0;
  m.signals   = signals;

  const shadow = readJson(path.join(sessionDir, 'shadow_execution_totals.json'));
  if (shadow) {
    m.shadow = {
      wouldTradeIfLive    : shadow.wouldTradeIfLive ?? 0,
      shadowProfitUsd     : shadow.shadowTheoreticalPnLUsd     // v1 opportunity (fixed engine)
                          ?? shadow.shadowEstimatedProfitUsd        // v1 compat (old engine)
                          ?? 0,
      shadowOpportunityUsd: shadow.shadowTheoreticalPnLUsd ?? 0,
      shadowValuePerHour  : shadow.shadowEstimatedValuePerHour ?? null,
      maxExecutionScore   : shadow.maxExecutionScore ?? 0,
      avgExecutionScore   : shadow.avgExecutionScore ?? 0,
      crossedPaper        : shadow.crossedPaper ?? false,
      crossedDryWallet    : shadow.crossedDryWallet ?? false,
      crossedMicro        : shadow.crossedMicro ?? false,
      topBlockedReason    : shadow.topBlockedReason ?? null,
      microLiveEligible   : shadow.microLiveEligible ?? 0,
      dryWalletEligible   : shadow.dryWalletEligible ?? 0,
      paperOnly           : shadow.paperOnly ?? 0,
      blocked             : shadow.blocked ?? 0,
      bestSignalProfitUsd : shadow.bestSignalProfitUsd ?? null,
      bestSignalSpreadPct : shadow.bestSignalSpreadPct ?? null,
    };
  }

  // v2 realistic engine fields
  const shadowV2 = readJson(path.join(sessionDir, 'shadow_execution_totals_v2.json'));
  if (shadowV2 && m.shadow) {
    m.shadow.shadowRealisticUsd    = shadowV2.shadowRealisticTheoreticalUsd ?? null;
    m.shadow.shadowCalibratedUsd   = shadowV2.shadowCalibratedEstimateUsd   ?? null;
    m.shadow.realisticSurvivors    = shadowV2.realisticPositiveCount         ?? null;
    m.shadow.realisticSurvivalRate = shadowV2.realisticSurvivalRate          ?? null;
    m.shadow.v2DirectionAccuracy   = shadowV2.v2DirectionAccuracyPct         ?? null;
    m.shadow.v2FalsePositive       = shadowV2.v2FalsePositive                ?? null;
    m.shadow.v2FalseNegative       = shadowV2.v2FalseNegative                ?? null;
  }

  const conf = readJson(path.join(sessionDir, 'dryrun_confidence.json'));
  if (conf) {
    const sData = conf.sessions?.find(s => s.label === sessionId);
    if (sData) { m.validity = sData.validity; m.passCount = sData.passCount; }
  }

  const sb = readJson(path.join(sessionDir, 'sandbox_results.json'));
  if (sb) { m.sbViableRate = sb.summary?.viableRate ?? null; }

  return m;
}

function aggregateLifetime(all) {
  const ws  = all.filter(s => s.shadow);
  const valid = all.filter(s => ['FULLY_VALID','VALID'].includes(s.validity));

  const lifetimeDurationH       = all.reduce((a, s) => a + (s.durationH ?? 0), 0);
  const lifetimeSignals         = all.reduce((a, s) => a + (s.signals ?? 0), 0);
  const lifetimeShadowProfitUsd   = ws.reduce((a, s) => a + (s.shadow.shadowProfitUsd ?? 0), 0);
  const lifetimeOpportunityUsd    = ws.reduce((a, s) => a + (s.shadow.shadowOpportunityUsd ?? s.shadow.shadowProfitUsd ?? 0), 0);
  const lifetimeRealisticUsd      = ws.reduce((a, s) => a + (s.shadow.shadowRealisticUsd ?? 0), 0);
  const lifetimeCalibratedUsd     = ws.reduce((a, s) => a + (s.shadow.shadowCalibratedUsd ?? 0), 0);
  const lifetimeWouldTradeCount   = ws.reduce((a, s) => a + (s.shadow.wouldTradeIfLive ?? 0), 0);
  const totalRealisticSurvivors   = ws.reduce((a, s) => a + (s.shadow.realisticSurvivors ?? 0), 0);
  const avgShadowValuePerHour     = lifetimeDurationH > 0 ? lifetimeShadowProfitUsd / lifetimeDurationH : null;
  const avgRealisticPerHour       = lifetimeDurationH > 0 ? lifetimeRealisticUsd / lifetimeDurationH : null;
  const v2Sessions                = ws.filter(s => s.shadow.v2DirectionAccuracy != null);
  const avgDirectionAccuracyV2    = v2Sessions.length > 0
    ? v2Sessions.reduce((a, s) => a + (s.shadow.v2DirectionAccuracy ?? 0), 0) / v2Sessions.length : null;

  const bestShadowSession = ws.reduce((b, s) =>
    (s.shadow.shadowProfitUsd ?? 0) > (b?.shadow?.shadowProfitUsd ?? 0) ? s : b, null);

  const sessionsCrossedPaper         = ws.filter(s => s.shadow.crossedPaper).length;
  const sessionsCrossedDryWallet     = ws.filter(s => s.shadow.crossedDryWallet).length;
  const sessionsCrossedMicroEligible = ws.filter(s => s.shadow.crossedMicro).length;

  const blockerCounts = {};
  for (const s of ws) {
    const b = s.shadow.topBlockedReason;
    if (b) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1;
  }
  const topLifetimeBlocker = Object.entries(blockerCounts).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;

  const maxLifetimeExecutionScore = ws.reduce((m, s) => Math.max(m, s.shadow.maxExecutionScore ?? 0), 0);
  const avgLifetimeExecutionScore = ws.length > 0
    ? ws.reduce((a, s) => a + (s.shadow.avgExecutionScore ?? 0), 0) / ws.length : 0;

  const bestSignalEver = ws.reduce((b, s) => {
    const p = s.shadow.bestSignalProfitUsd ?? -Infinity;
    return p > (b?.bestSignalProfitUsd ?? -Infinity)
      ? { sessionId: s.sessionId, bestSignalProfitUsd: p, bestSignalSpreadPct: s.shadow.bestSignalSpreadPct }
      : b;
  }, null);

  const recent5 = ws.slice(-5);
  const r5pnl   = recent5.reduce((a, s) => a + (s.shadow.shadowProfitUsd ?? 0), 0);
  const r5score = recent5.length > 0
    ? recent5.reduce((a, s) => a + (s.shadow.avgExecutionScore ?? 0), 0) / recent5.length : 0;

  return {
    generatedAt: new Date().toISOString(),
    totalSessions: all.length, sessionsWithShadowData: ws.length,
    bossValidSessions: valid.length,
    lifetimeDurationH: +lifetimeDurationH.toFixed(1),
    lifetimeSignals,
    lifetimeShadowProfitUsd: +lifetimeShadowProfitUsd.toFixed(4),
    lifetimeOpportunityUsd : +lifetimeOpportunityUsd.toFixed(4),
    lifetimeRealisticUsd   : +lifetimeRealisticUsd.toFixed(4),
    lifetimeCalibratedUsd  : +lifetimeCalibratedUsd.toFixed(4),
    lifetimeWouldTradeCount,
    totalRealisticSurvivors,
    avgShadowValuePerHour : avgShadowValuePerHour != null ? +avgShadowValuePerHour.toFixed(4) : null,
    avgRealisticPerHour   : avgRealisticPerHour != null ? +avgRealisticPerHour.toFixed(4) : null,
    avgDirectionAccuracyV2: avgDirectionAccuracyV2 != null ? +avgDirectionAccuracyV2.toFixed(1) : null,
    bestShadowSession: bestShadowSession ? {
      sessionId: bestShadowSession.sessionId,
      shadowPnl: bestShadowSession.shadow.shadowProfitUsd,
      maxScore:  bestShadowSession.shadow.maxExecutionScore,
      durationH: bestShadowSession.durationH,
    } : null,
    maxLifetimeExecutionScore: +maxLifetimeExecutionScore.toFixed(1),
    avgLifetimeExecutionScore: +avgLifetimeExecutionScore.toFixed(1),
    sessionsCrossedPaper, sessionsCrossedDryWallet, sessionsCrossedMicroEligible,
    topLifetimeBlocker, blockerCounts, bestSignalEver,
    recent5: { shadowPnl: +r5pnl.toFixed(4), sessions: recent5.length, avgScore: +r5score.toFixed(1) },
    sessionSummary: all.map(s => ({
      sessionId: s.sessionId, durationH: +s.durationH?.toFixed(1),
      validity: s.validity ?? null, signals: s.signals ?? 0,
      shadowPnl: s.shadow?.shadowProfitUsd ?? null,
      maxScore: s.shadow?.maxExecutionScore ?? null,
      crossedPaper: s.shadow?.crossedPaper ?? false,
      sbViableRate: s.sbViableRate ?? null,
    })),
  };
}

function main() {
  const sessions   = listSessions();
  const allMetrics = sessions.map(s => extractSessionMetrics(path.join(SESSIONS_DIR, s)));
  const lifetime   = aggregateLifetime(allMetrics);

  try { fs.writeFileSync(METRICS_FILE, JSON.stringify(lifetime, null, 2)); } catch { }

  if (JSON_MODE) { console.log(JSON.stringify(lifetime, null, 2)); return; }

  const gk = lifetime.sessionsCrossedMicroEligible > 0 ? '🟢'
           : lifetime.sessionsCrossedDryWallet > 0 ? '🟠'
           : lifetime.sessionsCrossedPaper > 0 ? '🟡' : '🔴';
  const bs = lifetime.bestShadowSession;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  AllMight — Lifetime Project Metrics');
  console.log(`  ${lifetime.generatedAt.slice(0,19)}Z`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Sessions:         ${lifetime.totalSessions} total  ${lifetime.bossValidSessions} Boss-valid`);
  console.log(`  Lifetime runtime: ${lifetime.lifetimeDurationH}h  ${lifetime.lifetimeSignals.toLocaleString()} signals`);
  console.log('───────────────────────────────────────────────────────');
  console.log('  Shadow Execution (lifetime):');
  console.log(`    Opportunity:    $${lifetime.lifetimeOpportunityUsd.toFixed(3)}   (v1 upper bound)`);
  console.log(`    Realistic:      $${lifetime.lifetimeRealisticUsd.toFixed(3)}   (v2 5bps friction)`);
  console.log(`    Calibrated:     $${lifetime.lifetimeCalibratedUsd.toFixed(3)}   (×sandbox rate)`);
  console.log(`    PnL/hr (real):  $${lifetime.avgRealisticPerHour?.toFixed(3) ?? 'N/A'}/h`);
  console.log(`    Survivors:      ${lifetime.totalRealisticSurvivors ?? 'N/A'}`);
  console.log(`    Direction v2:   ${lifetime.avgDirectionAccuracyV2?.toFixed(1) ?? 'N/A'}%`);
  console.log(`    Max score:      ${lifetime.maxLifetimeExecutionScore}`);
  if (bs) console.log(`    Best session:   ${bs.sessionId} ($${bs.shadowPnl?.toFixed(3)} score=${bs.maxScore})`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Gate Progression (${gk}):`);
  console.log(`    Paper (≥75):    ${lifetime.sessionsCrossedPaper} sessions`);
  console.log(`    Dry (≥85):      ${lifetime.sessionsCrossedDryWallet} sessions`);
  console.log(`    Micro (≥92):    ${lifetime.sessionsCrossedMicroEligible} sessions`);
  console.log(`    Top blocker:    ${lifetime.topLifetimeBlocker ?? 'none'}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Recent 5 sessions: PnL=$${lifetime.recent5.shadowPnl.toFixed(3)} avgScore=${lifetime.recent5.avgScore}`);
  if (lifetime.dryRunSuccessRate != null) {
    console.log('───────────────────────────────────────────────────────');
    console.log('  Dry Execution (lifetime):');
    console.log(`    Signals tested:  ${lifetime.lifetimeDryRunSignals}`);
    console.log(`    Executable:      ${lifetime.lifetimeDryRunExecutable} (${lifetime.dryRunSuccessRate}%)`);
    console.log(`    Executable PnL:  $${lifetime.dryRunExecutablePnL.toFixed(3)}`);
    if (lifetime.bestDryRunSession) {
      const bdr = lifetime.bestDryRunSession;
      console.log(`    Best session:    ${bdr.sessionId} (${bdr.executionSuccessRate}% success)`);
    }
  }
  console.log(`  Metrics file: ${METRICS_FILE}`);
  console.log('═══════════════════════════════════════════════════════');
}

main();
