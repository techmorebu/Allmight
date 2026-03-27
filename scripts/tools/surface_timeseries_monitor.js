'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Time-Series Monitor  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/surface_timeseries_monitor.js
//  STATUS:     CURRENT — Track A (Boss directive 2026-03-27)
//
//  PURPOSE
//  ───────
//  Watch ARB/USDC for the exact moment:
//    min(depthA, depthB) ≥ $10,000  AND  net spread > 0
//
//  Runs master-fetcher + scanner on a fixed interval, logs every scan to JSONL,
//  tracks consecutive scans above threshold, and alerts on promotion condition.
//
//  PROMOTION RULE (Boss-approved)
//  ───────────────────────────────
//    Signal   : depth_min ≥ $10k AND net > 0 in a single scan
//    Confirmed: signal holds for CONFIRM_SCANS_REQUIRED consecutive scans
//    Action   : print PROMOTE alert, do NOT auto-execute anything
//
//  DESIGN RULES
//  ────────────
//  • No execution logic
//  • No new RPC calls (master-fetcher handles RPC, scanner reads Redis)
//  • Deterministic log output (one JSONL line per scan, sorted fields)
//  • Never modifies scanner or fetcher — orchestrates them only
//  • Graceful shutdown on SIGINT / SIGTERM
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/surface_timeseries_monitor.js
//  node -r dotenv/config scripts/tools/surface_timeseries_monitor.js --interval 10
//  node -r dotenv/config scripts/tools/surface_timeseries_monitor.js --pair ARB/USDC
//  node -r dotenv/config scripts/tools/surface_timeseries_monitor.js --quiet
//
//  Logs to: logs/surface_timeseries.jsonl  (one JSON line per scan cycle)
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);

function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : def;
}

const INTERVAL_SEC          = Number(argVal('--interval', 30));   // seconds between scans
const WATCH_PAIR            = argVal('--pair', 'ARB/USDC');
const CONFIRM_SCANS_REQUIRED = Number(argVal('--confirm', 3));    // consecutive scans to confirm promotion
const QUIET                 = ARGS.includes('--quiet');

const LOG_DIR  = path.resolve(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'surface_timeseries.jsonl');

const NODE_BIN     = process.execPath;
const FETCHER_PATH = path.resolve(process.cwd(), 'scripts/master-fetcher.js');
const SCANNER_PATH = path.resolve(process.cwd(), 'scripts/tools/surface_inventory_scanner.js');

// ─── THRESHOLDS (must match scanner — do not diverge) ─────────────────────────

const DEPTH_CANDIDATE = 10_000;   // $10k hard floor — NEVER lower without Boss ruling

// ─── STATE ────────────────────────────────────────────────────────────────────

let scanCount          = 0;
let consecutiveAbove   = 0;   // consecutive scans where watch_pair depth_min ≥ $10k
let firstAboveAt       = null;
let promotionConfirmed = false;
let running            = true;

// ─── LOGGING ─────────────────────────────────────────────────────────────────

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

function appendLog(record) {
  ensureLogDir();
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    console.error('[monitor] log write failed:', e.message);
  }
}

function nowIso() { return new Date().toISOString(); }

// ─── RUNNER ───────────────────────────────────────────────────────────────────

async function runFetcher() {
  try {
    await execFileAsync(NODE_BIN, ['-r', 'dotenv/config', FETCHER_PATH], {
      cwd: process.cwd(),
      timeout: 15_000,
      env: process.env,
    });
  } catch (e) {
    // Non-fatal — base/optimism errors are expected; arbitrum may still succeed
    if (!QUIET) process.stdout.write(' (fetcher warn) ');
  }
}

async function runScanner() {
  const { stdout } = await execFileAsync(
    NODE_BIN,
    ['-r', 'dotenv/config', SCANNER_PATH, '--json'],
    {
      cwd    : process.cwd(),
      timeout: 10_000,
      env    : process.env,
    }
  );
  return JSON.parse(stdout);
}

// ─── SURFACE EXTRACTION ───────────────────────────────────────────────────────

function findWatchSurface(scanResult) {
  if (!Array.isArray(scanResult.surfaces)) return null;
  // Find the highest-scored surface for the watch pair
  return scanResult.surfaces
    .filter(s => s.pair === WATCH_PAIR)
    .sort((a, b) => (b.score || 0) - (a.score || 0))[0] || null;
}

// ─── DISPLAY ──────────────────────────────────────────────────────────────────

function statusLine(scan, surface, cycleMs) {
  const ts      = scan.scannedAt ? scan.scannedAt.slice(11, 19) : '?';
  const eth     = scan.ethPriceUSD ? `$${scan.ethPriceUSD.toFixed(0)}` : 'n/a';
  const age     = scan.redisAgeSec != null ? `${scan.redisAgeSec}s` : '?';

  if (!surface) {
    return `[${ts}] ETH:${eth} age:${age} | ${WATCH_PAIR}: no surface | cycle:${cycleMs}ms`;
  }

  const depthMin = surface.depthMin != null
    ? `$${surface.depthMin >= 1000 ? (surface.depthMin / 1000).toFixed(1) + 'k' : surface.depthMin.toFixed(0)}`
    : '—';
  const net     = surface.spreadFrac != null && surface.feeBurdenFrac != null
    ? `+${((surface.spreadFrac - surface.feeBurdenFrac) * 100).toFixed(4)}%`
    : '—';
  const floor   = surface.depthMin != null
    ? `${((surface.depthMin / DEPTH_CANDIDATE) * 100).toFixed(0)}% of $10k`
    : '—';

  const badge =
    promotionConfirmed           ? '🟢 CONFIRMED' :
    consecutiveAbove > 0         ? `🟡 above×${consecutiveAbove}/${CONFIRM_SCANS_REQUIRED}` :
    surface.tier === 'near_threshold' ? '⏳ near_threshold' :
    surface.tier === 'monitored'      ? '👀 monitored' :
    surface.tier === 'candidate'      ? '✅ candidate' :
    `🔴 ${surface.tier}`;

  return (
    `[${ts}] ETH:${eth} age:${age} | ` +
    `${WATCH_PAIR} ${badge} | ` +
    `depth_min:${depthMin} (${floor}) | net:${net} | ` +
    `scan:#${scanCount} cycle:${cycleMs}ms`
  );
}

