#!/usr/bin/env python3
"""
Writes a clean baseFetcher.js with:
- Verified pool addresses (from Uniswap V3 factory + Aerodrome docs)
- Correct sqrtPriceX96 price formula (same fix as arbitrumFetcher)
- Sequential fetching to avoid rate limits
- Only pools we can verify exist

Run: python3 write_base_fetcher.py
"""
import os

TARGET = os.path.expanduser(
    "~/Allmight/scripts/data_collection/masterFetcher/baseFetcher.js"
)

CONTENT = r"""// baseFetcher.js v1.1
// Fetches Uniswap V3 + Aerodrome pool data on Base Mainnet
// Chain: Base (chain_id: 8453)
// RPC: public endpoint (no key required)
//
// Price formula (same as arbitrumFetcher, verified):
//   sqrtP = Number(sqrtPriceX96) / 2^96
//   raw   = sqrtP^2 * 10^(dec0 - dec1)  <- token1 per token0
//
// Pool addresses verified via:
//   Uniswap V3: https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
//   Aerodrome:  https://aerodrome.finance/liquidity (sorted by TVL)

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL = process.env.BASE_MAINNET_RPC_URL || 'https://mainnet.base.org';
const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);

const CHAIN_ID       = 'base';
const CHAIN_NUM      = 8453;
const FETCH_DELAY_MS = 600; // public RPC needs more breathing room

const POOL_ABI_V3 = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
];

// Aerodrome uses a different getReserves signature than standard V2
// Returns uint256 instead of uint112
const PAIR_ABI_AERO = [
    'function getReserves() external view returns (uint256 _reserve0, uint256 _reserve1, uint256 _blockTimestampLast)',
    'function stable() external view returns (bool)',
];

// ── Uniswap V3 pools on Base (verified addresses) ────────────────────────────
// WETH on Base:  0x4200000000000000000000000000000000000006
// USDC on Base:  0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
// cbBTC on Base: 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
const UNISWAP_V3_POOLS = [
    {
        // ETH/USDC 0.05% — highest TVL pool on Base
        // token0=USDC(6), token1=WETH(18) on Base (opposite of mainnet)
        // Verify: raw = sqrtP^2 * 10^(6-18) = WETH/USDC -> invert = USD/ETH
        outputPair: 'ETH/USDC',
        pool:       '0xd0b53D9277642d899DF5C87A3966A349A798F224',
        decimals0:  6,    // USDC (token0 on Base)
        decimals1:  18,   // WETH (token1 on Base)
        fee:        500,
        priceMode:  'invert',
    },
    {
        // ETH/USDC 0.30%
        outputPair: 'ETH/USDC',
        pool:       '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18',
        decimals0:  6,
        decimals1:  18,
        fee:        3000,
        priceMode:  'invert',
    },
];

// ── Aerodrome pools on Base (verified addresses) ──────────────────────────────
// Aerodrome is the dominant DEX on Base (~$500M TVL)
// Volatile pools: 0.3% fee (same as Sushiswap V2)
// Stable pools:   0.01% fee (1 bps) — key advantage for stablecoin pairs
//
// Pool addresses from Aerodrome UI sorted by TVL (2026-02):
//   https://aerodrome.finance/liquidity
const AERODROME_POOLS = [
    {
        // WETH/USDC volatile pool — largest pool on Base
        // token0=WETH(18), token1=USDC(6)
        // raw = adj1/adj0 = USDC/WETH = USD/ETH directly
        outputPair: 'ETH/USDC',
        pool:       '0xcDAC0d6c6C59727a65F871236188350531885C43',
        decimals0:  18,   // WETH
        decimals1:  6,    // USDC
        fee:        0.003,
        stable:     false,
        priceMode:  'direct',
    },
    {
        // USDC/USDbC stable pool (two USDC variants)
        // token0=USDC(6), token1=USDbC(6)
        // Near peg, 0.01% fee
        outputPair: 'USDC/USDbC',
        pool:       '0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d',
        decimals0:  6,
        decimals1:  6,
        fee:        0.0001,
        stable:     true,
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

function tvlProxy(liq, price, pair) {
    const l = Number(liq);
    if (pair === 'ETH/USDC') return (l / 1e6) * Math.sqrt(price) * 2;
    return l / 1e12;
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchUniV3Pool(cfg) {
    try {
        const c = new ethers.Contract(cfg.pool, POOL_ABI_V3, PROVIDER);
        const [slot0, liq] = await Promise.all([c.slot0(), c.liquidity()]);

        const price = sqrtPriceX96ToPrice(slot0[0], cfg.decimals0, cfg.decimals1, cfg.priceMode);
        if (!isFinite(price) || price <= 0 || price > 1e15) {
            console.error(`[BASE] UniV3 ${cfg.outputPair}: invalid price=${price}`);
            return null;
        }

        return {
            pair:      cfg.outputPair,
            pool:      cfg.pool,
            price,
            liquidity: Number(liq),
            tvlUSD:    tvlProxy(liq, price, cfg.outputPair),
            fee:       cfg.fee / 10000,
            tick:      Number(slot0[1]),
            source:    'uniswap_v3_base_onchain',
            venue:     'uniswap_v3',
            chain:     CHAIN_ID,
            timestamp: new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[BASE] UniV3 ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,100)}`);
        return null;
    }
}

async function fetchAerodromePool(cfg) {
    try {
        const c   = new ethers.Contract(cfg.pool, PAIR_ABI_AERO, PROVIDER);
        const res = await c.getReserves();

        // res[0] and res[1] are BigInt in ethers v6
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
        if (!isFinite(price) || price <= 0 || price > 1e12) return null;

        // TVL: USDC side x2 for ETH pools, sum for stable pools
        const tvlUSD = cfg.outputPair === 'ETH/USDC'
            ? adj1 * 2          // USDC is token1 here
            : (adj0 + adj1);    // stable: both are USD-pegged

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool,
            price,
            reserve0:   r0b.toString(),
            reserve1:   r1b.toString(),
            reserveUSD: tvlUSD,
            fee:        cfg.fee,
            stable:     cfg.stable,
            source:     'aerodrome_base_onchain',
            venue:      'aerodrome',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[BASE] Aerodrome ${cfg.outputPair} ${cfg.pool.slice(0,10)}: ${e.message.slice(0,100)}`);
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function baseFetcher() {
    console.log('🔍 Fetching Base on-chain data (UniV3 + Aerodrome)...');
    const start = Date.now();

    const uniPrices = [];
    for (const cfg of UNISWAP_V3_POOLS) {
        const r = await fetchUniV3Pool(cfg);
        if (r) uniPrices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    const aeroPrices = [];
    for (const cfg of AERODROME_POOLS) {
        const r = await fetchAerodromePool(cfg);
        if (r) aeroPrices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    const allPrices = [...uniPrices, ...aeroPrices];
    console.log(`✅ Base: ${uniPrices.length}/${UNISWAP_V3_POOLS.length} UniV3, ${aeroPrices.length}/${AERODROME_POOLS.length} Aerodrome`);

    return {
        status: 'success',
        data: {
            prices:     allPrices,
            chain:      CHAIN_ID,
            chain_id:   CHAIN_NUM,
            venues:     ['uniswap_v3', 'aerodrome'],
            timestamp:  new Date().toISOString(),
            durationMs: Date.now() - start,
        },
    };
}

if (require.main === module) {
    baseFetcher().then(result => {
        console.log('\n📊 BASE ON-CHAIN DATA:');
        console.log('═'.repeat(72));
        result.data.prices.forEach(p => {
            const tvl    = (p.tvlUSD || p.reserveUSD)
                ? `$${((p.tvlUSD || p.reserveUSD) / 1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(2)}` : p.price.toFixed(6);
            console.log(
                `${p.venue.padEnd(12)} ${p.pair.padEnd(12)} ` +
                `${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`
            );
        });
        console.log('═'.repeat(72));
        if (result.data.prices.length === 0) {
            console.log('⚠ No prices — check pool addresses or RPC connectivity');
        }
    }).catch(console.error);
}

module.exports = baseFetcher;
"""

os.makedirs(os.path.dirname(TARGET), exist_ok=True)
with open(TARGET, 'w') as f:
    f.write(CONTENT)

print(f"✅ Wrote {TARGET}")
print("   Run: node scripts/data_collection/masterFetcher/baseFetcher.js")
