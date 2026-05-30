#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Behavioral Collector  (generalized, Wave 1)
//  PLACEMENT: scripts/research/surface_behavioral_collector.js
//  REPLACES:  scripts/research/dai_usdc_arb_collector.js (hardcoded predecessor)
//  STATUS:    Boss Wave 1 (post-2B.1) — "one research pipeline for every candidate"
//
//  READ-ONLY observational acquisition for ANY chain-scoped surface in
//  surfaces/registry.json that declares exactly 2 venues with pool addresses.
//  Same-block anchored. Multi-fetcher aware. Constitutional separation
//  between acquisition and interpretation preserved (no thresholds here).
//
//  USAGE
//    node scripts/research/surface_behavioral_collector.js --surface <surfaceId>
//    node scripts/research/surface_behavioral_collector.js --surface eth_usdc_ramses --interval 3000
//    node scripts/research/surface_behavioral_collector.js --surface eth_usdc_ramses --duration-min 240
//    node scripts/research/surface_behavioral_collector.js --surface eth_usdc_ramses --max-samples 5
//    node scripts/research/surface_behavioral_collector.js --self-test
//
//  OUTPUT
//    logs/research/<surfaceId>/spread_observations.jsonl   (raw, append, gitignored)
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACES_DIR = path.join(REPO, 'surfaces');
const REGISTRY_FILE = path.join(SURFACES_DIR, 'registry.json');

const REDIS_URL    = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const READ_TIMEOUT_MS = 5000;

// chain → ordered list of fetcher keys to read for venue data on that chain
// (arbitrum is single-fetcher; ethereum spans 3 because of how master-fetcher
//  is partitioned. baseFetcher, optimismFetcher etc. follow the same pattern.)
const CHAIN_FETCHER_KEYS = {
  arbitrum: ['fetcher:arbitrumFetcher'],
  ethereum: ['fetcher:ethereumFetcher', 'fetcher:uniswapV3Fetcher', 'fetcher:curveFetcherEthereum'],
  base:     ['fetcher:baseFetcher'],
  optimism: ['fetcher:optimismFetcher'],
  unichain: ['fetcher:unichainFetcher'],
};

// ─── tiny local helpers (no coupling to execution modules) ──────────────────
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ─── PURE FUNCTIONS (no I/O — testable) ─────────────────────────────────────

function computeSpreadBps(pA, pB) {
  if (!isFinite(pA) || !isFinite(pB) || pA <= 0 || pB <= 0) return null;
  const mid = (pA + pB) / 2;
  if (mid <= 0) return null;
  return +(Math.abs(pA - pB) / mid * 10000).toFixed(6);
}

function isSameBlock(blockA, blockB) {
  return blockA != null && blockB != null && blockA === blockB;
}

function fetcherKeysForChain(chain) {
  const keys = CHAIN_FETCHER_KEYS[chain];
  if (!keys) throw new Error(`no fetcher map for chain "${chain}" (add to CHAIN_FETCHER_KEYS)`);
  return keys;
}

// merge prices arrays from multiple fetcher payloads, filtering to the target chain
function mergePrices(payloads, targetChain) {
  const all = [];
  for (const p of payloads) {
    if (!p) continue;
    const prices = p.data?.data?.prices ?? p.data?.prices ?? [];
    for (const row of prices) {
      if (row && row.chain === targetChain) all.push(row);
    }
  }
  return all;
}

function findRowByPool(prices, pool) {
  const want = String(pool).toLowerCase();
  return prices.find(p => p && p.pool && String(p.pool).toLowerCase() === want) || null;
}

function blockPairKey(rowA, rowB) {
  return `${rowA?.blockNumber ?? 'null'}:${rowB?.blockNumber ?? 'null'}`;
}

