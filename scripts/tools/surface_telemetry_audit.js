#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Telemetry Audit  v1.1 (chain-aware)
//  PLACEMENT: scripts/tools/surface_telemetry_audit.js
//  STATUS:    Boss Phase 2A — READ-ONLY telemetry census
//
//  v1.1 (Boss Ruling B / Option 3): aggregate by (chain, pair), NOT pair alone.
//  Prevents cross-chain conflation (arbitrum:ETH/USDC vs base:ETH/USDC vs
//  optimism:ETH/USDC are distinct surfaces). Rows carry `chain` directly.
//  Displays chainScopedId (economic identity) when present in config.
//
//  DESIGN RULES (Boss Phase 2A)
//  - READ-ONLY. No execution, no arming, no contracts, no config writes, no promotion.
//  - Mirrors master-fetcher payload schema:
//      fetcher:{name} → { ok, name, timestamp, data: { data: { prices: [...] } } }
//      price row → { pair, venue, chain, price, blockNumber, ... }
//  - observed venues = telemetry; declared venue family = strategy identity (separate).
//
//  USAGE
//    node scripts/tools/surface_telemetry_audit.js            # live census → print + write
//    node scripts/tools/surface_telemetry_audit.js --json     # JSON to stdout
//    node scripts/tools/surface_telemetry_audit.js --self-test # logic check (no Redis)
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

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

const REDIS_URL     = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const STALE_AGE_SEC = Number(process.env.TELEMETRY_STALE_SEC || 120);

// ─── NORMALIZATION ────────────────────────────────────────────────────────────
function normToken(t) { const u = String(t || '').toUpperCase(); return u === 'WETH' ? 'ETH' : u; }
function normPair(pair) { return String(pair || '').toUpperCase().replace(/\bWETH\b/g, 'ETH'); }
function normChain(c) { return String(c || 'unknown').toLowerCase(); }
function surfaceExpectedPair(cfg) { return `${normToken(cfg.base)}/${normToken(cfg.quote)}`; }
function chainPairKey(chain, pair) { return `${normChain(chain)}:${normPair(pair)}`; }

// ─── PURE: extract one fetcher payload (mirrors scanner; now captures chain) ───
function extractFromPayload(key, raw) {
  const fetcherName = String(key).replace(/^fetcher:/, '').replace(/:error$/, '');
  const isError = /:error$/.test(key);
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return { fetcherName, isError, ok: false, parseError: true, timestamp: null, rows: [] }; }

  const ok = !!parsed.ok && !!parsed.data;
  const timestamp = parsed.timestamp || parsed.data?.timestamp || null;
  const prices = parsed.data?.data?.prices ?? parsed.data?.prices ?? [];
  const rows = [];
  if (Array.isArray(prices)) {
    for (const p of prices) {
      if (!p || !p.price || !isFinite(p.price) || p.price <= 0) continue;
      rows.push({
        pair       : normPair(p.pair),
        venue      : p.venue || 'unknown',
        chain      : normChain(p.chain),
        price      : p.price,
        blockNumber: p.blockNumber ?? null,
      });
    }
  }
  return { fetcherName, isError, ok, parseError: false, timestamp, rows };
}

// ─── PURE: aggregate observed telemetry by (chain, pair) ──────────────────────
function aggregateObserved(extracted, nowMs) {
  const byChainPair = new Map();  // "chain:pair" → {chain, pair, venues, rows, freshestBlock, fetchers, freshestTsMs}
  const fetchers = [];

  for (const ex of extracted) {
    if (ex.isError) {
      fetchers.push({ fetcherName: ex.fetcherName, status: 'ERROR', ageSec: null, chainPairs: 0, venues: 0, rows: 0, chainsMissing: 0 });
      continue;
    }
    const tsMs = ex.timestamp ? Date.parse(ex.timestamp) : null;
    const ageSec = (tsMs && isFinite(tsMs)) ? Math.round((nowMs - tsMs) / 1000) : null;
    const cpSeen = new Set();
    const venuesSeen = new Set();
    let chainsMissing = 0;

    for (const r of ex.rows) {
      if (r.chain === 'unknown') chainsMissing++;
      const key = chainPairKey(r.chain, r.pair);
      cpSeen.add(key);
      venuesSeen.add(r.venue);
      if (!byChainPair.has(key)) {
        byChainPair.set(key, { chain: normChain(r.chain), pair: r.pair, venues: new Set(), rows: 0, freshestBlock: null, fetchers: new Set(), freshestTsMs: null });
      }
      const e = byChainPair.get(key);
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
      chainPairs: cpSeen.size,
      venues: venuesSeen.size,
      rows: ex.rows.length,
      chainsMissing,
    });
  }
  return { byChainPair, fetchers };
}

