#!/usr/bin/env node
'use strict';
// surface_regime_report.js
// Analytics only — Boss ruling 2026-05-03
// Identifies when the ETH/USDC-Ramses surface is quiet, building, active, prime, or elite
// by UTC hour, session, and spread band across all historical session data.
//
// Usage:
//   node scripts/tools/surface_regime_report.js --all
//   node scripts/tools/surface_regime_report.js --session logs/sessions/session_20260503_1435
//   node scripts/tools/surface_regime_report.js --all --json

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const REPO        = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', {encoding:'utf8'}).trim(); }
  catch { return process.cwd(); }
})();
const LOGS_DIR    = path.join(REPO, 'logs');
const METRICS_DIR = path.join(LOGS_DIR, 'project_metrics');
const SESSIONS_DIR= path.join(LOGS_DIR, 'sessions');
const OUT_JSON    = path.join(METRICS_DIR, 'surface_regime_report.json');
const OUT_TXT     = path.join(METRICS_DIR, 'surface_regime_report.txt');

const JSON_MODE   = process.argv.includes('--json');
const ALL_MODE    = process.argv.includes('--all');
const SESSION_IDX = process.argv.indexOf('--session');
const TARGET_SESSION = SESSION_IDX !== -1 ? process.argv[SESSION_IDX + 1] : null;

// ─── REGIME THRESHOLDS (Boss spec 2026-05-03) ─────────────────────────────────
const REGIMES = {
  ELITE:    { spreadMin: 24, label: '⚡ ELITE',    action: 'candidate-watch',  priority: 5 },
  PRIME:    { spreadMin: 22, label: '🔥 PRIME',    action: 'dry-run',          priority: 4 },
  ACTIVE:   { spreadMin: 20, label: '📈 ACTIVE',   action: 'monitor',          priority: 3 },
  BUILDING: { spreadMin: 18, label: '🌡  BUILDING', action: 'watch',            priority: 2 },
  QUIET:    { spreadMin: 0,  label: '💤 QUIET',    action: 'observe',          priority: 1 },
};