// build raw observation — NO interpretation fields, ever
function buildObservation(now, payloadTsMax, csid, rowA, rowB) {
  const sameBlock = isSameBlock(rowA.blockNumber, rowB.blockNumber);
  const spreadBps = sameBlock ? computeSpreadBps(rowA.price, rowB.price) : null;
  const midPrice  = sameBlock ? +(((rowA.price + rowB.price) / 2)).toFixed(10) : null;
  return {
    ts: now,
    payloadTs: payloadTsMax,
    chainScopedId: csid,
    venueA: rowA.venue, poolA: rowA.pool, priceA: rowA.price, blockA: rowA.blockNumber ?? null,
    venueB: rowB.venue, poolB: rowB.pool, priceB: rowB.price, blockB: rowB.blockNumber ?? null,
    sameBlock,
    midPrice,
    spreadBps,
  };
}

// ─── config ──────────────────────────────────────────────────────────────────

function loadSurfaceConfig(surfaceId) {
  // try direct: surfaces/<surfaceId>.json (matches registry "file" convention)
  const direct = path.join(SURFACES_DIR, `${surfaceId}.json`);
  if (fs.existsSync(direct)) return JSON.parse(fs.readFileSync(direct, 'utf8'));
  // fallback: look up in registry.json by surfaceId
  if (fs.existsSync(REGISTRY_FILE)) {
    const reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    const entry = (reg.surfaces || []).find(e => e.surfaceId === surfaceId);
    if (entry && entry.file) {
      const p = path.join(SURFACES_DIR, entry.file);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  }
  throw new Error(`surface not found: ${surfaceId}`);
}

function validateSurface(surface) {
  if (!surface.chainScopedId) throw new Error('surface missing chainScopedId (required for behavioral research)');
  if (!surface.chain) throw new Error('surface missing chain');
  if (!Array.isArray(surface.venues) || surface.venues.length !== 2)
    throw new Error(`expected exactly 2 declared venues (got ${surface.venues?.length || 0}); ` +
                    `pairwise N-venue analysis not in scope for v1`);
  for (const v of surface.venues) if (!v.pool) throw new Error(`venue ${v.name || '?'} missing pool address`);
}

// ─── runtime ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const a = { surface: null, intervalMs: 3000, durationMin: null, maxSamples: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--surface')         a.surface     = argv[++i];
    else if (argv[i] === '--interval')   a.intervalMs  = parseInt(argv[++i], 10) || 3000;
    else if (argv[i] === '--duration-min') a.durationMin = parseFloat(argv[++i]) || null;
    else if (argv[i] === '--max-samples')  a.maxSamples  = parseInt(argv[++i], 10) || null;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.surface) { console.error('[collector] --surface <surfaceId> required'); process.exit(1); }

  let surface;
  try { surface = loadSurfaceConfig(args.surface); validateSurface(surface); }
  catch (e) { console.error(`[collector] config error: ${e.message}`); process.exit(1); }

  const fetcherKeys = fetcherKeysForChain(surface.chain);
  const [vA, vB] = surface.venues;
  const outDir   = path.join(REPO, 'logs', 'research', args.surface);
  const outJsonl = path.join(outDir, 'spread_observations.jsonl');

  const Redis = require('ioredis');
  const redis = new Redis(REDIS_URL, { lazyConnect: false, enableReadyCheck: true });
  redis.on('error', (e) => console.error(`[collector] redis error: ${e.message}`));

  fs.mkdirSync(outDir, { recursive: true });
  const sink = fs.createWriteStream(outJsonl, { flags: 'a' });

  let recorded = 0, misses = 0, dupes = 0, crossBlock = 0;
  let lastBlockKey = null;
  const startedAt = Date.now();
  const deadline = args.durationMin ? startedAt + args.durationMin * 60000 : null;

  console.error(`[collector] Surface Behavioral Collector (generalized) — READ-ONLY`);
  console.error(`[collector] ${surface.chainScopedId}  (${args.surface})`);
  console.error(`[collector] ${vA.name}(${vA.pool.slice(0,10)}) vs ${vB.name}(${vB.pool.slice(0,10)})`);
  console.error(`[collector] fetcher keys: ${fetcherKeys.join(', ')}`);
  console.error(`[collector] interval=${args.intervalMs}ms duration=${args.durationMin||'∞'}min maxSamples=${args.maxSamples||'∞'} → ${path.relative(REPO, outJsonl)}`);

  let stopping = false;
  const stop = (sig) => {
    if (stopping) return; stopping = true;
    console.error(`\n[collector] ${sig} — recorded=${recorded} misses=${misses} dupes=${dupes} crossBlock=${crossBlock}`);
    sink.end(() => { redis.quit().finally(() => process.exit(0)); });
  };
  process.on('SIGINT',  () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  async function tick() {
    if (stopping) return;
    if (deadline && Date.now() >= deadline) return stop('duration-reached');
    try {
      // read ALL relevant fetcher keys for this chain (multi-fetcher support)
      const raws = await Promise.all(fetcherKeys.map(k =>
        withTimeout(redis.get(k), READ_TIMEOUT_MS, `redis.get ${k}`).catch(() => null)
      ));
      const payloads = raws.map(r => { try { return r ? JSON.parse(r) : null; } catch { return null; } });
      if (payloads.every(p => p == null)) {
        misses++;
        if (misses === 1 || misses % 10 === 0) console.error(`[collector] miss #${misses} — no fetcher keys present in Redis (is master-fetcher running?)`);
        return;
      }
      const prices = mergePrices(payloads, surface.chain);
      const rowA = findRowByPool(prices, vA.pool);
      const rowB = findRowByPool(prices, vB.pool);
      if (!rowA || !rowB) {
        misses++;
        if (misses === 1 || misses % 10 === 0) console.error(`[collector] miss #${misses} — venue rows not found (rowA=${!!rowA} rowB=${!!rowB}, ${prices.length} chain rows merged)`);
        return;
      }
      const key = blockPairKey(rowA, rowB);
      if (key === lastBlockKey) {
        dupes++;
        if (dupes === 1 || dupes % 50 === 0) console.error(`[collector] dupe #${dupes} — same block pair (${key})`);
        return;
      }
      // use max(payloadTs) across read fetchers for traceability
      const payloadTsMax = payloads.reduce((mx, p) => {
        const t = p?.timestamp ?? p?.data?.timestamp ?? null;
        return (t && (!mx || t > mx)) ? t : mx;
      }, null);
      const obs = buildObservation(new Date().toISOString(), payloadTsMax, surface.chainScopedId, rowA, rowB);
      sink.write(JSON.stringify(obs) + '\n');
      lastBlockKey = key;
      recorded++;
      if (!obs.sameBlock) crossBlock++;
      const spreadStr = obs.spreadBps == null ? 'x-block' : obs.spreadBps + 'bp';
      console.error(`[collector] recorded #${recorded} | blockA=${obs.blockA} blockB=${obs.blockB} sameBlock=${obs.sameBlock} spread=${spreadStr}`);
      if (recorded % 50 === 0) {
        console.error(`[collector] HEARTBEAT recorded=${recorded} crossBlock=${crossBlock} misses=${misses} dupes=${dupes}`);
      }
      if (args.maxSamples && recorded >= args.maxSamples) return stop('max-samples');
    } catch (e) {
      console.error(`[collector] tick error: ${e.message}`);
    }
  }

  try { await withTimeout(redis.get(fetcherKeys[0]), READ_TIMEOUT_MS, 'redis.probe'); console.error('[collector] redis connected.'); }
  catch (e) { console.error(`[collector] CANNOT REACH REDIS at ${REDIS_URL}: ${e.message}`); process.exit(1); }

  const timer = setInterval(tick, args.intervalMs);
  tick();
  process.on('exit', () => clearInterval(timer));
}

