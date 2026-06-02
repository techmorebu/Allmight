#!/usr/bin/env node
/**
 * AllMight — Wave 7 Step 2: Unichain factory verification
 *
 * Purpose:
 *   Verify that the known DEX factory addresses on Unichain
 *   (1) have contract code deployed at the expected address, and
 *   (2) can return an ETH/USDC pool address via their standard getPool API.
 *
 * Why:
 *   Before adding any non-UniV3 venue to chains.json, we want on-chain
 *   confirmation that the factory exists and is wired correctly for
 *   ETH/USDC. This prevents shipping config that points to dead addresses.
 *
 * Boss directive (2026-06-02):
 *   TVL ≠ active-tick depth ≠ behavioral profile ≠ arbitrability.
 *   Verification happens regardless of external data signals about size.
 *
 * Factories tested:
 *   - Uniswap V3 PoolFactory (0x1f9840...003 — Unichain-specific, NOT canonical 0x1F98431c)
 *   - Velodrome V2 PoolFactory (0x31832f2a97... from velodrome-finance
 *     superchain-contracts deployment-addresses/unichain.json)
 *
 * Deferred (require auth or further research):
 *   - Velodrome Slipstream factory (confirmed deployed v1.0 but address
 *     not yet retrieved)
 *   - DYORSwap, UniChainSwap factories (would need pool-side discovery)
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ─── compatibility shim: ethers v5 vs v6 ───────────────────────────────────
const ZeroAddress =
  ethers.ZeroAddress ||
  (ethers.constants && ethers.constants.AddressZero) ||
  '0x0000000000000000000000000000000000000000';

const JsonRpcProvider =
  ethers.JsonRpcProvider ||
  (ethers.providers && ethers.providers.JsonRpcProvider);

if (!JsonRpcProvider) {
  console.error('FATAL: cannot find JsonRpcProvider in ethers');
  process.exit(1);
}

// ─── config ────────────────────────────────────────────────────────────────
const RPC_URL = process.env.UNICHAIN_MAINNET_RPC_URL;
if (!RPC_URL) {
  console.error('FATAL: UNICHAIN_MAINNET_RPC_URL not set in environment');
  process.exit(1);
}

const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x078D782b760474a361dDA0AF3839290b0EF57AD6';

const UNI_V3_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// Velodrome V2 PoolFactory typically exposes BOTH getPool and getPair
// (legacy compatibility). Try getPool first, fall back to getPair.
const VELO_V2_ABI = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)',
  'function getPair(address tokenA, address tokenB, bool stable) external view returns (address pair)',
];

const FACTORIES = [
  {
    name: 'Uniswap V3 PoolFactory',
    address: '0x1f98400000000000000000000000000000000003',
    type: 'uniswap_v3',
    feeTiers: [100, 500, 3000, 10000],
  },
  {
    name: 'Velodrome V2 PoolFactory',
    address: '0x31832f2a97Fd20664D76Cc421207669b55CE4BC0',
    type: 'velodrome_v2',
    stableFlags: [false, true],
  },
];

// ─── helpers ───────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

async function checkCode(provider, address, label) {
  const code = await withTimeout(provider.getCode(address), 10000, `getCode ${label}`);
  const codeBytes = (code.length - 2) / 2;
  return { code, codeBytes };
}

async function tryUniV3Pool(contract, fee) {
  try {
    const pool = await withTimeout(
      contract.getPool(WETH, USDC, fee),
      10000,
      `getPool fee=${fee}`
    );
    return { ok: true, pool };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 100) };
  }
}

async function tryVeloV2Pool(contract, stable) {
  // try getPool first, fall back to getPair
  try {
    const pool = await withTimeout(
      contract.getPool(WETH, USDC, stable),
      10000,
      `getPool stable=${stable}`
    );
    return { ok: true, pool, method: 'getPool' };
  } catch (err1) {
    try {
      const pool = await withTimeout(
        contract.getPair(WETH, USDC, stable),
        10000,
        `getPair stable=${stable}`
      );
      return { ok: true, pool, method: 'getPair' };
    } catch (err2) {
      return {
        ok: false,
        error: `getPool: ${err1.message.slice(0, 60)} | getPair: ${err2.message.slice(0, 60)}`,
      };
    }
  }
}

// ─── main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AllMight Wave 7 Step 2 — Unichain factory verification');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const provider = new JsonRpcProvider(RPC_URL);

  // Network info
  console.log('── network ──');
  try {
    const network = await withTimeout(provider.getNetwork(), 10000, 'getNetwork');
    const chainId =
      typeof network.chainId === 'bigint' ? Number(network.chainId) : network.chainId;
    console.log(`  chainId:     ${chainId} (expected: 130)`);
    if (chainId !== 130) {
      console.log(`  ⚠ chainId mismatch — RPC not pointing to Unichain mainnet`);
    } else {
      console.log(`  ✓ chainId verified`);
    }

    const block = await withTimeout(provider.getBlockNumber(), 10000, 'getBlockNumber');
    console.log(`  blockNumber: ${block}`);
  } catch (err) {
    console.error(`  ✗ network error: ${err.message}`);
    process.exit(1);
  }
  console.log('');

  // Per-factory verification
  for (const factory of FACTORIES) {
    console.log(`── ${factory.name} ──`);
    console.log(`  address:  ${factory.address}`);
    console.log(`  type:     ${factory.type}`);

    // 1. Code present?
    let codeInfo;
    try {
      codeInfo = await checkCode(provider, factory.address, factory.name);
    } catch (err) {
      console.log(`  ✗ getCode error: ${err.message}`);
      console.log('');
      continue;
    }

    if (codeInfo.code === '0x' || codeInfo.codeBytes < 100) {
      console.log(`  ✗ NO CONTRACT CODE at this address (codeBytes=${codeInfo.codeBytes})`);
      console.log('');
      continue;
    }
    console.log(`  ✓ contract code present (${codeInfo.codeBytes} bytes)`);

    // 2. Pool lookups
    if (factory.type === 'uniswap_v3') {
      const contract = new ethers.Contract(factory.address, UNI_V3_ABI, provider);
      for (const fee of factory.feeTiers) {
        const result = await tryUniV3Pool(contract, fee);
        if (!result.ok) {
          console.log(`  ✗ fee=${String(fee).padStart(5)}: error → ${result.error}`);
        } else if (result.pool === ZeroAddress) {
          console.log(`  ⚠ fee=${String(fee).padStart(5)}: NO POOL`);
        } else {
          console.log(`  ✓ fee=${String(fee).padStart(5)}: pool ${result.pool}`);
        }
      }
    } else if (factory.type === 'velodrome_v2') {
      const contract = new ethers.Contract(factory.address, VELO_V2_ABI, provider);
      for (const stable of factory.stableFlags) {
        const result = await tryVeloV2Pool(contract, stable);
        if (!result.ok) {
          console.log(`  ✗ stable=${stable}: error → ${result.error}`);
        } else if (result.pool === ZeroAddress) {
          console.log(`  ⚠ stable=${stable}: NO POOL (method=${result.method})`);
        } else {
          console.log(`  ✓ stable=${stable}: pool ${result.pool} (method=${result.method})`);
        }
      }
    }

    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Step 2 complete.');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Interpretation:');
  console.log('  ✓ uni_v3 pools at non-zero addresses → confirm UniV3 venue config');
  console.log('  ✓ velo_v2 pool at non-zero address → add Velodrome V2 venue in wave7 commit 3');
  console.log('  ⚠ velo_v2 NO POOL → Velodrome V2 has no ETH/USDC pair; only Slipstream may exist');
  console.log('  ✗ any factory: no code → diagnostic factory address is wrong, research needed');
  console.log('');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
