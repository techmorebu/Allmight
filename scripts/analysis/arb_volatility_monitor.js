'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Volatility / Divergence Monitor  v1.0  (Wave 2)
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT: scripts/analysis/arb_volatility_monitor.js
//  STATUS:    NEW — Boss directive 2026-04-07 (Wave 2 priority signal layer)
//
//  PURPOSE
//  ─────────
//  Detect WHEN a surface is entering or leaving the premium zone —
//  not just whether it is already there.
//
//  Runs master-fetcher as a subprocess on each interval to keep Redis fresh,
//  then reads the updated data to compute scores. No separate fetcher loop needed.
//
//  USAGE
//  ─────
//  # Continuous mode (self-contained — runs its own fetcher)
//  node -r dotenv/config scripts/analysis/arb_volatility_monitor.js \
//    --chain arbitrum --interval 15 --log logs/volatility_arbitrum.jsonl
//
//  # One-shot (requires Redis already populated)
//  node -r dotenv/config scripts/analysis/arb_volatility_monitor.js --chain arbitrum
//
//  # Surface filter
//  node -r dotenv/config scripts/analysis/arb_volatility_monitor.js \
//    --chain arbitrum --pair ETH/USDC
// ═══════════════════════════════════════════════════════════════════════════════

const fs      = require('fs');
const path    = require('path');
const Redis   = require('ioredis');
const { execFile }  = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const NODE_BIN     = process.execPath;
const FETCHER_PATH = path.resolve(process.cwd(), 'scripts/master-fetcher.js');

// Run master-fetcher subprocess to populate Redis before each scan.
// Non-fatal — base/optimism chain errors are expected and silently ignored.
async function runFetcher() {
  try {
    await execFileAsync(NODE_BIN, ['-r', 'dotenv/config', FETCHER_PATH], {
      cwd: process.cwd(), timeout: 20_000, env: process.env,
    });
  } catch (_) {}
}

// ─── ARGS ─────────────────────────────────────────────────────────────────────

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i+1]) return process.argv[i+1];
  const eq = process.argv.find(a => a.startsWith(flag+'='));
  return eq ? eq.split('=').slice(1).join('=') : def;
}

const CHAIN_ARG    = argVal('--chain',    'arbitrum');
const PAIR_FILTER  = argVal('--pair',     null);        // null = all pairs
const INTERVAL_SEC = Number(argVal('--interval', '0')); // 0 = one-shot
const LOG_PATH     = argVal('--log',      null);
const VERBOSE      = process.argv.includes('--verbose');
const TOP_N        = Number(argVal('--top', '10'));

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const FETCHER_KEYS_BY_CHAIN = {
  arbitrum: ['fetcher:arbitrumFetcher'],
  ethereum: ['fetcher:ethereumFetcher', 'fetcher:curveFetcherEthereum'],
};
const FETCHER_KEYS = FETCHER_KEYS_BY_CHAIN[CHAIN_ARG] || FETCHER_KEYS_BY_CHAIN.arbitrum;

// History ring buffer — how many snapshots to keep per surface
const HISTORY_DEPTH = 20;  // ~5 min at 15s interval

// Viability thresholds from surface analysis
const PREMIUM_SPREAD_PCT  = 0.18;  // ≥ 0.18% — premium zone (100% viable in v5)
const VIABLE_SPREAD_PCT   = 0.13;  // ≥ 0.13% — above viability floor
const WARMING_SPREAD_PCT  = 0.10;  // ≥ 0.10% — approaching floor (warming signal)

// ─── STATE ────────────────────────────────────────────────────────────────────

// surfaceKey → circular buffer of snapshots
const history = new Map();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(arr.map(x=>(x-m)**2).reduce((a,b)=>a+b,0)/arr.length);
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function appendLog(filePath, record) {
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    process.stderr.write(`[vol] log write failed: ${e.message}\n`);
  }
}

// ─── REDIS READ ───────────────────────────────────────────────────────────────

