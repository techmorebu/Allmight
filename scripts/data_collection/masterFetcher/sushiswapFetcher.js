// scripts/data_collection/masterFetcher/sushiswapFetcher.js
// Sushiswap V2 Ethereum mainnet fetcher
// Hardened speed-template version with success/partial/error status semantics
//
// Migration history:
//   v1.0 — initial: createProvider, token_registry, Promise.all stampede, no envelope
//   v2.0 — full hardened template: callDetailed, block anchoring, mapWithConcurrency,
//           uniform envelope (status/partial/stats/failures/endpointIdsSeen),
//           decimals baked into pool config (no token_registry or ERC20 RPC dependency),
//           BigInt-safe integer reserve scaling, explicit priceMode per pool

'use strict';
require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('ethereum');

const CHAIN_ID  = 'ethereum';
const CHAIN_NUM = 1;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ETH_SUSHI_FETCHER_CONCURRENCY || 2)  // conservative — Ethereum RPC is rate-sensitive
);

// ── ABI ───────────────────────────────────────────────────────────────────────

const PAIR_ABI_V2 = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

// ── Pool configs ──────────────────────────────────────────────────────────────
//
// decimals0 / decimals1 reflect actual on-chain token ordering.
// Sushiswap V2 factory sorts pairs by address: lower address = token0.
//
// priceMode:
//   'r0_over_r1' → price = normalizedReserve0 / normalizedReserve1
//   'r1_over_r0' → price = normalizedReserve1 / normalizedReserve0
//
// fee: Sushiswap V2 fixed tier in bps (3000 = 0.3% on all pools).
// Output row stores fee / 1_000_000 as a decimal fraction.
//
// On-chain token ordering (factory sort by address, verified):
//   ETH/USDC:  token0=USDC(0xA0b..,6d)  token1=WETH(0xC02..,18d) → r0/r1 = ETH price in USDC
//   WBTC/ETH:  token0=WBTC(0x226..,8d)  token1=WETH(0xC02..,18d) → r1/r0 = WBTC price in ETH
//   LINK/ETH:  token0=LINK(0x514..,18d) token1=WETH(0xC02..,18d) → r1/r0 = LINK price in ETH
//   UNI/ETH:   token0=UNI (0x1f9..,18d) token1=WETH(0xC02..,18d) → r1/r0 = UNI  price in ETH
//   AAVE/ETH:  token0=AAVE(0x7Fc..,18d) token1=WETH(0xC02..,18d) → r1/r0 = AAVE price in ETH
//   DAI/ETH:   token0=DAI (0x6B1..,18d) token1=WETH(0xC02..,18d) → r0/r1 = ETH  price in DAI

