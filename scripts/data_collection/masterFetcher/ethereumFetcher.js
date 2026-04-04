// ethereumFetcher.js
// Ethereum mainnet fetcher — Uniswap V3 + SushiSwap V3
// Follows exact arbitrumFetcher.js pattern: fetchUniV3Pool() with venue/source cfg overrides,
// serial reads with concurrency cap, same JSONL-compatible output schema.
//
// PLACEMENT: scripts/data_collection/masterFetcher/ethereumFetcher.js
//
// Boss directive 2026-04-04: Replicate Arbitrum setup → Ethereum mainnet.
// Phase 1 pairs: ETH/USDC, ETH/USDT, WBTC/USDC, DAI/USDC
// Venues: UniV3 (primary), SushiSwap V3 (secondary)

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const rpc = createProvider('ethereum');

const CHAIN_ID  = 'ethereum';
const CHAIN_NUM = 1;
const FETCH_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.ETH_FETCH_CONCURRENCY || '3', 10)
);
// Conservative — Ethereum RPC endpoints are more rate-sensitive than Arbitrum.
// Serial pool reads with provider_factory's built-in retry/failover handle burst protection.

// ─── POOL ABIs ─────────────────────────────────────────────────────────────────

const POOL_ABI_V3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// ─── ETHEREUM MAINNET TOKEN ADDRESSES ──────────────────────────────────────────
// All checksummed. USDC = native (not bridged). WBTC = canonical ERC-20.

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';
const DAI  = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

// ─── UNISWAP V3 POOLS (Ethereum mainnet) ───────────────────────────────────────
// Factory: 0x1F98431c8aD98523631AE4a59f267346ea31F984 (same factory as Arbitrum)
// All addresses confirmed via Etherscan + high-activity verification.
//
// Token ordering notes (Ethereum):
//   WETH  0xC02a < USDC  0xA0b8 — WAIT: C > A in hex → USDC < WETH → token0=USDC
//   Actually: 0xA0b8... < 0xC02a... → USDC sorts lower → token0=USDC for ETH/USDC
//   0x2260... (WBTC) < 0xA0b8... (USDC) → WBTC=token0 for WBTC/USDC
//   0x6B17... (DAI)  < 0xA0b8... (USDC) → DAI=token0  for DAI/USDC
//
// priceMode for each pool:
//   token0=USDC, token1=WETH → price = sqrtP^2 × 10^(6-18) = WETH per USDC → invert → USDC per WETH
//   token0=WBTC, token1=USDC → price = sqrtP^2 × 10^(8-6) → USDC per WBTC → 'invert_scaled' but
//     since we want USDC per WBTC and token0=WBTC: raw = (sqrtP^2) × 10^(8-6) gives ratio.
//     Actually: raw = sqrtP^2 × 10^(dec0-dec1) = 10^(8-6) = USDC/WBTC × 100
//     Hmm — let me be precise. sqrtPriceX96ToPrice(sqrtP, dec0, dec1, 'direct') = sqrtP^2 × 10^(dec0-dec1)
//     For WBTC(8)/USDC(6): raw = sqrtP^2 × 10^(8-6) = sqrtP^2 × 100 = USDC per WBTC (approximately correct)
//     For USDC(6)/WETH(18): raw = sqrtP^2 × 10^(6-18) = sqrtP^2 / 10^12 = WETH per USDC → 'invert'
//     For DAI(18)/USDC(6): raw = sqrtP^2 × 10^(18-6) = DAI per USDC → 'invert'? No — we want USDC per DAI.
//     Actually for stable pairs: raw = sqrtP^2 × 10^(18-6) = 10^12 × ... → that's DAI/USDC price.
//     Wait — let me think again. sqrtP^2 is token1 per token0 in raw units.
//     token1 per token0 × 10^(dec0-dec1) = token1/token0 human readable.
//     USDC(6)/WETH(18): sqrtP^2 × 10^(6-18) = WETH per USDC → need 'invert' for USDC per WETH.
//     WBTC(8)/USDC(6): sqrtP^2 × 10^(8-6) = USDC per WBTC → 'direct' gives ~$67k. ✓
//     DAI(18)/USDC(6): sqrtP^2 × 10^(18-6) = USDC per DAI → 'direct' gives ~1.0. ✓
//     WBTC(8)/WETH(18): sqrtP^2 × 10^(8-18) = WETH per WBTC → 'direct' gives ~32 ETH/BTC. ✓

