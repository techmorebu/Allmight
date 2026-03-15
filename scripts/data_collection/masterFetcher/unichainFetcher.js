// unichainFetcher.js
// Unichain mainnet fetcher — hardened template placeholder
// Current truth:
// - provider path normalized via provider_factory
// - no direct provider / no fixed sleeps
// - no active pool list yet
// - ready for future Uniswap V4 / verified pool integration

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('unichain');

const CHAIN_ID = 'unichain';
const CHAIN_NUM = 130;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.UNICHAIN_FETCHER_CONCURRENCY || 4)
);

const POOL_ABI_V3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// Unichain notes:
// - current working V3 pool list is not yet validated
// - chain appears to center around Uniswap V4 style infra
// - keep V3 support scaffolded, but do not fake active pools
const UNISWAP_V3_POOLS = [];

function nowIso() {
  return new Date().toISOString();
}

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
  const Q96 = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
  const raw = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
  return mode === 'invert' ? 1 / raw : raw;
}

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let idx = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const cur = idx++;
      if (cur >= items.length) break;
      out[cur] = await worker(items[cur], cur);
    }
  });

  await Promise.all(runners);
  return out;
}

async function fetchUniV3Pool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `unichain.univ3.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, provider);
        const [slot0, liq] = await Promise.all([
          c.slot0({ blockTag: blockNumber }),
          c.liquidity({ blockTag: blockNumber }),
        ]);
        return { slot0, liq };
      },
      { timeoutMs: 1500, hedge: true }
    );

    const price = sqrtPriceX96ToPrice(
      result.slot0[0],
      cfg.decimals0,
      cfg.decimals1,
      cfg.priceMode
    );

    if (!isFinite(price) || price <= 0 || price > 1e15) {
      throw new Error(`invalid price ${price}`);
    }

    const liqNum = Number(result.liq);
    const liquidityRaw = result.liq.toString();

    return {
      ok: true,
      price: {
        pair: cfg.outputPair,
        pool: cfg.pool,
        price,
        liquidity: liqNum,
        liquidityRaw,
        tvlUSD: null,
        fee: cfg.fee / 1_000_000,
        tick: Number(result.slot0[1]),
        source: 'uniswap_v3_unichain_onchain',
        venue: 'uniswap_v3',
        chain: CHAIN_ID,
        blockNumber,
        endpointId: meta.endpointId,
        endpoint: meta.urlRedacted,
        timestamp: nowIso(),
      },
    };
  } catch (e) {
    return {
      ok: false,
      venue: 'uniswap_v3',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

async function unichainFetcher() {
  const startedAt = Date.now();
  const startedIso = nowIso();

  // No verified active pools yet: return a clean structured idle-success result.
  // This keeps the master fetcher stable while preserving the truth.
  if (UNISWAP_V3_POOLS.length === 0) {
    return {
      status: 'success',
      partial: false,
      data: {
        prices: [],
        chain: CHAIN_ID,
        chain_id: CHAIN_NUM,
        venues: ['uniswap_v3'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: 0,
          successCount: 0,
          failureCount: 0,
          uniswapV3: {
            total: 0,
            success: 0,
            failed: 0,
          },
        },
        failures: [],
        note: 'No verified Unichain pools configured yet. V4 / validated pool integration pending.',
      },
    };
  }

  let blockNumber = null;
  let blockMeta = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'unichain.fetcher.block',
      { timeoutMs: 1200, hedge: true }
    );
    blockNumber = blockResp.blockNumber;
    blockMeta = blockResp.meta;
  } catch (e) {
    return {
      status: 'error',
      partial: false,
      data: {
        prices: [],
        chain: CHAIN_ID,
        chain_id: CHAIN_NUM,
        venues: ['uniswap_v3'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: UNISWAP_V3_POOLS.length,
          successCount: 0,
          failureCount: UNISWAP_V3_POOLS.length,
          uniswapV3: {
            total: UNISWAP_V3_POOLS.length,
            success: 0,
            failed: UNISWAP_V3_POOLS.length,
          },
        },
        failures: [
          {
            venue: 'block_fetch',
            pair: 'n/a',
            pool: 'n/a',
            error: String(e.message || e).slice(0, 160),
          },
        ],
      },
    };
  }

  const uniResults = await mapWithConcurrency(
    UNISWAP_V3_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchUniV3Pool(cfg, blockNumber)
  );

  const combined = [...uniResults];

  const priceRows = combined
    .filter((x) => x && x.ok && x.price)
    .map((x) => x.price);

  const failures = combined
    .filter((x) => !x || !x.ok)
    .map((x) => ({
      venue: x?.venue || 'unknown',
      pair: x?.pair || 'unknown',
      pool: x?.pool || 'unknown',
      error: x?.error || 'unknown error',
    }));

  const durationMs = Date.now() - startedAt;
  const endpointIdsSeen = [...new Set(priceRows.map((p) => p.endpointId).filter((v) => v !== undefined))];
  const endpointsSeen = [...new Set(priceRows.map((p) => p.endpoint).filter(Boolean))];

  const successCount = priceRows.length;
  const failureCount = failures.length;

  const status =
    successCount === 0 ? 'error' :
    failureCount > 0 ? 'partial' :
    'success';

  return {
    status,
    partial: status === 'partial',
    data: {
      prices: priceRows,
      chain: CHAIN_ID,
      chain_id: CHAIN_NUM,
      venues: ['uniswap_v3'],
      timestamp: startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId: blockMeta?.endpointId ?? null,
      endpoint: blockMeta?.urlRedacted ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools: UNISWAP_V3_POOLS.length,
        successCount,
        failureCount,
        uniswapV3: {
          total: UNISWAP_V3_POOLS.length,
          success: uniResults.filter((x) => x && x.ok).length,
          failed: uniResults.filter((x) => !x || !x.ok).length,
        },
      },
      failures,
    },
  };
}

if (require.main === module) {
  unichainFetcher()
    .then((result) => {
      console.log('\nUNICHAIN ON-CHAIN DATA:');
      console.log('='.repeat(90));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} endpoint=${result.data.endpoint} ` +
        `epSeen=${(result.data.endpointIdsSeen || []).join(',') || 'n/a'} ` +
        `duration=${result.data.durationMs}ms success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );

      if (result.data.note) {
        console.log(result.data.note);
      }

      result.data.prices.forEach((p) => {
        const tvl = (p.tvlUSD || p.reserveUSD)
          ? `$${((p.tvlUSD || p.reserveUSD) / 1000).toFixed(1)}k`
          : 'n/a';
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);

        console.log(
          `${p.venue.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | ` +
          `TVL: ${tvl.padStart(10)} | fee: ${feePct} | ep:${String(p.endpointId).padStart(2)}`
        );
      });

      if (result.data.failures.length) {
        console.log('-'.repeat(90));
        console.log('FAILURES:');
        result.data.failures.forEach((f) => {
          console.log(
            `${f.venue.padEnd(12)} ${String(f.pair).padEnd(14)} ${f.pool} :: ${f.error}`
          );
        });
      }

      console.log('='.repeat(90));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

unichainFetcher.chain = 'unichain';

module.exports = unichainFetcher;
