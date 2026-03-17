// scripts/data_collection/masterFetcher/uniswapV3Fetcher.js
// Uniswap V3 Ethereum mainnet fetcher
// Hardened speed-template version with success/partial/error status semantics
//
// Migration history:
//   v2.0 — createProvider('ethereum'), serial loop, chain tag, token_registry
//   v2.1 — FETCH_DELAY_MS serial sleep added, slot0+liquidity batched under one rpc.call()
//   v3.0 — Full hardened template: callDetailed, block anchoring, mapWithConcurrency,
//           uniform envelope (status/partial/stats/failures/endpointIdsSeen),
//           decimals baked into pool config (no token_registry RPC dependency),
//           correct on-chain token ordering with explicit priceMode per pool

'use strict';
require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('ethereum');

const CHAIN_ID  = 'ethereum';
const CHAIN_NUM = 1;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ETH_FETCHER_CONCURRENCY || 2)   // conservative — Ethereum RPC is rate-sensitive
);

// ── ABI ───────────────────────────────────────────────────────────────────────

const POOL_ABI_V3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
];

// ── Pool configs ──────────────────────────────────────────────────────────────
//
// decimals0 / decimals1 reflect the ACTUAL on-chain token ordering (lower
// address = token0 in Uniswap V3). They are NOT the "named" order shown in
// the outputPair label.
//
// fee is the Uniswap V3 raw fee tier in bps (500 = 0.05%, 3000 = 0.3%, 100 = 0.01%).
// The output row stores fee / 1_000_000 as a decimal fraction.
//
// priceMode:
//   'direct' → price = sqrtP^2 * 10^(dec0-dec1)   (token1 per token0, human units)
//   'invert' → price = 1 / above                   (token0 per token1, human units)
//
// ETH/USDC pools: on-chain token0=USDC(0xA0b..) token1=WETH(0xC02..)
//   direct → WETH per USDC (tiny).  invert → USDC per WETH (ETH price in USD) ✓