async function readFetcherPayloads(redis) {
  const results = [];
  for (const key of FETCHER_KEYS) {
    try {
      const raw = await redis.get(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (!parsed.ok || !parsed.data) continue;
      results.push({ key, payload: parsed });
    } catch (_) {}
  }
  return results;
}

function extractPriceRows(payloads) {
  const rows = [];
  for (const { key, payload } of payloads) {
    const prices = payload.data?.data?.prices ?? payload.data?.prices;
    if (!Array.isArray(prices)) continue;
    for (const p of prices) {
      if (!p || !p.price || !isFinite(p.price) || p.price <= 0) continue;
      rows.push({
        fetcherKey:  key,
        pair:        p.pair,
        venue:       p.venue || 'unknown',
        pool:        (p.pool || '').toLowerCase(),
        price:       p.price,
        fee:         typeof p.fee === 'number' ? p.fee : 0,
        blockNumber: p.blockNumber,
        timestamp:   p.timestamp || nowIso(),
        depthUSD:    p.depthUSD ?? p.tvlUSD ?? null,
        liquidityRaw: p.liquidityRaw ?? null,
        source:      p.source || key,
      });
    }
  }
  return rows;
}

// ─── SURFACE FORMATION ────────────────────────────────────────────────────────

function formCurrentSurfaces(rows) {
  // Group by pair → find all cross-venue pairs
  const byPair = new Map();
  for (const r of rows) {
    if (!byPair.has(r.pair)) byPair.set(r.pair, []);
    byPair.get(r.pair).push(r);
  }

  const surfaces = [];
  for (const [pair, venues] of byPair) {
    if (venues.length < 2) continue;
    if (PAIR_FILTER && pair !== PAIR_FILTER) continue;

    for (let i = 0; i < venues.length; i++) {
      for (let j = i+1; j < venues.length; j++) {
        const a = venues[i];
        const b = venues[j];
        if (a.venue === b.venue && a.pool === b.pool) continue;

        const spreadPct = Math.abs(a.price - b.price) / Math.min(a.price, b.price) * 100;
        const feeBurden = (a.fee + b.fee) * 100;
        const netPct    = spreadPct - feeBurden;

        // Surface ID — stable across scans
        const surfaceId = `${pair}:${[a.venue, b.venue].sort().join('↔')}`;

        surfaces.push({
          surfaceId,
          pair,
          venueA:      a.venue,
          venueB:      b.venue,
          priceA:      a.price,
          priceB:      b.price,
          feeA:        a.fee,
          feeB:        b.fee,
          spreadPct:   +spreadPct.toFixed(6),
          feeBurden:   +feeBurden.toFixed(6),
          netPct:      +netPct.toFixed(6),
          blockA:      a.blockNumber,
          blockB:      b.blockNumber,
          depthA:      a.depthUSD,
          depthB:      b.depthUSD,
          ts:          nowIso(),
        });
      }
    }
  }
  return surfaces;
}

// ─── HISTORY UPDATE ───────────────────────────────────────────────────────────

function updateHistory(surfaces) {
  for (const s of surfaces) {
    if (!history.has(s.surfaceId)) history.set(s.surfaceId, []);
    const buf = history.get(s.surfaceId);
    buf.push({ spreadPct: s.spreadPct, netPct: s.netPct, ts: s.ts });
    if (buf.length > HISTORY_DEPTH) buf.shift();
  }
}

// ─── COMPUTE SCORES ───────────────────────────────────────────────────────────

function computeScores(surface) {
  const buf = history.get(surface.surfaceId) || [];
  const spreads = buf.map(b => b.spreadPct);

  // ── Spread velocity ───────────────────────────────────────────────────────
  // Change in spread per interval. Positive = expanding (warming).
  let spreadVelocity = 0;
  if (spreads.length >= 3) {
    const recent = spreads.slice(-3);
    spreadVelocity = recent[recent.length-1] - recent[0];
  }

  // ── Spread acceleration ───────────────────────────────────────────────────
  // Is velocity itself increasing? (second derivative)
  let spreadAcceleration = 0;
  if (spreads.length >= 5) {
    const v1 = spreads[spreads.length-3] - spreads[spreads.length-5];
    const v2 = spreads[spreads.length-1] - spreads[spreads.length-3];
    spreadAcceleration = v2 - v1;
  }

  // ── Spread stability ──────────────────────────────────────────────────────
  // Low std = stable spread = reliable signal
  const spreadStd = spreads.length >= 3 ? stddev(spreads.slice(-6)) : null;

  // ── Venue lag ────────────────────────────────────────────────────────────
  // Which venue is "behind"? The one with the more extreme price relative to
  // a 2-venue system is the laggard. Positive = B is above A (B is lagging high).
  const venueLag = surface.priceB > surface.priceA ? 'B_high' : 'A_high';
  const lagMagnitudePct = surface.spreadPct;  // same as spread for 2-venue

  // ── Scores ────────────────────────────────────────────────────────────────
  // volatility_score: how much is this surface moving?
  // Range 0–1. Higher = more price action observed.
  const volatilityScore = clamp01(
    (Math.abs(spreadVelocity) / 0.05) * 0.5 +    // velocity contribution
    (surface.spreadPct / PREMIUM_SPREAD_PCT) * 0.3 + // current spread level
    (Math.abs(spreadAcceleration) / 0.02) * 0.2  // acceleration contribution
  );

  // divergence_score: is the gap actively growing toward premium?
  // Range 0–1. Higher = spread expanding toward viable/premium zone.
  const expandingTowardPremium = spreadVelocity > 0 && surface.spreadPct < PREMIUM_SPREAD_PCT;
  const divergenceScore = clamp01(
    (spreadVelocity > 0 ? spreadVelocity / 0.05 : 0) * 0.5 +           // positive velocity
    (surface.spreadPct >= VIABLE_SPREAD_PCT ? 0.3 : 0) +               // already above floor
    (expandingTowardPremium ? 0.2 : 0)                                 // heading to premium
  );

  // proximity_score: how close to premium zone?
  // Range 0–1. 1.0 = at or above premium threshold.
  const proximityScore = clamp01(surface.spreadPct / PREMIUM_SPREAD_PCT);

  // zone classification
  const zone = surface.spreadPct >= PREMIUM_SPREAD_PCT ? 'PREMIUM'
             : surface.spreadPct >= VIABLE_SPREAD_PCT  ? 'VIABLE'
             : surface.spreadPct >= WARMING_SPREAD_PCT ? 'WARMING'
             : surface.netPct > 0                      ? 'NET_POS'
             : 'DEAD';

  // Trend label
  const trend = spreadVelocity > 0.01  ? 'EXPANDING'
              : spreadVelocity < -0.01 ? 'COMPRESSING'
              : 'FLAT';

  return {
    spreadVelocity:    +spreadVelocity.toFixed(6),
    spreadAcceleration:+spreadAcceleration.toFixed(6),
    spreadStd:         spreadStd != null ? +spreadStd.toFixed(6) : null,
    venueLag,
    lagMagnitudePct:   +lagMagnitudePct.toFixed(6),
    volatilityScore:   +volatilityScore.toFixed(4),
    divergenceScore:   +divergenceScore.toFixed(4),
    proximityScore:    +proximityScore.toFixed(4),
    zone,
    trend,
    historyDepth:      buf.length,
  };
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function printReport(scored, scanCount, redisAgeSec) {
  const W = 110;
  console.log('\n' + '═'.repeat(W));
  console.log(`  AllMight — Volatility / Divergence Monitor  v1.0  |  chain=${CHAIN_ARG}`);
  console.log(`  ${nowIso()}  |  Redis age: ${redisAgeSec}s  |  Scan #${scanCount}`);
  console.log('═'.repeat(W));

  // Sort by divergence_score desc (highest divergence = most actionable)
  const ranked = [...scored].sort((a,b) => b.scores.divergenceScore - a.scores.divergenceScore);
  const top    = ranked.slice(0, TOP_N);

  const COL = (s, w) => String(s).padStart(w);
  const COLL = (s, w) => String(s).padEnd(w);
  console.log(
    `  ${'#'.padStart(3)}  ${'pair'.padEnd(12)}  ${'venues'.padEnd(28)}  ` +
    `${'spread'.padStart(8)}  ${'net'.padStart(8)}  ${'vel'.padStart(7)}  ` +
    `${'div'.padStart(6)}  ${'vol'.padStart(6)}  ${'prox'.padStart(6)}  ` +
    `${'zone'.padStart(8)}  trend`
  );
  console.log('  ' + '─'.repeat(W-2));

  top.forEach((s, i) => {
    const sc = s.scores;
    const venues = `${s.venueA}↔${s.venueB}`.slice(0, 28);
    const spreadStr = s.spreadPct >= PREMIUM_SPREAD_PCT ? `★${s.spreadPct.toFixed(4)}%`
                    : s.spreadPct >= VIABLE_SPREAD_PCT  ? `✓${s.spreadPct.toFixed(4)}%`
                    : `${s.spreadPct.toFixed(4)}%`;
    console.log(
      `  ${COL(i+1,3)}  ${COLL(s.pair,12)}  ${COLL(venues,28)}  ` +
      `${COL(spreadStr,8)}  ${COL((s.netPct>0?'+':'')+s.netPct.toFixed(4)+'%',8)}  ` +
      `${COL((sc.spreadVelocity>0?'+':'')+sc.spreadVelocity.toFixed(4),7)}  ` +
      `${COL(sc.divergenceScore.toFixed(3),6)}  ${COL(sc.volatilityScore.toFixed(3),6)}  ` +
      `${COL(sc.proximityScore.toFixed(3),6)}  ${COL(sc.zone,8)}  ${sc.trend}`
    );
  });

  // Hot surface alert
  const hot = ranked.filter(s => s.scores.zone === 'PREMIUM' || s.scores.divergenceScore >= 0.6);
  if (hot.length) {
    console.log(`\n  🔥 HOT SURFACES (${hot.length}): ${hot.map(s=>`${s.pair}(${s.venueA}↔${s.venueB})`).join(' | ')}`);
  }

  // Warming surfaces (approaching viable floor, expanding)
  const warming = ranked.filter(s =>
    s.scores.zone === 'WARMING' && s.scores.trend === 'EXPANDING' && s.scores.divergenceScore >= 0.3
  );
  if (warming.length) {
    console.log(`  ⚡ WARMING: ${warming.map(s=>`${s.pair}(div=${s.scores.divergenceScore.toFixed(2)})`).join(' | ')}`);
  }

  console.log('\n' + '═'.repeat(W));
}

// ─── MAIN SCAN ────────────────────────────────────────────────────────────────

async function runScan(redis, scanCount) {
  const payloads = await readFetcherPayloads(redis);
  if (!payloads.length) {
    console.warn('[vol] No fetcher data — run master-fetcher first.');
    return [];
  }

  // Redis age
  let redisAgeSec = '?';
  try {
    const ts = payloads.map(p => new Date(p.payload.timestamp).getTime()).filter(Boolean);
    if (ts.length) redisAgeSec = Math.round((Date.now() - Math.max(...ts)) / 1000);
  } catch (_) {}

  const rows     = extractPriceRows(payloads);
  const surfaces = formCurrentSurfaces(rows);
  updateHistory(surfaces);

  // Compute scores for each surface
  const scored = surfaces.map(s => ({ ...s, scores: computeScores(s) }));

  if (VERBOSE || !LOG_PATH) {
    printReport(scored, scanCount, redisAgeSec);
  }

  // JSONL output
  const record = {
    type:        'volatility_scan',
    ts:          nowIso(),
    chain:       CHAIN_ARG,
    scanCount,
    redisAgeSec,
    surfaceCount: scored.length,
    surfaces:    scored.map(s => ({
      surfaceId:         s.surfaceId,
      pair:              s.pair,
      venueA:            s.venueA,
      venueB:            s.venueB,
      spreadPct:         s.spreadPct,
      netPct:            s.netPct,
      feeBurden:         s.feeBurden,
      zone:              s.scores.zone,
      trend:             s.scores.trend,
      divergenceScore:   s.scores.divergenceScore,
      volatilityScore:   s.scores.volatilityScore,
      proximityScore:    s.scores.proximityScore,
      spreadVelocity:    s.scores.spreadVelocity,
      spreadStd:         s.scores.spreadStd,
      venueLag:          s.scores.venueLag,
      historyDepth:      s.scores.historyDepth,
    })),
    // Hot surface summary — upstream signal for scanner/activator
    hotSurfaces: scored
      .filter(s => s.scores.zone === 'PREMIUM' || s.scores.divergenceScore >= 0.5)
      .map(s => ({ surfaceId: s.surfaceId, zone: s.scores.zone, divergenceScore: s.scores.divergenceScore })),
  };

  appendLog(LOG_PATH, record);
  return scored;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const redis = new Redis(REDIS_URL, { lazyConnect: false, enableReadyCheck: true });
  redis.on('error', e => process.stderr.write(`[vol] Redis: ${e.message}\n`));

  try { await redis.ping(); } catch (e) {
    console.error('[vol] Cannot reach Redis:', e.message);
    await redis.quit().catch(() => {});
    process.exit(1);
  }

  console.log(`[vol] AllMight Volatility Monitor v1.0  chain=${CHAIN_ARG}  interval=${INTERVAL_SEC}s`);
  if (PAIR_FILTER) console.log(`[vol] Pair filter: ${PAIR_FILTER}`);
  if (LOG_PATH) console.log(`[vol] Log: ${LOG_PATH}`);

  let scanCount = 0;

  if (INTERVAL_SEC <= 0) {
    // One-shot
    await runScan(redis, ++scanCount);
    await redis.quit();
    process.exit(0);
  }

  // Continuous mode
  console.log(`[vol] Running continuous mode every ${INTERVAL_SEC}s. Ctrl+C to stop.`);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let running = true;
  process.on('SIGINT',  () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    const start = Date.now();
    try {
      // Populate Redis before reading — keeps data fresh each interval
      await runFetcher();
      await runScan(redis, ++scanCount);
    } catch (e) {
      process.stderr.write(`[vol] scan error: ${e.message}\n`);
    }
    const elapsed = Date.now() - start;
    const wait    = Math.max(0, INTERVAL_SEC * 1000 - elapsed);
    if (running) await sleep(wait);
  }

  console.log('[vol] Stopped.');
  await redis.quit().catch(() => {});
  process.exit(0);
}

main().catch(e => {
  console.error('[vol] FATAL:', e.message);
  process.exit(1);
});
