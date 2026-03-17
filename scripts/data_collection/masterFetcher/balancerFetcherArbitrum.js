// scripts/data_collection/masterFetcher/balancerFetcherArbitrum.js
// Balancer V2 Arbitrum fetcher
// Hardened speed-template version with success/partial/error status semantics
//
// Migration history:
//   v2.0 — createProvider('arbitrum') + rpc.call(), serial sleep loop, minimal envelope
//   v3.0 — full hardened template: callDetailed, block anchoring, mapWithConcurrency,
//           uniform envelope (status/partial/stats/failures/endpointIdsSeen),
//           pool-level fault isolation, frugal early-exit when no pools configured
//
// ── Pool list is currently empty ──────────────────────────────────────────────
// To activate this fetcher, add pool entries to BALANCER_POOLS below.
//
// How to find valid poolIds:
//   1. Go to app.balancer.fi → select Arbitrum network
//   2. Find target stable pool (e.g. USDC/USDT/USDCe)
//   3. Open pool page — the URL contains the poolId (bytes32 hex string)
//   4. Confirm pool contract address from the same page
//
// Pool entry shape:
//   {
//     name:       'USDC/USDT/USDCe stable',   // human label for logs
//     outputPair: 'USDC/USDT',                 // canonical pair for Redis key
//     pool:       '0x...',                     // pool contract address (for fee query)
//     poolId:     '0x...000002',               // bytes32 poolId (for vault query)
//     type:       'stable',                    // 'stable' | 'weighted' | 'meta'
//     i:          0,                           // index of token_in  in vault token array
//     j:          1,                           // index of token_out in vault token array
//     decimals:   [6, 6, 6],                   // decimals per token, in vault token order
//   }
//
// Note: Balancer's Vault returns tokens in sorted order (ascending address).
// Always verify token ordering from getPoolTokens() before setting i/j indices.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';
require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('arbitrum');

const CHAIN_ID  = 'arbitrum';
const CHAIN_NUM = 42161;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ARBITRUM_BALANCER_FETCHER_CONCURRENCY || 2)
);

// ── Balancer V2 Vault — canonical address, same on all EVM chains ─────────────
const VAULT_ADDR = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

const VAULT_ABI = [
  'function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)',
];

const POOL_ABI = [
  'function getSwapFeePercentage() external view returns (uint256)',
];

// ── Pool configs ──────────────────────────────────────────────────────────────
// See header comment block above for entry shape and discovery instructions.
const BALANCER_POOLS = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Per-pool fetcher ──────────────────────────────────────────────────────────
//
// Two separate callDetailed calls per pool — Vault and Pool are different contracts
// and cannot be batched into one callDetailed call per the project RPC rules.
// Both reads are block-anchored to the same blockNumber for snapshot consistency.

