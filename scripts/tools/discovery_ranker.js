'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Discovery Ranker v1
// ───────────────────────────────────────────────────────────────────────────────
//  PURPOSE
//  Read fetcher payloads from Redis, normalize pool rows, rank discovery-quality
//  candidates, and write ranked results back to Redis.
//
//  WHAT THIS IS
//  • Redis-only broad filter
//  • discovery guidance
//  • deterministic ranking
//
//  WHAT THIS IS NOT
//  • not a validator
//  • not breakeven truth
//  • not execution logic
//  • not same-block proof
//
//  USAGE
//  node -r dotenv/config scripts/tools/discovery_ranker.js
//  node -r dotenv/config scripts/tools/discovery_ranker.js --chain arbitrum
//  node -r dotenv/config scripts/tools/discovery_ranker.js --top 20
//  node -r dotenv/config scripts/tools/discovery_ranker.js --json
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const redis = require('../../utils/redis-client');

// ─── CLI ──────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);

function argVal(flag, def) {
  const i = ARGS.indexOf(flag);
  return i !== -1 && ARGS[i + 1] ? ARGS[i + 1] : def;
}

const CHAIN = argVal('--chain', 'arbitrum');
const TOP_N = Number(argVal('--top', 20));
const JSON_OUT = ARGS.includes('--json');
const QUIET = ARGS.includes('--quiet');

// ─── REDIS KEYS ───────────────────────────────────────────────────────────────

const FETCHER_KEY_BY_CHAIN = {
  arbitrum: 'fetcher:arbitrumFetcher',
  base: 'fetcher:baseFetcher',
  optimism: 'fetcher:optimismFetcher',
};

const RANKED_KEY = `discovery:ranked_candidates:${CHAIN}`;
const STATE_KEY = `discovery:ranker_state:${CHAIN}`;

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const CONFIG = {
  MIN_LIQUIDITY_USD: 5_000,
  HOT_CONFIRM_REQUIRED: 2,
  PERSISTENCE_WINDOW_SCANS: 3,
  HOT_CONFIRM_WINDOW_MS: 15 * 60 * 1000,
  COOLDOWN_MS: 15 * 60 * 1000,
  STALE_MS: 5 * 60 * 1000,
};

// Quote-family compatibility is strict, not optimistic.
const QUOTE_FAMILY = {
  USDC:     'USD_STABLE_NATIVE',
  USDT:     'USD_STABLE_TETHER',
  USDCE:    'USD_STABLE_BRIDGED',   // USDCe without dot
  'USDC.E': 'USD_STABLE_BRIDGED',   // USDCe with dot — must be quoted key in JS
  DAI:      'USD_STABLE_OTHER',
  WETH:     'ETH_QUOTE',
  ETH:      'ETH_QUOTE',
  WBTC:     'BTC_QUOTE',
  BTC:      'BTC_QUOTE',
};

const STABLE_QUOTE_FAMILIES = new Set([
  'USD_STABLE_NATIVE',
  'USD_STABLE_TETHER',
  'USD_STABLE_BRIDGED',
  'USD_STABLE_OTHER',
]);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function lower(v) {
  return String(v || '').toLowerCase();
}

function upper(v) {
  return String(v || '').toUpperCase();
}

