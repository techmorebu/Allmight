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
  // ── Phase 1 Re-entry (2026-03-18) ────────────────────────────────────────
  // Validated via arb_pool_smoke_test.js before re-entry.
  // Root cause of prior removal: Ethereum mainnet token0/token1 sort assumptions
  // were applied to Arbitrum pools. On Arbitrum, WETH (0x82aF..) sorts LOWER
  // than USDC (0xaf88..) — opposite of mainnet — so token0=WETH, token1=USDC.
  // All three pools confirmed live with slot0+liquidity responding and sane pricing.
  //
  // IMPORTANT: decimals0/decimals1 reflect ACTUAL on-chain token0/token1 ordering.
  // priceMode: 'direct' → price = sqrtP^2 × 10^(dec0-dec1)
  //   ETH/USDC direct: USDC per WETH → ~$2300 ✓
  //   ETH/USDT direct: USDT per WETH → ~$2300 ✓
  //   USDC/USDT direct: USDT per USDC → ~1.000 ✓
  //
  // sanityMin/sanityMax: per-pool price guard — catches silent wrong-pricing
  // if token ordering is ever misconfigured again.

  // ETH/USDC — on-chain token0=WETH (18dec), token1=USDC (6dec)
  {
    outputPair: 'ETH/USDC',
    pool:       '0xC6962004f452bE9203591991D15f6b388e09E8D0',
    decimals0:  18,
    decimals1:  6,
    fee:        500,
    priceMode:  'direct',
    sanityMin:  500,
    sanityMax:  20000,
  },

  // ETH/USDT — on-chain token0=WETH (18dec), token1=USDT (6dec)
  {
    outputPair: 'ETH/USDT',
    pool:       '0x641C00A822e8b671738d32a431a4Fb6074E5c79d',
    decimals0:  18,
    decimals1:  6,
    fee:        500,
    priceMode:  'direct',
    sanityMin:  500,
    sanityMax:  20000,
  },

  // USDC/USDT — on-chain token0=USDC (6dec), token1=USDT (6dec)
  {
    outputPair: 'USDC/USDT',
    pool:       '0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6',
    decimals0:  6,
    decimals1:  6,
    fee:        100,
    priceMode:  'direct',
    sanityMin:  0.9,
    sanityMax:  1.1,
  },

  // ── Phase 2A Addition (2026-03-18) ───────────────────────────────────────
  // Validated via arb_pool_smoke_test_p2.js before re-entry.
  // Both pools confirmed live with slot0+liquidity responding and sane pricing.
  // expectedToken0/expectedToken1 are stored for future runtime cross-check tooling.

  // ARB/WETH — on-chain token0=WETH (18dec), token1=ARB (18dec)
  // priceMode 'invert' → WETH per ARB ≈ 0.000046
  // Purpose: enables synthetic ARB/USD via ARB/WETH × ETH/USD legs
  {
    outputPair:     'ARB/WETH',
    pool:           '0xc6f780497a95e246eb9449f5e4770916dcd6396a',
    decimals0:      18,
    decimals1:      18,
    fee:            500,
    priceMode:      'invert',
    sanityMin:      0.000005,
    sanityMax:      0.01,
    expectedToken0: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',  // WETH
    expectedToken1: '0x912CE59144191C1204E64559FE8253a0e49E6548',  // ARB
  },

  // WBTC/USDT — on-chain token0=WBTC (8dec), token1=USDT (6dec)
  // priceMode 'direct' → USDT per WBTC ≈ $70k-$90k
  // Token ordering SAME as Ethereum mainnet — no chain-specific surprise
  {
    outputPair:     'WBTC/USDT',
    pool:           '0x5969efdde3cf5c0d9a88ae51e47d721096a97203',
    decimals0:      8,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      20000,
    sanityMax:      200000,
    expectedToken0: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',  // WBTC
    expectedToken1: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',  // USDT
  },

  // ── Phase 2B Addition (2026-03-19) ───────────────────────────────────────
  // ARB/nativeUSDC — validated via factory query + on-chain smoke test.
  // token1 confirmed as Circle native USDC (0xaf88..), NOT USDCe (0xFF97..).
  // Factory: getPool(ARB, nativeUSDC, 500) = 0xb0f6cA40...
  // Purpose: direct ARB/USD surface for comparison against synthetic
  //          ARB/WETH x ETH/USDC and ARB/WETH x ETH/USDT legs.
  // Single-read direct-vs-synthetic gap observed ~1.1% — warrants persistence test.

  // ARB/USDC — on-chain token0=ARB (18dec), token1=nativeUSDC (6dec)
  {
    outputPair:     "ARB/USDC",
    pool:           "0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8",
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      "direct",
    sanityMin:      0.01,
    sanityMax:      20,
    expectedToken0: "0x912CE59144191C1204E64559FE8253a0e49E6548",  // ARB
    expectedToken1: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // native USDC
  },

  // ── Deferred pools ────────────────────────────────────────────────────────
  // ARB/USDCe  0xcda53b1f... — DEFERRED: quote asset is USDCe (bridged/deprecated).
  //   Identity confirmed by factory query 2026-03-19. Not native USDC.

  // ── Permanently retired pools (confirmed non-recoverable) ─────────────────
  // USDC/USDCe 0xfe8e29...  — CALL_EXCEPTION, USDCe deprecated
  // USDC/USDCe 0xA9E9CB...  — CALL_EXCEPTION, USDCe deprecated
  // USDC/USDT  0xbcE73c...  — dead, superseded by 0.01% pool above
  // DAI/USDT   0x7f580f...  — CALL_EXCEPTION
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
      { timeoutMs: cfg.timeoutMs || 1500, hedge: true }
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

    // Per-pool sanity guard (Boss directive 2026-03-18):
    // Catches silent wrong-pricing from token order misconfig before it
    // reaches Redis. sanityMin/sanityMax are set per pool at config entry.
    if (cfg.sanityMin !== undefined && cfg.sanityMax !== undefined) {
      if (price < cfg.sanityMin || price > cfg.sanityMax) {
        throw new Error(
          `[TOKEN-ORDER-GUARD] price ${price.toFixed(4)} outside expected range ` +
          `[${cfg.sanityMin}, ${cfg.sanityMax}] for ${cfg.outputPair} — ` +
          `check decimals0/decimals1 and priceMode against on-chain token0/token1`
        );
      }
    }

    // Legacy stable-pair fallback guard (pools without explicit sanity bounds)
    const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
    if (isStable && cfg.sanityMin === undefined && (price < 0.9 || price > 1.1)) {
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
