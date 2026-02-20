#!/usr/bin/env node
// debug_arb_prices.js — shows raw tick and decimal values to diagnose price math
'use strict';
require('dotenv').config();
const { ethers } = require('ethers');

const PROVIDER = new ethers.JsonRpcProvider(
    process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc'
);

const POOL_ABI = [
    'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function liquidity() external view returns (uint128)',
    'function token0() external view returns (address)',
    'function token1() external view returns (address)',
];

const ERC20_ABI = [
    'function decimals() external view returns (uint8)',
    'function symbol() external view returns (string)',
];

const POOLS = [
    { name: 'ETH/USDC 0.05%', pool: '0xC6962004f452bE9203591991D15f6b388e09E8D0' },
    { name: 'ETH/USDC 0.30%', pool: '0x17c14D2c404D167802b16C450d3c99F88F2c4F4d' },
    { name: 'WBTC/ETH 0.30%', pool: '0x2f5e87C9312fa29aed5c179E456625D79015299c' },
    { name: 'LINK/ETH 0.30%', pool: '0x468b88941e7Cc0B88c1869d68ab6b570bCEF62Ff' },
    { name: 'ARB/ETH 0.30%',  pool: '0xC6F780497A95e246EB9449f5e4770916DCd6396A' },
];

async function inspect(cfg) {
    try {
        const contract = new ethers.Contract(cfg.pool, POOL_ABI, PROVIDER);
        const [slot0, token0addr, token1addr] = await Promise.all([
            contract.slot0(),
            contract.token0(),
            contract.token1(),
        ]);

        const t0 = new ethers.Contract(token0addr, ERC20_ABI, PROVIDER);
        const t1 = new ethers.Contract(token1addr, ERC20_ABI, PROVIDER);
        const [sym0, dec0, sym1, dec1] = await Promise.all([
            t0.symbol(), t0.decimals(), t1.symbol(), t1.decimals()
        ]);

        const sqrtPriceX96 = slot0[0];
        const tick         = Number(slot0[1]);

        // Method 1: tick-based price
        const tickPrice    = Math.pow(1.0001, tick);
        const decAdj       = Math.pow(10, Number(dec0) - Number(dec1));
        const tickPriceAdj = tickPrice * decAdj;

        // Method 2: sqrtPriceX96-based price (more accurate)
        // price of token1 in token0 units:
        //   price = (sqrtPriceX96 / 2^96)^2 * 10^(dec0-dec1)
        const Q96      = BigInt(2) ** BigInt(96);
        const sqrtP    = Number(sqrtPriceX96) / Number(Q96);
        const sqrtPrice = sqrtP * sqrtP * Math.pow(10, Number(dec0) - Number(dec1));

        console.log(`\n── ${cfg.name} ──`);
        console.log(`   Pool:      ${cfg.pool}`);
        console.log(`   token0:    ${sym0} (decimals=${dec0})  ${token0addr}`);
        console.log(`   token1:    ${sym1} (decimals=${dec1})  ${token1addr}`);
        console.log(`   tick:      ${tick}`);
        console.log(`   sqrtP^2 (token1/token0, raw):  ${sqrtPrice.toExponential(4)}`);
        console.log(`   tickPrice (token1/token0, raw): ${tickPriceAdj.toExponential(4)}`);
        console.log(`   → If WETH/USDC: price_USD = 1 / sqrtPrice = $${(1/sqrtPrice).toFixed(2)}`);
        console.log(`   → If WETH/USDC: price_USD = 1 / tickPrice = $${(1/tickPriceAdj).toFixed(2)}`);
    } catch (err) {
        console.log(`\n── ${cfg.name} ── ERROR: ${err.message.slice(0,100)}`);
    }
}

(async () => {
    console.log('🔍 Inspecting Arbitrum pool slot0 values...\n');
    for (const pool of POOLS) {
        await inspect(pool);
        await new Promise(r => setTimeout(r, 300)); // avoid rate limit
    }
    console.log('\n✅ Done');
})();
