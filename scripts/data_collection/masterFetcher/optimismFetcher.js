// optimismFetcher.js v1.0
// Fetches Velodrome V2 + Uniswap V3 pool data on Optimism
// Chain: Optimism (chain_id: 10)
// Gas: ~0.001 gwei -- essentially free
//
// KEY OPPORTUNITY: Velodrome stable pools at 0.02% (2 bps)
// Paired with UniV3 0.05% = 7 bps total fee wall
// Velodrome volatile pools: 0.3% (30 bps)

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL  = process.env.OPTIMISM_MAINNET_RPC_URL_1
               || process.env.OPTIMISM_MAINNET_RPC_URL
               || 'https://mainnet.optimism.io';
const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);

const CHAIN_ID       = 'optimism';
const CHAIN_NUM      = 10;
const FETCH_DELAY_MS = 400;

const POOL_ABI_V3 = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
    'function liquidity() external view returns (uint128)',
];

// Velodrome V2 uses same ABI as Aerodrome
const VELO_ABI = [
    'function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
];

// ── Optimism token addresses ──────────────────────────────────────────────────
// WETH:  0x4200000000000000000000000000000000000006
// USDC:  0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85  (native)
// USDC.e:0x7F5c764cBc14f9669B88837ca1490cCa17c31607  (bridged)
// USDT:  0x94b008aA00579c1307B0EF2c499aD98a8ce58e58
// DAI:   0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1
// OP:    0x4200000000000000000000000000000000000042
// WBTC:  0x68f180fcCe6836688e9084f035309E29Bf0A2095

// ── Uniswap V3 pools on Optimism ─────────────────────────────────────────────
const UNISWAP_V3_POOLS = [
    {
        outputPair: 'ETH/USDC',
        pool:       '0x85149247691df622eaF1a8Bd0CaFd40BC45154a9',
        decimals0:  18,   // WETH (token0)
        decimals1:  6,    // USDC (token1)
        fee:        500,
        priceMode:  'direct',
    },
    {
        outputPair: 'ETH/USDC',
        pool:       '0xB589969D38CE76D3d7AA319De7133bC9755fD840',
        decimals0:  18,
        decimals1:  6,
        fee:        3000,
        priceMode:  'direct',
    },
    {
        outputPair: 'ETH/USDC',
        pool:       '0x1fb3cf6e48F1E7B10213E7b6d87D4c073C7Fdb7b',
        decimals0:  18,
        decimals1:  6,
        fee:        3000,
        priceMode:  'direct',
    },
    {
        outputPair: 'USDC/USDT',
        pool:       '0xA73C628eaf6e283E26A7b1f8001CF186aa4c0E8E',
        decimals0:  6,    // USDC.e (token0)
        decimals1:  6,    // USDT (token1)
        fee:        100,
        priceMode:  'direct',
    },
];

