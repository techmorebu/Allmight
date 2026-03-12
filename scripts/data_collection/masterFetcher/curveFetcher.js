'use strict';

// curveFetcherArbitrum.js v2.0
// Fetches Curve Finance pool data on Arbitrum One
// Pool addresses are immutable -- verified from curve.fi/arbitrum
//
// v2.0 provider migration:
//   Removed: new ethers.JsonRpcProvider(...)
//   Now uses: createProvider('arbitrum') + rpc.call(...)
//   One rpc.call per on-chain read. Sequential loop. No stampedes.

require('dotenv').config();
const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const CHAIN_ID       = 'arbitrum';
const FETCH_DELAY_MS = 400;

const rpc = createProvider(CHAIN_ID);

// ── ABIs ──────────────────────────────────────────────────────────────────────
const CURVE_2POOL_ABI = [
    'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
    'function balances(uint256 i) external view returns (uint256)',
    'function fee() external view returns (uint256)',
    'function coins(uint256 i) external view returns (address)',
    'function A() external view returns (uint256)',
];

const CURVE_TRICRYPTO_ABI = [
    'function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256)',
    'function balances(uint256 i) external view returns (uint256)',
    'function fee() external view returns (uint256)',
    'function price_oracle(uint256 k) external view returns (uint256)',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Pool configs (unchanged from v1.0) ────────────────────────────────────────
const CURVE_POOLS = [
    {
        name:       'USDC/USDT 2pool',
        outputPair: 'USDC/USDT',
        pool:       '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
        type:       '2pool',
        coin0dec:   6,
        coin1dec:   6,
        i:          0,
        j:          1,
        dx:         1000n * 1000000n,  // 1000 USDC
    },
    {
        name:       'tricrypto (USDT/WBTC/ETH)',
        outputPair: 'ETH/USDT',
        pool:       '0x960ea3e3C7FB317332d990873d354E18d7645590',
        type:       'tricrypto',
        coin0dec:   6,
        coin1dec:   18,
        i:          0,
        j:          2,
        dx:         1000n * 1000000n,  // 1000 USDT
    },
];

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchCurve2Pool(cfg) {
    try {
        const dy = await rpc.call(
            `arb.curve.2pool.dy:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, provider);
                return c.get_dy(cfg.i, cfg.j, cfg.dx);
            }
        );

        const fee = await rpc.call(
            `arb.curve.2pool.fee:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, provider);
                return c.fee();
            }
        );

        const bal0 = await rpc.call(
            `arb.curve.2pool.bal0:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, provider);
                return c.balances(0);
            }
        );

        const bal1 = await rpc.call(
            `arb.curve.2pool.bal1:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, provider);
                return c.balances(1);
            }
        );

        const dx_human    = Number(cfg.dx) / Math.pow(10, cfg.coin0dec);
        const dy_human    = Number(dy)     / Math.pow(10, cfg.coin1dec);
        const price       = dy_human / dx_human;
        const fee_bps_val = Number(fee) / 1e10 * 10000;

        if (price < 0.9 || price > 1.1) {
            console.error(`[CURVE-ARB] ${cfg.outputPair}: price out of range: ${price.toFixed(6)}`);
            return null;
        }

        const tvl = (Number(bal0) / Math.pow(10, cfg.coin0dec)) +
                    (Number(bal1) / Math.pow(10, cfg.coin1dec));

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            fee:        fee_bps_val / 10000,
            fee_bps:    fee_bps_val,
            tvlUSD:     tvl,
            source:     'curve_arbitrum_onchain',
            venue:      'curve',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[CURVE-ARB] ${cfg.name}: ${e.message.slice(0, 100)}`);
        return null;
    }
}

async function fetchCurveTricrypto(cfg) {
    try {
        const oracle = await rpc.call(
            `arb.curve.tricrypto.oracle:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_TRICRYPTO_ABI, provider);
                return c.price_oracle(1);  // index 1 = ETH/USDT price
            }
        );

        const fee = await rpc.call(
            `arb.curve.tricrypto.fee:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_TRICRYPTO_ABI, provider);
                return c.fee();
            }
        );

        const bal0 = await rpc.call(
            `arb.curve.tricrypto.bal0:${cfg.outputPair}`,
            async (provider) => {
                const c = new ethers.Contract(cfg.pool, CURVE_TRICRYPTO_ABI, provider);
                return c.balances(0);
            }
        );

        const price       = Number(oracle) / 1e18;
        const fee_bps_val = Number(fee) / 1e10 * 10000;

        if (price < 100 || price > 100000) {
            console.error(`[CURVE-ARB] ${cfg.outputPair}: ETH price out of range: ${price}`);
            return null;
        }

        const tvl = Number(bal0) / 1e6 * 2;

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            fee:        fee_bps_val / 10000,
            fee_bps:    fee_bps_val,
            tvlUSD:     tvl,
            source:     'curve_arbitrum_onchain',
            venue:      'curve',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[CURVE-ARB] ${cfg.name}: ${e.message.slice(0, 100)}`);
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function curveFetcherArbitrum() {
    console.log('[curveFetcherArbitrum] Fetching Curve Arbitrum on-chain data...');
    const start  = Date.now();
    const prices = [];

    for (const cfg of CURVE_POOLS) {
        const r = cfg.type === 'tricrypto'
            ? await fetchCurveTricrypto(cfg)
            : await fetchCurve2Pool(cfg);
        if (r) prices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    console.log(`[curveFetcherArbitrum] ${prices.length}/${CURVE_POOLS.length} pools (${Date.now() - start}ms)`);

    return {
        status: 'success',
        data: {
            prices,
            chain:      CHAIN_ID,
            chain_id:   42161,
            venues:     ['curve'],
            timestamp:  new Date().toISOString(),
            durationMs: Date.now() - start,
        },
    };
}

curveFetcherArbitrum.chain = 'arbitrum';

module.exports = curveFetcherArbitrum;

if (require.main === module) {
    curveFetcherArbitrum().then(result => {
        console.log('\nCURVE ARBITRUM DATA:');
        console.log('='.repeat(72));
        result.data.prices.forEach(p => {
            const tvl    = p.tvlUSD ? `$${(p.tvlUSD / 1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 10 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);
            console.log(`${'curve'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`);
        });
        console.log('='.repeat(72));
    }).catch(console.error);
}