function stableStringify(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function sortDeterministic(rows) {
  return rows.sort((a, b) => {
    if (Boolean(b.candidate) !== Boolean(a.candidate)) {
      return Number(Boolean(b.candidate)) - Number(Boolean(a.candidate));
    }
    if ((b.score || 0) !== (a.score || 0)) {
      return (b.score || 0) - (a.score || 0);
    }
    if ((b.liquidityUSD || 0) !== (a.liquidityUSD || 0)) {
      return (b.liquidityUSD || 0) - (a.liquidityUSD || 0);
    }
    if ((a.pair || '') !== (b.pair || '')) {
      return (a.pair || '').localeCompare(b.pair || '');
    }
    if ((a.venue || '') !== (b.venue || '')) {
      return (a.venue || '').localeCompare(b.venue || '');
    }
    return (a.poolId || '').localeCompare(b.poolId || '');
  });
}

function liquidityBucketScore(liquidityUSD) {
  if (liquidityUSD == null) return 0;
  if (liquidityUSD >= 50_000) return 1.00;
  if (liquidityUSD >= 25_000) return 0.80;
  if (liquidityUSD >= 10_000) return 0.60;
  if (liquidityUSD >= 5_000) return 0.30;
  return 0.0;
}

function normalizeFlowProxy(volumeUSD, liquidityUSD) {
  if (volumeUSD == null || liquidityUSD == null || liquidityUSD <= 0) return null;
  const ratio = volumeUSD / liquidityUSD;
  // clamp into a sane scoring band
  if (ratio >= 2.0) return 1.0;
  if (ratio >= 1.0) return 0.8;
  if (ratio >= 0.5) return 0.5;
  if (ratio > 0.0) return 0.2;
  return 0.0;
}

function agePenalty(ageMs) {
  if (ageMs == null) return 0.08; // unknown freshness penalty
  if (ageMs <= CONFIG.STALE_MS) return 0.0;
  if (ageMs <= CONFIG.STALE_MS * 3) return 0.08;
  return 0.18;
}

function parseTimestampMs(row) {
  if (!row || !row.timestamp) return null;
  const ms = Date.parse(row.timestamp);
  return Number.isFinite(ms) ? ms : null;
}

function quoteFamilyFromSymbol(symbol) {
  const key = upper(symbol).replace(/\s+/g, '');
  return QUOTE_FAMILY[key] || 'UNKNOWN';
}

function pairFromSymbols(base, quote) {
  if (!base || !quote) return null;
  return `${upper(base)}/${upper(quote)}`;
}

function buildSurfaceKey(chain, pair, venue, poolId) {
  return `${chain}|${pair}|${venue}|${poolId}`;
}

function hasStableFamily(fam) {
  return STABLE_QUOTE_FAMILIES.has(fam);
}

// ─── NORMALIZATION ────────────────────────────────────────────────────────────
// This is intentionally tolerant because fetcher row shapes may vary.
// Do not guess missing time-series fields.

function normalizeVenue(rawVenue) {
  return lower(rawVenue || 'unknown');
}

function rowPoolId(row) {
  // arbitrumFetcher emits the pool address as `pool` — check it first.
  // Fallback chain covers other fetcher shapes.
  return lower(row.pool || row.poolAddress || row.address || row.poolId || row.id || '');
}

function inferBaseQuote(row) {
  // preferred explicit fields
  const base = upper(row.base || row.baseSymbol || row.token0Symbol || row.symbol0 || '');
  const quote = upper(row.quote || row.quoteSymbol || row.token1Symbol || row.symbol1 || '');

  if (base && quote) {
    return { base, quote };
  }

  // fallback pair string
  const pair = String(row.pair || row.symbol || '').trim();
  if (pair.includes('/')) {
    const [b, q] = pair.split('/').map(s => upper(s.trim()));
    if (b && q) return { base: b, quote: q };
  }

  return { base: '', quote: '' };
}

// ─── DECIMAL TABLE — for active-tick depth approximation ──────────────────────
// Used when fetcher emits raw L + price but no USD depth proxy.
// arbitrumFetcher emits liquidity (raw L uint128), price (human USD), tvlUSD: null.
// Scanner formula: reserveQuote = (L × sqrtP) / 10^dec1  where sqrtP = sqrt(price × 10^(dec1-dec0))
// Covers all tokens currently in arbitrumFetcher config.
const DEC_BY_SYMBOL = {
  WETH: 18, ETH: 18, ARB: 18, DAI: 18,
  WBTC: 8,  BTC: 8,
  USDC: 6,  USDT: 6,
};

/**
 * Approximate active-tick depth in USD for V3 pools using raw L + price.
 * Matches the scanner's computeActiveTickUSD formula exactly.
 * Returns null for WETH/WBTC-quoted pairs (no oracle available here).
 * Returns null if inputs are missing or degenerate.
 */
function approxDepthUSD(row) {
  const liq   = safeNum(row.liquidity);
  const price = safeNum(row.price);
  if (!liq || !price || liq <= 0 || price <= 0) return null;

  const { base, quote } = inferBaseQuote(row);
  const dec0 = DEC_BY_SYMBOL[upper(base)]  ?? 18;
  const dec1 = DEC_BY_SYMBOL[upper(quote)] ?? 18;
  const qf   = quoteFamilyFromSymbol(quote);

  // Cannot convert to USD without an oracle for non-stable quotes.
  if (qf === 'ETH_QUOTE' || qf === 'BTC_QUOTE' || qf === 'UNKNOWN') return null;

  const sqrtP        = Math.sqrt(price * Math.pow(10, dec1 - dec0));
  const reserveQuote = (liq * sqrtP) / Math.pow(10, dec1);
  const depthBoth    = reserveQuote * 2;

  return Number.isFinite(depthBoth) && depthBoth > 0 ? depthBoth : null;
}

function inferLiquidityUSD(row) {
  // Priority 1: explicit USD depth proxies (active-tick preferred over TVL).
  const explicit = safeNum(
    row.activeTickUsd    ??
    row.activeTickUSD    ??
    row.depthUsd         ??
    row.depthUSD         ??
    row.liquidityUsd     ??
    row.liquidityUSD     ??
    row.tvlUsd           ??
    row.tvlUSD           ??
    row.totalValueLockedUSD
  );
  if (explicit != null && explicit > 0) return explicit;

  // Priority 2: Camelot V2 / AMM V2 pools emit reserveUSD (total both sides TVL).
  const reserveUSD = safeNum(row.reserveUSD);
  if (reserveUSD != null && reserveUSD > 0) return reserveUSD;

  // Priority 3: V3 pools emit raw liquidity L + human price.
  // Compute approximate active-tick depth using scanner-identical formula.
  return approxDepthUSD(row);
}

function inferVolumeUSD(row) {
  return safeNum(row.volumeUsd ?? row.volumeUSD ?? null);
}

function inferPriceNow(row) {
  return safeNum(
    row.priceNow ??
    row.price ??
    row.token0Price ??
    row.midPrice ??
    row.spotPrice ??
    null
  );
}

function inferTimestampIso(row) {
  return row.timestamp || row.ts || null;
}

function inferBlockNumber(row) {
  const n = safeNum(row.blockNumber ?? row.block ?? null);
  return n == null ? null : Math.trunc(n);
}

function normalizeRow(chain, row) {
  const venue = normalizeVenue(row.venue || row.dex || row.source || row.fetcher || '');
  const poolId = rowPoolId(row);
  const { base, quote } = inferBaseQuote(row);
  const pair = pairFromSymbols(base, quote);
  const quoteFamily = quoteFamilyFromSymbol(quote);
  const liquidityUSD = inferLiquidityUSD(row);
  const volumeUSD = inferVolumeUSD(row);
  const priceNow = inferPriceNow(row);
  const timestamp = inferTimestampIso(row);
  const blockNumber = inferBlockNumber(row);

  return {
    surfaceKey: buildSurfaceKey(chain, pair || 'UNKNOWN/UNKNOWN', venue || 'unknown', poolId || 'unknown'),
    chain,
    venue,
    poolId,
    pair,
    base,
    quote,
    quoteFamily,
    priceNow,
    liquidityUSD,
    volumeUSD,
    blockNumber,
    timestamp,
    raw: row,
  };
}

// ─── PAIRABILITY ──────────────────────────────────────────────────────────────

function buildCompatibilityIndex(rows) {
  const byPair = new Map();

  for (const row of rows) {
    if (!row.pair || !row.base || !row.quote || !row.poolId) continue;

    const key = `${row.base}|${row.quote}|${row.quoteFamily}`;
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(row);
  }

  return byPair;
}

function pairabilityScore(row, compatibilityIndex) {
  if (!row.base || !row.quote || !row.quoteFamily) return 0.0;
  const key = `${row.base}|${row.quote}|${row.quoteFamily}`;
  const compatible = compatibilityIndex.get(key) || [];
  const distinctVenues = new Set(compatible.map(x => x.venue).filter(Boolean));

  if (distinctVenues.size >= 2) return 1.0;
  if (distinctVenues.size === 1 && compatible.length >= 2) return 0.4;
  return 0.0;
}

// ─── STATE / PERSISTENCE ──────────────────────────────────────────────────────

async function loadState() {
  try {
    const raw = await redis.get(STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function saveState(state) {
  // Plain JSON.stringify — stableStringify cannot be used here because its
  // array-replacer acts as a property whitelist at every nesting level, which
  // silently strips nested fields (seen, lastPromotedAt, updatedAt) since they
  // don't match the top-level surfaceKey strings. State is machine-read only;
  // deterministic ordering is not required.
  await redis.set(STATE_KEY, JSON.stringify(state));
}

function updatePersistence(entry, isHot) {
  const ts = nowMs();
  const next = entry || {
    seen: [],
    lastPromotedAt: 0,
  };

  next.seen = Array.isArray(next.seen) ? next.seen : [];
  next.seen.push({ ts, hot: Boolean(isHot) });

  // keep only last N scans within bounded time window
  next.seen = next.seen
    .filter(x => (ts - x.ts) <= CONFIG.HOT_CONFIRM_WINDOW_MS)
    .slice(-CONFIG.PERSISTENCE_WINDOW_SCANS);

  const hotCount = next.seen.filter(x => x.hot).length;
  const recentCount = next.seen.length;
  const persistenceOk =
    recentCount >= CONFIG.HOT_CONFIRM_REQUIRED &&
    hotCount >= CONFIG.HOT_CONFIRM_REQUIRED;

  return {
    stateEntry: next,
    hotCount,
    recentCount,
    persistenceOk,
  };
}

function cooldownActive(entry) {
  if (!entry || !entry.lastPromotedAt) return false;
  return (nowMs() - entry.lastPromotedAt) < CONFIG.COOLDOWN_MS;
}

// ─── SCORING ──────────────────────────────────────────────────────────────────

function scoreCandidate(row, compatibilityIndex, stateEntry) {
  const reasons = [];
  const penalties = {
    missing_data_penalty: 0.0,
    fragility_penalty: 0.0,
    freshness_penalty: 0.0,
    quote_integrity_penalty: 0.0,
  };

  // hard identity checks
  if (!row.chain || !row.venue || !row.poolId || !row.pair) {
    return {
      candidate: false,
      score: 0,
      reasons: ['missing identity fields'],
      penalties: { ...penalties, missing_data_penalty: 1.0 },
      hardReject: true,
      hardRejectReason: 'missing identity fields',
    };
  }

  if (!row.base || !row.quote || !row.quoteFamily || row.quoteFamily === 'UNKNOWN') {
    penalties.quote_integrity_penalty += 0.20;
    reasons.push('quote family unknown or ambiguous');
  }

  if (row.liquidityUSD == null) {
    return {
      candidate: false,
      score: 0,
      reasons: ['missing liquidity'],
      penalties: { ...penalties, missing_data_penalty: 1.0 },
      hardReject: true,
      hardRejectReason: 'missing liquidity',
    };
  }

  if (row.liquidityUSD < CONFIG.MIN_LIQUIDITY_USD) {
    return {
      candidate: false,
      score: 0,
      reasons: [`liquidity below $${CONFIG.MIN_LIQUIDITY_USD.toLocaleString()} floor`],
      penalties: { ...penalties, fragility_penalty: 1.0 },
      hardReject: true,
      hardRejectReason: 'liquidity below floor',
    };
  }

  const pairability = pairabilityScore(row, compatibilityIndex);
  if (pairability <= 0) {
    return {
      candidate: false,
      score: 0,
      reasons: ['no compatible counterpart venue'],
      penalties: { ...penalties, fragility_penalty: 1.0 },
      hardReject: true,
      hardRejectReason: 'no compatible counterpart venue',
    };
  }

  const tsMs = parseTimestampMs(row);
  const freshnessPenalty = agePenalty(tsMs == null ? null : (nowMs() - tsMs));
  penalties.freshness_penalty += freshnessPenalty;
  if (freshnessPenalty > 0) reasons.push('freshness degraded or unknown');

  const flowProxyRaw = normalizeFlowProxy(row.volumeUSD, row.liquidityUSD);
  let activity = 0.0;
  if (flowProxyRaw == null) {
    penalties.missing_data_penalty += 0.08;
    reasons.push('volume unavailable; activity degraded');
  } else {
    activity = flowProxyRaw;
    reasons.push('flow proxy available');
  }

  const liquidity = liquidityBucketScore(row.liquidityUSD);
  if (liquidity >= 0.80) reasons.push('strong usable liquidity');
  else if (liquidity >= 0.30) reasons.push('usable liquidity');

  if (pairability >= 1.0) reasons.push('compatible pair across venues');

  const { stateEntry: nextEntry, hotCount, persistenceOk } = updatePersistence(
    stateEntry,
    (activity > 0 || liquidity >= 0.30) && pairability > 0
  );

  let persistence = 0.0;
  if (persistenceOk) {
    persistence = 1.0;
    reasons.push(`persistent across recent scans (${hotCount})`);
  } else if (hotCount > 0) {
    persistence = 0.3;
    reasons.push('seen recently but not yet persistent');
  }

  if (cooldownActive(stateEntry)) {
    penalties.fragility_penalty += 0.05;
    reasons.push('cooldown active');
  }

  if (!hasStableFamily(row.quoteFamily) && row.quoteFamily !== 'ETH_QUOTE' && row.quoteFamily !== 'BTC_QUOTE') {
    penalties.quote_integrity_penalty += 0.05;
  }

  const scoreRaw =
    (0.30 * activity) +
    (0.25 * liquidity) +
    (0.20 * pairability) +
    (0.15 * persistence) -
    penalties.fragility_penalty -
    penalties.freshness_penalty -
    penalties.missing_data_penalty -
    penalties.quote_integrity_penalty;

  const score = Math.max(0, Number((scoreRaw * 100).toFixed(2)));
  const candidate = score > 0;

  return {
    candidate,
    score,
    reasons,
    penalties,
    hardReject: false,
    hardRejectReason: null,
    stateEntry: nextEntry,
    signalSummary: {
      flow_proxy: flowProxyRaw,
      liquidity_bucket_score: liquidity,
      pairability_score: pairability,
      persistence_hot_count: hotCount,
      freshness_known: tsMs != null,
    },
  };
}

// ─── DISPLAY ──────────────────────────────────────────────────────────────────

function printTop(rows) {
  console.log('\n═'.repeat(110));
  console.log(` AllMight — Discovery Ranker v1 | chain=${CHAIN} | top=${Math.min(TOP_N, rows.length)}`);
  console.log('═'.repeat(110));
  console.log(
    'score'.padEnd(8) +
    'pair'.padEnd(14) +
    'venue'.padEnd(16) +
    'liqUSD'.padEnd(12) +
    'volUSD'.padEnd(12) +
    'quoteFam'.padEnd(22) +
    'why'
  );
  console.log('-'.repeat(110));

  for (const row of rows.slice(0, TOP_N)) {
    const why = (row.why || []).slice(0, 2).join('; ');
    console.log(
      String(row.score ?? 0).padEnd(8) +
      String(row.pair || '').padEnd(14) +
      String(row.venue || '').padEnd(16) +
      String(row.liquidityUSD != null ? Math.round(row.liquidityUSD) : '—').padEnd(12) +
      String(row.volumeUSD != null ? Math.round(row.volumeUSD) : '—').padEnd(12) +
      String(row.quoteFamily || '').padEnd(22) +
      why
    );
  }
  console.log('-'.repeat(110));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function run() {
  const fetcherKey = FETCHER_KEY_BY_CHAIN[CHAIN];
  if (!fetcherKey) {
    await redis.quit().catch(() => {});
    throw new Error(`unsupported chain: ${CHAIN}`);
  }

  try {
    const raw = await redis.get(fetcherKey);
    if (!raw) {
      throw new Error(`missing redis key: ${fetcherKey}`);
    }

    const parsed = JSON.parse(raw);
    // Redis payload shape (written by master-fetcher):
    //   { ok, name, durationMs, timestamp, data: <arbitrumFetcher return> }
    // arbitrumFetcher return shape:
    //   { status, partial, data: { prices: [...], chain, ... } }
    // Full path to price rows: parsed.data.data.prices
    // Fallback: parsed.data.prices  (direct fetcher writes, if any)
    // Fallback: parsed              (bare array, not expected but defensive)
    const rows =
      Array.isArray(parsed?.data?.data?.prices) ? parsed.data.data.prices :
      Array.isArray(parsed?.data?.prices)        ? parsed.data.prices :
      Array.isArray(parsed?.data)                ? parsed.data :
      Array.isArray(parsed)                      ? parsed :
      [];

    const normalized = rows.map(row => normalizeRow(CHAIN, row));
    const compatibilityIndex = buildCompatibilityIndex(normalized);
    const state = await loadState();

    const ranked = [];
    const nextState = { ...state };

    for (const row of normalized) {
      const prior = nextState[row.surfaceKey] || null;
      const result = scoreCandidate(row, compatibilityIndex, prior);

      if (result.stateEntry) {
        nextState[row.surfaceKey] = {
          ...prior,
          ...result.stateEntry,
          updatedAt: nowIso(),
        };
      }

      if (result.candidate && !cooldownActive(prior)) {
        nextState[row.surfaceKey] = {
          ...(nextState[row.surfaceKey] || {}),
          lastPromotedAt: nowMs(),
        };
      }

      ranked.push({
        surfaceKey: row.surfaceKey,
        chain: row.chain,
        venue: row.venue,
        poolId: row.poolId,
        pair: row.pair,
        base: row.base,
        quote: row.quote,
        quoteFamily: row.quoteFamily,
        priceNow: row.priceNow,
        liquidityUSD: row.liquidityUSD,
        volumeUSD: row.volumeUSD,
        blockNumber: row.blockNumber,
        timestamp: row.timestamp,
        candidate: result.candidate,
        score: result.score,
        signals: result.signalSummary || {},
        penalties: result.penalties,
        why: result.reasons,
        hardReject: result.hardReject,
        hardRejectReason: result.hardRejectReason,
      });
    }

    const sorted = sortDeterministic(ranked);
    const top = sorted.slice(0, TOP_N);

    await redis.set(RANKED_KEY, JSON.stringify(top, null, 2));
    await saveState(nextState);

    if (JSON_OUT) {
      process.stdout.write(JSON.stringify({
        generatedAt: nowIso(),
        chain: CHAIN,
        sourceKey: fetcherKey,
        count: top.length,
        candidates: top,
      }, null, 2));
      return;
    }

    if (!QUIET) {
      printTop(top);
      console.log(`\n[ranker] wrote ${top.length} candidates → ${RANKED_KEY}`);
    }

    return {
      generatedAt: nowIso(),
      chain: CHAIN,
      sourceKey: fetcherKey,
      count: top.length,
      candidates: top,
    };
  } finally {
    // Always close the Redis connection so Node.js exits cleanly.
    // Without this the ioredis singleton keeps the event loop alive indefinitely.
    await redis.quit().catch(() => {});
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(`[discovery_ranker] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { run };
