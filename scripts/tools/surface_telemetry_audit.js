#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Telemetry Audit  v1.0
//  PLACEMENT: scripts/tools/surface_telemetry_audit.js
//  STATUS:    Boss Phase 2A — READ-ONLY telemetry census
//
//  WHAT IT DOES
//  ────────────
//  Enumerates what the Observatory actually collects, and cross-references it
//  against the surface registry. Answers: which surfaces are FULL / PARTIAL /
//  CONFIG_ONLY / MISSING — i.e. the Phase 2A telemetry work order.
//
//  It also surfaces OBSERVED-BUT-UNREGISTERED pairs: telemetry already flowing
//  that isn't yet a registered surface (candidate discovery — esp. stables).
//
//  DESIGN RULES (Boss Phase 2A)
//  ─────────────────────────────
//  - READ-ONLY. No execution, no arming, no contracts, no live gates.
//  - No config writes. No surface promotion. Audit only.
//  - Mirrors the canonical reader (surface_inventory_scanner.js) payload schema.
//
//  CONFIRMED SCHEMA (master-fetcher write / scanner parse)
//  ───────────────────────────────────────────────────────
//    Redis key : fetcher:{name}            (+ fetcher:{name}:error)
//    value     : JSON { ok, timestamp, data: { data: { prices: [...] } } }
//    price row : { pair, venue, price, blockNumber, liquidityRaw, fee,
//                  reserveUSD?, depthUSD? }
//
//  USAGE
//  ─────
//    node scripts/tools/surface_telemetry_audit.js            # live census → print + write
//    node scripts/tools/surface_telemetry_audit.js --json     # JSON to stdout
//    node scripts/tools/surface_telemetry_audit.js --self-test # logic check (no Redis)
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

// ─── PATHS ──────────────────────────────────────────────────────────────────
const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACES_DIR  = path.join(REPO, 'surfaces');
const REGISTRY_FILE = path.join(SURFACES_DIR, 'registry.json');
const METRICS_DIR   = path.join(REPO, 'logs', 'project_metrics');
const OUT_JSON      = path.join(METRICS_DIR, 'surface_telemetry_audit.json');
const OUT_TXT       = path.join(METRICS_DIR, 'surface_telemetry_audit.txt');

const REDIS_URL       = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const STALE_AGE_SEC   = Number(process.env.TELEMETRY_STALE_SEC || 120); // payload older than this = stale

// ─── TOKEN / PAIR NORMALIZATION ──────────────────────────────────────────────
function normToken(t) {
  const u = String(t || '').toUpperCase();
  return u === 'WETH' ? 'ETH' : u;
}
function normPair(pair) {
  return String(pair || '').toUpperCase().replace(/\bWETH\b/g, 'ETH');
}
function surfaceExpectedPair(cfg) {
  return `${normToken(cfg.base)}/${normToken(cfg.quote)}`;
}

// ─── PURE: extract one fetcher payload (mirrors scanner) ─────────────────────
function extractFromPayload(key, raw) {
  const fetcherName = String(key).replace(/^fetcher:/, '').replace(/:error$/, '');
  const isError = /:error$/.test(key);
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { fetcherName, isError, ok: false, parseError: true, timestamp: null, rows: [] }; }

  const ok = !!parsed.ok && !!parsed.data;     // scanner gate: needs ok && data
  const timestamp = parsed.timestamp || parsed.data?.timestamp || null;
  const prices = parsed.data?.data?.prices ?? parsed.data?.prices ?? [];
  const rows = [];
  if (Array.isArray(prices)) {
    for (const p of prices) {
      if (!p || !p.price || !isFinite(p.price) || p.price <= 0) continue;
      rows.push({
        pair       : normPair(p.pair),
        venue      : p.venue || 'unknown',
        price      : p.price,
        blockNumber: p.blockNumber ?? null,
      });
    }
  }
  return { fetcherName, isError, ok, parseError: false, timestamp, rows };
}

