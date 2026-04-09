// curveFetcherEthereum.js
// Ethereum mainnet Curve fetcher — hardened speed-template version
//
// PLACEMENT: scripts/data_collection/masterFetcher/curveFetcherEthereum.js
//
// Boss directive 2026-04-04: Add Curve to Ethereum venue coverage.
// Curve provides ultra-low fee legs (0.01–0.04%) needed to break the
// ETH mainnet fee barrier (current min was 0.01% + 0.30% = 0.31%).
//
// Covers:
//   - 3pool (DAI/USDC/USDT) — fee ~0.01-0.04%, primary stable reference
//   - tricrypto2 (USDT/WBTC/WETH) — ETH/USDT and WBTC/USDT via oracle
//   - USDC/USDT 2pool (stableswap-ng variant)
//
// Key difference from UniV3: Curve uses get_dy() for price, balances() for TVL.
// Fee is stored as integer / 1e10 (e.g., 4000000 → 0.04%).
// Depth: TVL approximation (Curve concentrates liquidity near peg — TVL ≈ effective depth).

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('ethereum');

const CHAIN_ID  = 'ethereum';
const CHAIN_NUM = 1;
const FETCH_CONCURRENCY = Math.max(
  1,
  Number(process.env.ETH_CURVE_FETCHER_CONCURRENCY || '2')
);

// ─── ABIs ──────────────────────────────────────────────────────────────────────

// Standard Curve StableSwap (2pool, 3pool, stableswap-ng)
// int128 args on classic pools, uint256 on newer NG pools
const CURVE_2POOL_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)',
  'function fee() external view returns (uint256)',
];

// Curve CryptoSwap (tricrypto2) — uint256 indices, price_oracle for ETH
const CURVE_TRICRYPTO_ABI = [
  'function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)',
  'function fee() external view returns (uint256)',
  'function price_oracle(uint256 k) external view returns (uint256)',
  'function last_prices(uint256 k) external view returns (uint256)',
];

// Curve NG stableswap (USDC/USDT pool on Ethereum uses NG)
const CURVE_NG_ABI = [
  'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
  'function balances(uint256 i) external view returns (uint256)',
  'function fee() external view returns (uint256)',
  'function stored_rates() external view returns (uint256[])',
];

// ─── POOL CONFIGS ──────────────────────────────────────────────────────────────
//
// Ethereum mainnet Curve pools (all confirmed via Curve UI / Etherscan):
//
//   3pool: 0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7
//     coins: [DAI(18, i=0), USDC(6, i=1), USDT(6, i=2)]
//     fee: ~0.01% (1000000 / 1e10)
//     TVL: ~$250M+
//
//   tricrypto2: 0xD51a44d3FaE010294C616388b506AcdA1bfAAE46
//     coins: [USDT(6, i=0), WBTC(8, i=1), WETH(18, i=2)]
//     ETH price via price_oracle(1) [WETH/USDT price in 18dec]
//     BTC price via price_oracle(0) [WBTC/USDT price in 18dec]
//     fee: ~0.02-0.06% (dynamic)
//
//   USDC/USDT NG: 0x7F86Bf177Dd4F3494b841a37e3a75ec4Cfa-... (to be probed)
//
// Pool type assignments:
//   '3pool'     → 3 coins, int128 indices, primary stable reference
//   'tricrypto' → 3 coins, uint256 indices, oracle-based ETH/BTC price
//   '2pool'     → 2 coins, int128 indices

