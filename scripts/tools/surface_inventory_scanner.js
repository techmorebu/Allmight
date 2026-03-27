'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Inventory Scanner  v2.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/surface_inventory_scanner.js
//  STATUS:     CURRENT — Surface Discovery & Classification phase
//
//  WHAT IT DOES
//  ─────────────
//  1. Reads all fetcher payloads from Redis (no new RPC calls)
//  2. Groups price rows by pair across venues
//  3. Enforces same-block rule — cross-block surfaces flagged, not silently trusted
//  4. Computes spread and fee burden
//  5. Computes active-tick depth (L × sqrtP) from stored liquidity + price
//     If decimals unknown → marks surface incomplete (Rule 5 — no guessing)
//  6. Scores and classifies each surface
//  7. Outputs ranked table + optional JSON
//
//  DESIGN RULES (Boss-approved)
//  ─────────────────────────────
//  Rule 1 — No execution logic
//  Rule 2 — No new RPC calls (Redis only)
//  Rule 3 — Deterministic output (sorted by tier rank, then score desc, then pair asc)
//  Rule 4 — Same-block enforcement (cross-block → degraded, not discarded)
//  Rule 5 — No guessing liquidity (unknown pool meta → incomplete)
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/surface_inventory_scanner.js
//  node -r dotenv/config scripts/tools/surface_inventory_scanner.js --json
//  node -r dotenv/config scripts/tools/surface_inventory_scanner.js --verbose
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const Redis = require('ioredis');

// ─── REDIS ────────────────────────────────────────────────────────────────────
// Keys written by master-fetcher: fetcher:{fetcherName}

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const FETCHER_KEYS = [
  'fetcher:arbitrumFetcher',
];

// ─── POOL METADATA ────────────────────────────────────────────────────────────
//  dec0/dec1 required for active-tick depth computation.
//  quoteToken determines USD conversion path.
//  Keyed by pool address (lowercase).
//  Source: arbitrumFetcher.js configs + session 2026-03-19 confirmed values.
//  Add new addresses here when adding pools to arbitrumFetcher.js.

const POOL_META = {
  // ── UniV3 pools ─────────────────────────────────────────────────────────────
  '0xc6962004f452be9203591991d15f6b388e09e8d0': { pair: 'ETH/USDC',   dec0: 18, dec1: 6,  quoteToken: 'USDC'  },
  '0x641c00a822e8b671738d32a431a4fb6074e5c79d': { pair: 'ETH/USDT',   dec0: 18, dec1: 6,  quoteToken: 'USDT'  },
  '0xbe3ad6a5669dc0b8b12febc03608860c31e2eef6': { pair: 'USDC/USDT',  dec0: 6,  dec1: 6,  quoteToken: 'USDT'  },
  '0x8e295789c9465487074a65b1ae9ce0351172393f': { pair: 'USDC/USDCe', dec0: 6,  dec1: 6,  quoteToken: 'USDCe' },
  '0x7f580f8a02b759c350e6b8340e7c2d4b8162b6a9': { pair: 'DAI/USDT',   dec0: 18, dec1: 6,  quoteToken: 'USDT'  },
  '0xbce73c2e5a623054b0e8e2428e956f4b9d0412a5': { pair: 'USDC/USDT',  dec0: 6,  dec1: 6,  quoteToken: 'USDT'  },
  '0xa9e9cb16e922892aa563a5adb0f7d976efce36fb': { pair: 'USDC/USDCe', dec0: 6,  dec1: 6,  quoteToken: 'USDCe' },
  '0xb0f6ca40411360c03d41c5ffc5f179b8403cdcf8': { pair: 'ARB/USDC',   dec0: 18, dec1: 6,  quoteToken: 'USDC'  },
  '0x5969efdde3cf5c0d9a88ae51e47d721096a97203': { pair: 'WBTC/USDT',  dec0: 8,  dec1: 6,  quoteToken: 'USDT'  },
  '0x2f5e87c9312fa29aed5c179e456625d79015299c': { pair: 'WBTC/WETH',  dec0: 8,  dec1: 18, quoteToken: 'WETH'  },
  '0xc6f780497a95e246eb9449f5e4770916dcd6396a': { pair: 'ARB/WETH',   dec0: 18, dec1: 18, quoteToken: 'WETH'  },
  // ── Camelot V2 ──────────────────────────────────────────────────────────────
  '0x84652bb2539513baf36e225c930fdd8eaa63ce27': { pair: 'ETH/USDC',   dec0: 18, dec1: 6,  quoteToken: 'USDC',  v2: true },
  // ── Camelot V3 (Algebra) ────────────────────────────────────────────────────
  '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1': { pair: 'ARB/USDC',   dec0: 18, dec1: 6,  quoteToken: 'USDC'  },
};

