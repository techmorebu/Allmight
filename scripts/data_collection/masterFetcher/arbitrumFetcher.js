// arbitrumFetcher.js v2.1
// Fetches Uniswap V3 + Camelot V2 pool data on Arbitrum One
// All pool addresses verified via Uniswap V3 Factory on-chain (2026-02-20)
// v2.1: Added ARB/WETH pool (0xC6F780497A95e246EB9449f5e4770916DCd6396A)
//       $4.7M/24h volume, $1.28M liquidity -- discovered via DexScreener 2026-02-25
//
// KEY OPPORTUNITY: Stablecoin pools at 0.01% fee (1 bps)
//   USDC/USDT 0.01% vs USDC/USDT 0.01% = 2 bps total fee wall
//   Any spread > 2 bps = gross-positive

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc'
);

const CHAIN_ID       = 'arbitrum';
const CHAIN_NUM      = 42161;
const FETCH_DELAY_MS = 400;

const POOL_ABI_V3 = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
];

const PAIR_ABI_V2 = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

// ── Arbitrum token addresses ──────────────────────────────────────────────────
// WETH:   0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
// USDC:   0xaf88d065e77c8cC2239327C5EDb3A432268e5831
// ARB:    0x912CE59144191C1204E64559FE8253a0e49E6548
// WBTC:   0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f  (native)
// USDCe:  0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8  (bridged)
// USDT:   0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9
// DAI:    0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1
// ARB:    0x912CE59144191C1204E64559FE8253a0e49E6548

// ── Uniswap V3 pools (all addresses verified via factory) ─────────────────────
const UNISWAP_V3_POOLS = [
    // ── ETH/USD pools ──────────────────────────────────────────────────────
    {
        outputPair: 'ETH/USDC',
        pool:       '0xC6962004f452bE9203591991D15f6b388e09E8D0',
        decimals0:  18,   // WETH
        decimals1:  6,    // USDC
        fee:        500,
        priceMode:  'direct',
    },
    {
        outputPair: 'ETH/USDT',
        pool:       '0x641C00A822e8b671738d32a431a4Fb6074E5c79d',
        decimals0:  18,   // WETH
        decimals1:  6,    // USDT
        fee:        500,
        priceMode:  'direct',
    },
    // ── ARB/WETH pool -- HIGH VOLUME ($4.7M/24h, $1.28M liquidity) ─────────
    // Discovered via DexScreener 2026-02-25. Pool verified on Arbitrum.
    // fee=3000 (0.30%) -- standard tier for volatile pairs
    {
        outputPair: 'ARB/WETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,   // ARB  (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000,
        priceMode:  'direct',  // WETH per ARB
    },
    // ── Stablecoin pools at 0.01% (1 bps) -- KEY OPPORTUNITY ──────────────
    {
        outputPair: 'USDC/USDT',
        pool:       '0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6',
        decimals0:  6,    // USDC (token0)
        decimals1:  6,    // USDT (token1)
        fee:        100,
        priceMode:  'direct',
    },
    {
        outputPair: 'USDC/USDCe',
        pool:       '0x8e295789c9465487074a65b1ae9Ce0351172393f',
        decimals0:  6,    // USDC native
        decimals1:  6,    // USDCe bridged
        fee:        100,
        priceMode:  'direct',
    },
    {
        outputPair: 'DAI/USDT',
        pool:       '0x7f580f8A02b759C350E6b8340e7c2d4b8162b6a9',
        decimals0:  18,   // DAI
        decimals1:  6,    // USDT
        fee:        100,
        priceMode:  'direct',
    },
    // ── ARB / WBTC pools ──────────────────────────────────────────────────────
    // ARB/WETH 0.05% (highest liquidity ARB pool on Arbitrum)
    // WETH=token0, ARB=token1 -- priceMode direct gives WETH per ARB
    {
        outputPair: 'ARB/WETH',
        pool:       ethers.getAddress('0xc6f780497a95e246eb9449f5e4770916dcd6396a'),
        decimals0:  18,   // WETH (token0)
        decimals1:  18,   // ARB  (token1)
        fee:        3000,
        priceMode:  'direct',
    },
    // ARB/USDC 0.3%
    {
        outputPair: 'ARB/USDC',
        pool:       ethers.getAddress('0xb0f6ca40411360c03d41c5ffa5134b1c9e2b2b16'),
        decimals0:  18,   // ARB  (token0)
        decimals1:  6,    // USDC (token1)
        fee:        3000,
        priceMode:  'direct',
    },
    // WBTC/WETH 0.3%
    {
        outputPair: 'WBTC/WETH',
        pool:       ethers.getAddress('0x2f5e87c9312fa29aed5c179e456625d79015299c'),
        decimals0:  8,    // WBTC (token0)
        decimals1:  18,   // WETH (token1)
        fee:        3000,
        priceMode:  'direct',
    },
    // ── 0.05% stablecoin pools (for comparison) ────────────────────────────
    {
        outputPair: 'USDC/USDT',
        pool:       '0xbcE73c2e5A623054B0e8e2428E956f4b9d0412a5',
        decimals0:  6,    // USDC
        decimals1:  6,    // USDT
        fee:        500,
        priceMode:  'direct',
    },
    {
        outputPair: 'USDC/USDCe',
        pool:       '0xA9E9CB16E922892Aa563a5aDb0f7D976EFCe36FB',
        decimals0:  6,
        decimals1:  6,
        fee:        500,
        priceMode:  'direct',
    },
];