// ── Velodrome V2 pools (verified from velodrome.finance) ──────────────────────
const VELODROME_POOLS = [
    {
        // WETH/USDC volatile -- high TVL, main ETH/USD pair
        outputPair: 'ETH/USDC',
        pool:       '0x0493Bf8b6DBB159Ce2Db2E0E8403E753Abd1235b',
        decimals0:  18,   // WETH
        decimals1:  6,    // USDC.e
        fee:        0.003,
        stable:     false,
        priceMode:  'direct',
    },
    {
        // USDC/USDT stable -- 0.02% fee (2 bps) KEY OPPORTUNITY
        outputPair: 'USDC/USDT',
        pool:       '0xF1F199342687A7d78bCC16fce79fa2665EF870E1',
        decimals0:  6,    // USDC.e
        decimals1:  6,    // USDT
        fee:        0.0002,
        stable:     true,
        priceMode:  'direct',
    },
    {
        // USDC/DAI stable -- 0.02% fee (2 bps)
        outputPair: 'USDC/DAI',
        pool:       '0x4F7ebc19844259386DBdDB7b2eB759eeFc6F8353',
        decimals0:  6,    // USDC.e
        decimals1:  18,   // DAI
        fee:        0.0002,
        stable:     true,
        priceMode:  'invert',  // DAI(18)/USDC(6) needs invert
    },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function sqrtPriceX96ToPrice(sqrtPriceX96Raw, dec0, dec1, mode) {
    const Q96   = 2n ** 96n;
    const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
    const raw   = sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
    return mode === 'invert' ? 1.0 / raw : raw;
}

async function fetchUniV3Pool(cfg) {
    try {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, PROVIDER);
        const [slot0, liq] = await Promise.all([c.slot0(), c.liquidity()]);
        const price = sqrtPriceX96ToPrice(slot0[0], cfg.decimals0, cfg.decimals1, cfg.priceMode);
        if (!isFinite(price) || price <= 0 || price > 1e15) return null;
        const isStable = !cfg.outputPair.includes('ETH') && !cfg.outputPair.includes('BTC');
        if (isStable && (price < 0.9 || price > 1.1)) {
            console.error(`[OP] UniV3 ${cfg.outputPair}: price out of range: ${price.toFixed(6)}`);
            return null;
        }
        const liqNum = Number(liq);
        const tvlUSD = cfg.outputPair.includes('ETH') ? (liqNum / 1e6) * Math.sqrt(price) * 2 : liqNum / 1e9;
        return {
            pair: cfg.outputPair, pool: cfg.pool, price,
            liquidity: liqNum, tvlUSD,
            fee: cfg.fee / 10000,
            source: 'uniswap_v3_optimism_onchain', venue: 'uniswap_v3',
            chain: CHAIN_ID, timestamp: new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[OP] UniV3 ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,80)}`);
        return null;
    }
}

async function fetchVelodromePool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, VELO_ABI, PROVIDER);
        const res = await c.getReserves();
        const r0b = res[0], r1b = res[1];
        if (r0b === 0n || r1b === 0n) return null;
        const PREC = 1000000000n;
        const adj0 = Number(r0b * PREC / BigInt('1' + '0'.repeat(cfg.decimals0))) / 1e9;
        const adj1 = Number(r1b * PREC / BigInt('1' + '0'.repeat(cfg.decimals1))) / 1e9;
        if (!adj0 || !adj1) return null;
        const raw   = adj1 / adj0;
        const price = cfg.priceMode === 'invert' ? 1.0 / raw : raw;
        if (!isFinite(price) || price <= 0 || price > 1e12) return null;
        if (cfg.stable && (price < 0.9 || price > 1.1)) {
            console.error(`[OP] Velodrome ${cfg.outputPair}: stable price out of range: ${price.toFixed(6)}`);
            return null;
        }
        const tvlUSD = cfg.outputPair.includes('ETH') ? adj1 * 2 : cfg.stable ? (adj0 + adj1) : adj1 * price * 2;
        return {
            pair: cfg.outputPair, pool: cfg.pool, price,
            reserve0: r0b.toString(), reserve1: r1b.toString(), reserveUSD: tvlUSD,
            fee: cfg.fee, stable: cfg.stable,
            source: 'velodrome_optimism_onchain', venue: 'velodrome',
            chain: CHAIN_ID, timestamp: new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[OP] Velodrome ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,80)}`);
        return null;
    }
}

async function optimismFetcher() {
    console.log('Fetching Optimism on-chain data (UniV3 + Velodrome)...');
    const start = Date.now();
    const uniPrices  = [];
    const veloPrices = [];

    for (const cfg of UNISWAP_V3_POOLS) {
        const r = await fetchUniV3Pool(cfg);
        if (r) uniPrices.push(r);
        await sleep(FETCH_DELAY_MS);
    }
    for (const cfg of VELODROME_POOLS) {
        const r = await fetchVelodromePool(cfg);
        if (r) veloPrices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    const allPrices = [...uniPrices, ...veloPrices];
    console.log(`Optimism: ${uniPrices.length}/${UNISWAP_V3_POOLS.length} UniV3, ${veloPrices.length}/${VELODROME_POOLS.length} Velodrome`);

    return {
        status: 'success',
        data: {
            prices: allPrices, chain: CHAIN_ID, chain_id: CHAIN_NUM,
            venues: ['uniswap_v3', 'velodrome'],
            timestamp: new Date().toISOString(), durationMs: Date.now() - start,
        },
    };
}

if (require.main === module) {
    optimismFetcher().then(result => {
        console.log('\nOPTIMISM ON-CHAIN DATA:');
        console.log('='.repeat(76));
        result.data.prices.forEach(p => {
            const tvl    = (p.tvlUSD || p.reserveUSD) ? `$${((p.tvlUSD||p.reserveUSD)/1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
            console.log(`${p.venue.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`);
        });
        console.log('='.repeat(76));
    }).catch(console.error);
}

module.exports = optimismFetcher;