// ─── THRESHOLDS ───────────────────────────────────────────────────────────────
//  Aligned with breakeven_engine.js confirmed session values (2026-03-19).

const THRESHOLDS = {
  DEPTH_THIN      : 5_000,    // < $5k   → blocked_liquidity / thin
  DEPTH_CANDIDATE : 10_000,   // ≥ $10k  → monitored floor
  DEPTH_STRONG    : 50_000,   // ≥ $50k  → candidate
  MIN_SPREAD_FRAC : 0.000050, // 0.005%  → below this is noise
};

// Tier rank for deterministic sort (lower = better)
const TIER_RANK = {
  candidate        : 0,
  monitored        : 1,
  blocked_liquidity: 2,
  blocked_fee      : 3,
  thin_liquidity   : 4,
  incomplete       : 5,
  cross_block      : 6,
  noise            : 7,
};

// ─── STATE ────────────────────────────────────────────────────────────────────

let ETH_PRICE_USD = null;  // populated from live ETH/USDC row; needed for WETH depths

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

/**
 * Compute active-tick depth in USD.
 *
 * Formula: (L × sqrtP_raw / 10^dec1) × 2
 * where sqrtP_raw = sqrt(price_human × 10^(dec1 − dec0))
 *
 * Confirmed reference values (session 2026-03-19):
 *   UniV3 ARB/USDC  → $3,090    (L ≈ 1.846e15)
 *   CamelotV3 ARB/USDC → $56,016 (L ≈ 3.35e16)
 */
function computeActiveTickUSD(liquidityRaw, priceHuman, dec0, dec1, quoteToken) {
  const L = Number(liquidityRaw || 0);
  if (!L || !priceHuman || !isFinite(priceHuman) || priceHuman <= 0) return null;

  const sqrtP = Math.sqrt(priceHuman * Math.pow(10, dec1 - dec0));
  const reserveQuote = (L * sqrtP) / Math.pow(10, dec1);
  const bothSides = reserveQuote * 2;

  if (quoteToken === 'USDC' || quoteToken === 'USDT') return bothSides;
  if (quoteToken === 'USDCe') return bothSides;        // ~1:1 USD for scanning
  if (quoteToken === 'WETH' && ETH_PRICE_USD > 0) return bothSides * ETH_PRICE_USD;
  return null;  // need ETH price, don't have it yet
}

/**
 * Score: (net_spread × depth_min) / fee_bps^0.5
 *
 * Quick-scan score — not a substitute for the full breakeven engine.
 * Used only for relative ranking within this scanner's output.
 */
function scoreSurface(spreadFrac, feeBurdenFrac, depthMinUSD) {
  if (!depthMinUSD || depthMinUSD <= 0) return 0;
  const net = spreadFrac - feeBurdenFrac;
  if (net <= 0) return 0;
  const feeBps = feeBurdenFrac * 10_000;
  if (feeBps === 0) return 0;
  return Math.round((net * depthMinUSD) / Math.pow(feeBps, 0.5));
}

// ─── CLASSIFICATION ───────────────────────────────────────────────────────────

function classify(s) {
  if (s.incomplete) {
    return { tier: 'incomplete', score: 0, reason: s.incompleteReason || 'missing pool meta' };
  }

  if (s.crossBlock) {
    return { tier: 'cross_block', score: 0, reason: `block ${s.blockA} vs ${s.blockB}` };
  }

  if (s.spreadFrac < THRESHOLDS.MIN_SPREAD_FRAC) {
    return { tier: 'noise', score: 0, reason: `spread ${(s.spreadFrac * 100).toFixed(4)}% below 0.005% floor` };
  }

  if (s.feeBurdenFrac >= s.spreadFrac) {
    return {
      tier : 'blocked_fee',
      score: 0,
      reason: `fee ${(s.feeBurdenFrac * 100).toFixed(4)}% ≥ spread ${(s.spreadFrac * 100).toFixed(4)}%`,
    };
  }

  const depthMin = (s.depthA != null && s.depthB != null) ? Math.min(s.depthA, s.depthB) : null;

  if (depthMin == null) {
    return { tier: 'incomplete', score: 0, reason: 'depth null after meta lookup' };
  }

  if (depthMin < THRESHOLDS.DEPTH_THIN) {
    return {
      tier  : 'blocked_liquidity',
      score : 0,
      reason: `min depth $${depthMin.toFixed(0)} < $${THRESHOLDS.DEPTH_THIN.toLocaleString()}`,
    };
  }

  const score = scoreSurface(s.spreadFrac, s.feeBurdenFrac, depthMin);
  const netPct = ((s.spreadFrac - s.feeBurdenFrac) * 100).toFixed(4);

  if (depthMin >= THRESHOLDS.DEPTH_STRONG) {
    return {
      tier  : 'candidate',
      score,
      reason: `net +${netPct}% | depth $${(depthMin / 1000).toFixed(0)}k`,
    };
  }
  if (depthMin >= THRESHOLDS.DEPTH_CANDIDATE) {
    return {
      tier  : 'monitored',
      score,
      reason: `net +${netPct}% | depth $${(depthMin / 1000).toFixed(1)}k — watch`,
    };
  }

  return {
    tier  : 'thin_liquidity',
    score,
    reason: `depth $${depthMin.toFixed(0)} — below candidate floor`,
  };
}

