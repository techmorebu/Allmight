'use strict';

// arbitrumFetcher.js v3.0
// Fetches Uniswap V3 + Camelot V2 pool data on Arbitrum One
// All pool addresses verified via Uniswap V3 Factory on-chain (2026-02-20)
//
// v3.0 provider migration:
//   Removed: new ethers.JsonRpcProvider(...)
//   Now uses: createProvider('arbitrum') + rpc.call(...)
//   Pattern matches uniswapV3Fetcher.js — sequential loop, one rpc.call per read.

require('dotenv').config();
const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const CHAIN_ID       = 'arbitrum';
const CHAIN_NUM      = 42161;
const FETCH_DELAY_MS = 400;

const rpc = createProvider(CHAIN_ID);

// ── ABIs ──────────────────────────────────────────────────────────────────────
const POOL_ABI_V3 = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
];

const PAIR_ABI_V2 = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

// ── Pool registries (unchanged from v2.0) ─────────────────────────────────────
const UNISWAP_V3_POOLS = [
    { outputPair: 'ETH/USDC',   pool: '0xC6962004f452bE9203591991D15f6b388e09E8D0', decimals0: 18, decimals1: 6,  fee: 500, priceMode: 'direct' },
    { outputPair: 'ETH/USDT',   pool: '0x641C00A822e8b671738d32a431a4Fb6074E5c79d', decimals0: 18, decimals1: 6,  fee: 500, priceMode: 'direct' },
    { outputPair: 'USDC/USDT',  pool: '0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6', decimals0: 6,  decimals1: 6,  fee: 100, priceMode: 'direct' },
    { outputPair: 'USDC/USDCe', pool: '0x8e295789c9465487074a65b1ae9Ce0351172393f', decimals0: 6,  decimals1: 6,  fee: 100, priceMode: 'direct' },
    { outputPair: 'DAI/USDT',   pool: '0x7f580f8A02b759C350E6b8340e7c2d4b8162b6a9', decimals0: 18, decimals1: 6,  fee: 100, priceMode: 'direct' },
    { outputPair: 'USDC/USDT',  pool: '0xbcE73c2e5A623054B0e8e2428E956f4b9d0412a5', decimals0: 6,  decimals1: 6,  fee: 500, priceMode: 'direct' },
    { outputPair: 'USDC/USDCe', pool: '0xA9E9CB16E922892Aa563a5aDb0f7D976EFCe36FB', decimals0: 6,  decimals1: 6,  fee: 500, priceMode: 'direct' },
];

const CAMELOT_POOLS = [
    { outputPair: 'ETH/USDC', pool: '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27', decimals0: 18, decimals1: 6, fee: 0.003, priceMode: 'direct' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
    const Q96   = 2n ** 96n;
    const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
    const raw   = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
    return mode === 'invert' ? 1.0 / raw : raw;
}

// ── Pool fetchers ─────────────────────────────────────────────────────────────

async function fetchUniV3Pool(cfg) {
    try {
        const slot0 = await rpc.call(
            `arb.univ3.slot0:${cfg.pool.slice(0, 10)}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, provider);
                return c.slot0();
            }
        );

        const liq = await rpc.call(
            `arb.univ3.liq:${cfg.pool.slice(0, 10)}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, provider);
                return c.liquidity();
            }
        );

        const price = sqrtPriceX96ToPrice(slot0[0], cfg.decimals0, cfg.decimals1, cfg.priceMode);

        if (!isFinite(price) || price <= 0 || price > 1e15) {
            console.error(`[ARB] UniV3 ${cfg.outputPair} ${cfg.pool.slice(0,10)}: invalid price=${price.toExponential(2)}`);
            return null;
        }

        const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
        if (isStable && (price < 0.9 || price > 1.1)) {
            console.error(`[ARB] UniV3 ${cfg.outputPair}: stablecoin price out of range: ${price.toFixed(6)}`);
            return null;
        }

        const liqNum = Number(liq);
        const tvlUSD = cfg.outputPair.includes('ETH')
            ? (liqNum / 1e6) * Math.sqrt(price) * 2
            : liqNum / 1e9;

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
        const res = await rpc.call(
            `arb.camelot.reserves:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, PAIR_ABI_V2, provider);
                return c.getReserves();
            }
        );

        const r0b = res[0];
        const r1b = res[1];
        if (r0b === 0n || r1b === 0n) return null;

        const PREC   = 1000000000n;
        const SCALE0 = BigInt('1' + '0'.repeat(cfg.decimals0));
        const SCALE1 = BigInt('1' + '0'.repeat(cfg.decimals1));
        const adj0   = Number(r0b * PREC / SCALE0) / 1e9;
        const adj1   = Number(r1b * PREC / SCALE1) / 1e9;
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
    console.log('[arbitrumFetcher] Fetching Arbitrum on-chain data (UniV3 + Camelot)...');
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
    console.log(`[arbitrumFetcher] ${uniPrices.length}/${UNISWAP_V3_POOLS.length} UniV3, ${camelotPrices.length}/${CAMELOT_POOLS.length} Camelot (${Date.now() - start}ms)`);

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

arbitrumFetcher.chain = 'arbitrum';

module.exports = arbitrumFetcher;

if (require.main === module) {
    arbitrumFetcher().then(result => {
        console.log('\nARBITRUM ON-CHAIN DATA:');
        console.log('='.repeat(76));
        result.data.prices.forEach(p => {
            const tvl    = (p.tvlUSD || p.reserveUSD) ? `$${((p.tvlUSD || p.reserveUSD) / 1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
            console.log(`${p.venue.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`);
        });
        console.log('='.repeat(76));
    }).catch(console.error);
}
