// arbitrumFetcher.js v1.1
// Fetches Uniswap V3 + Camelot V2 pool data on Arbitrum One
// Chain: Arbitrum One (chain_id: 42161)
// RPC: ARBITRUM_MAINNET_RPC_URL_1
//
// Price formula (verified 2026-02-20):
//   sqrtP = Number(sqrtPriceX96) / 2^96
//   rawPrice = sqrtP^2 * 10^(dec0 - dec1)   <- token1 per token0
//   ETH/USDC pool: token0=WETH(18), token1=USDC(6)
//     raw = sqrtP^2 * 10^(18-6) = USD/ETH directly (no inversion)
//   LINK/ETH pool: token0=WETH(18), token1=LINK(18)
//     raw = sqrtP^2 = LINK/ETH -> invert to get ETH/LINK
//
// Fetching: sequential with 400ms delay to avoid Infura rate limits

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc'
);

const CHAIN_ID  = 'arbitrum';
const CHAIN_NUM = 42161;
const FETCH_DELAY_MS = 400;

const POOL_ABI_V3 = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
];

const PAIR_ABI_V2 = [
    'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
];

// Uniswap V3 pools on Arbitrum (token ordering verified 2026-02-20)
const UNISWAP_V3_POOLS = [
    {
        name:       'ETH/USDC',
        pool:       '0xC6962004f452bE9203591991D15f6b388e09E8D0',
        decimals0:  18,  // WETH
        decimals1:  6,   // USDC
        fee:        500,
        priceMode:  'direct',  // sqrtP^2 * 10^(18-6) = USD/ETH directly
        outputPair: 'ETH/USDC',
    },
    {
        name:       'ETH/USDC',
        pool:       '0x17c14D2c404D167802b16C450d3c99F88F2c4F4d',
        decimals0:  18,
        decimals1:  6,
        fee:        3000,
        priceMode:  'direct',
        outputPair: 'ETH/USDC',
    },
    {
        name:       'WBTC/ETH',
        pool:       '0x2f5e87C9312fa29aed5c179E456625D79015299c',
        decimals0:  8,   // WBTC
        decimals1:  18,  // WETH
        fee:        3000,
        priceMode:  'direct',  // ETH per WBTC
        outputPair: 'WBTC/ETH',
    },
    {
        name:       'LINK/ETH',
        pool:       '0x468b88941e7Cc0B88c1869d68ab6b570bCEF62Ff',
        decimals0:  18,  // WETH (token0!)
        decimals1:  18,  // LINK (token1!)
        fee:        3000,
        priceMode:  'invert',  // sqrtP^2 = LINK/ETH -> need ETH/LINK = 1/sqrtP^2
        outputPair: 'LINK/ETH',
    },
    {
        name:       'ARB/ETH',
        pool:       '0xC6F780497A95e246EB9449f5e4770916DCd6396A',
        decimals0:  18,  // ARB
        decimals1:  18,  // WETH
        fee:        3000,
        priceMode:  'invert',  // sqrtP^2=WETH/ARB -> invert=ARB/ETH
        outputPair: 'ARB/ETH',
    },
];

// Camelot V2 pools on Arbitrum
const CAMELOT_POOLS = [
    {
        name:       'ETH/USDC',
        pool:       '0x84652bb2539513BAf36e225c930Fdd8eaa63CE27',
        decimals0:  18,   // WETH (token0, confirmed on-chain)
        decimals1:  6,    // USDC.e (token1, confirmed on-chain)
        fee:        0.003,
        priceMode:  'direct',  // adj1/adj0 = USDC/WETH = USD/ETH
        outputPair: 'ETH/USDC',
    },
];

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

function sqrtPriceX96ToPrice(sqrtPriceX96, decimals0, decimals1, priceMode) {
    const Q96   = BigInt(2) ** BigInt(96);
    const sqrtP = Number(sqrtPriceX96) / Number(Q96);
    const raw   = sqrtP * sqrtP * Math.pow(10, decimals0 - decimals1);
    return priceMode === 'invert' ? 1 / raw : raw;
}

function tvlProxy(liquidity, price, pairName) {
    const liq = Number(liquidity);
    if (pairName === 'ETH/USDC') return (liq / 1e6) * Math.sqrt(price) * 2;
    return liq / 1e12;
}

async function fetchUniV3Pool(cfg) {
    try {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, PROVIDER);
        const [slot0, liquidity] = await Promise.all([c.slot0(), c.liquidity()]);

        const price = sqrtPriceX96ToPrice(slot0[0], cfg.decimals0, cfg.decimals1, cfg.priceMode);
        if (!isFinite(price) || price <= 0) {
            console.error(`[ARB] UniV3 ${cfg.name}: invalid price=${price}`);
            return null;
        }

        return {
            pair:      cfg.outputPair,
            pool:      cfg.pool,
            price:     price,
            liquidity: Number(liquidity),
            tvlUSD:    tvlProxy(liquidity, price, cfg.outputPair),
            fee:       cfg.fee / 10000,
            tick:      Number(slot0[1]),
            source:    'uniswap_v3_arbitrum_onchain',
            venue:     'uniswap_v3',
            chain:     CHAIN_ID,
            timestamp: new Date().toISOString(),
        };
    } catch (err) {
        console.error(`[ARB] UniV3 ${cfg.name}: ${err.message.slice(0, 100)}`);
        return null;
    }
}

async function fetchCamelotPool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, PAIR_ABI_V2, PROVIDER);
        const res = await c.getReserves();

        // res[0] and res[1] are native bigint primitives in ethers v6
        // Use BigInt arithmetic to avoid Number overflow on large reserves
        const r0b = res[0];
        const r1b = res[1];
        if (r0b === 0n || r1b === 0n) return null;

        // Divide by token decimals using BigInt, then scale to float
        // PREC=1e9 gives 9 decimal places of precision
        const PREC   = 1000000000n;
        const SCALE0 = BigInt('1' + '0'.repeat(cfg.decimals0));
        const SCALE1 = BigInt('1' + '0'.repeat(cfg.decimals1));

        const adj0 = Number(r0b * PREC / SCALE0) / 1e9;
        const adj1 = Number(r1b * PREC / SCALE1) / 1e9;

        if (adj0 === 0 || adj1 === 0) return null;

        // raw = token1 per token0 (both already decimal-adjusted)
        const raw   = adj1 / adj0;
        const price = cfg.priceMode === 'invert' ? 1.0 / raw : raw;

        if (!isFinite(price) || price <= 0 || price > 1e12) return null;

        const tvlUSD = cfg.outputPair === 'ETH/USDC'
            ? adj0 * 2          // USDC.e side x2
            : adj1 * price * 2;

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
        console.error(`[ARB] Camelot ${cfg.outputPair}: ${e.message.slice(0, 100)}`);
        return null;
    }
}


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
        console.log('='.repeat(72));
        result.data.prices.forEach(p => {
            const tvl    = (p.tvlUSD || p.reserveUSD) ? `$${((p.tvlUSD||p.reserveUSD)/1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);
            console.log(`${p.venue.padEnd(12)} ${p.pair.padEnd(10)} ${px.padStart(14)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`);
        });
        console.log('='.repeat(72));
    }).catch(console.error);
}

module.exports = arbitrumFetcher;
