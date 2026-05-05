#!/usr/bin/env node
'use strict';
// surface_portfolio_report.js
// Cross-surface portfolio dashboard. Analytics only — no execution changes.
// Reads existing session data and maps to surface config.
//
// Usage:
//   node scripts/tools/surface_portfolio_report.js --all
//   node scripts/tools/surface_portfolio_report.js --all --json

const fs   = require('fs');
const path = require('path');

// ─── PATHS ────────────────────────────────────────────────────────────────────
const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim(); }
  catch { return process.cwd(); }
})();
const LOGS_DIR    = path.join(REPO, 'logs');
const METRICS_DIR = path.join(LOGS_DIR, 'project_metrics');
const SESSIONS_DIR= path.join(LOGS_DIR, 'sessions');
const OUT_JSON    = path.join(METRICS_DIR, 'surface_portfolio_report.json');
const OUT_TXT     = path.join(METRICS_DIR, 'surface_portfolio_report.txt');

const JSON_MODE   = process.argv.includes('--json');
const ALL_MODE    = process.argv.includes('--all');

// ─── LOAD REGISTRY (fail-soft) ────────────────────────────────────────────────
function loadRegistry() {
  try {
    const regPath = path.join(REPO, 'surfaces', 'registry.json');
    if (!fs.existsSync(regPath)) return null;
    return JSON.parse(fs.readFileSync(regPath, 'utf8'));
  } catch { return null; }
}