const CURVE_POOLS = [

  // ── 3pool (DAI/USDC/USDT) ────────────────────────────────────────────────────
  // The most important stable reference on Ethereum. Fee ~0.01%.
  // USDC→USDT: i=1 (USDC 6dec), j=2 (USDT 6dec), dx=1000 USDC
  {
    name:       '3pool USDC/USDT',
    outputPair: 'USDC/USDT',
    pool:       '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
    type:       '3pool',
    coin0dec:   6,   // coin i = USDC
    coin1dec:   6,   // coin j = USDT
    i:          1,   // USDC index
    j:          2,   // USDT index
    dx:         1000n * 1_000_000n,   // 1000 USDC
    bal_i:      1,   // balance index for USDC
    bal_j:      2,   // balance index for USDT
    sanityMin:  0.98,
    sanityMax:  1.02,
  },

  // ── 3pool DAI/USDC ────────────────────────────────────────────────────────────
  // DAI→USDC: i=0 (DAI 18dec), j=1 (USDC 6dec)
  // This gives us a DAI/USDC price from Curve to compare with UniV3 stable pools.
  {
    name:       '3pool DAI/USDC',
    outputPair: 'DAI/USDC',
    pool:       '0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7',
    type:       '3pool',
    coin0dec:   18,  // coin i = DAI
    coin1dec:   6,   // coin j = USDC
    i:          0,   // DAI index
    j:          1,   // USDC index
    dx:         1000n * 1_000_000_000_000_000_000n,  // 1000 DAI
    bal_i:      0,
    bal_j:      1,
    sanityMin:  0.97,
    sanityMax:  1.03,
  },

  // ── tricrypto2 (USDT/WBTC/WETH) — ETH/USDT via oracle ─────────────────────
  // ETH price read from price_oracle(1) — WETH/USDT in 18-decimal units.
  // More reliable than get_dy for large-size price discovery.
  // Fee: dynamic, typically 0.02–0.06%.
  {
    name:       'tricrypto2 ETH/USDT',
    outputPair: 'ETH/USDT',
    pool:       '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46',
    type:       'tricrypto',
    coin0dec:   6,   // USDT
    coin1dec:   18,  // WETH
    i:          0,   // USDT index
    j:          2,   // WETH index
    dx:         1000n * 1_000_000n,  // 1000 USDT
    priceOracleIdx: 1,   // price_oracle(1) = WETH price in USDT (18dec)
    sanityMin:  500,
    sanityMax:  20000,
  },

  // ── tricrypto2 — WBTC/USDT via oracle ────────────────────────────────────────
  {
    name:       'tricrypto2 WBTC/USDT',
    outputPair: 'WBTC/USDT',
    pool:       '0xD51a44d3FaE010294C616388b506AcdA1bfAAE46',
    type:       'tricrypto_btc',
    coin0dec:   6,
    coin1dec:   8,
    i:          0,  // USDT
    j:          1,  // WBTC
    dx:         1000n * 1_000_000n,
    priceOracleIdx: 0,  // price_oracle(0) = WBTC price in USDT (18dec)
    sanityMin:  10000,
    sanityMax:  100000,
  },

];

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

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

// ─── FETCH: 2pool / 3pool (StableSwap) ────────────────────────────────────────