const UNISWAP_V3_POOLS = [
  // ETH / USDC
  { outputPair: 'ETH/USDC',  pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640', decimals0: 6,  decimals1: 18, fee: 500,  priceMode: 'invert'  }, // 0.05%
  { outputPair: 'ETH/USDC',  pool: '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8', decimals0: 6,  decimals1: 18, fee: 3000, priceMode: 'invert'  }, // 0.30%
  // WBTC / ETH — on-chain token0=WBTC(0x2260..) token1=WETH(0xC02..)
  { outputPair: 'WBTC/ETH',  pool: '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD', decimals0: 8,  decimals1: 18, fee: 3000, priceMode: 'direct'  }, // ETH per BTC
  // USDC / USDT — on-chain token0=USDC(0xA0b..) token1=USDT(0xdAC..)
  { outputPair: 'USDC/USDT', pool: '0x3416cF6C708Da44DB2624D63ea0AAef7113527C6', decimals0: 6,  decimals1: 6,  fee: 100,  priceMode: 'direct'  }, // USDT per USDC ≈ 1.0
  // LINK / ETH — on-chain token0=LINK(0x514..) token1=WETH(0xC02..)
  { outputPair: 'LINK/ETH',  pool: '0xa6Cc3C2531FdaA6Ae1A3CA84c2855806728693e8', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'direct'  }, // ETH per LINK
  // UNI / ETH — on-chain token0=UNI(0x1f9..) token1=WETH(0xC02..)
  { outputPair: 'UNI/ETH',   pool: '0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'direct'  }, // ETH per UNI
  // AAVE / ETH — on-chain token0=AAVE(0x7Fc..) token1=WETH(0xC02..)
  { outputPair: 'AAVE/ETH',  pool: '0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'direct'  }, // ETH per AAVE
  // MATIC / ETH — on-chain token0=MATIC(0x7D1..) token1=WETH(0xC02..)
  { outputPair: 'MATIC/ETH', pool: '0x290A6a7460B308ee3F19023D2D00dE604bcf5B42', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'direct'  }, // ETH per MATIC
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
  // Approximate floating-point conversion for monitoring quotes.
  // This is not fully integer-precision-safe for all uint160 values.
  const Q96  = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
  const raw   = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
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

// ── Per-pool fetcher ──────────────────────────────────────────────────────────

async function fetchUniV3Pool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `eth.univ3.${cfg.outputPair.replace('/', '-')}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, provider);
        const [slot0, liq] = await Promise.all([
          c.slot0({ blockTag: blockNumber }),
          c.liquidity({ blockTag: blockNumber }),
        ]);
        return { slot0, liq };
      },
      { timeoutMs: 2000, hedge: true }   // 2 s — Ethereum L1 is slower than Arbitrum
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

    // Stable-pair sanity guard (USDC/USDT only — no ETH/BTC in outputPair)
    const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
    if (isStable && (price < 0.9 || price > 1.1)) {
      throw new Error(`stable price out of range: ${price.toFixed(6)}`);
    }

    const liqNum = Number(result.liq);

    return {
      ok: true,
      price: {
        pair:        cfg.outputPair,
        pool:        cfg.pool,
        price,
        liquidity:   liqNum,
        liquidityRaw: result.liq.toString(),
        tvlUSD:      null,          // TVL requires oracle — out of scope for this fetcher
        fee:         cfg.fee / 1_000_000,
        tick:        Number(result.slot0[1]),
        source:      'uniswap_v3_ethereum_onchain',
        venue:       'uniswap_v3',
        chain:       CHAIN_ID,
        blockNumber,
        endpointId:  meta.endpointId,
        endpoint:    meta.urlRedacted,
        timestamp:   nowIso(),
      },
    };
  } catch (e) {
    return {
      ok:    false,
      venue: 'uniswap_v3',
      pair:  cfg.outputPair,
      pool:  cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function uniswapV3Fetcher() {
  const startedAt  = Date.now();
  const startedIso = nowIso();

  const TOTAL_POOLS = UNISWAP_V3_POOLS.length;

  // ── 1. Block anchor ───────────────────────────────────────────────────────
  let blockNumber = null;
  let blockMeta   = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'eth.uniswapV3Fetcher.block',
      { timeoutMs: 2000, hedge: true }
    );
    blockNumber = blockResp.blockNumber;
    blockMeta   = blockResp.meta;
  } catch (e) {
    // Block fetch failed — cannot anchor reads, return full error envelope
    return {
      status:  'error',
      partial: false,
      data: {
        prices:           [],
        chain:            CHAIN_ID,
        chain_id:         CHAIN_NUM,
        venues:           ['uniswap_v3'],
        timestamp:        startedIso,
        durationMs:       Date.now() - startedAt,
        blockNumber:      null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId:       null,
        endpoint:         null,
        endpointIdsSeen:  [],
        endpointsSeen:    [],
        stats: {
          totalPools:   TOTAL_POOLS,
          successCount: 0,
          failureCount: TOTAL_POOLS,
          uniswapV3: { total: TOTAL_POOLS, success: 0, failed: TOTAL_POOLS },
        },
        failures: [
          {
            venue: 'block_fetch',
            pair:  'n/a',
            pool:  'n/a',
            error: String(e.message || e).slice(0, 160),
          },
        ],
      },
    };
  }

  // ── 2. Pool reads (bounded concurrency, block-anchored) ───────────────────
  const uniResults = await mapWithConcurrency(
    UNISWAP_V3_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchUniV3Pool(cfg, blockNumber)
  );

  // ── 3. Assemble envelope ──────────────────────────────────────────────────
  const priceRows = uniResults
    .filter((x) => x && x.ok && x.price)
    .map((x) => x.price);

  const failures = uniResults
    .filter((x) => !x || !x.ok)
    .map((x) => ({
      venue: x?.venue || 'unknown',
      pair:  x?.pair  || 'unknown',
      pool:  x?.pool  || 'unknown',
      error: x?.error || 'unknown error',
    }));

  const durationMs       = Date.now() - startedAt;
  const successCount     = priceRows.length;
  const failureCount     = failures.length;
  const endpointIdsSeen  = [...new Set(priceRows.map((p) => p.endpointId).filter((v) => v !== undefined))];
  const endpointsSeen    = [...new Set(priceRows.map((p) => p.endpoint).filter(Boolean))];

  const status =
    successCount === 0  ? 'error'   :
    failureCount  > 0   ? 'partial' :
    'success';

  return {
    status,
    partial: status === 'partial',
    data: {
      prices:           priceRows,
      chain:            CHAIN_ID,
      chain_id:         CHAIN_NUM,
      venues:           ['uniswap_v3'],
      timestamp:        startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId:       blockMeta?.endpointId  ?? null,
      endpoint:         blockMeta?.urlRedacted  ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools:   TOTAL_POOLS,
        successCount,
        failureCount,
        uniswapV3: {
          total:   TOTAL_POOLS,
          success: successCount,
          failed:  failureCount,
        },
      },
      failures,
    },
  };
}

// ── CLI runner ────────────────────────────────────────────────────────────────

if (require.main === module) {
  uniswapV3Fetcher()
    .then((result) => {
      console.log('\nUNISWAP V3 ETHEREUM ON-CHAIN DATA:');
      console.log('='.repeat(95));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} ` +
        `endpoint=${result.data.endpoint} ` +
        `epSeen=${(result.data.endpointIdsSeen || []).join(',') || 'n/a'} ` +
        `duration=${result.data.durationMs}ms ` +
        `success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );

      result.data.prices.forEach((p) => {
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(8);
        console.log(
          `${'uniswap_v3'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(16)} | ` +
          `liq: ${String(p.liquidity).padStart(20)} | fee: ${feePct} | ep:${String(p.endpointId).padStart(2)}`
        );
      });

      if (result.data.failures.length) {
        console.log('-'.repeat(95));
        console.log('FAILURES:');
        result.data.failures.forEach((f) => {
          console.log(
            `${'uniswap_v3'.padEnd(12)} ${String(f.pair).padEnd(14)} ${f.pool} :: ${f.error}`
          );
        });
      }

      console.log('='.repeat(95));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

// ── Exports ───────────────────────────────────────────────────────────────────

uniswapV3Fetcher.chain = CHAIN_ID;
module.exports = uniswapV3Fetcher;