function printPromotion(surface) {
  const W = 80;
  console.log('\n' + '█'.repeat(W));
  console.log('  🟢 PROMOTION CONDITION CONFIRMED');
  console.log(`  Pair:      ${WATCH_PAIR}`);
  console.log(`  Venue A:   ${surface.venueA}  depth: $${surface.depthA.toFixed(0)}`);
  console.log(`  Venue B:   ${surface.venueB}  depth: $${surface.depthB.toFixed(0)}`);
  console.log(`  depth_min: $${surface.depthMin.toFixed(0)} ≥ $${DEPTH_CANDIDATE.toLocaleString()} ✓`);
  console.log(`  net spread:+${((surface.spreadFrac - surface.feeBurdenFrac) * 100).toFixed(4)}% ✓`);
  console.log(`  Consecutive scans above threshold: ${consecutiveAbove}`);
  console.log(`  First crossed: ${firstAboveAt}`);
  console.log(`  Confirmed at:  ${nowIso()}`);
  console.log('');
  console.log('  NEXT ACTION:');
  console.log('  Run standard 8-step validation sequence.');
  console.log('  See: docs/current/VALIDATION_PIPELINE.md');
  console.log('  Report to Boss before any further action.');
  console.log('█'.repeat(W) + '\n');
}

function printHeader() {
  console.log('\n' + '═'.repeat(80));
  console.log('  AllMight — Surface Time-Series Monitor  v1.0');
  console.log(`  Watching: ${WATCH_PAIR}  |  interval: ${INTERVAL_SEC}s  |  confirm: ${CONFIRM_SCANS_REQUIRED} scans`);
  console.log(`  Log: ${LOG_FILE}`);
  console.log(`  Promotion threshold: depth_min ≥ $${DEPTH_CANDIDATE.toLocaleString()} AND net > 0`);
  console.log(`  Stop: Ctrl+C`);
  console.log('═'.repeat(80) + '\n');
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function runCycle() {
  const cycleStart = Date.now();
  scanCount++;

  let scanResult, surface;

  try {
    await runFetcher();
    scanResult = await runScanner();
    surface    = findWatchSurface(scanResult);
  } catch (e) {
    const errRecord = {
      ts       : nowIso(),
      scanCount,
      error    : e.message.slice(0, 200),
      pair     : WATCH_PAIR,
    };
    appendLog(errRecord);
    if (!QUIET) console.log(`[${nowIso().slice(11,19)}] cycle error: ${e.message.slice(0,80)}`);
    return;
  }

  const cycleMs = Date.now() - cycleStart;

  // ── Threshold tracking ────────────────────────────────────────────────────
  const aboveThreshold = surface &&
    surface.depthMin != null &&
    surface.depthMin >= DEPTH_CANDIDATE &&
    (surface.spreadFrac - surface.feeBurdenFrac) > 0;

  if (aboveThreshold) {
    if (consecutiveAbove === 0) firstAboveAt = nowIso();
    consecutiveAbove++;
    if (!promotionConfirmed && consecutiveAbove >= CONFIRM_SCANS_REQUIRED) {
      promotionConfirmed = true;
      printPromotion(surface);
    }
  } else {
    if (consecutiveAbove > 0 && !QUIET) {
      console.log(`  ↳ dropped below threshold after ${consecutiveAbove} scan(s) — resetting counter`);
    }
    consecutiveAbove = 0;
  }

  // ── Log record ────────────────────────────────────────────────────────────
  const record = {
    ts               : scanResult.scannedAt,
    scanCount,
    ethPriceUSD      : scanResult.ethPriceUSD,
    redisAgeSec      : scanResult.redisAgeSec,
    pair             : WATCH_PAIR,
    tier             : surface ? surface.tier   : null,
    depthMin         : surface ? surface.depthMin : null,
    depthA           : surface ? surface.depthA   : null,
    depthB           : surface ? surface.depthB   : null,
    spreadFrac       : surface ? surface.spreadFrac      : null,
    feeBurdenFrac    : surface ? surface.feeBurdenFrac   : null,
    netSpreadFrac    : surface ? (surface.spreadFrac - surface.feeBurdenFrac) : null,
    venueA           : surface ? surface.venueA  : null,
    venueB           : surface ? surface.venueB  : null,
    consecutiveAbove,
    promotionConfirmed,
    cycleMs,
  };
  appendLog(record);

  // ── Console output ────────────────────────────────────────────────────────
  if (!QUIET) {
    console.log(statusLine(scanResult, surface, cycleMs));
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  printHeader();

  // Graceful shutdown
  const shutdown = () => {
    running = false;
    console.log(`\n[monitor] stopped after ${scanCount} scans. Log: ${LOG_FILE}\n`);
    process.exit(0);
  };
  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // Run immediately, then on interval
  while (running) {
    await runCycle();
    if (running) await sleep(INTERVAL_SEC * 1000);
  }
}

main().catch(err => {
  console.error('[monitor] FATAL:', err.message || err);
  process.exit(1);
});