async function fetchCurveStable(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `eth.curve.stable.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, provider);
        const [dy, fee, bal_i, bal_j] = await Promise.all([
          c.get_dy(cfg.i, cfg.j, cfg.dx, { blockTag: blockNumber }),
          c.fee({ blockTag: blockNumber }),
          c.balances(cfg.bal_i ?? cfg.i, { blockTag: blockNumber }),
          c.balances(cfg.bal_j ?? cfg.j, { blockTag: blockNumber }),
        ]);
        return { dy, fee, bal_i, bal_j };
      },
      { timeoutMs: 6000, hedge: true }
    );

    const dxHuman = Number(cfg.dx) / Math.pow(10, cfg.coin0dec);
    const dyHuman = Number(result.dy) / Math.pow(10, cfg.coin1dec);
    const price   = dyHuman / dxHuman;

    // fee() returns integer where 1e10 = 100%. Convert to fraction.
    const feeFrac = Number(result.fee) / 1e10;
    const feeBps  = feeFrac * 10000;

    if (!isFinite(price) || price <= 0) throw new Error(`invalid price ${price}`);
    if (price < cfg.sanityMin || price > cfg.sanityMax) {
      throw new Error(`price ${price.toFixed(6)} outside [${cfg.sanityMin}, ${cfg.sanityMax}]`);
    }

    // TVL in USD — both sides are stablecoins so raw balance sum is USD value
    const tvlUSD =
      (Number(result.bal_i) / Math.pow(10, cfg.coin0dec)) +
      (Number(result.bal_j) / Math.pow(10, cfg.coin1dec));

    return {
      ok: true,
      price: {
        pair:        cfg.outputPair,
        pool:        cfg.pool,
        price,
        fee:         feeFrac,
        fee_bps:     +feeBps.toFixed(4),
        tvlUSD,
        depthUSD:    tvlUSD,  // Curve stable pools: TVL ≈ effective depth (bonding curve)
        source:      'curve_ethereum_onchain',
        venue:       'curve',
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
      venue: 'curve',
      pair:  cfg.outputPair,
      pool:  cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// ─── FETCH: tricrypto (CryptoSwap, oracle-based ETH/BTC) ──────────────────────

async function fetchCurveTricrypto(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `eth.curve.crypto.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, CURVE_TRICRYPTO_ABI, provider);
        const [oracle, fee, bal0] = await Promise.all([
          c.price_oracle(cfg.priceOracleIdx, { blockTag: blockNumber }),
          c.fee({ blockTag: blockNumber }),
          c.balances(0, { blockTag: blockNumber }),  // USDT balance for TVL
        ]);
        return { oracle, fee, bal0 };
      },
      { timeoutMs: 6000, hedge: true }
    );

    // price_oracle returns asset/USDT price in 18-decimal units
    const price  = Number(result.oracle) / 1e18;
    const feeFrac = Number(result.fee) / 1e10;
    const feeBps  = feeFrac * 10000;

    if (!isFinite(price) || price <= 0) throw new Error(`invalid oracle price ${price}`);
    if (price < cfg.sanityMin || price > cfg.sanityMax) {
      throw new Error(`price ${price.toFixed(2)} outside [${cfg.sanityMin}, ${cfg.sanityMax}]`);
    }

    // TVL estimate from USDT balance × 3 (tricrypto has 3 balanced coins)
    const tvlUSD = (Number(result.bal0) / 1e6) * 3;

    return {
      ok: true,
      price: {
        pair:        cfg.outputPair,
        pool:        cfg.pool,
        price,
        fee:         feeFrac,
        fee_bps:     +feeBps.toFixed(4),
        tvlUSD,
        depthUSD:    tvlUSD / 3,  // conservative: one leg of the pool
        source:      'curve_ethereum_onchain',
        venue:       'curve',
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
      venue: 'curve',
      pair:  cfg.outputPair,
      pool:  cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// ─── MAIN FETCHER ──────────────────────────────────────────────────────────────

async function curveFetcherEthereum() {
  const startedAt  = Date.now();
  const startedIso = nowIso();

  let blockNumber, blockMeta;
  try {
    const res = await rpc.getBlockNumber('eth.curve.block', { timeoutMs: 5000, hedge: true });
    blockNumber = res.blockNumber;
    blockMeta   = res.meta;
  } catch (e) {
    return {
      status: 'error', partial: false,
      data: {
        prices: [], chain: CHAIN_ID, chain_id: CHAIN_NUM, venues: ['curve'],
        timestamp: startedIso, durationMs: Date.now() - startedAt, blockNumber: null,
        stats: { totalPools: CURVE_POOLS.length, successCount: 0, failureCount: CURVE_POOLS.length },
        failures: [{ venue: 'block_fetch', pair: 'n/a', pool: 'n/a', error: String(e.message||e).slice(0,160) }],
      },
    };
  }

  const results = await mapWithConcurrency(CURVE_POOLS, FETCH_CONCURRENCY, async (cfg) => {
    if (cfg.type === 'tricrypto' || cfg.type === 'tricrypto_btc') {
      return fetchCurveTricrypto(cfg, blockNumber);
    }
    return fetchCurveStable(cfg, blockNumber);
  });

  const priceRows    = results.filter(x => x?.ok && x.price).map(x => x.price);
  const failures     = results.filter(x => !x?.ok).map(x => ({
    venue: x?.venue || 'curve', pair: x?.pair || '?', pool: x?.pool || '?',
    error: x?.error || '?',
  }));
  const successCount = priceRows.length;
  const failureCount = failures.length;
  const durationMs   = Date.now() - startedAt;
  const status       = successCount === 0 ? 'error' : failureCount > 0 ? 'partial' : 'success';
  const endpointIdsSeen = [...new Set(priceRows.map(p => p.endpointId).filter(v => v !== undefined))];
  const endpointsSeen   = [...new Set(priceRows.map(p => p.endpoint).filter(Boolean))];

  return {
    status, partial: status === 'partial',
    data: {
      prices: priceRows,
      chain: CHAIN_ID, chain_id: CHAIN_NUM,
      venues: ['curve'],
      timestamp: startedIso, durationMs, blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId:      blockMeta?.endpointId ?? null,
      endpoint:        blockMeta?.urlRedacted ?? null,
      endpointIdsSeen, endpointsSeen,
      stats: {
        totalPools:   CURVE_POOLS.length,
        successCount, failureCount,
        curve: { total: CURVE_POOLS.length, success: successCount, failed: failureCount },
      },
      failures,
    },
  };
}

// ─── STANDALONE RUNNER ─────────────────────────────────────────────────────────

if (require.main === module) {
  curveFetcherEthereum()
    .then((result) => {
      console.log('\nCURVE ETHEREUM ON-CHAIN DATA:');
      console.log('='.repeat(90));
      console.log(
        `status=${result.status} block=${result.data.blockNumber} ` +
        `duration=${result.data.durationMs}ms success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );
      result.data.prices.forEach((p) => {
        const tvl = p.tvlUSD ? `$${(p.tvlUSD / 1e6).toFixed(1)}M` : 'n/a';
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px = p.price > 100 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);
        console.log(
          `${p.venue.padEnd(8)} ${p.pair.padEnd(12)} ${px.padStart(12)} | fee: ${feePct} | TVL: ${tvl.padStart(8)} | ep:${p.endpointId}`
        );
      });
      if (result.data.failures.length) {
        console.log('-'.repeat(90));
        result.data.failures.forEach(f => console.log(`FAIL: ${f.pair} ${f.pool} :: ${f.error}`));
      }
      console.log('='.repeat(90));
    })
    .catch(err => { console.error(err); process.exit(1); });
}

curveFetcherEthereum.chain = 'ethereum';
module.exports = curveFetcherEthereum;
