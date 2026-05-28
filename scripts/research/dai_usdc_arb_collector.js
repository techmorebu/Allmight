#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Phase 2A.2 Behavioral Collector :: Arbitrum DAI/USDC
//  PLACEMENT: scripts/research/dai_usdc_arb_collector.js
//  STATUS:    Boss Phase 2A.2 approved — READ-ONLY observational ACQUISITION
//
//  ┌───────────────────────────────────────────────────────────────────────┐
//  │  OBSERVATIONAL ONLY. This collector records RAW spread observations.    │
//  │  It performs NO interpretation: no thresholds, no frequency, no         │
//  │  persistence, no profitability, no "viable" verdicts. Those belong to   │
//  │  the SEPARATE analyzer (Boss: keep interpretation out of acquisition).  │
//  └───────────────────────────────────────────────────────────────────────┘
//
//  WHAT IT DOES
//    - Reads Redis key fetcher:arbitrumFetcher (written by master-fetcher).
//    - Extracts the two declared DAI/USDC venue rows (pools from the surface
//      config — config-driven, not hardcoded).
//    - SAME-BLOCK ANCHORED: spread is computed only when both venue rows share
//      a block. Cross-block pairs are recorded with spreadBps=null + sameBlock
//      =false (cross-block spreads are 5-14x inflated → invalid; project mandate).
//    - Appends one raw observation per NEW fetcher snapshot (dedup on payload ts).
//    - withTimeout hard deadline on every Redis read (no silent hangs; mandate).
//
//  SCOPE (Boss): arbitrum DAI/USDC ONLY. No other pair, no other chain.
//  CONSTRAINTS: no execution, no wallet, no promotion, no threshold mutation,
//               no blending of flash/inventory models. READ-ONLY.
//
//  OUTPUT: logs/research/dai_usdc_arb/spread_observations.jsonl  (append; raw)
//
//  USAGE
//    node scripts/research/dai_usdc_arb_collector.js                  # daemon, 3s
//    node scripts/research/dai_usdc_arb_collector.js --interval 2000
//    node scripts/research/dai_usdc_arb_collector.js --duration-min 120
//    node scripts/research/dai_usdc_arb_collector.js --max-samples 5000
//    node scripts/research/dai_usdc_arb_collector.js --self-test
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACES_DIR = path.join(REPO, 'surfaces');
const CONFIG_FILE  = path.join(SURFACES_DIR, 'dai_usdc_candidate.json');
const OUT_DIR      = path.join(REPO, 'logs', 'research', 'dai_usdc_arb');
const OUT_JSONL    = path.join(OUT_DIR, 'spread_observations.jsonl');

const REDIS_URL    = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const FETCHER_KEY  = 'fetcher:arbitrumFetcher';
const READ_TIMEOUT_MS = 5000;

