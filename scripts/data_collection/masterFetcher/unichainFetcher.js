// unichainFetcher.js v1.0
// Fetches Uniswap V3 + V4 pool data on Unichain
// Chain: Unichain (chain_id: 130 per Infura)
// Gas: ~0.002 gwei -- near free
// Status: low competition -- new chain, most bots not deployed here yet
//
// Note: Uniswap V4 uses a single PoolManager contract
// V3 pools still exist and are the most liquid initially

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL  = process.env.UNICHAIN_MAINNET_RPC_URL_1 || 'https://mainnet.unichain.org';
const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);

const CHAIN_ID       = 'unichain';
const CHAIN_NUM      = 130;
const FETCH_DELAY_MS = 500;

const POOL_ABI_V3 = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
    'function liquidity() external view returns (uint128)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
];

// ── Unichain token addresses ──────────────────────────────────────────────────
// WETH:  0x4200000000000000000000000000000000000006  (same as other OP-stack chains)
// USDC:  0x078D782b760474a361dDA0AF3839290b0EF57E2e  (native USDC on Unichain)
// USDT:  0x9151434b16b9763660705744e285bE4BDB5B00Ca

// Unichain uses Uniswap V4 -- V3 factory not deployed
// V4 PoolManager: 0x1F98431c8aD98523631AE4a59f267346ea31F984 (TBC)
// TODO: implement V4 PoolManager.getSlot0() interface
const UNISWAP_V3_POOLS = [ // EMPTY until V4 ABI implemented
    {
        outputPair: 'ETH/USDC',
        pool:       '0xf04B5FA1Ef01b1c52a84b3B6cF7C7f39c95cB87e',
        decimals0:  18,
        decimals1:  6,
        fee:        500,
        priceMode:  'direct',
    },
    {
        outputPair: 'ETH/USDC',
        pool:       '0xE4f4AaC6c0bF56A95e6Ca7440Cde6fCA11e4c39c',
        decimals0:  18,
        decimals1:  6,
        fee:        3000,
        priceMode:  'direct',
    },
    {
        outputPair: 'USDC/USDT',
        pool:       '0x5e69aC31c3Dc0f5a86B7E8Ab462E2F5c03C18F1e',
        decimals0:  6,
        decimals1:  6,
        fee:        100,
        priceMode:  'direct',
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
            console.error(`[UNICHAIN] ${cfg.outputPair}: price out of range: ${price.toFixed(6)}`);
            return null;
        }
        return {
            pair: cfg.outputPair, pool: cfg.pool, price,
            liquidity: Number(liq),
            fee: cfg.fee / 10000,
            source: 'uniswap_v3_unichain_onchain', venue: 'uniswap_v3',
            chain: CHAIN_ID, timestamp: new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[UNICHAIN] ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,80)}`);
        return null;
    }
}

async function unichainFetcher() {
    console.log('Fetching Unichain on-chain data (UniV3)...');
    const start  = Date.now();
    const prices = [];

    for (const cfg of UNISWAP_V3_POOLS) {
        const r = await fetchUniV3Pool(cfg);
        if (r) prices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    console.log(`Unichain: ${prices.length}/${UNISWAP_V3_POOLS.length} UniV3`);

    return {
        status: 'success',
        data: {
            prices, chain: CHAIN_ID, chain_id: CHAIN_NUM,
            venues: ['uniswap_v3'],
            timestamp: new Date().toISOString(), durationMs: Date.now() - start,
        },
    };
}

if (require.main === module) {
    unichainFetcher().then(result => {
        console.log('\nUNICHAIN ON-CHAIN DATA:');
        console.log('='.repeat(76));
        if (result.data.prices.length === 0) {
            console.log('No pools found -- pool addresses may need verification');
            console.log('Run discover_pools.py with UNICHAIN_MAINNET_RPC_URL_1 to find correct addresses');
        }
        result.data.prices.forEach(p => {
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
            console.log(`${'uniswap_v3'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | fee: ${feePct}`);
        });
        console.log('='.repeat(76));
    }).catch(console.error);
}

module.exports = unichainFetcher;
