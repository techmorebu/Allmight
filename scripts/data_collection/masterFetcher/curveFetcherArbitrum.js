// curveFetcherArbitrum.js
// Arbitrum Curve fetcher — hardened speed-template version
// Covers:
// - USDC/USDT 2pool
// - tricrypto (USDT/WBTC/ETH) via ETH oracle path

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('arbitrum');

const CHAIN_ID = 'arbitrum';
const CHAIN_NUM = 42161;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ARBITRUM_CURVE_FETCHER_CONCURRENCY || 2)
);

const CURVE_2POOL_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)',
  'function fee() external view returns (uint256)',
];

const CURVE_TRICRYPTO_ABI = [
  'function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)',
  'function fee() external view returns (uint256)',
  'function price_oracle(uint256 k) external view returns (uint256)',
];

const CURVE_POOLS = [
  {
    name: 'USDC/USDT 2pool',
    outputPair: 'USDC/USDT',
    pool: '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
    type: '2pool',
    coin0dec: 6,
    coin1dec: 6,
    i: 0,
    j: 1,
    dx: 1000n * 1000000n,
  },
  {
    name: 'tricrypto (USDT/WBTC/ETH)',
    outputPair: 'ETH/USDT',
    pool: '0x960ea3e3C7FB317332d990873d354E18d7645590',
    type: 'tricrypto',
    coin0dec: 6,
    coin1dec: 18,
    i: 0,
    j: 2,
    dx: 1000n * 1000000n,
  },
];

function nowIso() {
  return new Date().toISOString();
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

async function fetchCurve2Pool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `arb.curve.2pool.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, provider);
        const [dy, fee, bal0, bal1] = await Promise.all([
          c.get_dy(cfg.i, cfg.j, cfg.dx, { blockTag: blockNumber }),
          c.fee({ blockTag: blockNumber }),
          c.balances(0, { blockTag: blockNumber }),
          c.balances(1, { blockTag: blockNumber }),
        ]);
        return { dy, fee, bal0, bal1 };
      },
      { timeoutMs: 1500, hedge: true }
    );

    const dxHuman = Number(cfg.dx) / Math.pow(10, cfg.coin0dec);
    const dyHuman = Number(result.dy) / Math.pow(10, cfg.coin1dec);
    const price = dyHuman / dxHuman;

    const feeBps = Number(result.fee) / 1e10 * 10000;

    if (!isFinite(price) || price <= 0) {
      throw new Error(`invalid price ${price}`);
    }

    if (price < 0.9 || price > 1.1) {
      throw new Error(`stable price out of range ${price}`);
    }

    const tvlUSD =
      (Number(result.bal0) / Math.pow(10, cfg.coin0dec)) +
      (Number(result.bal1) / Math.pow(10, cfg.coin1dec));

    return {
      ok: true,
      price: {
        pair: cfg.outputPair,
        pool: cfg.pool,
        price,
        fee: feeBps / 10000,
        fee_bps: feeBps,
        tvlUSD,
        source: 'curve_arbitrum_onchain',
        venue: 'curve',
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
      venue: 'curve',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

async function fetchCurveTricrypto(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `arb.curve.tricrypto.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, CURVE_TRICRYPTO_ABI, provider);
        const [oracle, fee, bal0] = await Promise.all([
          c.price_oracle(1, { blockTag: blockNumber }),
          c.fee({ blockTag: blockNumber }),
          c.balances(0, { blockTag: blockNumber }),
        ]);
        return { oracle, fee, bal0 };
      },
      { timeoutMs: 1500, hedge: true }
    );

    const price = Number(result.oracle) / 1e18;
    const feeBps = Number(result.fee) / 1e10 * 10000;

    if (!isFinite(price) || price < 100 || price > 100000) {
      throw new Error(`ETH price out of range ${price}`);
    }

    const tvlUSD = (Number(result.bal0) / 1e6) * 2;

    return {
      ok: true,
      price: {
        pair: cfg.outputPair,
        pool: cfg.pool,
        price,
        fee: feeBps / 10000,
        fee_bps: feeBps,
        tvlUSD,
        source: 'curve_arbitrum_onchain',
        venue: 'curve',
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
      venue: 'curve',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

async function curveFetcherArbitrum() {
  const startedAt = Date.now();
  const startedIso = nowIso();

  let blockNumber = null;
  let blockMeta = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'arbitrum.curve.fetcher.block',
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
        venues: ['curve'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: CURVE_POOLS.length,
          successCount: 0,
          failureCount: CURVE_POOLS.length,
          curve: {
            total: CURVE_POOLS.length,
            success: 0,
            failed: CURVE_POOLS.length,
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

  const results = await mapWithConcurrency(
    CURVE_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => cfg.type === 'tricrypto'
      ? fetchCurveTricrypto(cfg, blockNumber)
      : fetchCurve2Pool(cfg, blockNumber)
  );

  const priceRows = results
    .filter((x) => x && x.ok && x.price)
    .map((x) => x.price);

  const failures = results
    .filter((x) => !x || !x.ok)
    .map((x) => ({
      venue: x?.venue || 'curve',
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
      venues: ['curve'],
      timestamp: startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId: blockMeta?.endpointId ?? null,
      endpoint: blockMeta?.urlRedacted ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools: CURVE_POOLS.length,
        successCount,
        failureCount,
        curve: {
          total: CURVE_POOLS.length,
          success: results.filter((x) => x && x.ok).length,
          failed: results.filter((x) => !x || !x.ok).length,
        },
      },
      failures,
    },
  };
}

if (require.main === module) {
  curveFetcherArbitrum()
    .then((result) => {
      console.log('\nCURVE ARBITRUM DATA:');
      console.log('='.repeat(90));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} endpoint=${result.data.endpoint} ` +
        `epSeen=${(result.data.endpointIdsSeen || []).join(',') || 'n/a'} ` +
        `duration=${result.data.durationMs}ms success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );

      result.data.prices.forEach((p) => {
        const tvl = p.tvlUSD ? `$${(p.tvlUSD / 1000).toFixed(1)}k` : 'n/a';
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px = p.price > 10 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);

        console.log(
          `${'curve'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | ` +
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

curveFetcherArbitrum.chain = 'arbitrum';

module.exports = curveFetcherArbitrum;