const UNISWAP_V3_POOLS = [

  // ── ETH/USDC ──────────────────────────────────────────────────────────────────
  // token0=USDC(6dec), token1=WETH(18dec)  →  priceMode='invert'

  // ETH/USDC 0.05% — highest-volume pool, primary price anchor
  {
    outputPair:     'ETH/USDC',
    pool:           '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640',
    decimals0:      6,
    decimals1:      18,
    fee:            500,
    priceMode:      'invert',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: USDC,
    expectedToken1: WETH,
  },

  // ETH/USDC 0.30% — cross-tier reference
  {
    outputPair:     'ETH/USDC',
    pool:           '0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8',
    decimals0:      6,
    decimals1:      18,
    fee:            3000,
    priceMode:      'invert',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: USDC,
    expectedToken1: WETH,
  },

  // ETH/USDC 0.01% — tightest fee tier (exists on mainnet since 2022)
  {
    outputPair:     'ETH/USDC',
    pool:           '0xE0554a476A092703abdB3Ef35c80e0D76d32939F',
    decimals0:      6,
    decimals1:      18,
    fee:            100,
    priceMode:      'invert',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: USDC,
    expectedToken1: WETH,
  },

  // ── ETH/USDT ──────────────────────────────────────────────────────────────────
  // token0=WETH(18dec), token1=USDT(6dec)  →  priceMode='direct'
  // 0xC02a > 0xdAC1 is FALSE — 0xC < 0xd → WETH < USDT → token0=WETH

  // ETH/USDT 0.05%
  {
    outputPair:     'ETH/USDT',
    pool:           '0x11b815efB8f581194ae79006d24E0d814B7697F6',
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: WETH,
    expectedToken1: USDT,
  },

  // ETH/USDT 0.30%
  {
    outputPair:     'ETH/USDT',
    pool:           '0x4e68Ccd3E89f51C3074ca5072bbAC773960dFa36',
    decimals0:      18,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: WETH,
    expectedToken1: USDT,
  },

  // ── WBTC/USDC ─────────────────────────────────────────────────────────────────
  // token0=WBTC(8dec), token1=USDC(6dec)  →  priceMode='direct'
  // 0x2260 < 0xA0b8 → WBTC < USDC → token0=WBTC

  // WBTC/USDC 0.30% — primary WBTC surface on Ethereum
  {
    outputPair:     'WBTC/USDC',
    pool:           '0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35',
    decimals0:      8,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    expectedToken0: WBTC,
    expectedToken1: USDC,
  },

  // WBTC/USDC 0.05%
  {
    outputPair:     'WBTC/USDC',
    pool:           '0x9a772018FbD77fcD2d25657e5C547BAfF3Fd7D16',
    decimals0:      8,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    expectedToken0: WBTC,
    expectedToken1: USDC,
  },

  // ── WBTC/ETH ──────────────────────────────────────────────────────────────────
  // token0=WBTC(8dec), token1=WETH(18dec)  →  priceMode='direct' → ETH per WBTC ≈ 32
  {
    outputPair:     'WBTC/ETH',
    pool:           '0xCBCdF9626bC03E24f779434178A73a0B4bad62eD',
    decimals0:      8,
    decimals1:      18,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      1,
    sanityMax:      1000,
    expectedToken0: WBTC,
    expectedToken1: WETH,
  },

  // ── DAI/USDC ──────────────────────────────────────────────────────────────────
  // token0=DAI(18dec), token1=USDC(6dec)  →  priceMode='direct' → USDC per DAI ≈ 1.0
  // 0x6B17 < 0xA0b8 → DAI < USDC → token0=DAI

  // DAI/USDC 0.01% — tightest stable, reference price
  {
    outputPair:     'DAI/USDC',
    pool:           '0x5777d92f208679DB4b9778590Fa3CAB3aC9e2168',
    decimals0:      18,
    decimals1:      6,
    fee:            100,
    priceMode:      'direct',
    sanityMin:      0.9,
    sanityMax:      1.1,
    expectedToken0: DAI,
    expectedToken1: USDC,
  },

  // DAI/USDC 0.05%
  {
    outputPair:     'DAI/USDC',
    pool:           '0x6c6Bc977E13Df9b0de53b251522280BB72383700',
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      0.9,
    sanityMax:      1.1,
    expectedToken0: DAI,
    expectedToken1: USDC,
  },

  // ── ETH/USDT 0.01% ────────────────────────────────────────────────────────────
  {
    outputPair:     'ETH/USDT',
    pool:           '0xC5aF84701f98Fa483eCe78aF83F11b6C38ACA71d',
    decimals0:      18,
    decimals1:      6,
    fee:            100,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    expectedToken0: WETH,
    expectedToken1: USDT,
  },

];

// ─── SUSHISWAP V3 POOLS (Ethereum mainnet) ─────────────────────────────────────
// SushiSwap V3 factory (Ethereum): 0xbACEB8eC6b9355Dfc0269C18bac9d6E2Bdc29C4f
// All pools confirmed via factory.getPool() + depth probe (2026-04-04).
// Same slot0+liquidity interface as UniV3 — fetched via fetchUniV3Pool().

