// arbitrumFetcher.js
// Arbitrum mainnet fetcher — Uniswap V3 + Camelot V2
// Hardened speed-template version with success/partial/error status semantics

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('arbitrum');

const CHAIN_ID = 'arbitrum';
const CHAIN_NUM = 42161;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ARBITRUM_FETCHER_CONCURRENCY || 4)
);

const POOL_ABI_V3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

const PAIR_ABI_V2 = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

const UNISWAP_V3_POOLS = [
  { outputPair: 'ETH/USDC',   pool: '0xC6962004f452bE9203591991D15f6b388e09E8D0', decimals0: 18, decimals1: 6, fee: 500,  priceMode: 'direct' },
  { outputPair: 'ETH/USDT',   pool: '0x641C00A822e8b671738d32a431a4Fb6074E5c79d', decimals0: 18, decimals1: 6, fee: 500,  priceMode: 'direct' },
  { outputPair: 'USDC/USDT',  pool: '0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6', decimals0: 6,  decimals1: 6, fee: 100,  priceMode: 'direct' },
  { outputPair: 'USDC/USDCe', pool: '0x8e295789c9465487074a65b1ae9Ce0351172393f', decimals0: 6,  decimals1: 6, fee: 100,  priceMode: 'direct' },
  { outputPair: 'DAI/USDT',   pool: '0x7f580f8A02b759C350E6b8340e7c2d4b8162b6a9', decimals0: 18, decimals1: 6, fee: 100,  priceMode: 'direct' },
  { outputPair: 'USDC/USDT',  pool: '0xbcE73c2e5A623054B0e8e2428E956f4b9d0412a5', decimals0: 6,  decimals1: 6, fee: 500,  priceMode: 'direct' },
  { outputPair: 'USDC/USDCe', pool: '0xA9E9CB16E922892Aa563a5aDb0f7D976EFCe36FB', decimals0: 6,  decimals1: 6, fee: 500,  priceMode: 'direct' },
];

const CAMELOT_POOLS = [
  { outputPair: 'ETH/USDC', pool: '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27', decimals0: 18, decimals1: 6, fee: 0.003, priceMode: 'direct' },
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
      `arb.univ3.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
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

    const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
    if (isStable && (price < 0.9 || price > 1.1)) {
      throw new Error(`stable price out of range ${price}`);
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
        source: 'uniswap_v3_arbitrum_onchain',
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

async function fetchCamelotPool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `arb.camelot.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, PAIR_ABI_V2, provider);
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

    const reserveUSD = cfg.outputPair === 'ETH/USDC'
      ? adj1 * 2
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
        source: 'camelot_v2_arbitrum_onchain',
        venue: 'camelot_v2',
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
      venue: 'camelot_v2',
      pair: cfg.outputPair,
      pool: cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

async function arbitrumFetcher() {
  const startedAt = Date.now();
  const startedIso = nowIso();

  let blockNumber = null;
  let blockMeta = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'arbitrum.fetcher.block',
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
        venues: ['uniswap_v3', 'camelot_v2'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: UNISWAP_V3_POOLS.length + CAMELOT_POOLS.length,
          successCount: 0,
          failureCount: UNISWAP_V3_POOLS.length + CAMELOT_POOLS.length,
          uniswapV3: {
            total: UNISWAP_V3_POOLS.length,
            success: 0,
            failed: UNISWAP_V3_POOLS.length,
          },
          camelot: {
            total: CAMELOT_POOLS.length,
            success: 0,
            failed: CAMELOT_POOLS.length,
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

  const camelotResults = await mapWithConcurrency(
    CAMELOT_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchCamelotPool(cfg, blockNumber)
  );

  const combined = [...uniResults, ...camelotResults];

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
      venues: ['uniswap_v3', 'camelot_v2'],
      timestamp: startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId: blockMeta?.endpointId ?? null,
      endpoint: blockMeta?.urlRedacted ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools: UNISWAP_V3_POOLS.length + CAMELOT_POOLS.length,
        successCount,
        failureCount,
        uniswapV3: {
          total: UNISWAP_V3_POOLS.length,
          success: uniResults.filter((x) => x && x.ok).length,
          failed: uniResults.filter((x) => !x || !x.ok).length,
        },
        camelot: {
          total: CAMELOT_POOLS.length,
          success: camelotResults.filter((x) => x && x.ok).length,
          failed: camelotResults.filter((x) => !x || !x.ok).length,
        },
      },
      failures,
    },
  };
}

if (require.main === module) {
  arbitrumFetcher()
    .then((result) => {
      console.log('\nARBITRUM ON-CHAIN DATA:');
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

arbitrumFetcher.chain = 'arbitrum';

module.exports = arbitrumFetcher;