// ─── PURE: classify one registry surface against observed (chain, pair) ───────
function classifySurface(cfg, byChainPair, nowMs) {
  const pair  = surfaceExpectedPair(cfg);
  const chain = normChain(cfg.chain);
  const key   = chainPairKey(chain, pair);
  const declaredVenues = Array.isArray(cfg.venues) ? cfg.venues.map(v => v.name).filter(Boolean) : [];
  const hasBreakeven = typeof cfg.realisticBreakevenBps === 'number' && isFinite(cfg.realisticBreakevenBps);
  const obs = byChainPair.get(key);

  const base = {
    surfaceId      : cfg.surfaceId,
    chainScopedId  : cfg.chainScopedId || null,   // Boss Ruling 1: economic identity
    displayName    : cfg.displayName || cfg.surfaceId,
    chain,
    pair,
    chainPair      : key,
    promotionStatus: cfg.promotionStatus || null,
    declaredVenues,
    hasBreakeven,
  };

  if (!obs) {
    const status = declaredVenues.length === 0 ? 'MISSING' : 'CONFIG_ONLY';
    return { ...base, status, scorerMode: 'PREVIEW', observedVenues: [], missingVenues: declaredVenues,
      ageSec: null, freshestBlock: null,
      reason: declaredVenues.length === 0 ? 'no telemetry + no venue geometry' : `venues configured but ${key} not observed` };
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

// ─── PURE: observed-but-unregistered (chain, pair) — candidate discovery ──────
function unregisteredChainPairs(byChainPair, configs) {
  const declared = new Set(configs.map(c => chainPairKey(c.chain, surfaceExpectedPair(c))));
  const out = [];
  for (const [key, e] of byChainPair) {
    if (!declared.has(key)) {
      out.push({ chainPair: key, chain: e.chain, pair: e.pair, venues: Array.from(e.venues), rows: e.rows, venueCount: e.venues.size });
    }
  }
  out.sort((a, b) => b.venueCount - a.venueCount || a.chainPair.localeCompare(b.chainPair));
  return out;
}

// ─── LOADERS ─────────────────────────────────────────────────────────────────
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
  try { Redis = require('ioredis'); } catch { return { extracted: [], redisError: 'ioredis not installed' }; }
  const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, retryStrategy: () => null });
  const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);
  try {
    await withTimeout(redis.connect(), 3000, 'connect');
    const keys = await withTimeout(scanKeys(redis, 'fetcher:*'), 5000, 'scan');
    const extracted = [];
    for (const key of keys) {
      try { const raw = await withTimeout(redis.get(key), 3000, `get ${key}`); if (raw != null) extracted.push(extractFromPayload(key, raw)); }
      catch { /* skip */ }
    }
    return { extracted, redisError: null, keyCount: keys.length };
  } catch (e) { return { extracted: [], redisError: e.message }; }
  finally { try { redis.disconnect(); } catch {} }
}