const SUSHISWAP_V3_POOLS = [

  // ETH/USDC 0.05% — cross-venue primary
  {
    outputPair:     'ETH/USDC',
    pool:           '0xB891afB5D7c2C384ce5A9DF7e710c8EF9ebcB266',
    decimals0:      6,
    decimals1:      18,
    fee:            500,
    priceMode:      'invert',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_ethereum_onchain',
    expectedToken0: USDC,
    expectedToken1: WETH,
  },

  // ETH/USDC 0.30%
  {
    outputPair:     'ETH/USDC',
    pool:           '0x87C7056BBE6084f03304196Be51c6B90B6d85Aa2',
    decimals0:      6,
    decimals1:      18,
    fee:            3000,
    priceMode:      'invert',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_ethereum_onchain',
    expectedToken0: USDC,
    expectedToken1: WETH,
  },

  // ETH/USDT 0.05%
  {
    outputPair:     'ETH/USDT',
    pool:           '0x3D9Bd4A01737C8f3b9BDAEe940b26e5e52e1e34a',
    decimals0:      18,
    decimals1:      6,
    fee:            500,
    priceMode:      'direct',
    sanityMin:      500,
    sanityMax:      20000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_ethereum_onchain',
    expectedToken0: WETH,
    expectedToken1: USDT,
  },

  // WBTC/USDC 0.30%
  {
    outputPair:     'WBTC/USDC',
    pool:           '0xa33F9b0e4F9A8aB1E6dB2de44B87b5e53a38Ae3a',
    decimals0:      8,
    decimals1:      6,
    fee:            3000,
    priceMode:      'direct',
    sanityMin:      10000,
    sanityMax:      100000,
    venue:          'sushiswap_v3',
    source:         'sushiswap_v3_ethereum_onchain',
    expectedToken0: WBTC,
    expectedToken1: USDC,
  },

];

// ─── HELPERS ───────────────────────────────────────────────────────────────────

function nowIso() { return new Date().toISOString(); }

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
  const Q96   = 2n ** 96n;
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

// ─── POOL FETCHER ──────────────────────────────────────────────────────────────
// Identical logic to arbitrumFetcher.js fetchUniV3Pool() — venue/source from cfg.

