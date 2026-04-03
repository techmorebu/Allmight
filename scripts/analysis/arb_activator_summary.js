'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Activator Run Summary  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT: scripts/analysis/arb_activator_summary.js
//  PURPOSE:   Deterministic post-run analyzer for arb_window_activator JSONL logs.
//             Produces window-by-window breakdown, regime split, edge distribution,
//             and size-efficiency curve for Boss classification.
//
//  USAGE
//  ─────
//  node scripts/analysis/arb_activator_summary.js --log=./logs/activator_eth_usdt.jsonl
//  node scripts/analysis/arb_activator_summary.js --log=./logs/activator_eth_usdt.jsonl --json
//
//  OUTPUT SECTIONS
//  ───────────────
//  1. Run overview (duration, ticks, errors, arm rate)
//  2. Windows by regime (base vs surge — duration, net, close reason)
//  3. Signal summary (EXECUTION_READY / MARGINAL / LOST per regime)
//  4. Size-sweep edge curve (from sizeSweep fields in signal records)
//  5. Edge distribution (min/max/mean/median by regime)
//  6. Boss classification inputs
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';
const fs   = require('fs');
const path = require('path');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const ARGS    = process.argv.slice(2);
const JSON_OUT = ARGS.includes('--json');

function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  if (i !== -1 && ARGS[i + 1]) return ARGS[i + 1];
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  return eq ? eq.split('=').slice(1).join('=') : def;
}

const LOG_PATH = argVal('--log', null);

if (!LOG_PATH) {
  console.error('[summary] Usage: node arb_activator_summary.js --log=./logs/activator_eth_usdt.jsonl');
  process.exit(1);
}

if (!fs.existsSync(LOG_PATH)) {
  console.error(`[summary] File not found: ${LOG_PATH}`);
  process.exit(1);
}

// ─── LOAD ─────────────────────────────────────────────────────────────────────