// ── Camelot V2 pools ──────────────────────────────────────────────────────────
const CAMELOT_POOLS = [
    {
        outputPair: 'ETH/USDC',
        pool:       '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27',
        decimals0:  18,   // WETH (token0, confirmed on-chain)
        decimals1:  6,    // USDC.e (token1, confirmed on-chain)
        fee:        0.003,
        priceMode:  'direct',
    },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
    const Q96   = 2n ** 96n;
    const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
    const raw   = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
    return mode === 'invert' ? 1.0 / raw : raw;
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchUniV3Pool(cfg) {
    try {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, PROVIDER);
        const [slot0, liq] = await Promise.all([c.slot0(), c.liquidity()]);
        const price = sqrtPriceX96ToPrice(slot0[0], cfg.decimals0, cfg.decimals1, cfg.priceMode);
        if (!isFinite(price) || price <= 0 || price > 1e15) {
            console.error(`[ARB] UniV3 ${cfg.outputPair} ${cfg.pool.slice(0,10)}: invalid price=${price.toExponential(2)}`);
            return null;
        }
        // For stablecoin pairs, sanity check: price should be 0.9 - 1.1
        const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC') && !cfg.outputPair.includes('ARB');
        if (isStable && (price < 0.9 || price > 1.1)) {
            console.error(`[ARB] UniV3 ${cfg.outputPair}: stablecoin price out of range: ${price.toFixed(6)}`);
            return null;
        }
        const liqNum = Number(liq);
        // TVL estimation per pair type
        let tvlUSD;
        if (cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('ARB')) {
            tvlUSD = (liqNum / 1e6) * Math.sqrt(price) * 2;
        } else if (cfg.outputPair === 'ARB/WETH') {
            // ARB/WETH: both 18 dec, price = WETH per ARB
            // rough TVL: liquidity * sqrt(price) * 2 * eth_price
            tvlUSD = (liqNum / 1e9) * Math.sqrt(price) * 2 * 2700;
        } else {
            tvlUSD = liqNum / 1e9;
        }
        return {
            pair:      cfg.outputPair,
            pool:      cfg.pool,
            price,
            liquidity: liqNum,
            tvlUSD,
            fee:       cfg.fee / 10000,
            tick:      Number(slot0[1]),
            source:    'uniswap_v3_arbitrum_onchain',
            venue:     'uniswap_v3',
            chain:     CHAIN_ID,
            timestamp: new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[ARB] UniV3 ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,80)}`);
        return null;
    }
}

async function fetchCamelotPool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, PAIR_ABI_V2, PROVIDER);
        const res = await c.getReserves();
        const r0b = res[0];
        const r1b = res[1];
        if (r0b === 0n || r1b === 0n) return null;
        const PREC   = 1000000000n;
        const SCALE0 = BigInt('1' + '0'.repeat(cfg.decimals0));
        const SCALE1 = BigInt('1' + '0'.repeat(cfg.decimals1));
        const adj0 = Number(r0b * PREC / SCALE0) / 1e9;
        const adj1 = Number(r1b * PREC / SCALE1) / 1e9;
        if (!adj0 || !adj1) return null;
        const raw   = adj1 / adj0;
        const price = cfg.priceMode === 'invert' ? 1.0 / raw : raw;
        if (!isFinite(price) || price <= 0 || price > 1e10) return null;
        const tvlUSD = cfg.outputPair === 'ETH/USDC' ? adj1 * 2 : adj1 * price * 2;
        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            reserve0:   r0b.toString(),
            reserve1:   r1b.toString(),
            reserveUSD: tvlUSD,
            fee:        cfg.fee,
            source:     'camelot_v2_arbitrum_onchain',
            venue:      'camelot_v2',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[ARB] Camelot ${cfg.outputPair}: ${e.message.slice(0,80)}`);
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function arbitrumFetcher() {
    console.log('Fetching Arbitrum on-chain data (UniV3 + Camelot)...');
    const start = Date.now();

    const uniPrices = [];
    for (const cfg of UNISWAP_V3_POOLS) {
        const r = await fetchUniV3Pool(cfg);
        if (r) uniPrices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    const camelotPrices = [];
    for (const cfg of CAMELOT_POOLS) {
        const r = await fetchCamelotPool(cfg);
        if (r) camelotPrices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    const allPrices = [...uniPrices, ...camelotPrices];
    console.log(`Arbitrum: ${uniPrices.length}/${UNISWAP_V3_POOLS.length} UniV3, ${camelotPrices.length}/${CAMELOT_POOLS.length} Camelot`);

    return {
        status: 'success',
        data: {
            prices:     allPrices,
            chain:      CHAIN_ID,
            chain_id:   CHAIN_NUM,
            venues:     ['uniswap_v3', 'camelot_v2'],
            timestamp:  new Date().toISOString(),
            durationMs: Date.now() - start,
        },
    };
}

if (require.main === module) {
    arbitrumFetcher().then(result => {
        console.log('\nARBITRUM ON-CHAIN DATA:');
        console.log('='.repeat(76));
        result.data.prices.forEach(p => {
            const tvl    = (p.tvlUSD || p.reserveUSD)
                ? `$${((p.tvlUSD || p.reserveUSD) / 1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
            console.log(
                `${p.venue.padEnd(12)} ${p.pair.padEnd(14)} ` +
                `${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`
            );
        });
        console.log('='.repeat(76));
    }).catch(console.error);
}

module.exports = arbitrumFetcher;