// ─── PURE: aggregate observed telemetry ──────────────────────────────────────
function aggregateObserved(extracted, nowMs) {
  const byPair = new Map();    // pair → { venues:Set, rows, freshestBlock, fetchers:Set, freshestTsMs }
  const fetchers = [];         // per-fetcher liveness summary

  for (const ex of extracted) {
    if (ex.isError) {
      fetchers.push({ fetcherName: ex.fetcherName, status: 'ERROR', ageSec: null, pairs: 0, venues: 0, rows: 0 });
      continue;
    }
    const tsMs = ex.timestamp ? Date.parse(ex.timestamp) : null;
    const ageSec = (tsMs && isFinite(tsMs)) ? Math.round((nowMs - tsMs) / 1000) : null;
    const pairsSeen = new Set();
    const venuesSeen = new Set();

    for (const r of ex.rows) {
      pairsSeen.add(r.pair);
      venuesSeen.add(r.venue);
      if (!byPair.has(r.pair)) {
        byPair.set(r.pair, { venues: new Set(), rows: 0, freshestBlock: null, fetchers: new Set(), freshestTsMs: null });
      }
      const e = byPair.get(r.pair);
      e.venues.add(r.venue);
      e.rows++;
      e.fetchers.add(ex.fetcherName);
      if (r.blockNumber != null && (e.freshestBlock == null || r.blockNumber > e.freshestBlock)) e.freshestBlock = r.blockNumber;
      if (tsMs && (e.freshestTsMs == null || tsMs > e.freshestTsMs)) e.freshestTsMs = tsMs;
    }

    fetchers.push({
      fetcherName: ex.fetcherName,
      status: !ex.ok ? 'NOT_OK' : (ageSec != null && ageSec > STALE_AGE_SEC ? 'STALE' : 'LIVE'),
      ageSec,
      pairs: pairsSeen.size,
      venues: venuesSeen.size,
      rows: ex.rows.length,
    });
  }
  return { byPair, fetchers };
}

// ─── PURE: classify one registry surface against observed telemetry ──────────
function classifySurface(cfg, byPair, nowMs) {
  const pair = surfaceExpectedPair(cfg);
  const declaredVenues = Array.isArray(cfg.venues) ? cfg.venues.map(v => v.name).filter(Boolean) : [];
  const hasBreakeven = typeof cfg.realisticBreakevenBps === 'number' && isFinite(cfg.realisticBreakevenBps);
  const obs = byPair.get(pair) || byPair.get(normPair(pair));

  const base = {
    surfaceId: cfg.surfaceId,
    displayName: cfg.displayName || cfg.surfaceId,
    pair,
    promotionStatus: cfg.promotionStatus || null,
    declaredVenues,
    hasBreakeven,
  };

  if (!obs) {
    const status = declaredVenues.length === 0 ? 'MISSING' : 'CONFIG_ONLY';
    return { ...base, status, scorerMode: 'PREVIEW', observedVenues: [], missingVenues: declaredVenues,
      ageSec: null, freshestBlock: null,
      reason: declaredVenues.length === 0 ? 'no telemetry + no venue geometry' : 'venues configured but not observed in Redis' };
  }

  const observedVenues = Array.from(obs.venues);
  const missingVenues  = declaredVenues.filter(v => !obs.venues.has(v));
  const ageSec = obs.freshestTsMs ? Math.round((nowMs - obs.freshestTsMs) / 1000) : null;
  const fresh  = ageSec == null ? true : ageSec <= STALE_AGE_SEC;
  const venuesComplete = declaredVenues.length > 0 ? missingVenues.length === 0 : observedVenues.length >= 2;

  let status, scorerMode, reason;
  if (venuesComplete && hasBreakeven && fresh) {
    status = 'FULL'; scorerMode = 'FULL'; reason = 'observed, venues complete, breakeven configured';
  } else if (observedVenues.length >= 1) {
    status = 'PARTIAL'; scorerMode = 'PREVIEW';
    const why = [];
    if (!venuesComplete) why.push(`missing venues: ${missingVenues.join(', ') || '<2 venues observed>'}`);
    if (!hasBreakeven)   why.push('no realisticBreakevenBps');
    if (!fresh)          why.push(`stale (${ageSec}s)`);
    reason = why.join('; ');
  } else {
    status = 'CONFIG_ONLY'; scorerMode = 'PREVIEW'; reason = 'venues configured but none observed';
  }

  return { ...base, status, scorerMode, observedVenues, missingVenues, ageSec, freshestBlock: obs.freshestBlock, reason };
}

// ─── PURE: observed-but-unregistered pairs (candidate discovery) ─────────────
function unregisteredPairs(byPair, surfaceConfigs) {
  const declared = new Set(surfaceConfigs.map(surfaceExpectedPair));
  const out = [];
  for (const [pair, e] of byPair) {
    if (!declared.has(pair)) {
      out.push({ pair, venues: Array.from(e.venues), rows: e.rows, venueCount: e.venues.size });
    }
  }
  out.sort((a, b) => b.venueCount - a.venueCount || a.pair.localeCompare(b.pair));
  return out;
}