// ─── tiny local helpers (no coupling to execution modules) ──────────────────
function withTimeout(promise, ms, label) {
  let t;
  const timeout = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`timeout: ${label} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// PURE: spread in bps between two prices, or null if inputs invalid
function computeSpreadBps(pA, pB) {
  if (!isFinite(pA) || !isFinite(pB) || pA <= 0 || pB <= 0) return null;
  const mid = (pA + pB) / 2;
  if (mid <= 0) return null;
  return +(Math.abs(pA - pB) / mid * 10000).toFixed(6);
}

// PURE: same-block iff both blocks present and equal (mirrors scanner logic)
function isSameBlock(blockA, blockB) {
  return blockA != null && blockB != null && blockA === blockB;
}

// PURE: build a raw observation record (NO interpretation fields)
function buildObservation(now, payloadTs, csid, rowA, rowB) {
  const sameBlock = isSameBlock(rowA.blockNumber, rowB.blockNumber);
  // spread is VALID only same-block; cross-block → null (invalid, not inflated noise)
  const spreadBps = sameBlock ? computeSpreadBps(rowA.price, rowB.price) : null;
  const midPrice  = sameBlock ? +(((rowA.price + rowB.price) / 2)).toFixed(10) : null;
  return {
    ts            : now,
    payloadTs,
    chainScopedId : csid,
    venueA: rowA.venue, poolA: rowA.pool, priceA: rowA.price, blockA: rowA.blockNumber ?? null,
    venueB: rowB.venue, poolB: rowB.pool, priceB: rowB.price, blockB: rowB.blockNumber ?? null,
    sameBlock,
    midPrice,
    spreadBps,            // null when cross-block (invalid by mandate)
  };
}

// PURE: extract a venue row by pool address (case-insensitive)
function findRowByPool(prices, pool) {
  const want = String(pool).toLowerCase();
  return prices.find(p => p && p.pool && String(p.pool).toLowerCase() === want) || null;
}

// ─── config ──────────────────────────────────────────────────────────────────
function loadVenues() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (cfg.chain !== 'arbitrum') throw new Error(`config chain is ${cfg.chain}, expected arbitrum`);
  if (!Array.isArray(cfg.venues) || cfg.venues.length !== 2) throw new Error('expected exactly 2 declared venues');
  for (const v of cfg.venues) if (!v.pool) throw new Error(`venue ${v.name} missing pool`);
  return { csid: cfg.chainScopedId || 'arbitrum:DAI/USDC', venues: cfg.venues };
}

// ─── runtime ───────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { intervalMs: 3000, durationMin: null, maxSamples: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--interval')      a.intervalMs  = parseInt(argv[++i], 10) || 3000;
    else if (argv[i] === '--duration-min') a.durationMin = parseFloat(argv[++i]) || null;
    else if (argv[i] === '--max-samples')  a.maxSamples  = parseInt(argv[++i], 10) || null;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let venuesCfg;
  try { venuesCfg = loadVenues(); }
  catch (e) { console.error(`[collector] config error: ${e.message}`); process.exit(1); }
  const [vA, vB] = venuesCfg.venues;

  const Redis = require('ioredis');
  const redis = new Redis(REDIS_URL, { lazyConnect: false, enableReadyCheck: true });
  redis.on('error', (e) => console.error(`[collector] redis error: ${e.message}`));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sink = fs.createWriteStream(OUT_JSONL, { flags: 'a' });

  let recorded = 0, misses = 0, dupes = 0, crossBlock = 0;
  let lastPayloadTs = null;
  const startedAt = Date.now();
  const deadline = args.durationMin ? startedAt + args.durationMin * 60000 : null;

  console.error(`[collector] Phase 2A.2 Arbitrum DAI/USDC — OBSERVATIONAL ONLY`);
  console.error(`[collector] ${venuesCfg.csid} | ${vA.name}(${vA.pool.slice(0,10)}) vs ${vB.name}(${vB.pool.slice(0,10)})`);
  console.error(`[collector] interval=${args.intervalMs}ms duration=${args.durationMin||'∞'}min maxSamples=${args.maxSamples||'∞'} → ${path.relative(REPO, OUT_JSONL)}`);

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
      const raw = await withTimeout(redis.get(FETCHER_KEY), READ_TIMEOUT_MS, 'redis.get');
      if (!raw) {
        misses++;
        // periodic diagnostic so "silent misses" can't hide a down fetcher
        if (misses === 1 || misses % 10 === 0) console.error(`[collector] miss #${misses} — no ${FETCHER_KEY} in Redis (is the master-fetcher cron running?)`);
        return;
      }
      const payload = JSON.parse(raw);
      const payloadTs = payload.timestamp ?? payload.data?.timestamp ?? null;
      if (payloadTs != null && payloadTs === lastPayloadTs) {
        dupes++;
        if (dupes === 1 || dupes % 50 === 0) console.error(`[collector] dupe #${dupes} — same payloadTs (fetcher hasn't refreshed)`);
        return;
      }
      const prices = payload.data?.data?.prices ?? payload.data?.prices ?? [];
      const rowA = findRowByPool(prices, vA.pool);
      const rowB = findRowByPool(prices, vB.pool);
      if (!rowA || !rowB) {
        misses++;
        console.error(`[collector] miss — venue rows not found in payload (rowA=${!!rowA} rowB=${!!rowB}, prices=${prices.length})`);
        lastPayloadTs = payloadTs;
        return;
      }

      const obs = buildObservation(new Date().toISOString(), payloadTs, venuesCfg.csid, rowA, rowB);
      sink.write(JSON.stringify(obs) + '\n');
      lastPayloadTs = payloadTs;
      recorded++;
      if (!obs.sameBlock) crossBlock++;
      // log EVERY record (cadence is fetcher-bounded ~5s, so this stays sane long-term)
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

  // initial connectivity probe (clear error if REDIS_URL wrong)
  try { await withTimeout(redis.get(FETCHER_KEY), READ_TIMEOUT_MS, 'redis.probe'); console.error('[collector] redis connected.'); }
  catch (e) { console.error(`[collector] CANNOT REACH REDIS at ${REDIS_URL}: ${e.message}`); process.exit(1); }

  const timer = setInterval(tick, args.intervalMs);
  tick();
  // keep handle for cleanliness
  process.on('exit', () => clearInterval(timer));
}