// ─── REPORT ──────────────────────────────────────────────────────────────────
function buildTextReport(out) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push('  AllMight — Surface Telemetry Audit v1.1 (chain-aware)  READ-ONLY');
  L.push(`  generatedAt: ${out.meta.generatedAt}`);
  if (out.meta.redisError) L.push(`  ⚠️  REDIS: ${out.meta.redisError}  (no live telemetry — fetcher likely not running)`);
  else L.push(`  redis: connected | fetcher keys: ${out.meta.keyCount} | observed chain:pairs: ${out.observedChainPairCount}`);
  L.push(bar);
  L.push('');

  L.push('  FETCHERS');
  if (!out.fetchers.length) L.push('    (none observed — fetcher not running or Redis empty)');
  for (const f of out.fetchers) {
    L.push(`    ${f.fetcherName.padEnd(24)} ${f.status.padEnd(7)} age:${f.ageSec == null ? 'n/a' : f.ageSec + 's'}  chain:pairs:${f.chainPairs} venues:${f.venues} rows:${f.rows}` + (f.chainsMissing ? `  ⚠️chain-missing:${f.chainsMissing}` : ''));
  }
  L.push('');

  L.push('  REGISTERED SURFACES (matched by chain + pair)');
  for (const s of out.surfaces) {
    const idLine = s.chainScopedId ? `${s.chainScopedId}` : `${s.chainPair} (no chainScopedId yet)`;
    L.push(`  ▸ ${s.displayName}  [${s.surfaceId}]   ${s.status}  → scorer ${s.scorerMode}`);
    L.push(`      economic id: ${idLine}`);
    L.push(`      declaredVenues: ${s.declaredVenues.join(', ') || '(none)'}`);
    L.push(`      observedVenues: ${s.observedVenues.join(', ') || '(none)'}` +
           (s.missingVenues.length ? `   missing: ${s.missingVenues.join(', ')}` : '') +
           (s.ageSec != null ? `   age: ${s.ageSec}s` : ''));
    L.push(`      ${s.reason}`);
    L.push('');
  }

  L.push('  OBSERVED BUT UNREGISTERED — by chain:pair (candidate discovery)');
  if (!out.unregistered.length) L.push('    (none)');
  for (const u of out.unregistered) {
    L.push(`    ${u.chainPair.padEnd(22)} venues:${u.venueCount} [${u.venues.join(', ')}]  rows:${u.rows}`);
  }
  L.push('');

  L.push(bar);
  L.push('  TELEMETRY GAP SUMMARY (Phase 2A work order)');
  const byStatus = {};
  for (const s of out.surfaces) (byStatus[s.status] = byStatus[s.status] || []).push(s.chainScopedId || s.chainPair);
  for (const st of ['FULL', 'PARTIAL', 'CONFIG_ONLY', 'MISSING']) if (byStatus[st]) L.push(`    ${st}: ${byStatus[st].join(', ')}`);
  L.push('');
  L.push('  NOTES');
  L.push('  - Aggregation is CHAIN-SCOPED (chain:pair). Cross-chain pairs are distinct surfaces.');
  L.push('  - Pre-chainScopedId historical reports may have pair-level aggregation artifacts.');
  L.push('  - Audit only. No execution, no config writes, no promotion. (Boss Phase 2A)');
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
  const { byChainPair, fetchers } = aggregateObserved(extracted, nowMs);
  const surfaces = configs.map(cfg => classifySurface(cfg, byChainPair, nowMs));
  const unregistered = unregisteredChainPairs(byChainPair, configs);

  const out = {
    meta: { generatedAt: new Date().toISOString(), redisError: redisError || null, keyCount: keyCount || 0, staleAgeSec: STALE_AGE_SEC, chainAware: true },
    observedChainPairCount: byChainPair.size,
    fetchers, surfaces, unregistered,
  };

  if (jsonMode) { console.log(JSON.stringify(out, null, 2)); return; }
  const txt = buildTextReport(out);
  console.log(txt);
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
    fs.writeFileSync(OUT_TXT, txt + '\n');
    console.log(`\n[telemetry_audit] wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_TXT)}`);
  } catch (e) { console.error(`[telemetry_audit] could not write artifacts: ${e.message}`); }
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────
function selfTest() {
  const nowMs = Date.now();
  const tsNow = new Date(nowMs).toISOString();
  const cases = [];

  const rawArb = JSON.stringify({ ok: true, name: 'arbitrumFetcher', timestamp: tsNow,
    data: { data: { prices: [
      { pair: 'ETH/USDC',  venue: 'uniswap_v3', chain: 'arbitrum', price: 3000, blockNumber: 100 },
      { pair: 'ETH/USDC',  venue: 'ramses_v2',  chain: 'arbitrum', price: 3001, blockNumber: 100 },
      { pair: 'USDC/USDT', venue: 'uniswap_v3', chain: 'arbitrum', price: 1.0001, blockNumber: 100 },
      { pair: 'USDC/USDT', venue: 'curve',      chain: 'arbitrum', price: 1.0000, blockNumber: 100 },
    ] } } });
  const rawBase = JSON.stringify({ ok: true, name: 'baseFetcher', timestamp: tsNow,
    data: { data: { prices: [
      { pair: 'WETH/USDC', venue: 'aerodrome', chain: 'base', price: 2999, blockNumber: 500 }, // WETH→ETH; base chain
      { pair: 'WETH/USDC', venue: 'uniswap_v3', chain: 'base', price: 2998, blockNumber: 500 },
    ] } } });

  const exArb = extractFromPayload('fetcher:arbitrumFetcher', rawArb);
  const exBase = extractFromPayload('fetcher:baseFetcher', rawBase);
  cases.push(['extract: row carries chain', exArb.rows[0].chain === 'arbitrum']);
  cases.push(['extract: base WETH→ETH + chain base', exBase.rows[0].pair === 'ETH/USDC' && exBase.rows[0].chain === 'base']);

  const { byChainPair, fetchers } = aggregateObserved([exArb, exBase], nowMs);
  cases.push(['aggregate: arbitrum:ETH/USDC key exists', byChainPair.has('arbitrum:ETH/USDC')]);
  cases.push(['aggregate: base:ETH/USDC key exists', byChainPair.has('base:ETH/USDC')]);
  cases.push(['aggregate: arbitrum ≠ base (distinct keys)', byChainPair.get('arbitrum:ETH/USDC') !== byChainPair.get('base:ETH/USDC')]);
  cases.push(['aggregate: arbitrum:ETH/USDC has 2 venues', byChainPair.get('arbitrum:ETH/USDC').venues.size === 2]);
  cases.push(['aggregate: base:ETH/USDC has aerodrome', byChainPair.get('base:ETH/USDC').venues.has('aerodrome')]);
  cases.push(['aggregate: base venues NOT in arbitrum set', !byChainPair.get('arbitrum:ETH/USDC').venues.has('aerodrome')]);
  cases.push(['aggregate: arbitrum:USDC/USDT present', byChainPair.has('arbitrum:USDC/USDT')]);

  // FULL: arbitrum ETH/USDC surface matches ONLY arbitrum rows
  const ethCfg = { surfaceId: 'eth_usdc_ramses', chainScopedId: 'arbitrum:ETH/USDC:ramses_uni',
    displayName: 'ETH/USDC — Ramses V2', base: 'WETH', quote: 'USDC', chain: 'arbitrum',
    realisticBreakevenBps: 17.4, venues: [{ name: 'uniswap_v3' }, { name: 'ramses_v2' }] };
  const cEth = classifySurface(ethCfg, byChainPair, nowMs);
  cases.push(['classify arbitrum ETH/USDC: FULL', cEth.status === 'FULL']);
  cases.push(['classify: matched chainPair arbitrum:ETH/USDC', cEth.chainPair === 'arbitrum:ETH/USDC']);
  cases.push(['classify: exposes chainScopedId', cEth.chainScopedId === 'arbitrum:ETH/USDC:ramses_uni']);
  cases.push(['classify: only arbitrum venues (no aerodrome leak)', !cEth.observedVenues.includes('aerodrome')]);

  // a base ETH/USDC surface would match base rows only
  const baseCfg = { surfaceId: 'base_eth_usdc', chainScopedId: 'base:ETH/USDC:aerodrome_uni',
    displayName: 'ETH/USDC — Base', base: 'WETH', quote: 'USDC', chain: 'base',
    realisticBreakevenBps: 10, venues: [{ name: 'aerodrome' }, { name: 'uniswap_v3' }] };
  const cBase = classifySurface(baseCfg, byChainPair, nowMs);
  cases.push(['classify base ETH/USDC: FULL (distinct from arbitrum)', cBase.status === 'FULL' && cBase.chainPair === 'base:ETH/USDC']);

  // CONFIG_ONLY: arbitrum DAI/USDC declared but not observed
  const daiCfg = { surfaceId: 'dai_usdc_candidate', displayName: 'DAI/USDC', base: 'DAI', quote: 'USDC',
    chain: 'arbitrum', venues: [{ name: 'curve' }, { name: 'uniswap_v3' }] };
  cases.push(['classify arbitrum DAI/USDC: CONFIG_ONLY (not observed)', classifySurface(daiCfg, byChainPair, nowMs).status === 'CONFIG_ONLY']);

  // unregistered uses chain:pair; arbitrum:USDC/USDT discovered when only ETH registered
  const unreg = unregisteredChainPairs(byChainPair, [ethCfg]);
  cases.push(['unregistered: arbitrum:USDC/USDT discovered', unreg.some(u => u.chainPair === 'arbitrum:USDC/USDT')]);
  cases.push(['unregistered: base:ETH/USDC discovered (registered=arbitrum only)', unreg.some(u => u.chainPair === 'base:ETH/USDC')]);
  cases.push(['unregistered: arbitrum:ETH/USDC NOT listed (registered)', !unreg.some(u => u.chainPair === 'arbitrum:ETH/USDC')]);

  // fetcher liveness still works
  cases.push(['fetcher: arbitrumFetcher LIVE', fetchers.find(f => f.fetcherName === 'arbitrumFetcher').status === 'LIVE']);

  let pass = 0;
  console.log('── surface_telemetry_audit.js v1.1 SELF-TEST (chain-aware) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
