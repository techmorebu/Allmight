'use strict';

// balancerFetcherArbitrum.js v2.0
// Fetches Balancer V2 pool data on Arbitrum One
// Vault address: 0xBA12222222228d8Ba445958a75a0704d566BF2C8 (same on all chains)
//
// NOTE: BALANCER_POOLS is currently empty — poolIds need to be added.
// To find valid poolIds: visit app.balancer.fi, find the USDC/USDT/USDCe
// stable pool on Arbitrum, inspect the pool URL for its poolId (bytes32).
// Hardcode it below and this fetcher will start returning data.
//
// v2.0 provider migration:
//   Removed: new ethers.JsonRpcProvider(...)
//   Now uses: createProvider('arbitrum') + rpc.call(...)

require('dotenv').config();
const { ethers }         = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

const CHAIN_ID       = 'arbitrum';
const FETCH_DELAY_MS = 400;

const rpc = createProvider(CHAIN_ID);

// ── Balancer V2 Vault — same address on all chains ────────────────────────────
const VAULT_ADDR = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

const VAULT_ABI = [
    'function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)',
];

const POOL_ABI = [
    'function getSwapFeePercentage() external view returns (uint256)',
    'function getAmplificationParameter() external view returns (uint256 value, bool isUpdating, uint256 precision)',
    'function getActualSupply() external view returns (uint256)',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Pool configs ──────────────────────────────────────────────────────────────
// TODO: Add poolIds from app.balancer.fi → Arbitrum → stable pools
// Example entry when ready:
// {
//     name:       'USDC/USDT/USDCe stable',
//     outputPair: 'USDC/USDT',
//     pool:       '0x...',          // pool contract address
//     poolId:     '0x...000002',    // bytes32 poolId from Balancer
//     type:       'stable',
//     i:          0,                // index of token_in in vault token array
//     j:          1,                // index of token_out
//     decimals:   [6, 6, 6],        // decimals per token in vault order
// }
const BALANCER_POOLS = [];

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchBalancerPool(cfg) {
    try {
        const { tokens, balances } = await rpc.call(
            `arb.balancer.poolTokens:${cfg.outputPair}`,
            async (provider) => {
                const vault = new ethers.Contract(VAULT_ADDR, VAULT_ABI, provider);
                return vault.getPoolTokens(cfg.poolId);
            }
        );

        if (!balances || balances.length < 2) return null;

        const feeRaw = await rpc.call(
            `arb.balancer.fee:${cfg.outputPair}`,
            async (provider) => {
                const pool = new ethers.Contract(cfg.pool, POOL_ABI, provider);
                return pool.getSwapFeePercentage();
            }
        );

        // Balancer fee: 1e18 = 100%, so 1e14 = 0.01%
        const fee_bps = Number(feeRaw) / 1e18 * 10000;

        const i     = cfg.i;
        const j     = cfg.j;
        const bal_i = Number(balances[i]) / Math.pow(10, cfg.decimals[i]);
        const bal_j = Number(balances[j]) / Math.pow(10, cfg.decimals[j]);

        if (!bal_i || !bal_j) return null;

        const price    = bal_j / bal_i;
        const isStable = cfg.type === 'stable';

        if (isStable && (price < 0.9 || price > 1.1)) {
            console.error(`[BAL-ARB] ${cfg.outputPair}: price out of range: ${price.toFixed(6)}`);
            return null;
        }
        if (!isStable && (price < 0.0001 || price > 1e8)) return null;

        const tvlUSD = balances.reduce(
            (sum, b, idx) => sum + Number(b) / Math.pow(10, cfg.decimals[idx] || 6),
            0
        );

        return {
            pair:       cfg.outputPair,
            pool:       cfg.pool.toLowerCase(),
            price,
            fee:        fee_bps / 10000,
            fee_bps,
            tvlUSD,
            poolType:   cfg.type,
            source:     'balancer_v2_arbitrum_onchain',
            venue:      'balancer_v2',
            chain:      CHAIN_ID,
            timestamp:  new Date().toISOString(),
        };
    } catch (e) {
        console.error(`[BAL-ARB] ${cfg.name}: ${e.message.slice(0, 100)}`);
        return null;
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function balancerFetcherArbitrum() {
    console.log('[balancerFetcherArbitrum] Fetching Balancer V2 Arbitrum on-chain data...');
    const start  = Date.now();
    const prices = [];

    for (const cfg of BALANCER_POOLS) {
        const r = await fetchBalancerPool(cfg);
        if (r) prices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    if (BALANCER_POOLS.length === 0) {
        console.log('[balancerFetcherArbitrum] No pools configured. Add poolIds to BALANCER_POOLS to enable.');
    } else {
        console.log(`[balancerFetcherArbitrum] ${prices.length}/${BALANCER_POOLS.length} pools (${Date.now() - start}ms)`);
    }

    return {
        status: 'success',
        data: {
            prices,
            chain:      CHAIN_ID,
            chain_id:   42161,
            venues:     ['balancer_v2'],
            timestamp:  new Date().toISOString(),
            durationMs: Date.now() - start,
        },
    };
}

balancerFetcherArbitrum.chain = 'arbitrum';

module.exports = balancerFetcherArbitrum;

if (require.main === module) {
    balancerFetcherArbitrum().then(result => {
        console.log('\nBALANCER ARBITRUM DATA:');
        console.log('='.repeat(76));
        if (result.data.prices.length === 0) {
            console.log('  (no pools configured — add poolIds to BALANCER_POOLS)');
        }
        result.data.prices.forEach(p => {
            const tvl    = p.tvlUSD ? `$${(p.tvlUSD / 1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
            console.log(`${'balancer_v2'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`);
        });
        console.log('='.repeat(76));
    }).catch(console.error);
}