async function fetchBalancerPool(cfg, blockNumber) {
  try {
    // ── Read 1: Vault — getPoolTokens ─────────────────────────────────────────
    const { result: vaultResult, meta: vaultMeta } = await rpc.callDetailed(
      `arb.balancer.poolTokens.${cfg.outputPair.replace('/', '-')}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, provider);
        return vault.getPoolTokens(cfg.poolId, { blockTag: blockNumber });
      },
      { timeoutMs: 1800, hedge: true }
    );

    const { balances } = vaultResult;

    if (!balances || balances.length < 2) {
      throw new Error(`insufficient token balances returned: ${balances?.length ?? 0}`);
    }

    // ── Read 2: Pool contract — getSwapFeePercentage ──────────────────────────
    // Separate contract from Vault — must be a separate callDetailed call.
    const { result: feeRaw } = await rpc.callDetailed(
      `arb.balancer.fee.${cfg.outputPair.replace('/', '-')}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const pool = new ethers.Contract(cfg.pool, POOL_ABI, provider);
        return pool.getSwapFeePercentage({ blockTag: blockNumber });
      },
      { timeoutMs: 1800, hedge: true }
    );

    // Balancer fee encoding: 1e18 = 100%
    // e.g. 1e14 = 0.01% → fee_bps = 1, fee decimal = 0.0001
    const fee_bps = Number(feeRaw) / 1e18 * 10000;

    const i     = cfg.i;
    const j     = cfg.j;
    const bal_i = Number(balances[i]) / Math.pow(10, cfg.decimals[i]);
    const bal_j = Number(balances[j]) / Math.pow(10, cfg.decimals[j]);

    if (!bal_i || !bal_j) {
      throw new Error(`zero or invalid balances at indices i=${i} j=${j}`);
    }

    // Approximate price from balance ratio.
    // For stable pools this is a reasonable quote proxy.
    // For weighted pools this is NOT the spot price — use get_dy if precision is required.
    const price    = bal_j / bal_i;
    const isStable = cfg.type === 'stable';

    if (isStable && (price < 0.9 || price > 1.1)) {
      throw new Error(`stable price out of range: ${price.toFixed(6)}`);
    }
    if (!isStable && (price < 0.0001 || price > 1e8)) {
      throw new Error(`weighted price out of range: ${price}`);
    }

    // TVL: sum all token balances normalized to decimals.
    // Assumes all tokens are USD-pegged — only valid for stable pools.
    // For weighted pools this is an approximation.
    const tvlUSD = balances.reduce(
      (sum, b, idx) => sum + Number(b) / Math.pow(10, cfg.decimals[idx] ?? 6),
      0
    );

    return {
      ok: true,
      price: {
        pair:       cfg.outputPair,
        pool:       cfg.pool.toLowerCase(),
        price,
        fee:        fee_bps / 10000,
        fee_bps,
        tvlUSD,
        poolType:   cfg.type,
        source:     'balancer_v2_arbitrum_onchain',
        venue:      'balancer_v2',
        chain:      CHAIN_ID,
        blockNumber,
        endpointId: vaultMeta.endpointId,
        endpoint:   vaultMeta.urlRedacted,
        timestamp:  nowIso(),
      },
    };
  } catch (e) {
    return {
      ok:    false,
      venue: 'balancer_v2',
      pair:  cfg.outputPair,
      pool:  cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function balancerFetcherArbitrum() {
  const startedAt  = Date.now();
  const startedIso = nowIso();
  const TOTAL_POOLS = BALANCER_POOLS.length;

  // ── Early exit: no pools configured ──────────────────────────────────────
  // Skip the block fetch — no point burning an RPC call with nothing to anchor.
  if (TOTAL_POOLS === 0) {
    console.log('[balancerFetcherArbitrum] No pools configured — add poolIds to BALANCER_POOLS to activate.');
    return {
      status:  'success',
      partial: false,
      data: {
        prices:           [],
        chain:            CHAIN_ID,
        chain_id:         CHAIN_NUM,
        venues:           ['balancer_v2'],
        timestamp:        startedIso,
        durationMs:       Date.now() - startedAt,
        blockNumber:      null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId:       null,
        endpoint:         null,
        endpointIdsSeen:  [],
        endpointsSeen:    [],
        stats: {
          totalPools:   0,
          successCount: 0,
          failureCount: 0,
          balancerV2:   { total: 0, success: 0, failed: 0 },
        },
        failures: [],
      },
    };
  }

  // ── 1. Block anchor ───────────────────────────────────────────────────────
  let blockNumber = null;
  let blockMeta   = null;

  try {
    const blockResp = await rpc.getBlockNumber(
      'arb.balancerFetcherArbitrum.block',
      { timeoutMs: 1500, hedge: true }
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
        venues:           ['balancer_v2'],
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
          balancerV2:   { total: TOTAL_POOLS, success: 0, failed: TOTAL_POOLS },
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
    BALANCER_POOLS,
    FETCH_CONCURRENCY,
    (cfg) => fetchBalancerPool(cfg, blockNumber)
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
      venues:           ['balancer_v2'],
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
        balancerV2: {
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
  balancerFetcherArbitrum()
    .then((result) => {
      console.log('\nBALANCER V2 ARBITRUM ON-CHAIN DATA:');
      console.log('='.repeat(95));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} ` +
        `endpoint=${result.data.endpoint} ` +
        `epSeen=${(result.data.endpointIdsSeen || []).join(',') || 'n/a'} ` +
        `duration=${result.data.durationMs}ms ` +
        `success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );

      if (result.data.prices.length === 0) {
        console.log('  (no pools configured — add poolIds to BALANCER_POOLS to activate)');
      }

      result.data.prices.forEach((p) => {
        const tvl    = p.tvlUSD ? `$${(p.tvlUSD / 1000).toFixed(1)}k` : 'n/a';
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
        console.log(
          `${'balancer_v2'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | ` +
          `TVL: ${tvl.padStart(10)} | fee: ${feePct} | ep:${String(p.endpointId).padStart(2)}`
        );
      });

      if (result.data.failures.length) {
        console.log('-'.repeat(95));
        console.log('FAILURES:');
        result.data.failures.forEach((f) => {
          console.log(
            `${'balancer_v2'.padEnd(12)} ${String(f.pair).padEnd(14)} ${f.pool} :: ${f.error}`
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

balancerFetcherArbitrum.chain = CHAIN_ID;
module.exports = balancerFetcherArbitrum;