// ─── REDIS READ ───────────────────────────────────────────────────────────────

async function readFetcherPayloads(redis) {
  const results = [];
  for (const key of FETCHER_KEYS) {
    try {
      const raw = await redis.get(key);
      if (!raw) { console.warn(`[scanner] key missing: ${key}`); continue; }
      const parsed = JSON.parse(raw);
      if (!parsed.ok || !parsed.data) { console.warn(`[scanner] payload not ok: ${key}`); continue; }
      results.push({ key, payload: parsed });
    } catch (e) {
      console.warn(`[scanner] failed to read ${key}: ${e.message}`);
    }
  }
  return results;
}

// ─── PRICE ROW EXTRACTION ────────────────────────────────────────────────────

function extractRows(payloads) {
  const rows = [];
  for (const { key, payload } of payloads) {
    const prices = payload.data?.prices;
    if (!Array.isArray(prices)) continue;
    for (const p of prices) {
      if (!p || !p.price || !isFinite(p.price) || p.price <= 0) continue;
      rows.push({
        fetcherKey  : key,
        pair        : p.pair,
        pool        : (p.pool || '').toLowerCase(),
        venue       : p.venue || 'unknown',
        price       : p.price,
        liquidity   : p.liquidity,
        liquidityRaw: p.liquidityRaw || String(p.liquidity || 0),
        fee         : typeof p.fee === 'number' ? p.fee : 0,
        tick        : p.tick,
        blockNumber : p.blockNumber,
        reserveUSD  : p.reserveUSD || null,   // V2 only
        source      : p.source || key,
      });
    }
  }
  return rows;
}

// ─── ETH PRICE REF ────────────────────────────────────────────────────────────

function extractEthPrice(rows) {
  const ref = rows.find(r =>
    (r.pair === 'ETH/USDC') &&
    r.venue === 'uniswap_v3' &&
    r.price > 100
  );
  if (ref) ETH_PRICE_USD = ref.price;
}

// ─── SURFACE FORMATION ───────────────────────────────────────────────────────