// ─── SELF-TEST (pure functions; no Redis, no fs) ────────────────────────────
function selfTest() {
  const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  const cases = [];

  // spread math
  cases.push(['spread(1.00005,1.00015) ≈ 1.0bp', approx(computeSpreadBps(1.00005, 1.00015), 1.0)]);
  cases.push(['spread(1.0,1.0) = 0',              computeSpreadBps(1.0, 1.0) === 0]);
  cases.push(['spread(1.0,1.0027) ≈ 27bp',        approx(computeSpreadBps(1.0, 1.0027), 27.0, 0.05)]);
  cases.push(['spread invalid input → null',      computeSpreadBps(0, 1) === null && computeSpreadBps(NaN, 1) === null]);

  // same-block
  cases.push(['sameBlock equal → true',  isSameBlock(100, 100) === true]);
  cases.push(['sameBlock differ → false', isSameBlock(100, 101) === false]);
  cases.push(['sameBlock null → false',  isSameBlock(null, 100) === false]);

  // pool matching (case-insensitive)
  const prices = [
    { pool: '0x7CF803e8d82A50504180f417B8bC7a493C0a0503', venue: 'uniswap_v3', price: 1.00005, blockNumber: 500 },
    { pool: '0xD46c8A1940113ae64f960B7aA12EF5dcAB0ffe0E', venue: 'uniswap_v3', price: 0.998,   blockNumber: 500 },
    { pool: '0x45FaE8D0D2acE73544baab452f9020925AfCCC75', venue: 'camelot_v3', price: 1.00015, blockNumber: 500 },
  ];
  const rowA = findRowByPool(prices, '0x7cf803e8d82a50504180f417b8bc7a493c0a0503'); // lowercase query
  const rowB = findRowByPool(prices, '0x45FaE8D0D2acE73544baab452f9020925AfCCC75');
  cases.push(['pool match picks 1bp uni (not 30bp)', rowA && rowA.price === 1.00005]);
  cases.push(['pool match camelot', rowB && rowB.venue === 'camelot_v3']);
  cases.push(['missing pool → null', findRowByPool(prices, '0xdead') === null]);

  // observation: same-block → valid spread, NO interpretation fields
  const obs = buildObservation('2026-01-01T00:00:00Z', 1700, 'arbitrum:DAI/USDC:uni_camelot', rowA, rowB);
  cases.push(['obs sameBlock true', obs.sameBlock === true]);
  cases.push(['obs spreadBps ≈ 1.0', approx(obs.spreadBps, 1.0)]);
  cases.push(['obs has raw fields', obs.priceA === 1.00005 && obs.blockA === 500 && obs.venueB === 'camelot_v3']);
  const interpKeys = ['viable','threshold','frequency','persistence','margin','score','verdict','profit'];
  cases.push(['obs has NO interpretation fields', interpKeys.every(k => !(k in obs))]);

  // observation: cross-block → spreadBps null (invalid by mandate, not inflated)
  const rowBx = { ...rowB, blockNumber: 501 };
  const obsX = buildObservation('2026-01-01T00:00:01Z', 1701, 'arbitrum:DAI/USDC:uni_camelot', rowA, rowBx);
  cases.push(['cross-block sameBlock false', obsX.sameBlock === false]);
  cases.push(['cross-block spreadBps null (not inflated)', obsX.spreadBps === null]);

  let pass = 0;
  console.log('── dai_usdc_arb_collector.js SELF-TEST (Phase 2A.2 acquisition) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