function classifyRegime(spreadBps, survivalRate, heatClass, hasDryRunNetPos) {
  if (spreadBps >= 26 || hasDryRunNetPos) return 'ELITE';
  if (spreadBps >= 24)                    return 'ELITE';
  if (spreadBps >= 22)                    return 'PRIME';
  if (spreadBps >= 20 || (survivalRate != null && survivalRate >= 25)) return 'ACTIVE';
  if (spreadBps >= 18 || heatClass === 'HOT' || heatClass === 'EXTREME') return 'BUILDING';
  return 'QUIET';
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const lines = [];
  try {
    fs.readFileSync(filePath, 'utf8').split('\n').forEach(l => {
      l = l.trim();
      if (!l || !l.startsWith('{')) return;
      try { lines.push(JSON.parse(l)); } catch { /* skip malformed */ }
    });
  } catch { /* fail-soft */ }
  return lines;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function utcHour(ts) {
  try { return new Date(ts).getUTCHours(); } catch { return null; }
}

function safeAvg(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  return valid.length ? valid.reduce((a,b) => a+b, 0) / valid.length : null;
}

function safeMax(arr) {
  const valid = arr.filter(v => v != null && !isNaN(v));
  return valid.length ? Math.max(...valid) : null;
}

// ─── SESSION PROCESSOR ────────────────────────────────────────────────────────
function processSession(sessionDir) {
  const sessionId = path.basename(sessionDir).replace('session_', '');
  const result = { sessionId, signals: [], hourBuckets: {} };

  // ── Read v2 ledger (primary signal source) ───────────────────────────────
  const v2Ledger = readJsonl(path.join(sessionDir, 'shadow_execution_ledger_v2.jsonl'));
  for (const r of v2Ledger) {
    if (!r.ts) continue;
    const hour = utcHour(r.ts);
    if (hour === null) continue;
    result.signals.push({
      hour,
      ts          : r.ts,
      spreadBps   : r.spreadBps   ?? (r.spreadPct   ? r.spreadPct   * 100 : null),
      heatClass   : r.heatClass   ?? null,
      regime      : r.regime      ?? null,
      survives    : r.realisticSurvives === true,
      realisticNet: r.realisticNetUsd  ?? null,
      score       : r.executionScore   ?? null,
    });
  }

  // ── Read activator heartbeats (spread + heat per tick) ───────────────────
  // Also captures ticks with no v2 signal (quiet periods matter)
  const actLines = readJsonl(path.join(sessionDir, 'activator.jsonl'));
  for (const r of actLines) {
    if (r.type !== 'heartbeat' || !r.ts) continue;
    const hour = utcHour(r.ts);
    if (hour === null) continue;
    // netSpreadFrac → bps (fraction × 100 × 100 = fraction * 10000)
    const spreadBps = r.netSpreadFrac != null
      ? +(r.netSpreadFrac * 10000).toFixed(2)
      : r.priceDistanceBps ?? null;
    result.signals.push({
      hour,
      ts          : r.ts,
      spreadBps,
      heatClass   : r.heatClass ?? null,
      regime      : r.regime    ?? null,
      survives    : false,      // heartbeat ticks are not signals
      realisticNet: null,
      score       : null,
      isTick      : true,       // mark as tick not signal
    });
  }

  // ── Read dry run ledger if present ───────────────────────────────────────
  const drLedger = readJsonl(path.join(sessionDir, 'shadow_dryrun_ledger.jsonl'));
  const drBySignal = {};
  for (const r of drLedger) {
    if (r.signalId) drBySignal[r.signalId] = r;
  }

  // Attach dry run outcomes to matching v2 signals by signalId
  // (dry run ledger uses signalId = sessionId-blockNumber pattern)
  for (const sig of result.signals) {
    if (sig.isTick) continue;
    const matchKey = Object.keys(drBySignal).find(k =>
      k.includes(sessionId) && sig.ts &&
      Math.abs(new Date(k.split('-').slice(-1)[0]) - new Date(sig.ts)) < 60000
    );
    if (matchKey) {
      sig.wouldExecute = drBySignal[matchKey].wouldExecute;
      sig.dryRunNet    = drBySignal[matchKey].expectedNetUsd;
    }
  }

  return result;
}

// ─── AGGREGATE INTO HOURLY BUCKETS ────────────────────────────────────────────
function buildHourlyTable(allSignals) {
  const hours = {};
  for (let h = 0; h < 24; h++) {
    hours[h] = {
      hour          : h,
      totalRecords  : 0,   // ticks + signals
      signalCount   : 0,   // v2 signals only
      spreads       : [],
      heatClasses   : {},
      survivors     : 0,
      survivorNets  : [],
      drExecutable  : 0,
      drNetPositive : 0,
      drNetSum      : 0,
      regimeVotes   : {},
      // Boss spec 2026-05-05 — count by spread band
      count20plus   : 0,
      count22plus   : 0,
      count24plus   : 0,
      count26plus   : 0,
    };
  }

  for (const sig of allSignals) {
    const b = hours[sig.hour];
    if (!b) continue;
    b.totalRecords++;
    if (!sig.isTick) b.signalCount++;
    if (sig.spreadBps != null) b.spreads.push(sig.spreadBps);
    if (sig.heatClass) b.heatClasses[sig.heatClass] = (b.heatClasses[sig.heatClass]||0) + 1;
    if (sig.survives)  { b.survivors++; b.survivorNets.push(sig.realisticNet ?? 0); }
    // Count by spread band (signals only, not ticks)
    if (!sig.isTick && sig.spreadBps != null) {
      if (sig.spreadBps >= 20) b.count20plus++;
      if (sig.spreadBps >= 22) b.count22plus++;
      if (sig.spreadBps >= 24) b.count24plus++;
      if (sig.spreadBps >= 26) b.count26plus++;
    }
    if (sig.wouldExecute) {
      b.drExecutable++;
      if ((sig.dryRunNet ?? 0) > 0) { b.drNetPositive++; b.drNetSum += sig.dryRunNet; }
    }
  }

  // Compute derived metrics per hour
  const table = [];
  for (let h = 0; h < 24; h++) {
    const b = hours[h];
    const avgSpread  = safeAvg(b.spreads);
    const maxSpread  = safeMax(b.spreads);
    const survRate   = b.signalCount > 0 ? +(b.survivors / b.signalCount * 100).toFixed(1) : null;
    const domHeat    = Object.entries(b.heatClasses).sort((a,b) => b[1]-a[1])[0]?.[0] ?? null;
    const hasDryPos  = b.drNetPositive > 0;

    // Boss spec 2026-05-05: regime uses maxSpread (not avg)
    const regime = (maxSpread != null)
      ? classifyRegime(maxSpread, survRate, domHeat, hasDryPos)
      : 'QUIET';

    const action = REGIMES[regime]?.action ?? 'observe';

    table.push({
      hour         : h,
      utcLabel     : `${String(h).padStart(2,'0')}:00 UTC`,
      totalRecords : b.totalRecords,
      signalCount  : b.signalCount,
      avgSpreadBps : avgSpread != null ? +avgSpread.toFixed(2) : null,
      maxSpreadBps : maxSpread != null ? +maxSpread.toFixed(2) : null,
      dominantHeat : domHeat,
      survivors    : b.survivors,
      survivalRate : survRate,
      count20plus  : b.count20plus,
      count22plus  : b.count22plus,
      count24plus  : b.count24plus,
      count26plus  : b.count26plus,
      drExecutable : b.drExecutable,
      drNetPositive: b.drNetPositive,
      drNetPnL     : b.survivorNets.length ? +b.survivorNets.reduce((a,c)=>a+c,0).toFixed(4) : 0,
      regime,
      regimeLabel  : REGIMES[regime]?.label ?? '?',
      priority     : REGIMES[regime]?.priority ?? 0,
      action,
    });
  }
  return table;
}

// ─── SPREAD BAND TABLE ────────────────────────────────────────────────────────
function buildSpreadBandTable(allSignals) {
  const bands = [
    { label: '<18bps',    min: 0,  max: 18  },
    { label: '18–20bps',  min: 18, max: 20  },
    { label: '20–22bps',  min: 20, max: 22  },
    { label: '22–24bps',  min: 22, max: 24  },
    { label: '24–26bps',  min: 24, max: 26  },
    { label: '26+bps',    min: 26, max: 9999 },
  ];

  const sigs = allSignals.filter(s => !s.isTick && s.spreadBps != null);
  return bands.map(band => {
    const inBand   = sigs.filter(s => s.spreadBps >= band.min && s.spreadBps < band.max);
    const survivors= inBand.filter(s => s.survives);
    const drExec   = inBand.filter(s => s.wouldExecute);
    const drNetPos = inBand.filter(s => s.wouldExecute && (s.dryRunNet ?? 0) > 0);
    const regime   = inBand.length
      ? classifyRegime(
          safeAvg(inBand.map(s=>s.spreadBps)),
          inBand.length ? survivors.length/inBand.length*100 : 0,
          null, drNetPos.length > 0
        )
      : 'QUIET';
    return {
      band          : band.label,
      count         : inBand.length,
      survivors     : survivors.length,
      survivalRate  : inBand.length ? +(survivors.length/inBand.length*100).toFixed(1) : null,
      avgSpread     : safeAvg(inBand.map(s=>s.spreadBps)),
      drExecutable  : drExec.length,
      drNetPositive : drNetPos.length,
      regime,
      regimeLabel   : REGIMES[regime]?.label ?? '?',
    };
  });
}

// ─── TEXT REPORT ──────────────────────────────────────────────────────────────
function buildTextReport(hourly, bands, meta) {
  const W = 80;
  const line  = '─'.repeat(W);
  const dline = '═'.repeat(W);
  const rows  = [];

  rows.push(dline);
  rows.push('  AllMight — Surface Regime Report');
  rows.push(`  ${new Date().toISOString()}`);
  rows.push(`  Sessions analyzed: ${meta.sessionCount}   Total records: ${meta.totalRecords.toLocaleString()}`);
  rows.push(dline);

  // ── Best windows summary ─────────────────────────────────────────────────
  const ranked = [...hourly]
    .filter(h => h.totalRecords > 0)
    .sort((a,b) => b.priority - a.priority || (b.avgSpreadBps??0) - (a.avgSpreadBps??0));

  rows.push('');
  rows.push('  TOP UTC WINDOWS (by regime):');
  rows.push(line);
  const elite   = ranked.filter(h => h.regime === 'ELITE');
  const prime   = ranked.filter(h => h.regime === 'PRIME');
  const active  = ranked.filter(h => h.regime === 'ACTIVE');
  const building= ranked.filter(h => h.regime === 'BUILDING');

  const fmtHours = arr => arr.length ? arr.map(h=>h.utcLabel).join(', ') : '(none yet)';
  rows.push(`  ⚡ ELITE    : ${fmtHours(elite)}`);
  rows.push(`  🔥 PRIME    : ${fmtHours(prime)}`);
  rows.push(`  📈 ACTIVE   : ${fmtHours(active)}`);
  rows.push(`  🌡  BUILDING : ${fmtHours(building)}`);

  // ── Hourly table ─────────────────────────────────────────────────────────
  rows.push('');
  rows.push('  HOURLY BREAKDOWN:');
  rows.push(line);
  rows.push(
    '  Hour     Regime      MaxSprd  ≥22bps  ≥24bps  ≥26bps  Surviv%  DrExec  Action'
  );
  rows.push(line);
  for (const h of hourly) {
    if (h.totalRecords === 0) continue;
    const max   = h.maxSpreadBps != null ? `${h.maxSpreadBps.toFixed(1)}bps` : ' —    ';
    const surv  = h.survivalRate != null ? `${h.survivalRate.toFixed(0)}%` : '  —';
    const label = (h.regimeLabel ?? '?').padEnd(12);
    rows.push(
      `  ${h.utcLabel}  ${label}  ${max.padEnd(8)} ` +
      `${String(h.count22plus).padEnd(7)} ${String(h.count24plus).padEnd(7)} ${String(h.count26plus).padEnd(7)} ` +
      `${surv.padEnd(8)} ${String(h.drExecutable).padEnd(7)} ${h.action}`
    );
  }

  // ── Spread band table ─────────────────────────────────────────────────────
  rows.push('');
  rows.push('  SPREAD BAND ANALYSIS:');
  rows.push(line);
  rows.push('  Band         n       Survivors  SurvRate  DrExec  DrNet+  Regime');
  rows.push(line);
  for (const b of bands) {
    const surv  = b.survivalRate != null ? `${b.survivalRate}%` : '—';
    rows.push(
      `  ${b.band.padEnd(14)} ${String(b.count).padEnd(7)} ` +
      `${String(b.survivors).padEnd(10)} ${surv.padEnd(9)} ` +
      `${String(b.drExecutable).padEnd(7)} ${String(b.drNetPositive).padEnd(7)} ${b.regimeLabel}`
    );
  }

  // ── Recommendations ───────────────────────────────────────────────────────
  rows.push('');
  rows.push('  RECOMMENDATIONS:');
  rows.push(line);
  const primePlusHours = ranked.filter(h => h.priority >= 4).map(h=>h.utcLabel);
  const activeHours    = ranked.filter(h => h.priority === 3).map(h=>h.utcLabel);
  const quietHours     = ranked.filter(h => h.priority <= 1 && h.totalRecords > 0).map(h=>h.utcLabel);

  if (primePlusHours.length) {
    rows.push(`  PRIME+ windows  → deploy watchdog + dry-run mode: ${primePlusHours.join(', ')}`);
  }
  if (activeHours.length) {
    rows.push(`  ACTIVE windows  → monitor closely: ${activeHours.join(', ')}`);
  }
  if (quietHours.length) {
    rows.push(`  QUIET windows   → RPC conservation, slow poll OK: ${quietHours.join(', ')}`);
  }

  rows.push('');
  rows.push('  Note: regime based on historical averages. Real-time spread may differ.');
  rows.push('  Use market regime heartbeat on Discord for live regime status.');
  rows.push(dline);
  rows.push('');

  return rows.join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  let sessionDirs = [];

  if (TARGET_SESSION) {
    sessionDirs = [path.resolve(TARGET_SESSION)];
  } else if (ALL_MODE) {
    if (!fs.existsSync(SESSIONS_DIR)) {
      console.error(`Sessions dir not found: ${SESSIONS_DIR}`);
      process.exit(1);
    }
    sessionDirs = fs.readdirSync(SESSIONS_DIR)
      .filter(n => n.startsWith('session_'))
      .map(n => path.join(SESSIONS_DIR, n))
      .filter(p => fs.statSync(p).isDirectory())
      .sort();
  } else {
    console.error('Usage: node surface_regime_report.js --all');
    console.error('       node surface_regime_report.js --session <path>');
    process.exit(1);
  }

  console.log(`\n  Surface Regime Report — analyzing ${sessionDirs.length} sessions...\n`);

  const allSignals = [];
  let sessionCount = 0;

  for (const dir of sessionDirs) {
    try {
      const res = processSession(dir);
      if (res.signals.length === 0) continue;
      allSignals.push(...res.signals);
      sessionCount++;
      if (!JSON_MODE) process.stdout.write('.');
    } catch (e) {
      if (!JSON_MODE) process.stdout.write('x');
    }
  }
  if (!JSON_MODE) console.log('');

  if (allSignals.length === 0) {
    console.error('\n  No signal data found. Run some sessions first.');
    process.exit(1);
  }

  const hourly = buildHourlyTable(allSignals);
  const bands  = buildSpreadBandTable(allSignals);
  const meta   = { sessionCount, totalRecords: allSignals.length, generatedAt: new Date().toISOString() };

  const report = {
    generatedAt    : meta.generatedAt,
    sessionsAnalyzed: sessionCount,
    totalRecords   : allSignals.length,
    hourlyBreakdown: hourly,
    spreadBands    : bands,
    bestWindows    : {
      elite   : hourly.filter(h => h.regime === 'ELITE').map(h => h.utcLabel),
      prime   : hourly.filter(h => h.regime === 'PRIME').map(h => h.utcLabel),
      active  : hourly.filter(h => h.regime === 'ACTIVE').map(h => h.utcLabel),
      building: hourly.filter(h => h.regime === 'BUILDING').map(h => h.utcLabel),
      quiet   : hourly.filter(h => h.regime === 'QUIET' && h.totalRecords > 0).map(h => h.utcLabel),
    },
    recommendation: {
      primePlusWindows : hourly.filter(h => h.priority >= 4).map(h => h.hour),
      quietWindows     : hourly.filter(h => h.priority <= 1 && h.totalRecords > 0).map(h => h.hour),
      topSpreadBand    : bands.sort((a,b) => (b.avgSpread??0) - (a.avgSpread??0))[0]?.band,
    },
  };

  const txt = buildTextReport(hourly, bands, meta);

  // Write outputs
  fs.mkdirSync(METRICS_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
  fs.writeFileSync(OUT_TXT, txt);

  if (JSON_MODE) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(txt);
    console.log(`  JSON: ${OUT_JSON}`);
    console.log(`  TXT:  ${OUT_TXT}`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