function formSurfaces(rows) {
  // Group by normalised pair
  const byPair = new Map();
  for (const row of rows) {
    if (!byPair.has(row.pair)) byPair.set(row.pair, []);
    byPair.get(row.pair).push(row);
  }

  const surfaces = [];

  for (const [pair, venues] of byPair) {
    if (venues.length < 2) continue;

    // All unique venue-pair combinations
    for (let i = 0; i < venues.length; i++) {
      for (let j = i + 1; j < venues.length; j++) {
        const a = venues[i];
        const b = venues[j];

        if (a.venue === b.venue && a.pool === b.pool) continue;

        // Spread (absolute, normalised to mid)
        const mid = (a.price + b.price) / 2;
        const spreadFrac = Math.abs(a.price - b.price) / mid;

        // Fee burden = both legs (round-trip)
        const feeA = a.fee;
        const feeB = b.fee;
        const feeBurdenFrac = feeA + feeB;

        // Block check
        const crossBlock = (a.blockNumber != null && b.blockNumber != null) &&
                           (a.blockNumber !== b.blockNumber);

        // Active-tick depth
        const metaA = POOL_META[a.pool];
        const metaB = POOL_META[b.pool];

        let depthA = null;
        let depthB = null;
        let incomplete = false;
        let incompleteReason = '';

        if (!metaA) {
          incomplete = true;
          incompleteReason = `no POOL_META: ${a.pool.slice(0, 10)} (${a.venue})`;
        } else if (metaA.v2) {
          depthA = a.reserveUSD != null ? a.reserveUSD / 2 : null;
          if (depthA == null) { incomplete = true; incompleteReason = 'V2 reserveUSD missing'; }
        } else {
          depthA = computeActiveTickUSD(a.liquidityRaw, a.price, metaA.dec0, metaA.dec1, metaA.quoteToken);
          if (depthA == null) { incomplete = true; incompleteReason = `depth null (${metaA.quoteToken} — ETH price needed?)`; }
        }

        if (!metaB) {
          incomplete = true;
          incompleteReason += (incompleteReason ? '; ' : '') + `no POOL_META: ${b.pool.slice(0, 10)} (${b.venue})`;
        } else if (metaB.v2) {
          depthB = b.reserveUSD != null ? b.reserveUSD / 2 : null;
          if (depthB == null) { incomplete = true; incompleteReason += '; V2 reserveUSD missing'; }
        } else {
          depthB = computeActiveTickUSD(b.liquidityRaw, b.price, metaB.dec0, metaB.dec1, metaB.quoteToken);
          if (depthB == null) { incomplete = true; incompleteReason += `; depth null (${metaB.quoteToken} — ETH price needed?)`; }
        }

        const surface = {
          id            : `${pair}:${a.venue}-${b.venue}:${a.pool.slice(0,8)}-${b.pool.slice(0,8)}`,
          pair,
          venueA        : a.venue,
          venueB        : b.venue,
          poolA         : a.pool,
          poolB         : b.pool,
          priceA        : a.price,
          priceB        : b.price,
          spreadFrac,
          feeA,
          feeB,
          feeBurdenFrac,
          blockA        : a.blockNumber,
          blockB        : b.blockNumber,
          crossBlock,
          depthA,
          depthB,
          depthMin      : (depthA != null && depthB != null) ? Math.min(depthA, depthB) : null,
          incomplete,
          incompleteReason: incompleteReason.trim(),
          scannedAt     : nowIso(),
          tier          : '',
          score         : 0,
          reason        : '',
        };

        const result = classify(surface);
        surface.tier   = result.tier;
        surface.score  = result.score || 0;
        surface.reason = result.reason || '';

        surfaces.push(surface);
      }
    }
  }

  // Deterministic sort
  surfaces.sort((a, b) => {
    const ta = TIER_RANK[a.tier] ?? 9;
    const tb = TIER_RANK[b.tier] ?? 9;
    if (ta !== tb) return ta - tb;
    if (b.score !== a.score) return b.score - a.score;
    return a.pair.localeCompare(b.pair);
  });

  return surfaces;
}

// ─── REPORT PRINTER ──────────────────────────────────────────────────────────