async function fetchUniV3Pool(cfg, blockNumber) {
  try {
    const { result, meta } = await rpc.callDetailed(
      `eth.${cfg.venue || 'uniswap_v3'}.${cfg.outputPair}.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, provider);
        const [slot0, liq] = await Promise.all([
          c.slot0({ blockTag: blockNumber }),
          c.liquidity({ blockTag: blockNumber }),
        ]);
        return { slot0, liq };
      },
      { timeoutMs: cfg.timeoutMs || 6000, hedge: true }
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

    if (cfg.sanityMin !== undefined && cfg.sanityMax !== undefined) {
      if (price < cfg.sanityMin || price > cfg.sanityMax) {
        throw new Error(
          `[TOKEN-ORDER-GUARD] price ${price.toFixed(4)} outside [${cfg.sanityMin}, ${cfg.sanityMax}] ` +
          `for ${cfg.outputPair} — check decimals/priceMode vs on-chain token0/token1`
        );
      }
    }

    const liqNum      = Number(result.liq);
    const liquidityRaw = result.liq.toString();

    return {
      ok: true,
      price: {
        pair:         cfg.outputPair,
        pool:         cfg.pool,
        price,
        liquidity:    liqNum,
        liquidityRaw,
        tvlUSD:       null,
        fee:          cfg.fee / 1_000_000,
        tick:         Number(result.slot0[1]),
        source:       cfg.source || 'uniswap_v3_ethereum_onchain',
        venue:        cfg.venue  || 'uniswap_v3',
        chain:        CHAIN_ID,
        blockNumber,
        endpointId:   meta.endpointId,
        endpoint:     meta.urlRedacted,
        timestamp:    nowIso(),
      },
    };
  } catch (e) {
    return {
      ok:    false,
      venue: cfg.venue || 'uniswap_v3',
      pair:  cfg.outputPair,
      pool:  cfg.pool,
      error: String(e.message || e).slice(0, 160),
    };
  }
}

// ─── MAIN FETCHER ──────────────────────────────────────────────────────────────

async function ethereumFetcher() {
  const startedAt  = Date.now();
  const startedIso = nowIso();

  // Block number — same-block anchoring (mandatory per Boss architecture)
  let blockNumber, blockMeta;
  try {
    const res = await rpc.getBlockNumber(
      'eth.block',
      { timeoutMs: 5000, hedge: true }
    );
    blockNumber = res.blockNumber;
    blockMeta   = res.meta;
  } catch (e) {
    return {
      status: 'error',
      partial: false,
      data: {
        prices: [],
        chain: CHAIN_ID,
        chain_id: CHAIN_NUM,
        venues: ['uniswap_v3', 'sushiswap_v3'],
        timestamp: startedIso,
        durationMs: Date.now() - startedAt,
        blockNumber: null,
        fetchConcurrency: FETCH_CONCURRENCY,
        endpointId: null,
        endpoint: null,
        endpointIdsSeen: [],
        endpointsSeen: [],
        stats: {
          totalPools: UNISWAP_V3_POOLS.length + SUSHISWAP_V3_POOLS.length,
          successCount: 0,
          failureCount: UNISWAP_V3_POOLS.length + SUSHISWAP_V3_POOLS.length,
          uniswapV3:   { total: UNISWAP_V3_POOLS.length,   success: 0, failed: UNISWAP_V3_POOLS.length },
          sushiswapV3: { total: SUSHISWAP_V3_POOLS.length, success: 0, failed: SUSHISWAP_V3_POOLS.length },
        },
        failures: [{ venue: 'block_fetch', pair: 'n/a', pool: 'n/a', error: String(e.message || e).slice(0, 160) }],
      },
    };
  }

  const uniResults   = await mapWithConcurrency(UNISWAP_V3_POOLS,   FETCH_CONCURRENCY, (cfg) => fetchUniV3Pool(cfg, blockNumber));
  const sushiResults = await mapWithConcurrency(SUSHISWAP_V3_POOLS, FETCH_CONCURRENCY, (cfg) => fetchUniV3Pool(cfg, blockNumber));

  const combined  = [...uniResults, ...sushiResults];
  const priceRows = combined.filter((x) => x && x.ok && x.price).map((x) => x.price);
  const failures  = combined.filter((x) => !x || !x.ok).map((x) => ({
    venue: x?.venue || 'unknown',
    pair:  x?.pair  || 'unknown',
    pool:  x?.pool  || 'unknown',
    error: x?.error || 'unknown error',
  }));

  const durationMs       = Date.now() - startedAt;
  const endpointIdsSeen  = [...new Set(priceRows.map((p) => p.endpointId).filter((v) => v !== undefined))];
  const endpointsSeen    = [...new Set(priceRows.map((p) => p.endpoint).filter(Boolean))];
  const successCount     = priceRows.length;
  const failureCount     = failures.length;
  const status           = successCount === 0 ? 'error' : failureCount > 0 ? 'partial' : 'success';

  return {
    status,
    partial: status === 'partial',
    data: {
      prices: priceRows,
      chain: CHAIN_ID,
      chain_id: CHAIN_NUM,
      venues: ['uniswap_v3', 'sushiswap_v3'],
      timestamp: startedIso,
      durationMs,
      blockNumber,
      fetchConcurrency: FETCH_CONCURRENCY,
      endpointId:       blockMeta?.endpointId ?? null,
      endpoint:         blockMeta?.urlRedacted ?? null,
      endpointIdsSeen,
      endpointsSeen,
      stats: {
        totalPools:  UNISWAP_V3_POOLS.length + SUSHISWAP_V3_POOLS.length,
        successCount,
        failureCount,
        uniswapV3:   { total: UNISWAP_V3_POOLS.length,   success: uniResults.filter((x) => x && x.ok).length,   failed: uniResults.filter((x) => !x || !x.ok).length },
        sushiswapV3: { total: SUSHISWAP_V3_POOLS.length, success: sushiResults.filter((x) => x && x.ok).length, failed: sushiResults.filter((x) => !x || !x.ok).length },
      },
      failures,
    },
  };
}

// ─── STANDALONE RUNNER ─────────────────────────────────────────────────────────

if (require.main === module) {
  ethereumFetcher()
    .then((result) => {
      console.log('\nETHEREUM ON-CHAIN DATA:');
      console.log('='.repeat(90));
      console.log(
        `status=${result.status} partial=${result.partial} block=${result.data.blockNumber} ` +
        `duration=${result.data.durationMs}ms success=${result.data.stats.successCount} ` +
        `failed=${result.data.stats.failureCount}`
      );
      result.data.prices.forEach((p) => {
        const feePct = (p.fee * 100).toFixed(4) + '%';
        const px     = p.price > 100 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);
        console.log(
          `${p.venue.padEnd(14)} ${p.pair.padEnd(14)} ${px.padStart(12)} | fee: ${feePct} | ep:${String(p.endpointId).padStart(2)}`
        );
      });
      if (result.data.failures.length) {
        console.log('-'.repeat(90));
        console.log('FAILURES:');
        result.data.failures.forEach((f) => {
          console.log(`${f.venue.padEnd(14)} ${String(f.pair).padEnd(14)} ${f.pool} :: ${f.error}`);
        });
      }
      console.log('='.repeat(90));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

ethereumFetcher.chain = 'ethereum';
module.exports = ethereumFetcher;