const raw = fs.readFileSync(LOG_PATH, 'utf8');
const records = raw.trim().split('\n').filter(Boolean).map(l => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function pct(n, d) { return d ? ((n / d) * 100).toFixed(1) + '%' : '—'; }

function fmt$(v) {
  if (v == null) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtEdge(v) {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${(v).toFixed(5)}%`;
}

// ─── PARSE RECORDS ────────────────────────────────────────────────────────────

const transitions = records.filter(r => r.type === 'state_transition');
const heartbeats  = records.filter(r => r.type === 'heartbeat');
const signals     = records.filter(r => r.signal);
const remaps      = records.filter(r => r.type === 'tick_map_refresh');
const readyChecks = records.filter(r => r.type === 'ready_check_confirmed');

// Build windows from ARMED→PASSIVE transition pairs
// Each ARMED→PASSIVE record now carries windowId, windowStartTs, windowEndTs, windowDurationMs, regime
const closedWindows = transitions.filter(t => t.from === 'ARMED' && t.to === 'PASSIVE' && t.windowId);
// Also try to pair from open records if close records lack windowId (backwards compat)
const openByWindowId = {};
for (const t of transitions.filter(t => t.from === 'PASSIVE' && t.to === 'ARMED' && t.windowId)) {
  openByWindowId[t.windowId] = t;
}

// Unify window records — prefer close record data, fill gaps from open record
const windows = closedWindows.map(close => {
  const open = openByWindowId[close.windowId] || {};
  const durMs = close.windowDurationMs ??
    (close.windowStartTs && close.windowEndTs
      ? new Date(close.windowEndTs) - new Date(close.windowStartTs)
      : null);
  return {
    windowId:    close.windowId,
    startTs:     close.windowStartTs || open.ts,
    endTs:       close.windowEndTs   || close.ts,
    durationMs:  durMs,
    durationS:   durMs != null ? Math.round(durMs / 1000) : null,
    regime:      close.regime || open.regime || 'base',
    netEntry:    open.netSpreadFrac != null ? open.netSpreadFrac : null,
    depthEntry:  open.depthMin  != null ? open.depthMin  : close.windowStartDepth,
    depthClose:  close.depthMin,
    closeReason: close.blockedReason || '?',
    netClose:    close.netSpreadFrac,
    tickDist:    open.tickDistance,
  };
});

// For backwards compat — if no windowId on transitions, build from pairing
if (windows.length === 0) {
  let armed = null;
  for (const t of transitions) {
    if (t.from === 'PASSIVE' && t.to === 'ARMED') { armed = t; }
    else if (t.from === 'ARMED' && t.to === 'PASSIVE' && armed) {
      const dur = new Date(t.ts) - new Date(armed.ts);
      windows.push({
        windowId:   null,
        startTs:    armed.ts,
        endTs:      t.ts,
        durationMs: dur,
        durationS:  Math.round(dur / 1000),
        regime:     t.regime || armed.regime || 'base',
        netEntry:   armed.netSpreadFrac,
        depthEntry: armed.depthMin,
        depthClose: t.depthMin,
        closeReason: t.blockedReason || '?',
        netClose:   t.netSpreadFrac,
        tickDist:   armed.tickDistance,
      });
      armed = null;
    }
  }
}

// Regime split
const baseWindows  = windows.filter(w => w.regime === 'base');
const surgeWindows = windows.filter(w => w.regime === 'surge');

// Signals by regime
const sigsByRegime = { base: [], surge: [], unknown: [] };
for (const s of signals) {
  const r = s.regime || 'unknown';
  (sigsByRegime[r] || sigsByRegime.unknown).push(s);
}

// Run overview
const firstHb = heartbeats[0];
const lastHb  = heartbeats[heartbeats.length - 1];
const runStart = records[0]?.ts;
const runEnd   = records[records.length - 1]?.ts;
const uptimeMin = lastHb?.uptime_min ?? null;

// ─── SECTION PRINTERS ─────────────────────────────────────────────────────────

const W = 110;
const EQ = '═'.repeat(W);
const LN = '─'.repeat(W);

function windowTable(wins, title) {
  if (!wins.length) { console.log(`  (none)\n`); return; }
  console.log(`  ${title} (${wins.length})`);
  console.log(`  ${'#'.padEnd(4)}${'start'.padEnd(22)}${'dur'.padEnd(8)}${'net_entry'.padEnd(12)}${'depth_entry'.padEnd(14)}${'close_reason'.padEnd(28)}${'net_close'.padEnd(12)}`);
  console.log('  ' + '─'.repeat(W - 4));
  for (const w of wins) {
    const dur   = w.durationS != null ? `${w.durationS}s` : '?';
    const ne    = w.netEntry  != null ? `${(w.netEntry * 100).toFixed(4)}%` : '—';
    const dep   = fmt$(w.depthEntry);
    const nc    = w.netClose  != null ? `${(w.netClose * 100).toFixed(4)}%` : '—';
    const id    = w.windowId  != null ? String(w.windowId).padEnd(4) : '?'.padEnd(4);
    console.log(`  ${id}${(w.startTs || '').slice(11, 22).padEnd(22)}${dur.padEnd(8)}${ne.padEnd(12)}${dep.padEnd(14)}${(w.closeReason || '?').padEnd(28)}${nc.padEnd(12)}`);
  }
  const durs = wins.map(w => w.durationS).filter(v => v != null);
  const nets = wins.map(w => w.netEntry).filter(v => v != null);
  if (durs.length) {
    const avgDur = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
    console.log(`  avg_dur=${avgDur}s  max_dur=${Math.max(...durs)}s  min_dur=${Math.min(...durs)}s`);
  }
  if (nets.length) {
    const avgNet = nets.reduce((a, b) => a + b, 0) / nets.length;
    console.log(`  avg_net_entry=${(avgNet * 100).toFixed(4)}%  max=${(Math.max(...nets) * 100).toFixed(4)}%`);
  }
  console.log();
}

function sizeSweepTable(sigs) {
  if (!sigs.length) { console.log('  (no signals with sizeSweep data)\n'); return; }
  // Aggregate by size across all signals
  const bySz = {};
  for (const s of sigs) {
    if (!Array.isArray(s.sizeSweep)) continue;
    for (const sw of s.sizeSweep) {
      if (!bySz[sw.size]) bySz[sw.size] = { edges: [], slip: [], count: 0, profitable: 0, marginal: 0, lost: 0 };
      bySz[sw.size].count++;
      if (sw.finalEdge != null) bySz[sw.size].edges.push(sw.finalEdge);
      if (sw.slippage  != null) bySz[sw.size].slip.push(sw.slippage);
      if (sw.status === 'PROFITABLE') bySz[sw.size].profitable++;
      if (sw.status === 'MARGINAL')   bySz[sw.size].marginal++;
      if (sw.status === 'LOST')       bySz[sw.size].lost++;
    }
  }
  console.log(`  ${'size'.padEnd(8)}${'mean_edge'.padEnd(12)}${'max_edge'.padEnd(12)}${'mean_slip'.padEnd(12)}${'profitable'.padEnd(12)}${'marginal'.padEnd(12)}${'lost'.padEnd(10)}`);
  console.log('  ' + '─'.repeat(80));
  for (const [sz, d] of Object.entries(bySz).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const me   = d.edges.length ? d.edges.reduce((a, b) => a + b, 0) / d.edges.length : null;
    const maxE = d.edges.length ? Math.max(...d.edges) : null;
    const ms   = d.slip.length  ? d.slip.reduce((a, b) => a + b, 0) / d.slip.length   : null;
    console.log(
      `  ${'$'+sz}.padEnd(8)}`.replace("'$'+sz).padEnd(8)}", `${'$' + sz}`.padEnd(8)) +
      fmtEdge(me).padEnd(12) +
      fmtEdge(maxE).padEnd(12) +
      (ms != null ? `${ms.toFixed(5)}%` : '—').padEnd(12) +
      pct(d.profitable, d.count).padEnd(12) +
      pct(d.marginal,   d.count).padEnd(12) +
      pct(d.lost,       d.count).padEnd(10)
    );
  }
  console.log();
}

// Simplified size sweep table that works cleanly
function sizeSweepTableClean(sigs) {
  if (!sigs.length) { console.log('  (no signals with sizeSweep data)\n'); return; }
  const bySz = {};
  for (const s of sigs) {
    if (!Array.isArray(s.sizeSweep)) continue;
    for (const sw of s.sizeSweep) {
      const sz = sw.size;
      if (!bySz[sz]) bySz[sz] = { edges: [], count: 0, profitable: 0, marginal: 0, lost: 0 };
      bySz[sz].count++;
      if (sw.finalEdge != null) bySz[sz].edges.push(sw.finalEdge);
      if (sw.status === 'PROFITABLE') bySz[sz].profitable++;
      if (sw.status === 'MARGINAL')   bySz[sz].marginal++;
      if (sw.status === 'LOST')       bySz[sz].lost++;
    }
  }

  const header = 'size      mean_edge    max_edge     profitable   marginal     lost      n';
  console.log('  ' + header);
  console.log('  ' + '-'.repeat(header.length));
  const sizes = Object.keys(bySz).map(Number).sort((a, b) => a - b);
  for (const sz of sizes) {
    const d  = bySz[sz];
    const me = d.edges.length ? (d.edges.reduce((a, b) => a + b, 0) / d.edges.length) : null;
    const mx = d.edges.length ? Math.max(...d.edges) : null;
    const row = [
      ('$' + sz).padEnd(10),
      fmtEdge(me).padEnd(13),
      fmtEdge(mx).padEnd(13),
      pct(d.profitable, d.count).padEnd(13),
      pct(d.marginal,   d.count).padEnd(13),
      pct(d.lost,       d.count).padEnd(10),
      String(d.count),
    ].join('');
    console.log('  ' + row);
  }
  console.log();
}

// ─── MAIN OUTPUT ──────────────────────────────────────────────────────────────

if (JSON_OUT) {
  const out = {
    logFile:       LOG_PATH,
    runStart, runEnd, uptimeMin,
    totalWindows:  windows.length,
    baseWindows:   baseWindows.length,
    surgeWindows:  surgeWindows.length,
    totalSignals:  signals.length,
    signalsByType: {
      EXECUTION_READY:    signals.filter(s => s.signal === 'EXECUTION_READY').length,
      SIMULATION_MARGINAL:signals.filter(s => s.signal === 'SIMULATION_MARGINAL').length,
      SIMULATION_LOST:    signals.filter(s => s.signal === 'SIMULATION_LOST').length,
    },
    windows,
    signals,
  };
  process.stdout.write(JSON.stringify(out, null, 2));
  process.exit(0);
}

// ── Console report ────────────────────────────────────────────────────────────

console.log('\n' + EQ);
console.log(' AllMight — Activator Run Summary  v1.0');
console.log(` Log: ${LOG_PATH}`);
if (runStart) console.log(` Run: ${runStart.slice(0, 19)} → ${(runEnd || '?').slice(0, 19)}  (${uptimeMin != null ? uptimeMin + ' min' : '?'})`);
console.log(EQ);

// Overview
const lastHbStats = lastHb || {};
console.log('\n ── OVERVIEW ──────────────────────────────────────────────────');
console.log(`  Ticks:       ${lastHbStats.ticks ?? '?'}`);
console.log(`  Errors:      ${lastHbStats.errors ?? '?'}`);
console.log(`  Armed:       ${lastHbStats.armed ?? '?'}  (windows opened)`);
console.log(`  Sim runs:    ${lastHbStats.simRuns ?? '?'}`);
console.log(`  EXEC_READY:  ${lastHbStats.readySignals ?? signals.filter(s => s.signal === 'EXECUTION_READY').length}`);
console.log(`  Remaps:      ${remaps.length}`);
console.log(`  Ready checks:${readyChecks.length}`);
console.log();

// Windows
console.log(LN);
console.log(' BASE REGIME WINDOWS  (depth < $100k, structural signal)');
console.log(LN);
windowTable(baseWindows, 'base windows');

console.log(LN);
console.log(' SURGE REGIME WINDOWS  (depth ≥ $100k, LP-event signal)');
console.log(LN);
windowTable(surgeWindows, 'surge windows');

// Signals
const allSignalTypes = ['EXECUTION_READY', 'SIMULATION_MARGINAL', 'SIMULATION_LOST'];
console.log(LN);
console.log(' SIGNAL BREAKDOWN BY REGIME');
console.log(LN);
for (const regime of ['base', 'surge', 'unknown']) {
  const rSigs = sigsByRegime[regime];
  if (!rSigs.length) continue;
  console.log(`  ${regime.toUpperCase()} (${rSigs.length} signals):`);
  for (const t of allSignalTypes) {
    const n = rSigs.filter(s => s.signal === t).length;
    if (n) {
      const edges = rSigs.filter(s => s.signal === t && s.finalEdge != null).map(s => s.finalEdge);
      const avg = edges.length ? edges.reduce((a, b) => a + b, 0) / edges.length : null;
      const max = edges.length ? Math.max(...edges) : null;
      console.log(`    ${t.padEnd(22)} n=${n}  avg_edge=${fmtEdge(avg)}  max_edge=${fmtEdge(max)}`);
    }
  }
  console.log();
}

// Size sweep
console.log(LN);
console.log(' SIZE-SWEEP EDGE CURVE  (delay=0, all EXECUTION_READY + MARGINAL signals)');
console.log(LN);
const sweepSigs = signals.filter(s => s.signal !== 'SIMULATION_LOST' && Array.isArray(s.sizeSweep));
if (sweepSigs.length > 0) {
  console.log('  ALL REGIMES:');
  sizeSweepTableClean(sweepSigs);
  const baseSweep  = sweepSigs.filter(s => s.regime === 'base');
  const surgeSweep = sweepSigs.filter(s => s.regime === 'surge');
  if (baseSweep.length) {
    console.log('  BASE REGIME:');
    sizeSweepTableClean(baseSweep);
  }
  if (surgeSweep.length) {
    console.log('  SURGE REGIME:');
    sizeSweepTableClean(surgeSweep);
  }
} else {
  console.log('  No size sweep data found (requires activator v2+ logs).\n');
}

// Boss input
console.log(LN);
console.log(' BOSS CLASSIFICATION INPUTS');
console.log(LN);
const bDurs = baseWindows.map(w => w.durationS).filter(v => v != null);
const sDurs = surgeWindows.map(w => w.durationS).filter(v => v != null);
const bNets = baseWindows.map(w => w.netEntry).filter(v => v != null);
const sNets = surgeWindows.map(w => w.netEntry).filter(v => v != null);

console.log('  BASE REGIME (structural signal):');
console.log(`    Windows:  ${baseWindows.length}`);
if (bDurs.length) console.log(`    Duration: min=${Math.min(...bDurs)}s  max=${Math.max(...bDurs)}s  avg=${Math.round(bDurs.reduce((a,b)=>a+b,0)/bDurs.length)}s`);
if (bNets.length) console.log(`    Net entry: min=${(Math.min(...bNets)*100).toFixed(4)}%  max=${(Math.max(...bNets)*100).toFixed(4)}%  avg=${(bNets.reduce((a,b)=>a+b,0)/bNets.length*100).toFixed(4)}%`);
console.log(`    EXECUTION_READY: ${sigsByRegime.base.filter(s=>s.signal==='EXECUTION_READY').length}`);
console.log();
console.log('  SURGE REGIME (LP-event signal):');
console.log(`    Windows:  ${surgeWindows.length}`);
if (sDurs.length) console.log(`    Duration: min=${Math.min(...sDurs)}s  max=${Math.max(...sDurs)}s  avg=${Math.round(sDurs.reduce((a,b)=>a+b,0)/sDurs.length)}s`);
if (sNets.length) console.log(`    Net entry: min=${(Math.min(...sNets)*100).toFixed(4)}%  max=${(Math.max(...sNets)*100).toFixed(4)}%  avg=${(sNets.reduce((a,b)=>a+b,0)/sNets.length*100).toFixed(4)}%`);
console.log(`    EXECUTION_READY: ${sigsByRegime.surge.filter(s=>s.signal==='EXECUTION_READY').length}`);
console.log();

console.log(EQ + '\n');
