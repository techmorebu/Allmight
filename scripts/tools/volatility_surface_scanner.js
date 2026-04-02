// volatility_surface_scanner.js
// PURPOSE:
// Rank pools by volatility + flow + stability BEFORE validation

const redis = require("../../utils/redis-client");

const CONFIG = {
  MIN_LIQUIDITY_USD: 10000,
  MIN_TX_60M: 20,
  MIN_MOVE_BPS: 15,
  MIN_VOL_EXPANSION: 1.4,
  MAX_LIQ_DROP: 0.25,
  PERSISTENCE_REQUIRED: 2,
  COOLDOWN_MS: 15 * 60 * 1000,
  TOP_N: 20
};

// simple in-memory state (upgrade to Redis later if needed)
const stateCache = new Map();

function now() {
  return Date.now();
}

function computeSignals(pool) {
  const {
    priceNow,
    price5m,
    price15m,
    volumeUSD,
    liquidityUSD,
    txCount60m,
    liquidityChange15m
  } = pool;

  const moveBps = Math.abs((priceNow - price15m) / price15m) * 10000;

  const volExpansion = price5m
    ? Math.abs((priceNow - price5m) / price5m)
    : 0;

  const txDensity = txCount60m / 60;
  const flowEfficiency = volumeUSD / Math.max(liquidityUSD, 1);

  return {
    moveBps,
    volExpansion,
    txDensity,
    flowEfficiency,
    liquidityUSD,
    liquidityChange15m
  };
}

function passesGates(s) {
  return (
    s.liquidityUSD >= CONFIG.MIN_LIQUIDITY_USD &&
    s.txDensity * 60 >= CONFIG.MIN_TX_60M &&
    s.moveBps >= CONFIG.MIN_MOVE_BPS &&
    s.volExpansion >= CONFIG.MIN_VOL_EXPANSION &&
    s.liquidityChange15m <= CONFIG.MAX_LIQ_DROP
  );
}

function computeScore(s) {
  return (
    0.3 * s.volExpansion +
    0.25 * (s.moveBps / 100) +
    0.2 * s.txDensity +
    0.15 * s.flowEfficiency +
    0.1 * (1 - s.liquidityChange15m)
  );
}

function updatePersistence(key, passed) {
  const entry = stateCache.get(key) || { count: 0, last: 0 };

  if (passed) {
    entry.count += 1;
  } else {
    entry.count = 0;
  }

  entry.last = now();
  stateCache.set(key, entry);

  return entry.count;
}

function isCoolingDown(key) {
  const entry = stateCache.get(key);
  if (!entry) return false;
  return now() - entry.last < CONFIG.COOLDOWN_MS;
}

async function run() {
  const raw = await redis.get("fetcher:arbitrumFetcher");
  if (!raw) {
    console.log("No data in Redis");
    return;
  }

  const pools = JSON.parse(raw);
  const candidates = [];

  for (const pool of pools) {
    const key = pool.poolId || pool.address;

    const signals = computeSignals(pool);
    const passed = passesGates(signals);

    const persistence = updatePersistence(key, passed);

    if (!passed) continue;
    if (persistence < CONFIG.PERSISTENCE_REQUIRED) continue;
    if (isCoolingDown(key)) continue;

    const score = computeScore(signals);

    candidates.push({
      key,
      score,
      signals,
      ts: new Date().toISOString()
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const top = candidates.slice(0, CONFIG.TOP_N);

  await redis.set(
    "discovery:volatility_candidates:arbitrum",
    JSON.stringify(top)
  );

  console.log(`Volatility scanner: ${top.length} candidates stored`);
}

if (require.main === module) {
  run().catch(console.error);
}

module.exports = { run };
