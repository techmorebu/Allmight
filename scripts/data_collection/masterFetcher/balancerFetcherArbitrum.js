// balancerFetcherArbitrum.js v1.0
// Fetches Balancer V2 pool data on Arbitrum One
// Stable pools: 0.01% (1 bps) -- KEY: adds 2nd venue for stablecoin arb
// Balancer Vault: 0xBA12222222228d8Ba445958a75a0704d566BF2C8 (same all chains)

'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const RPC_URL  = process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc';
const PROVIDER = new ethers.JsonRpcProvider(RPC_URL);

const CHAIN_ID       = 'arbitrum';
const FETCH_DELAY_MS = 400;

// Balancer V2 Vault -- same address on all chains
const VAULT_ADDR = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';

const VAULT_ABI = [
    'function getPoolTokens(bytes32 poolId) external view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)',
];

const POOL_ABI = [
    'function getSwapFeePercentage() external view returns (uint256)',
    'function getAmplificationParameter() external view returns (uint256 value, bool isUpdating, uint256 precision)',
    'function getActualSupply() external view returns (uint256)',
];

// ── Balancer V2 pool configs on Arbitrum ─────────────────────────────────────
// Pool IDs are fixed -- from Balancer subgraph / app.balancer.fi
const BALANCER_POOLS = [
    // Balancer V2 REST API blocked by network policy
    // To fix: query vault directly with confirmed poolIds from app.balancer.fi
    // Best Arbitrum stable pool: search for USDC/USDT/USDCe on balancer.fi
    // TODO next session: hardcode poolId from browser inspection
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBalancerPool(cfg) {
    try {
        const vault    = new ethers.Contract(VAULT_ADDR, VAULT_ABI, PROVIDER);
        const poolCtrl = new ethers.Contract(cfg.pool, POOL_ABI, PROVIDER);

        // Get token balances from vault
        const { tokens, balances } = await vault.getPoolTokens(cfg.poolId);
        if (!balances || balances.length < 2) return null;

        // Get swap fee
        const feeRaw = await poolCtrl.getSwapFeePercentage();
        // Balancer fee: 1e18 = 100%, so 1e14 = 0.01%
        const fee_bps = Number(feeRaw) / 1e18 * 10000;

        // Calculate price from balances
        // For stable pools: price ≈ balance ratio adjusted for decimals
        const i = cfg.i, j = cfg.j;
        const bal_i = Number(balances[i]) / Math.pow(10, cfg.decimals[i]);
        const bal_j = Number(balances[j]) / Math.pow(10, cfg.decimals[j]);

        if (!bal_i || !bal_j) return null;

        // For weighted pools, price = (bal_j / weight_j) / (bal_i / weight_i)
        // For stable pools, approximate with balance ratio (accurate for near-peg)
        const price = bal_j / bal_i;

        const isStable = cfg.type === 'stable';
        if (isStable && (price < 0.9 || price > 1.1)) {
            console.error(`[BAL-ARB] ${cfg.outputPair}: price out of range: ${price.toFixed(6)}`);
            return null;
        }
        if (!isStable && (price < 0.0001 || price > 1e8)) return null;

        const tvlUSD = cfg.outputPair.includes('ETH')
            ? bal_j * 2
            : balances.reduce((sum, b, idx) => sum + Number(b) / Math.pow(10, cfg.decimals[idx] || 6), 0);

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

async function balancerFetcherArbitrum() {
    console.log('Fetching Balancer V2 Arbitrum on-chain data...');
    const start  = Date.now();
    const prices = [];

    for (const cfg of BALANCER_POOLS) {
        const r = await fetchBalancerPool(cfg);
        if (r) prices.push(r);
        await sleep(FETCH_DELAY_MS);
    }

    console.log(`Balancer Arbitrum: ${prices.length}/${BALANCER_POOLS.length} pools`);

    return {
        status: 'success',
        data: {
            prices, chain: CHAIN_ID, chain_id: 42161,
            venues: ['balancer_v2'],
            timestamp: new Date().toISOString(), durationMs: Date.now() - start,
        },
    };
}

if (require.main === module) {
    balancerFetcherArbitrum().then(result => {
        console.log('\nBALANCER ARBITRUM DATA:');
        console.log('='.repeat(76));
        result.data.prices.forEach(p => {
            const tvl    = p.tvlUSD ? `$${(p.tvlUSD/1000).toFixed(1)}k` : 'n/a';
            const feePct = (p.fee * 100).toFixed(4) + '%';
            const px     = p.price > 1 ? `$${p.price.toFixed(4)}` : p.price.toFixed(6);
            console.log(`${'balancer_v2'.padEnd(12)} ${p.pair.padEnd(14)} ${px.padStart(12)} | TVL: ${tvl.padStart(10)} | fee: ${feePct}`);
        });
        console.log('='.repeat(76));
    }).catch(console.error);
}

module.exports = balancerFetcherArbitrum;
