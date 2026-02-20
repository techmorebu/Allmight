#!/usr/bin/env python3
"""
Writes curveFetcherArbitrum.js -- fetches Curve Finance pools on Arbitrum.
Pool addresses are hardcoded (Curve pools are immutable, addresses don't change).

Curve 2pool on Arbitrum (USDC/USDT):
  Address: 0x7f90122BF0700F9E7e1F688fe926940E8839F353
  Coins: USDC(0), USDT(1)
  Fee: 0.04% (4 bps)

Curve tricrypto on Arbitrum (USDT/WBTC/ETH):
  Address: 0x960ea3e3C7FB317332d990873d354E18d7645590
  Fee: 0.03% (3 bps)

Run: python3 build_curve_arbitrum.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/curveFetcherArbitrum.js"
)

CONTENT = r"""// curveFetcherArbitrum.js v1.0
// Fetches Curve Finance pool data on Arbitrum One
// Pool addresses are immutable -- verified from curve.fi/arbitrum
//
// KEY POOL: 2pool (USDC/USDT) at 0.04% (4 bps)
//   Paired with UniV3 USDC/USDT 0.01% = 5 bps total fee wall
//   vs 3.29 bps spread in calm market, 10-20 bps during volatility

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc'
);

const CHAIN_ID       = 'arbitrum';
const FETCH_DELAY_MS = 400;

// Curve StableSwap ABI (2pool / plain pools)
const CURVE_2POOL_ABI = [
    'function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256)',
    'function balances(uint256 i) external view returns (uint256)',
    'function fee() external view returns (uint256)',
    'function coins(uint256 i) external view returns (address)',
    'function A() external view returns (uint256)',
];

// Curve tricrypto ABI (uses uint256 indexes instead of int128)
const CURVE_TRICRYPTO_ABI = [
    'function get_dy(uint256 i, uint256 j, uint256 dx) external view returns (uint256)',
    'function balances(uint256 i) external view returns (uint256)',
    'function fee() external view returns (uint256)',
    'function price_oracle(uint256 k) external view returns (uint256)',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Curve pool configs ────────────────────────────────────────────────────────
const CURVE_POOLS = [
    {
        name:       'USDC/USDT 2pool',
        outputPair: 'USDC/USDT',
        pool:       '0x7f90122BF0700F9E7e1F688fe926940E8839F353',
        type:       '2pool',
        // coin0 = USDC (6 decimals), coin1 = USDT (6 decimals)
        coin0dec:   6,
        coin1dec:   6,
        // Query: buy 1000 USDC (coin0), get how much USDT (coin1)?
        i:          0,   // from USDC
        j:          1,   // to USDT
        dx:         1000n * 1000000n,  // 1000 USDC in raw units (6 dec)
    },
    {
        name:       'tricrypto (USDT/WBTC/ETH)',
        outputPair: 'ETH/USDT',
        pool:       '0x960ea3e3C7FB317332d990873d354E18d7645590',
        type:       'tricrypto',
        // coin0=USDT(6), coin1=WBTC(8), coin2=ETH(18)
        // price_oracle(1) = ETH/USDT price
        coin0dec:   6,
        coin1dec:   18,
        i:          0,   // from USDT
        j:          2,   // to WETH
        dx:         1000n * 1000000n,  // 1000 USDT
    },
];

async function fetchCurve2Pool(cfg) {
    try {
        const c = new ethers.Contract(cfg.pool, CURVE_2POOL_ABI, PROVIDER);

        // Get price: how much coin1 do we get for dx coin0?
        const dy  = await c.get_dy(cfg.i, cfg.j, cfg.dx);
        const fee = await c.fee();  // fee in 1e10 units (1e8 = 1%)

        // price = dy/dx adjusted for decimals
        const dx_human = Number(cfg.dx) / Math.pow(10, cfg.coin0dec);
        const dy_human = Number(dy)     / Math.pow(10, cfg.coin1dec);
        const price    = dy_human / dx_human;

        // fee: Curve stores as integer where 1e10 = 100%
        // e.g. 4000000 = 0.04%
        const fee_pct     = Number(fee) / 1e10 * 100;  // percent
        const fee_bps_val = fee_pct * 100;              // basis points

        // Sanity check for stablecoin pairs
        if (price < 0.9 || price > 1.1) {
            console.error(`[CURVE-ARB] ${cfg.outputPair}: price out of range: ${price.toFixed(6)}`);
            return null;
        }

        // Get pool balances for TVL estimate
        const bal0 = await c.balances(0);
        const bal1 = await c.balances(1);
        const tvl  = (Number(bal0) / Math.pow(10, cfg.coin0dec)) +
                     (Number(bal1) / Math.pow(10, cfg.coin1dec));

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            fee:        fee_bps_val / 10000,  // store as decimal for adapter
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
        const c = new ethers.Contract(cfg.pool, CURVE_TRICRYPTO_ABI, PROVIDER);

        // price_oracle(1) gives ETH price in USDT (18 decimals)
        const oracle = await c.price_oracle(1);
        const price  = Number(oracle) / 1e18;
        const fee    = await c.fee();
        const fee_bps_val = Number(fee) / 1e10 * 10000;

        if (price < 100 || price > 100000) {
            console.error(`[CURVE-ARB] ${cfg.outputPair}: ETH price out of range: ${price}`);
            return null;
        }

        const bal0 = await c.balances(0);
        const tvl  = Number(bal0) / 1e6 * 2;

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

async function curveFetcherArbitrum() {
    console.log('Fetching Curve Arbitrum on-chain data...');
    const start  = Date.now();
    const prices = [];

    for (const cfg of CURVE_POOLS) {
        const r = cfg.type === 'tricrypto'
            ? await fetchCurveTricrypto(cfg)
            : await fetchCurve2Pool(cfg);
        if (r) prices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    console.log(`Curve Arbitrum: ${prices.length}/${CURVE_POOLS.length} pools`);

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

if (require.main === module) {
    curveFetcherArbitrum().then(result => {
        console.log('\nCURVE ARBITRUM DATA:');
        console.log('='.repeat(72));
        result.data.prices.forEach(p => {
            const tvl    = p.tvlUSD ? `$${(p.tvlUSD / 1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 10 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);
            console.log(
                `${'curve'.padEnd(12)} ${p.pair.padEnd(14)} ` +
                `${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`
            );
        });
        console.log('='.repeat(72));
    }).catch(console.error);
}

module.exports = curveFetcherArbitrum;
"""

os.makedirs(os.path.dirname(TARGET), exist_ok=True)
with open(TARGET, 'w') as f:
    f.write(CONTENT)

print(f"Written: {TARGET}")
print("Run: node scripts/data_collection/masterFetcher/curveFetcherArbitrum.js")