// ─── LOADERS (fail-soft) ─────────────────────────────────────────────────────
function loadSurfaceConfigs() {
  let registry;
  try { registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); }
  catch (e) { return { configs: [], error: `cannot read registry.json: ${e.message}` }; }
  const configs = [];
  for (const entry of (registry.surfaces || [])) {
    const file = entry.file || `${entry.surfaceId}.json`;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(SURFACES_DIR, file), 'utf8'));
      cfg.surfaceId       = cfg.surfaceId || entry.surfaceId;
      cfg.promotionStatus = cfg.promotionStatus || entry.promotionStatus || null;
      configs.push(cfg);
    } catch { /* skip */ }
  }
  return { configs, error: null };
}

// ─── REDIS I/O (live; wrapped, fail-soft, no hang) ──────────────────────────
function scanKeys(redis, pattern) {
  return new Promise((resolve, reject) => {
    const found = [];
    const stream = redis.scanStream({ match: pattern, count: 200 });
    stream.on('data', keys => { for (const k of keys) found.push(k); });
    stream.on('end', () => resolve(found));
    stream.on('error', reject);
  });
}

async function loadLivePayloads() {
  let Redis;
  try { Redis = require('ioredis'); }
  catch { return { extracted: [], redisError: 'ioredis not installed' }; }

  const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    retryStrategy: () => null,   // do not loop forever
  });

  const withTimeout = (p, ms, label) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms)),
  ]);

  try {
    await withTimeout(redis.connect(), 3000, 'connect');
    const keys = await withTimeout(scanKeys(redis, 'fetcher:*'), 5000, 'scan');
    const extracted = [];
    for (const key of keys) {
      try {
        const raw = await withTimeout(redis.get(key), 3000, `get ${key}`);
        if (raw != null) extracted.push(extractFromPayload(key, raw));
      } catch { /* skip individual key errors */ }
    }
    return { extracted, redisError: null, keyCount: keys.length };
  } catch (e) {
    return { extracted: [], redisError: e.message };
  } finally {
    try { redis.disconnect(); } catch {}
  }
}

// ─── REPORT ──────────────────────────────────────────────────────────────────
function buildTextReport(out) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push('  AllMight — Surface Telemetry Audit (Boss Phase 2A)  READ-ONLY');
  L.push(`  generatedAt: ${out.meta.generatedAt}`);
  if (out.meta.redisError) {
    L.push(`  ⚠️  REDIS: ${out.meta.redisError}  (no live telemetry — fetcher likely not running)`);
  } else {
    L.push(`  redis: connected | fetcher keys: ${out.meta.keyCount} | observed pairs: ${out.observedPairCount}`);
  }
  L.push(bar);
  L.push('');

  L.push('  FETCHERS');
  if (!out.fetchers.length) L.push('    (none observed — fetcher not running or Redis empty)');
  for (const f of out.fetchers) {
    L.push(`    ${f.fetcherName.padEnd(24)} ${f.status.padEnd(7)} age:${f.ageSec == null ? 'n/a' : f.ageSec + 's'}  pairs:${f.pairs} venues:${f.venues} rows:${f.rows}`);
  }
  L.push('');

  L.push('  REGISTERED SURFACES');
  for (const s of out.surfaces) {
    L.push(`  ▸ ${s.displayName}  [${s.surfaceId}]   ${s.status}  → scorer ${s.scorerMode}`);
    L.push(`      pair: ${s.pair}   declaredVenues: ${s.declaredVenues.join(', ') || '(none)'}`);
    L.push(`      observedVenues: ${s.observedVenues.join(', ') || '(none)'}` +
           (s.missingVenues.length ? `   missing: ${s.missingVenues.join(', ')}` : '') +
           (s.ageSec != null ? `   age: ${s.ageSec}s` : ''));
    L.push(`      ${s.reason}`);
    L.push('');
  }

  L.push('  OBSERVED BUT UNREGISTERED (candidate discovery)');
  if (!out.unregistered.length) L.push('    (none)');
  for (const u of out.unregistered) {
    L.push(`    ${u.pair.padEnd(14)} venues:${u.venueCount} [${u.venues.join(', ')}]  rows:${u.rows}`);
  }
  L.push('');

  L.push(bar);
  L.push('  TELEMETRY GAP SUMMARY (Phase 2A work order)');
  const byStatus = {};
  for (const s of out.surfaces) (byStatus[s.status] = byStatus[s.status] || []).push(s.surfaceId);
  for (const st of ['FULL', 'PARTIAL', 'CONFIG_ONLY', 'MISSING']) {
    if (byStatus[st]) L.push(`    ${st}: ${byStatus[st].join(', ')}`);
  }
  L.push('');
  L.push('  NOTES');
  L.push('  - Audit only. No execution, no config writes, no promotion. (Boss Phase 2A)');
  L.push('  - Empty Redis → start the FETCHER (telemetry only) and re-run for live census.');
  L.push(bar);
  return L.join('\n');
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  const jsonMode = process.argv.includes('--json');
  const { configs, error } = loadSurfaceConfigs();
  if (error) { console.error(`[telemetry_audit] ${error}`); process.exit(1); }

  const { extracted, redisError, keyCount } = await loadLivePayloads();
  const nowMs = Date.now();
  const { byPair, fetchers } = aggregateObserved(extracted, nowMs);
  const surfaces = configs.map(cfg => classifySurface(cfg, byPair, nowMs));
  const unregistered = unregisteredPairs(byPair, configs);

  const out = {
    meta: { generatedAt: new Date().toISOString(), redisError: redisError || null, keyCount: keyCount || 0, staleAgeSec: STALE_AGE_SEC },
    observedPairCount: byPair.size,
    fetchers,
    surfaces,
    unregistered,
  };

  if (jsonMode) { console.log(JSON.stringify(out, null, 2)); return; }

  const txt = buildTextReport(out);
  console.log(txt);
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
    fs.writeFileSync(OUT_TXT, txt + '\n');
    console.log(`\n[telemetry_audit] wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_TXT)}`);
  } catch (e) {
    console.error(`[telemetry_audit] could not write artifacts: ${e.message}`);
  }
}