function printReport(surfaces, scannedAt, redisAgeSec) {
  const W    = 126;
  const LINE = '─'.repeat(W);
  const DBLE = '═'.repeat(W);

  const fmtUSD = v => {
    if (v == null) return '—'.padStart(9);
    return (v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`).padStart(9);
  };
  const fmtPct = v => {
    if (v == null) return '—'.padStart(9);
    return `${(v * 100).toFixed(4)}%`.padStart(9);
  };

  const ACTIONABLE = new Set(['candidate', 'monitored']);

  // Tally
  const counts = {};
  for (const s of surfaces) counts[s.tier] = (counts[s.tier] || 0) + 1;

  console.log('\n' + DBLE);
  console.log(
    ` ALLMIGHT — SURFACE INVENTORY SCAN\n` +
    ` Scanned: ${scannedAt}  |  ETH ref: ${ETH_PRICE_USD ? '$' + ETH_PRICE_USD.toFixed(2) : 'n/a'}  |  Redis age: ${redisAgeSec}s`
  );
  console.log(LINE);
  console.log(' TALLY: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(LINE);
  console.log(
    ' #    TIER               PAIR           VENUE-A            VENUE-B          SPREAD    FEE-BURD   DEPTH-A   DEPTH-B   SCORE'
  );
  console.log(LINE);

  surfaces.forEach((s, i) => {
    const mark = ACTIONABLE.has(s.tier) ? '►' : ' ';
    console.log(
      `${mark} ${String(i + 1).padStart(2)}.  ` +
      `${s.tier.padEnd(18)} ` +
      `${s.pair.padEnd(14)} ` +
      `${s.venueA.padEnd(18)} ` +
      `${s.venueB.padEnd(16)} ` +
      `${fmtPct(s.spreadFrac)} ` +
      `${fmtPct(s.feeBurdenFrac)} ` +
      `${fmtUSD(s.depthA)} ` +
      `${fmtUSD(s.depthB)} ` +
      `${String(s.score || 0).padStart(7)}`
    );
    if (s.reason) console.log(`        ↳ ${s.reason}`);
  });

  console.log(LINE);

  // Actionable block
  const actionable = surfaces.filter(s => ACTIONABLE.has(s.tier));
  if (actionable.length) {
    console.log('\n ACTIONABLE — pass these into the validation pipeline:\n');
    for (const s of actionable) {
      const net = (s.spreadFrac - s.feeBurdenFrac);
      console.log(` ► [${s.tier.toUpperCase()}]  ${s.pair}  —  ${s.venueA} vs ${s.venueB}`);
      console.log(`   spread: ${fmtPct(s.spreadFrac).trim()}  fee: ${fmtPct(s.feeBurdenFrac).trim()}  net: ${fmtPct(net).trim()}  depth_min: ${fmtUSD(s.depthMin).trim()}`);
      console.log(`   pool A: ${s.poolA}`);
      console.log(`   pool B: ${s.poolB}`);
      if (s.crossBlock) console.log(`   ⚠ cross-block: ${s.blockA} vs ${s.blockB}`);
      console.log();
    }
    console.log(' NEXT: docs/current/VALIDATION_PIPELINE.md  (8-step sequence)');
  } else {
    console.log('\n No actionable surfaces in current snapshot.');
    console.log(' → Run fetcher first: node -r dotenv/config scripts/master-fetcher.js');
    console.log(' → Then re-scan: node -r dotenv/config scripts/tools/surface_inventory_scanner.js');
  }

  console.log('\n REMINDERS:');
  console.log('  • depth = L×sqrtP (not TVL) — incomplete = no POOL_META entry');
  console.log('  • cross_block = same-block rule violated — do not trust for sizing');
  console.log('  • this is a first-pass filter — survivors go to full validation pipeline');
  console.log(DBLE + '\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const useJson    = process.argv.includes('--json');
  const useVerbose = process.argv.includes('--verbose');

  const redis = new Redis(REDIS_URL, { lazyConnect: false, enableReadyCheck: true });
  redis.on('error', e => console.error('[scanner] Redis error:', e.message));

  const scannedAt = nowIso();

  try {
    await redis.ping();
  } catch (e) {
    console.error('[scanner] Cannot reach Redis:', e.message);
    await redis.quit().catch(() => {});
    process.exit(1);
  }

  const payloads = await readFetcherPayloads(redis);
  await redis.quit();

  if (!payloads.length) {
    console.error('[scanner] No fetcher data in Redis. Run: node -r dotenv/config scripts/master-fetcher.js');
    process.exit(1);
  }

  const rows = extractRows(payloads);
  extractEthPrice(rows);

  if (useVerbose) {
    console.log(`[scanner] rows: ${rows.length}  ETH: ${ETH_PRICE_USD ? '$' + ETH_PRICE_USD.toFixed(2) : 'n/a'}`);
    for (const r of rows) {
      const dep = POOL_META[r.pool]
        ? computeActiveTickUSD(r.liquidityRaw, r.price, POOL_META[r.pool].dec0, POOL_META[r.pool].dec1, POOL_META[r.pool].quoteToken)
        : null;
      console.log(
        `  ${r.venue.padEnd(14)} ${r.pair.padEnd(12)} ` +
        `price=${r.price.toFixed(6).padStart(12)}  ` +
        `fee=${(r.fee * 100).toFixed(4)}%  ` +
        `block=${r.blockNumber}  ` +
        `depth=${dep != null ? '$' + (dep / 1000).toFixed(1) + 'k' : '—'}`
      );
    }
    console.log();
  }

  // Redis data age
  let redisAgeSec = '?';
  try {
    const ts = payloads.map(p => new Date(p.payload.timestamp).getTime()).filter(Boolean);
    if (ts.length) redisAgeSec = Math.round((Date.now() - Math.max(...ts)) / 1000);
  } catch {}

  const surfaces = formSurfaces(rows);

  if (useJson) {
    console.log(JSON.stringify({
      scannedAt,
      ethPriceUSD  : ETH_PRICE_USD,
      redisAgeSec,
      surfaceCount : surfaces.length,
      surfaces,
    }, null, 2));
    return;
  }

  printReport(surfaces, scannedAt, redisAgeSec);
}

main().catch(err => {
  console.error('[scanner] FATAL:', err.message || err);
  process.exit(1);
});
