#!/usr/bin/env python3
"""
Discovers correct pool addresses via Uniswap V3 Factory and Aerodrome Factory
on-chain calls. No guessing -- pulls addresses directly from the factory.

Run: python3 discover_pools.py
"""
import os, sys, json, time

sys.path.insert(0, os.path.expanduser("~/Allmight"))
os.chdir(os.path.expanduser("~/Allmight"))

# We'll use subprocess to run node for RPC calls
import subprocess

ARB_SCRIPT = """
const { ethers } = require('ethers');
require('dotenv').config();

const ARB_RPC  = process.env.ARBITRUM_MAINNET_RPC_URL_1 || 'https://arb1.arbitrum.io/rpc';
const BASE_RPC = 'https://mainnet.base.org';

// Uniswap V3 Factory ABI
const FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)'
];

// Aerodrome Factory ABI
const AERO_FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)',
    'function getPair(address tokenA, address tokenB, bool stable) external view returns (address pair)'
];

// Arbitrum token addresses
const ARB_TOKENS = {
    WETH:   '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC:   '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // native USDC
    USDCe:  '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',  // bridged USDC.e
    USDT:   '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    DAI:    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    WBTC:   '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
};

// Base token addresses
const BASE_TOKENS = {
    WETH:   '0x4200000000000000000000000000000000000006',
    USDC:   '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // native USDC
    USDbC:  '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',  // bridged USDC
    DAI:    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    cbETH:  '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
    USDT:   '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
};

// Uniswap V3 Factory (same address on all chains)
const UNI_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
// Aerodrome Factory on Base
const AERO_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const arbProvider  = new ethers.JsonRpcProvider(ARB_RPC);
    const baseProvider = new ethers.JsonRpcProvider(BASE_RPC);

    const uniFactoryArb  = new ethers.Contract(UNI_FACTORY, FACTORY_ABI, arbProvider);
    const uniFactoryBase = new ethers.Contract(UNI_FACTORY, FACTORY_ABI, baseProvider);
    const aeroFactory    = new ethers.Contract(AERO_FACTORY, AERO_FACTORY_ABI, baseProvider);

    console.log('\\n=== ARBITRUM: Uniswap V3 Pool Discovery ===');

    const arbPairs = [
        ['USDC',  'USDCe', 100,  'USDC/USDCe 0.01%'],
        ['USDC',  'USDCe', 500,  'USDC/USDCe 0.05%'],
        ['USDC',  'USDT',  100,  'USDC/USDT 0.01%'],
        ['USDC',  'USDT',  500,  'USDC/USDT 0.05%'],
        ['WETH',  'USDC',  500,  'WETH/USDC 0.05%'],
        ['WETH',  'USDT',  500,  'WETH/USDT 0.05%'],
        ['DAI',   'USDC',  100,  'DAI/USDC 0.01%'],
        ['DAI',   'USDT',  100,  'DAI/USDT 0.01%'],
    ];

    for (const [t0, t1, fee, label] of arbPairs) {
        try {
            const addr = await uniFactoryArb.getPool(ARB_TOKENS[t0], ARB_TOKENS[t1], fee);
            const exists = addr !== '0x0000000000000000000000000000000000000000';
            console.log(`  ${exists ? 'FOUND' : 'NONE '} ${label}: ${addr}`);
            await sleep(300);
        } catch(e) {
            console.log(`  ERROR ${label}: ${e.message.slice(0,60)}`);
            await sleep(300);
        }
    }

    console.log('\\n=== BASE: Uniswap V3 Pool Discovery ===');

    const basePairs = [
        ['USDC',  'USDbC', 100,  'USDC/USDbC 0.01%'],
        ['USDC',  'USDbC', 500,  'USDC/USDbC 0.05%'],
        ['WETH',  'USDC',  500,  'WETH/USDC 0.05%'],
        ['WETH',  'USDC',  100,  'WETH/USDC 0.01%'],
        ['DAI',   'USDC',  100,  'DAI/USDC 0.01%'],
    ];

    for (const [t0, t1, fee, label] of basePairs) {
        try {
            const addr = await uniFactoryBase.getPool(BASE_TOKENS[t0], BASE_TOKENS[t1], fee);
            const exists = addr !== '0x0000000000000000000000000000000000000000';
            console.log(`  ${exists ? 'FOUND' : 'NONE '} ${label}: ${addr}`);
            await sleep(400);
        } catch(e) {
            console.log(`  ERROR ${label}: ${e.message.slice(0,60)}`);
            await sleep(400);
        }
    }

    console.log('\\n=== BASE: Aerodrome Stable Pool Discovery ===');

    const aeroPairs = [
        ['USDC',  'USDbC', true,  'USDC/USDbC stable'],
        ['USDC',  'DAI',   true,  'USDC/DAI stable'],
        ['USDT',  'USDC',  true,  'USDT/USDC stable'],
        ['WETH',  'cbETH', false, 'WETH/cbETH volatile'],
        ['WETH',  'USDC',  false, 'WETH/USDC volatile'],
    ];

    for (const [t0, t1, stable, label] of aeroPairs) {
        try {
            let addr;
            try {
                addr = await aeroFactory.getPool(BASE_TOKENS[t0], BASE_TOKENS[t1], stable);
            } catch {
                addr = await aeroFactory.getPair(BASE_TOKENS[t0], BASE_TOKENS[t1], stable);
            }
            const exists = addr && addr !== '0x0000000000000000000000000000000000000000';
            console.log(`  ${exists ? 'FOUND' : 'NONE '} ${label}: ${addr}`);
            await sleep(400);
        } catch(e) {
            console.log(`  ERROR ${label}: ${e.message.slice(0,60)}`);
            await sleep(400);
        }
    }
}

main().catch(console.error);
"""

# Write and run the node script
script_path = os.path.expanduser("~/Allmight/discover_pools.js")
with open(script_path, "w") as f:
    f.write(ARB_SCRIPT)

print("Running pool discovery via on-chain factory calls...")
print("This takes ~30s due to sequential RPC calls\n")

result = subprocess.run(
    ["node", "discover_pools.js"],
    cwd=os.path.expanduser("~/Allmight"),
    capture_output=True,
    text=True,
    timeout=120
)
print(result.stdout)
if result.stderr:
    print("STDERR:", result.stderr[:500])

# Cleanup
os.remove(script_path)