// ─── SELF-TEST (pure-logic, no Redis) ────────────────────────────────────────
function selfTest() {
  const nowMs = Date.now();
  const tsNow = new Date(nowMs).toISOString();
  const cases = [];

  // payload extraction (confirmed schema: data.data.prices)
  const rawArb = JSON.stringify({
    ok: true, timestamp: tsNow,
    data: { data: { prices: [
      { pair: 'ETH/USDC',  venue: 'uniswap_v3', price: 3000, blockNumber: 100, fee: 0.0001 },
      { pair: 'ETH/USDC',  venue: 'ramses_v2',  price: 3001, blockNumber: 100, fee: 0.0005 },
      { pair: 'USDC/USDT', venue: 'uniswap_v3', price: 1.0001, blockNumber: 100 },
      { pair: 'USDC/USDT', venue: 'ramses_v2',  price: 1.0000, blockNumber: 100 },
      { pair: 'WETH/USDC', venue: 'camelot_v3', price: 2999, blockNumber: 100 }, // WETH→ETH normalize
    ] } },
  });
  const exArb = extractFromPayload('fetcher:arbitrumFetcher', rawArb);
  cases.push(['extract: fetcherName', exArb.fetcherName === 'arbitrumFetcher']);
  cases.push(['extract: ok true', exArb.ok === true]);
  cases.push(['extract: 5 rows', exArb.rows.length === 5]);
  cases.push(['extract: WETH→ETH normalized', exArb.rows[4].pair === 'ETH/USDC']);

  // alternate schema path (data.prices)
  const rawAlt = JSON.stringify({ ok: true, timestamp: tsNow, data: { prices: [{ pair: 'DAI/USDC', venue: 'curve', price: 1.0 }] } });
  const exAlt = extractFromPayload('fetcher:curveFetcherArbitrum', rawAlt);
  cases.push(['extract: alt schema data.prices', exAlt.rows.length === 1 && exAlt.rows[0].pair === 'DAI/USDC']);

  // not-ok payload
  const exBad = extractFromPayload('fetcher:x', JSON.stringify({ ok: false, data: null }));
  cases.push(['extract: ok=false → ok false', exBad.ok === false]);
  const exParse = extractFromPayload('fetcher:y', '{bad json');
  cases.push(['extract: parse error handled', exParse.parseError === true && exParse.rows.length === 0]);

  // aggregate (note: WETH/USDC row normalizes into ETH/USDC → 3 venues there)
  const { byPair, fetchers } = aggregateObserved([exArb, exAlt], nowMs);
  cases.push(['aggregate: ETH/USDC has 3 venues (WETH merged)', byPair.get('ETH/USDC').venues.size === 3]);
  cases.push(['aggregate: USDC/USDT present', byPair.has('USDC/USDT')]);
  cases.push(['aggregate: DAI/USDC present (alt schema)', byPair.has('DAI/USDC')]);
  cases.push(['aggregate: fetcher LIVE', fetchers.find(f => f.fetcherName === 'arbitrumFetcher').status === 'LIVE']);

  // classify — FULL surface (observed, declared venues complete, breakeven)
  const ethCfg = { surfaceId: 'eth_usdc_ramses', displayName: 'ETH/USDC — Ramses V2',
    base: 'WETH', quote: 'USDC', realisticBreakevenBps: 17.4,
    venues: [{ name: 'uniswap_v3' }, { name: 'ramses_v2' }] };
  const cEth = classifySurface(ethCfg, byPair, nowMs);
  cases.push(['classify ETH/USDC: FULL', cEth.status === 'FULL']);
  cases.push(['classify ETH/USDC: scorer FULL', cEth.scorerMode === 'FULL']);
  cases.push(['classify ETH/USDC: 3 observed venues', cEth.observedVenues.length === 3]);
  cases.push(['classify ETH/USDC: no missing declared venues', cEth.missingVenues.length === 0]);

  // classify — CONFIG_ONLY (declared venues, not observed at all)
  const arbCfg = { surfaceId: 'arb_usdc_candidate', displayName: 'ARB/USDC', base: 'ARB', quote: 'USDC',
    venues: [{ name: 'uniswap_v3' }, { name: 'ramses_v2' }] };
  const cArb = classifySurface(arbCfg, byPair, nowMs);
  cases.push(['classify ARB/USDC: CONFIG_ONLY', cArb.status === 'CONFIG_ONLY']);
  cases.push(['classify ARB/USDC: scorer PREVIEW', cArb.scorerMode === 'PREVIEW']);

  // classify — MISSING (no venues AND not observed)
  const fraxCfg = { surfaceId: 'frax_usdc_candidate', displayName: 'FRAX/USDC', base: 'FRAX', quote: 'USDC', venues: [] };
  const cFrax = classifySurface(fraxCfg, byPair, nowMs);
  cases.push(['classify FRAX/USDC: MISSING (no venues, not observed)', cFrax.status === 'MISSING']);

  // classify — PARTIAL (observed but no breakeven, declared venues empty)
  const daiCfg = { surfaceId: 'dai_usdc_candidate', displayName: 'DAI/USDC', base: 'DAI', quote: 'USDC', venues: [] };
  const cDai = classifySurface(daiCfg, byPair, nowMs);
  cases.push(['classify DAI/USDC: PARTIAL (observed, no breakeven)', cDai.status === 'PARTIAL']);

  // classify — PARTIAL (observed but no breakeven)
  const usdtCfg = { surfaceId: 'usdc_usdt', displayName: 'USDC/USDT', base: 'USDC', quote: 'USDT',
    venues: [{ name: 'uniswap_v3' }, { name: 'ramses_v2' }] };  // observed both, but no breakeven
  const cUsdt = classifySurface(usdtCfg, byPair, nowMs);
  cases.push(['classify USDC/USDT: PARTIAL (no breakeven)', cUsdt.status === 'PARTIAL']);

  // unregistered discovery — USDC/USDT observed but not in (eth-only) registry
  const unreg = unregisteredPairs(byPair, [ethCfg]);
  cases.push(['unregistered: USDC/USDT discovered', unreg.some(u => u.pair === 'USDC/USDT')]);
  cases.push(['unregistered: ETH/USDC NOT listed (registered)', !unreg.some(u => u.pair === 'ETH/USDC')]);

  // stale detection
  const oldTs = new Date(nowMs - (STALE_AGE_SEC + 60) * 1000).toISOString();
  const exOld = extractFromPayload('fetcher:z', JSON.stringify({ ok: true, timestamp: oldTs, data: { data: { prices: [{ pair: 'ETH/USDC', venue: 'a', price: 1 }] } } }));
  const aggOld = aggregateObserved([exOld], nowMs);
  cases.push(['stale: old payload → STALE', aggOld.fetchers[0].status === 'STALE']);

  let pass = 0;
  console.log('── surface_telemetry_audit.js SELF-TEST (pure logic, no Redis) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

// ─── ENTRY ───────────────────────────────────────────────────────────────────
if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  main();
}