const SUSHISWAP_POOLS = [
  { outputPair: 'ETH/USDC',  pair: '0x397FF1542f962076d0BFE58eA045FfA2d347ACa0', decimals0: 6,  decimals1: 18, fee: 3000, priceMode: 'r0_over_r1' },
  { outputPair: 'WBTC/ETH',  pair: '0xCEfF51756c56CeFFCA006cD410B03FFC46dd3a58', decimals0: 8,  decimals1: 18, fee: 3000, priceMode: 'r1_over_r0' },
  { outputPair: 'LINK/ETH',  pair: '0xC40D16476380e4037e6b1A2594cAF6a6cc8Da967', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'r1_over_r0' },
  { outputPair: 'UNI/ETH',   pair: '0xDafd66636E2561b0284EDdE37e42d192F2844D40', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'r1_over_r0' },
  { outputPair: 'AAVE/ETH',  pair: '0xD75EA151a61d06868E31F8988D28DFE5E9df57B4', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'r1_over_r0' },
  { outputPair: 'DAI/ETH',   pair: '0xC3D03e4F041Fd4cD388c549Ee2A29a9E5075882f', decimals0: 18, decimals1: 18, fee: 3000, priceMode: 'r0_over_r1' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

// BigInt-safe integer reserve scaling.
// uint112 max ≈ 5.19e33 — exceeds Number.MAX_SAFE_INTEGER — so we scale down
// using integer division before converting to float.
function scaleReserve(rawBigInt, decimals) {
  const PREC  = 1_000_000_000n;
  const SCALE = BigInt('1' + '0'.repeat(decimals));
  return Number((rawBigInt * PREC) / SCALE) / 1e9;
}

function computePrice(adj0, adj1, priceMode) {
  return priceMode === 'r0_over_r1' ? adj0 / adj1 : adj1 / adj0;
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

async function fetchSushiPool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `eth.sushi.${cfg.outputPair.replace('/', '-')}.${cfg.pair.slice(0, 10)}`,
      async (provider) => {
        const pair = new ethers.Contract(cfg.pair, PAIR_ABI_V2, provider);
        return pair.getReserves({ blockTag: blockNumber });
      },
      { timeoutMs: 2000, hedge: true }
    );

    const r0b = result[0];   // uint112 as BigInt
    const r1b = result[1];

    if (r0b === 0n || r1b === 0n) {
      throw new Error('zero reserves');
    }

    const adj0 = scaleReserve(r0b, cfg.decimals0);
    const adj1 = scaleReserve(r1b, cfg.decimals1);

    if (!adj0 || !adj1) {
      throw new Error('reserve scaling produced zero or NaN');
    }

    const price = computePrice(adj0, adj1, cfg.priceMode);

    if (!isFinite(price) || price <= 0 || price > 1e15) {
      throw new Error(`invalid price: ${price}`);
    }

    // Stable-pair sanity guard (DAI/ETH is not stable — skip)
    const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
    if (isStable && (price < 0.9 || price > 1.1)) {
      throw new Error(`stable price out of range: ${price.toFixed(6)}`);
    }

    return {
      ok: true,
      price: {
        pair:        cfg.outputPair,
        pool:        cfg.pair,
        price,
        reserve0:    r0b.toString(),
        reserve1:    r1b.toString(),
        tvlUSD:      null,          // TVL requires a USD oracle — out of scope for this fetcher
        fee:         cfg.fee / 1_000_000,
        source:      'sushiswap_v2_ethereum_onchain',
        venue:       'sushiswap_v2',
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
      venue: 'sushiswap_v2',
      pair:  cfg.outputPair,
      pool:  cfg.pair,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function sushiswapFetcher() {
  const startedAt  = Date.now();
  const startedIso = nowIso();

  const TOTAL_POOLS = SUSHISWAP_POOLS.length;

  // ── 1. Block anchor ───────────────────────────────────────────────────────
  let blockNumber = null;
  let blockMeta   = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'eth.sushiswapFetcher.block',
      { timeoutMs: 2000, hedge: true }
    );
    blockNumber = blockResp.blockNumber;
    blockMeta   = blockResp.meta;
  } catch (e) {
    return {
      status:  'error',
      partial: false,
      data: {
        prices:           [],
        chain:            CHAIN_ID,
        chain_id:         CHAIN_NUM,
        venues:           ['sushiswap_v2'],
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
          sushiswapV2:  { total: TOTAL_POOLS, success: 0, failed: TOTAL_POOLS },
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
  const poolResults = await mapWithConcurrency(
    SUSHISWAP_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchSushiPool(cfg, blockNumber)
  );

  // ── 3. Assemble envelope ──────────────────────────────────────────────────
  const priceRows = poolResults
    .filter((x) => x && x.ok && x.price)
    .map((x) => x.price);

  const failures = poolResults
    .filter((x) => !x || !x.ok)
    .map((x) => ({
      venue: x?.venue || 'unknown',
      pair:  x?.pair  || 'unknown',
      pool:  x?.pool  || 'unknown',
      error: x?.error || 'unknown error',
    }));

  const durationMs      = Date.now() - startedAt;
  const successCount    = priceRows.length;
  const failureCount    = failures.length;
  const endpointIdsSeen = [...new Set(priceRows.map((p) => p.endpointId).filter((v) => v !== undefined))];
  const endpointsSeen   = [...new Set(priceRows.map((p) => p.endpoint).filter(Boolean))];

  const status =
    successCount === 0 ? 'error'   :
    failureCount  > 0 ? 'partial' :
    'success';

  return {
    status,
    partial: status === 'partial',
    data: {
      prices:           priceRows,
      chain:            CHAIN_ID,
      chain_id:         CHAIN_NUM,
      venues:           ['sushiswap_v2'],
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
        sushiswapV2: {
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
  sushiswapFetcher()
    .then((result) => {
      console.log('\nSUSHISWAP V2 ETHEREUM ON-CHAIN DATA:');
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
          `${'sushiswap_v2'.padEnd(13)} ${p.pair.padEnd(12)} ${px.padStart(16)} | ` +
          `r0: ${p.reserve0.padStart(22)} | r1: ${p.reserve1.padStart(22)} | fee: ${feePct} | ep:${String(p.endpointId).padStart(2)}`
        );
      });

      if (result.data.failures.length) {
        console.log('-'.repeat(95));
        console.log('FAILURES:');
        result.data.failures.forEach((f) => {
          console.log(
            `${'sushiswap_v2'.padEnd(13)} ${String(f.pair).padEnd(12)} ${f.pool} :: ${f.error}`
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

sushiswapFetcher.chain = CHAIN_ID;
module.exports = sushiswapFetcher;
