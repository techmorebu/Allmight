// optimismFetcher.js
// Optimism mainnet fetcher — Uniswap V3 + Velodrome V2
// Hardened speed-template version with success/partial/error status semantics

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('optimism');

const CHAIN_ID = 'optimism';
const CHAIN_NUM = 10;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.OPTIMISM_FETCHER_CONCURRENCY || 4)
);

const POOL_ABI_V3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

const VELO_ABI = [
  'function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256)',
  'function totalSupply() external view returns (uint256)',
];

const UNISWAP_V3_POOLS = [
  {
    outputPair: 'ETH/USDC',
    pool: '0x1fb3cf6e48F1E7B10213E7b6d87D4c073C7Fdb7b',
    decimals0: 6,
    decimals1: 18,
    fee: 500,
    priceMode: 'invert',
  },
  {
    outputPair: 'ETH/USDC',
    pool: '0x85149247691df622eaF1a8Bd0CaFd40BC45154a9',
    decimals0: 18,
    decimals1: 6,
    fee: 500,
    priceMode: 'direct',
  },
  {
    outputPair: 'ETH/USDC',
    pool: '0xB589969D38CE76D3d7AA319De7133bC9755fD840',
    decimals0: 18,
    decimals1: 6,
    fee: 3000,
    priceMode: 'direct',
  },
];

const VELODROME_POOLS = [
  {
    outputPair: 'ETH/USDC',
    pool: '0x79c912FEF520be002c2B6e57EC4324e260f38E50',
    decimals0: 18,
    decimals1: 6,
    fee: 0.002,
    stable: false,
    priceMode: 'direct',
  },
];

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
      `op.univ3.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
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
        source: 'uniswap_v3_optimism_onchain',
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

async function fetchVelodromePool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `op.velodrome.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, VELO_ABI, provider);
        const reserves = await c.getReserves({ blockTag: blockNumber });
        return { reserves };
      },
      { timeoutMs: 1500, hedge: true }
    );

    const r0b = result.reserves[0];
    const r1b = result.reserves[1];

    if (r0b === 0n || r1b === 0n) {
      throw new Error('zero reserves');
    }

    const PREC = 1000000000n;
    const SCALE0 = BigInt('1' + '0'.repeat(cfg.decimals0));
    const SCALE1 = BigInt('1' + '0'.repeat(cfg.decimals1));
    const adj0 = Number((r0b * PREC) / SCALE0) / 1e9;
    const adj1 = Number((r1b * PREC) / SCALE1) / 1e9;

    if (!adj0 || !adj1) {
      throw new Error('adjusted reserves invalid');
    }

    const raw = adj1 / adj0;
    const price = cfg.priceMode === 'invert' ? 1 / raw : raw;

    if (!isFinite(price) || price <= 0 || price > 1e12) {
      throw new Error(`invalid price ${price}`);
    }

    if (cfg.stable && (price < 0.9 || price > 1.1)) {
      throw new Error(`stable price out of range ${price}`);
    }

    const reserveUSD = cfg.outputPair === 'ETH/USDC'
      ? adj1 * 2
      : cfg.stable
        ? (adj0 + adj1)
        : adj1 * price * 2;

    return {
      ok: true,
      price: {
        pair: cfg.outputPair,
        pool: cfg.pool,
        price,
        reserve0: r0b.toString(),
        reserve1: r1b.toString(),
        reserveUSD,
        fee: cfg.fee,
        stable: cfg.stable,
        source: 'velodrome_optimism_onchain',
        venue: 'velodrome',
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
      venue: 'velodrome',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

async function optimismFetcher() {
  const startedAt = Date.now();
  const startedIso = nowIso();

  let blockNumber = null;
  let blockMeta = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'optimism.fetcher.block',
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
        venues: ['uniswap_v3', 'velodrome'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: UNISWAP_V3_POOLS.length + VELODROME_POOLS.length,
          successCount: 0,
          failureCount: UNISWAP_V3_POOLS.length + VELODROME_POOLS.length,
          uniswapV3: {
            total: UNISWAP_V3_POOLS.length,
            success: 0,
            failed: UNISWAP_V3_POOLS.length,
          },
          velodrome: {
            total: VELODROME_POOLS.length,
            success: 0,
            failed: VELODROME_POOLS.length,
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

  const veloResults = await mapWithConcurrency(
    VELODROME_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchVelodromePool(cfg, blockNumber)
  );

  const combined = [...uniResults, ...veloResults];

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
      venues: ['uniswap_v3', 'velodrome'],
      timestamp: startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId: blockMeta?.endpointId ?? null,
      endpoint: blockMeta?.urlRedacted ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools: UNISWAP_V3_POOLS.length + VELODROME_POOLS.length,
        successCount,
        failureCount,
        uniswapV3: {
          total: UNISWAP_V3_POOLS.length,
          success: uniResults.filter((x) => x && x.ok).length,
          failed: uniResults.filter((x) => !x || !x.ok).length,
        },
        velodrome: {
          total: VELODROME_POOLS.length,
          success: veloResults.filter((x) => x && x.ok).length,
          failed: veloResults.filter((x) => !x || !x.ok).length,
        },
      },
      failures,
    },
  };
}

if (require.main === module) {
  optimismFetcher()
    .then((result) => {
      console.log('\nOPTIMISM ON-CHAIN DATA:');
      console.log('='.repeat(90));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} endpoint=${result.data.endpoint} ` +
        `epSeen=${(result.data.endpointIdsSeen || []).join(',') || 'n/a'} ` +
        `duration=${result.data.durationMs}ms success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );

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

optimismFetcher.chain = 'optimism';

module.exports = optimismFetcher;