// ─── SELF-TEST (pure functions; no Redis, no fs) ─────────────────────────────
function selfTest() {
  const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  const cases = [];

  // spread math (preserved from predecessor)
  cases.push(['spread(1.00005,1.00015) ≈ 1.0bp', approx(computeSpreadBps(1.00005, 1.00015), 1.0)]);
  cases.push(['spread(1.0,1.0) = 0',              computeSpreadBps(1.0, 1.0) === 0]);
  cases.push(['spread invalid input → null',      computeSpreadBps(0, 1) === null]);

  // same-block (preserved)
  cases.push(['sameBlock equal → true',  isSameBlock(100, 100) === true]);
  cases.push(['sameBlock differ → false', isSameBlock(100, 101) === false]);
  cases.push(['sameBlock null → false',  isSameBlock(null, 100) === false]);

  // chain → fetcher resolution (NEW)
  cases.push(['arbitrum → 1 fetcher key',  fetcherKeysForChain('arbitrum').length === 1]);
  cases.push(['ethereum → 3 fetcher keys', fetcherKeysForChain('ethereum').length === 3]);
  cases.push(['unknown chain throws',      (() => { try { fetcherKeysForChain('zzz'); return false; } catch { return true; } })()]);

  // multi-fetcher merge (NEW)
  const ethPayloads = [
    { data: { data: { prices: [
      { pool: '0x5777', venue: 'uniswap_v3', chain: 'ethereum', price: 1.0001, blockNumber: 100 },
      { pool: '0xabcd', venue: 'uniswap_v3', chain: 'arbitrum', price: 2.0,    blockNumber: 200 },  // wrong chain
    ]}}},
    { data: { data: { prices: [
      { pool: '0xbEbc', venue: 'curve',      chain: 'ethereum', price: 1.0002, blockNumber: 100 },
    ]}}},
    null,  // a fetcher key with no data
  ];
  const merged = mergePrices(ethPayloads, 'ethereum');
  cases.push(['merged keeps only target chain', merged.length === 2]);
  cases.push(['merged excludes wrong-chain row', !merged.some(r => r.chain !== 'ethereum')]);
  cases.push(['merged finds curve venue from second payload',
    !!findRowByPool(merged, '0xbEbc')]);

  // pool match across multi-fetcher (NEW)
  const rA = findRowByPool(merged, '0x5777');
  const rB = findRowByPool(merged, '0xbEbc');
  cases.push(['pool match across fetchers — uni',   rA && rA.venue === 'uniswap_v3']);
  cases.push(['pool match across fetchers — curve', rB && rB.venue === 'curve']);

  // observation (same as predecessor — proves no interpretation drift)
  const obs = buildObservation('2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z',
    'ethereum:DAI/USDC:curve_uni', rA, rB);
  cases.push(['obs sameBlock true (same block 100)', obs.sameBlock === true]);
  cases.push(['obs records both venues', obs.venueA === 'uniswap_v3' && obs.venueB === 'curve']);
  const interpKeys = ['viable','threshold','frequency','persistence','margin','score','verdict','profit'];
  cases.push(['obs has NO interpretation fields', interpKeys.every(k => !(k in obs))]);

  // block-pair dedup key (NEW)
  const r1 = { blockNumber: 100 }, r2 = { blockNumber: 100 }, r3 = { blockNumber: 101 };
  cases.push(['blockPairKey stable for same blocks', blockPairKey(r1, r2) === blockPairKey(r1, r2)]);
  cases.push(['blockPairKey changes when block advances', blockPairKey(r1, r2) !== blockPairKey(r1, r3)]);

  // surface validation (NEW)
  const okCfg = { chainScopedId: 'a:B/C:x_y', chain: 'arbitrum', venues: [{pool:'0x1'},{pool:'0x2'}] };
  const noCsid = { chain: 'arbitrum', venues: [{pool:'0x1'},{pool:'0x2'}] };
  const oneVen = { chainScopedId: 'a:B/C:x_y', chain: 'arbitrum', venues: [{pool:'0x1'}] };
  const noPool = { chainScopedId: 'a:B/C:x_y', chain: 'arbitrum', venues: [{pool:'0x1'},{name:'no-pool'}] };
  cases.push(['validate ok',                  (() => { try { validateSurface(okCfg); return true; } catch { return false; } })()]);
  cases.push(['validate rejects missing csid',(() => { try { validateSurface(noCsid); return false; } catch (e) { return /chainScopedId/.test(e.message); } })()]);
  cases.push(['validate rejects 1 venue',     (() => { try { validateSurface(oneVen); return false; } catch (e) { return /2 declared venues/.test(e.message); } })()]);
  cases.push(['validate rejects no pool',     (() => { try { validateSurface(noPool); return false; } catch (e) { return /missing pool/.test(e.message); } })()]);

  let pass = 0;
  console.log('── surface_behavioral_collector.js SELF-TEST (generalized, Wave 1) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