function loadSurfaceConfig(surfaceId) {
  try {
    const filePath = path.join(REPO, 'surfaces', `${surfaceId}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

// ─── SESSION READERS (fail-soft) ──────────────────────────────────────────────
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function readSessionData(sessionDir) {
  const st  = readJson(path.join(sessionDir, 'session_totals.json'));
  const sv1 = readJson(path.join(sessionDir, 'shadow_execution_totals.json'));
  const sv2 = readJson(path.join(sessionDir, 'shadow_execution_totals_v2.json'));
  const sdr = readJson(path.join(sessionDir, 'shadow_dryrun_totals.json'));
  if (!st && !sv1) return null;

  return {
    sessionId      : path.basename(sessionDir).replace('session_', ''),
    runtimeHours   : st ? st.totalRuntimeMs / 3600000 : null,
    totalSignals   : sv1?.totalSignals ?? 0,
    restartCount   : st?.restartCount  ?? 0,
    estValueUsd    : st?.totalEstValueUsd ?? 0,
    // v1 shadow
    opportunityUsd : sv1?.shadowTheoreticalPnLUsd    ?? 0,
    bestSpreadBps  : sv1?.bestSignalSpreadPct != null
      ? sv1.bestSignalSpreadPct * 100 : null,
    avgScore       : sv1?.avgExecutionScore ?? null,
    // v2 shadow
    realisticUsd   : sv2?.shadowRealisticTheoreticalUsd  ?? 0,
    calibratedUsd  : sv2?.shadowCalibratedEstimateUsd    ?? 0,
    survivalRate   : sv2?.realisticSurvivalRate ?? null,
    v2Survivors    : sv2?.realisticPositiveCount ?? 0,
    v2Accuracy     : sv2?.v2DirectionAccuracyPct ?? null,
    // dry run
    dryRunAttempted: sdr?.attempted      ?? 0,
    dryRunExecute  : sdr?.wouldExecuteCount ?? 0,
    dryRunSuccessRate: sdr?.executionSuccessRate ?? null,
    dryRunPnL      : sdr?.expectedExecutablePnL ?? 0,
    dryRunFunding  : sdr?.fundingStatus ?? null,
  };
}

// ─── BUILD SURFACE STATS ──────────────────────────────────────────────────────
function buildSurfaceStats(surfaceId, sessions) {
  // Current architecture: all sessions are on the primary surface.
  // Phase 2 will add surfaceId field to session files.
  // For now, map all sessions to eth_usdc_ramses (the only active surface).
  const filtered = surfaceId === 'eth_usdc_ramses' ? sessions : [];

  const totalSessions   = filtered.length;
  const totalRuntime    = filtered.reduce((a,s) => a + (s.runtimeHours??0), 0);
  const totalSignals    = filtered.reduce((a,s) => a + s.totalSignals, 0);
  const totalOppty      = filtered.reduce((a,s) => a + s.opportunityUsd, 0);
  const totalRealistic  = filtered.reduce((a,s) => a + s.realisticUsd, 0);
  const totalCalibrated = filtered.reduce((a,s) => a + s.calibratedUsd, 0);
  const totalDrExec     = filtered.reduce((a,s) => a + s.dryRunExecute, 0);
  const totalDrPnL      = filtered.reduce((a,s) => a + s.dryRunPnL, 0);

  const survRates   = filtered.map(s=>s.survivalRate).filter(v=>v!=null);
  const avgSurv     = survRates.length ? survRates.reduce((a,b)=>a+b,0)/survRates.length : null;
  const bestSession = filtered.sort((a,b) => b.realisticUsd - a.realisticUsd)[0] ?? null;
  const maxSpread   = Math.max(...filtered.map(s=>s.bestSpreadBps??0).filter(v=>v>0), 0);
  const pnlPerHr    = totalRuntime > 0 ? totalCalibrated / totalRuntime : 0;
  const withDryRun  = filtered.filter(s=>s.dryRunAttempted>0);
  const dryRunSucc  = withDryRun.length ? withDryRun.reduce((a,s)=>a+(s.dryRunSuccessRate??0),0)/withDryRun.length : null;

  return {
    surfaceId,
    totalSessions,
    totalRuntimeHours  : +totalRuntime.toFixed(2),
    totalSignals,
    totalOpportunityUsd: +totalOppty.toFixed(3),
    totalRealisticUsd  : +totalRealistic.toFixed(3),
    totalCalibratedUsd : +totalCalibrated.toFixed(3),
    pnlPerHour         : +pnlPerHr.toFixed(4),
    avgSurvivalRate    : avgSurv != null ? +avgSurv.toFixed(1) : null,
    maxSpreadBps       : maxSpread || null,
    dryRunSessions     : withDryRun.length,
    dryRunExecutable   : totalDrExec,
    dryRunPnL          : +totalDrPnL.toFixed(3),
    dryRunSuccessRate  : dryRunSucc != null ? +dryRunSucc.toFixed(1) : null,
    bestSession        : bestSession ? {
      sessionId    : bestSession.sessionId,
      realisticUsd : bestSession.realisticUsd,
      runtimeHours : bestSession.runtimeHours,
    } : null,
  };
}

// ─── TEXT REPORT ──────────────────────────────────────────────────────────────
function buildTextReport(registry, surfaceStats, sessionCount, meta) {
  const W = 75;
  const rows = [];

  rows.push('═'.repeat(W));
  rows.push('  AllMight — Surface Portfolio Report');
  rows.push(`  ${meta.generatedAt}`);
  rows.push(`  Sessions: ${sessionCount}  Registry: ${registry?.surfaces?.length ?? '?'} surfaces`);
  rows.push('═'.repeat(W));

  // ── Registry overview ──────────────────────────────────────────────────────
  rows.push('');
  rows.push('  SURFACE REGISTRY:');
  rows.push('─'.repeat(W));
  if (registry) {
    for (const entry of registry.surfaces) {
      const cfg    = loadSurfaceConfig(entry.surfaceId);
      const status = entry.enabled ? '✅ ACTIVE ' : '⏸  LOCKED ';
      const ladder = (cfg?.promotionStatus ?? entry.promotionStatus ?? '?').padEnd(20);
      rows.push(`  ${status}  ${entry.displayName.padEnd(35)} ${ladder}`);
    }
  } else {
    rows.push('  (registry.json not found)');
  }

  // ── Active surface stats ───────────────────────────────────────────────────
  rows.push('');
  rows.push('  ACTIVE SURFACE PERFORMANCE:');
  rows.push('─'.repeat(W));
  for (const ss of surfaceStats.filter(s => s.totalSessions > 0)) {
    rows.push(`  ${ss.surfaceId}`);
    rows.push(`    Sessions:     ${ss.totalSessions}   Runtime: ${ss.totalRuntimeHours.toFixed(1)}h   Signals: ${ss.totalSignals.toLocaleString()}`);
    rows.push(`    Opportunity:  $${ss.totalOpportunityUsd.toFixed(2)}  (v1 upper bound)`);
    rows.push(`    Realistic:    $${ss.totalRealisticUsd.toFixed(2)}  (v2 5bps friction)`);
    rows.push(`    Calibrated:   $${ss.totalCalibratedUsd.toFixed(2)}  (×sandbox rate)`);
    rows.push(`    PnL/hr:       $${ss.pnlPerHour.toFixed(4)}/h`);
    rows.push(`    Survival:     ${ss.avgSurvivalRate != null ? ss.avgSurvivalRate+'%' : '?'} avg  maxSpread: ${ss.maxSpreadBps != null ? ss.maxSpreadBps.toFixed(2)+'bps' : '?'}`);
    if (ss.dryRunSessions > 0) {
      rows.push(`    Dry-run:      ${ss.dryRunExecutable} executable  ${ss.dryRunSuccessRate != null ? ss.dryRunSuccessRate+'%' : '?'} success  $${ss.dryRunPnL.toFixed(3)} PnL`);
    }
    if (ss.bestSession) {
      rows.push(`    Best session: ${ss.bestSession.sessionId} ($${ss.bestSession.realisticUsd.toFixed(3)})`);
    }
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────
  rows.push('');
  rows.push('  WATCHLIST SURFACES (Phase 2 — locked):');
  rows.push('─'.repeat(W));
  if (registry) {
    const watchlist = registry.surfaces.filter(s => !s.enabled);
    if (watchlist.length === 0) {
      rows.push('  (none)');
    } else {
      for (const s of watchlist) {
        const cfg = loadSurfaceConfig(s.surfaceId);
        rows.push(`  ⏸  ${s.displayName}`);
        rows.push(`     Status: ${s.promotionStatus}  |  ${cfg?.notes ?? 'no notes'}`);
      }
    }
  }

  // ── Promotion requirements ─────────────────────────────────────────────────
  rows.push('');
  rows.push('  PHASE 2 UNLOCK REQUIREMENTS:');
  rows.push('─'.repeat(W));
  rows.push('  To activate a new surface:');
  rows.push('    1. Boss explicit unlock ruling');
  rows.push('    2. Current phase complete (24h run + 3 C9 sessions + dry-run ≥80%)');
  rows.push('    3. New surface: 3 shadow-only sessions collected');
  rows.push('    4. Spread behavior documented');
  rows.push('    5. Boss promotion ruling from WATCHLIST → SHADOW_ONLY');

  rows.push('');
  rows.push('  Note: Portfolio report is informational. No execution behavior changed.');
  rows.push('═'.repeat(W));
  rows.push('');
  return rows.join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!ALL_MODE) {
    console.error('Usage: node surface_portfolio_report.js --all');
    process.exit(1);
  }

  const registry = loadRegistry();

  // Load all sessions
  const sessions = [];
  if (fs.existsSync(SESSIONS_DIR)) {
    for (const name of fs.readdirSync(SESSIONS_DIR).sort()) {
      if (!name.startsWith('session_')) continue;
      const sessionDir = path.join(SESSIONS_DIR, name);
      if (!fs.statSync(sessionDir).isDirectory()) continue;
      try {
        const data = readSessionData(sessionDir);
        if (data) sessions.push(data);
      } catch { /* fail-soft */ }
    }
  }

  // Build stats per surface
  const surfaces = registry ? registry.surfaces.map(s => s.surfaceId) : ['eth_usdc_ramses'];
  const surfaceStats = surfaces.map(id => buildSurfaceStats(id, sessions));

  const meta = { generatedAt: new Date().toISOString() };

  const report = {
    generatedAt      : meta.generatedAt,
    sessionsAnalyzed : sessions.length,
    registry         : registry ? {
      version  : registry.version,
      surfaces : registry.surfaces.map(s => ({
        surfaceId      : s.surfaceId,
        displayName    : s.displayName,
        enabled        : s.enabled,
        promotionStatus: s.promotionStatus,
        chain          : s.chain,
      })),
    } : null,
    bySurface        : Object.fromEntries(
      surfaceStats.map(ss => [ss.surfaceId, ss])
    ),
    global: {
      totalSessions    : sessions.length,
      totalRuntimeHours: +sessions.reduce((a,s)=>a+(s.runtimeHours??0),0).toFixed(2),
      totalSignals     : sessions.reduce((a,s)=>a+s.totalSignals,0),
      totalRealisticUsd: +sessions.reduce((a,s)=>a+s.realisticUsd,0).toFixed(3),
      totalCalibratedUsd: +sessions.reduce((a,s)=>a+s.calibratedUsd,0).toFixed(3),
      activeSurfaces   : surfaces.filter(id =>
        surfaceStats.find(ss=>ss.surfaceId===id)?.totalSessions > 0
      ).length,
    },
  };

  const txt = buildTextReport(registry, surfaceStats, sessions.length, meta);

  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_TXT,  txt);

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(txt);
    console.log(`  JSON: ${OUT_JSON}`);
    console.log(`  TXT:  ${OUT_TXT}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
