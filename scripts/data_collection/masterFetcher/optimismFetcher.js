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
    'function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256)',
    'function totalSupply() external view returns (uint256)',
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
        // ETH/USDC native 0.05% -- verified via factory
        outputPair: 'ETH/USDC',
        pool:       '0x1fb3cf6e48F1E7B10213E7b6d87D4c073C7Fdb7b',
        decimals0:  18,
        decimals1:  6,
        fee:        500,
        priceMode:  'direct',
    },
    {
        // ETH/USDCe 0.05% -- verified via factory
        outputPair: 'ETH/USDC',
        pool:       '0x85149247691df622eaF1a8Bd0CaFd40BC45154a9',
        decimals0:  18,
        decimals1:  6,
        fee:        500,
        priceMode:  'direct',
    },
    {
        // ETH/USDCe 0.3% -- verified via factory
        outputPair: 'ETH/USDC',
        pool:       '0xB589969D38CE76D3d7AA319De7133bC9755fD840',
        decimals0:  18,
        decimals1:  6,
        fee:        3000,
        priceMode:  'direct',
    },
    {
        // USDC/USDT 0.01% native USDC -- verified via factory
        outputPair: 'USDC/USDT',
        pool:       '0xA73C628eaf6e283E26A7b1f8001CF186aa4c0E8E',
        decimals0:  6,
        decimals1:  6,
        fee:        100,
        priceMode:  'direct',
    },
    {
        // USDCe/USDT 0.01% -- confirmed UniV3 fee=100 via on-chain check
        outputPair: 'USDCe/USDT',
        pool:       '0xF1F199342687A7d78bCC16fce79fa2665EF870E1',
        decimals0:  6,
        decimals1:  6,
        fee:        100,
        priceMode:  'direct',
    },
    {
        // USDCe/USDT 0.05% -- verified via factory
        outputPair: 'USDCe/USDT',
        pool:       '0xF3F3433c3a97F70349C138ada81da4D3554982DB',
        decimals0:  6,
        decimals1:  6,
        fee:        500,
        priceMode:  'direct',
    },
    // DAI/USDC pool removed -- decimals mismatch causing price=0, needs on-chain verification
];

// ── Velodrome V2 pools (verified from velodrome.finance) ──────────────────────
const VELODROME_POOLS = [
    {
        // WETH/USDC volatile
        // On-chain: token0=USDC(6dec), token1=WETH(18dec)
        // getAmountOut(1 USDC, USDC) -> WETH amount
        // ETH price = 1e6 / (wethOut / 1e18)
        outputPair: 'ETH/USDC',
        pool:       '0xF4F2657AE744354bAcA871E56775e5083F7276Ab',
        token0:     '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',  // USDC (actual token0)
        decimals0:  6,    // USDC
        decimals1:  18,   // WETH
        fee:        0.003,
        stable:     false,
        priceMode:  'invert',  // getAmountOut gives WETH/USDC, we want USDC/ETH
    },
    {
        // USDCe/USDT stable -- 0.02% fee -- $14k TVL -- REAL SIGNAL
        // On-chain verified: token0=USDCe, token1=USDT
        outputPair: 'USDCe/USDT',
        pool:       '0x2B47C794c3789f499D8A54Ec12f949EeCCE8bA16',
        token0:     '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',  // USDCe
        decimals0:  6,
        decimals1:  6,
        fee:        0.0002,
        stable:     true,
        priceMode:  'direct',
    },
    // USDC/USDT stable removed -- $0 TVL, no liquidity
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
        const tvlUSD /* NOTE: may be wrong for pools where token decimals differ */ /* NOTE: may be wrong for pools where token decimals differ */ = cfg.outputPair.includes('ETH') ? (liqNum / 1e6) * Math.sqrt(price) * 2 : liqNum / 1e9;
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
        const c = new ethers.Contract(cfg.pool, VELO_ABI, PROVIDER);

        // getAmountOut is correct for BOTH stable and volatile Velodrome pools
        // Reserve ratio gives wrong price for stable pools (stableswap invariant)
        // For volatile pools, getAmountOut == reserve ratio but is safer
        const AMOUNT_IN = BigInt(10 ** cfg.decimals0); // 1 unit of token0
        const [res, amountOut] = await Promise.all([
            c.getReserves(),
            c.getAmountOut(AMOUNT_IN, cfg.token0),
        ]);

        if (res[0] === 0n || res[1] === 0n) return null;
        if (!amountOut || amountOut === 0n) return null;

        // price = units of token1 per 1 token0
        const rawPrice = Number(amountOut) / (10 ** cfg.decimals1);
        const price    = cfg.priceMode === 'invert' ? 1.0 / rawPrice : rawPrice;

        if (!isFinite(price) || price <= 0) return null;
        if (cfg.stable && (price < 0.9 || price > 1.1)) {
            console.error(`[OP] Velodrome ${cfg.outputPair}: stable price=${price.toFixed(6)} out of range`);
            return null;
        }
        if (!cfg.stable) {
            // ETH/USDC should be ~1500-5000, not 0 or billions
            const minP = cfg.priceMode === 'invert' ? 100 : 0.00001;
            const maxP = cfg.priceMode === 'invert' ? 100000 : 1e8;
            if (price < minP || price > maxP) {
                console.error(`[OP] Velodrome ${cfg.outputPair}: volatile price=${price.toFixed(4)} out of range`);
                return null;
            }
        }

        const adj0   = Number(res[0]) / (10 ** cfg.decimals0);
        const adj1   = Number(res[1]) / (10 ** cfg.decimals1);
        const tvlUSD = cfg.stable
            ? adj0 + adj1
            : cfg.outputPair.includes('ETH') ? adj1 * 2 : adj1 * price * 2;

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            reserveUSD: tvlUSD,
            fee:        cfg.fee,
            stable:     cfg.stable,
            source:     'velodrome_optimism_onchain',
            venue:      'velodrome',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
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
