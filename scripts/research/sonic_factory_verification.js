#!/usr/bin/env node
/**
 * AllMight — Wave 8 Step 2: Sonic factory verification
 *
 * Purpose:
 *   Verify that the Shadow Exchange DEX factory addresses on Sonic
 *   (1) have contract code deployed, (2) can return wS/USDC pool addresses,
 *   and CRITICALLY (3) determine whether Shadow V3 maintains UniV3-style
 *   ABI compatibility or requires a Ramses V3-specific adapter.
 *
 * Boss directive (2026-06-03):
 *   ONLY factory verification in Step 2. No SwapX, no discovery, no probes.
 *
 * Architectural significance:
 *   Shadow Exchange CL is built on IRamsesV3Pool interfaces (confirmed via
 *   import in Shadow source on SonicScan). Ramses is our project's proven
 *   winner protocol family on Arbitrum (V2). Sonic is the FIRST chain we've
 *   encountered with a Ramses-derived deployment outside Arbitrum. The ABI
 *   compatibility verdict from this diagnostic determines whether Sonic
 *   investigation continues with our uniswap_v3 venue type or whether we
 *   need to introduce a new ramses_v3 type in Step 3.
 *
 * ABIs tested for Shadow V3:
 *   - UniV3 standard: getPool(address, address, uint24 fee)
 *   - Ramses V3 alt:  getPool(address, address, int24 tickSpacing)
 *
 * Common tickSpacings for Ramses V3 family: 1, 5, 10, 50, 100, 200, 500.
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ─── compatibility shim ────────────────────────────────────────────────────
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
const RPC_URL = process.env.SONIC_MAINNET_RPC_URL;
if (!RPC_URL) {
  console.error('FATAL: SONIC_MAINNET_RPC_URL not set in environment');
  process.exit(1);
}

// Tokens (Sonic mainnet)
const WS = '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38';
const USDC = '0x29219dd400f2Bf60E5a23d13Be72B486D4038894';

// ABI variants for Shadow V3
const ABI_UNIV3 = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];
const ABI_RAMSES_V3 = [
  'function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool)',
];

// ABIs for Shadow V2 (Solidly fork — getPool primary, getPair legacy fallback)
const ABI_SOLIDLY_V2 = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)',
  'function getPair(address tokenA, address tokenB, bool stable) external view returns (address pair)',
];

const FACTORIES = {
  shadow_v3: {
    name: 'Shadow V3 (CL — Ramses V3 fork)',
    address: '0xcD2d0637c94fe77C2896BbCBB174cefFb08DE6d7',
    uniV3FeeTiers: [100, 500, 3000, 10000],
    ramsesV3TickSpacings: [1, 5, 10, 50, 100, 200, 500],
  },
  shadow_v2: {
    name: 'Shadow V2 (Solidly fork)',
    address: '0x2dA25E7446A70D7be65fd4c053948BEcAA6374c8',
    stableFlags: [false, true],
  },
};

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

async function tryV3PoolUniV3(contract, fee) {
  try {
    const pool = await withTimeout(
      contract.getPool(WS, USDC, fee),
      10000,
      `UniV3 getPool fee=${fee}`
    );
    return { ok: true, pool };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 100) };
  }
}

async function tryV3PoolRamses(contract, tickSpacing) {
  try {
    const pool = await withTimeout(
      contract.getPool(WS, USDC, tickSpacing),
      10000,
      `Ramses getPool ts=${tickSpacing}`
    );
    return { ok: true, pool };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 100) };
  }
}

async function tryV2Pool(contract, stable) {
  // Try getPool first, fall back to getPair
  try {
    const pool = await withTimeout(
      contract.getPool(WS, USDC, stable),
      10000,
      `getPool stable=${stable}`
    );
    return { ok: true, pool, method: 'getPool' };
  } catch (err1) {
    try {
      const pool = await withTimeout(
        contract.getPair(WS, USDC, stable),
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
  console.log('  AllMight Wave 8 Step 2 — Sonic factory verification');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const provider = new JsonRpcProvider(RPC_URL);

  // Network info
  console.log('── network ──');
  try {
    const network = await withTimeout(provider.getNetwork(), 10000, 'getNetwork');
    const chainId =
      typeof network.chainId === 'bigint' ? Number(network.chainId) : network.chainId;
    console.log(`  chainId:     ${chainId} (expected: 146)`);
    if (chainId !== 146) {
      console.log(`  ⚠ chainId mismatch — RPC not pointing to Sonic mainnet`);
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

  // ── Shadow V3 ──
  console.log(`── ${FACTORIES.shadow_v3.name} ──`);
  console.log(`  address:  ${FACTORIES.shadow_v3.address}`);

  let codeInfo;
  try {
    codeInfo = await checkCode(provider, FACTORIES.shadow_v3.address, 'shadow_v3');
  } catch (err) {
    console.log(`  ✗ getCode error: ${err.message}`);
    console.log('');
    process.exit(1);
  }

  if (codeInfo.code === '0x' || codeInfo.codeBytes < 100) {
    console.log(`  ✗ NO CONTRACT CODE at this address (codeBytes=${codeInfo.codeBytes})`);
    process.exit(1);
  }
  console.log(`  ✓ contract code present (${codeInfo.codeBytes} bytes)`);

  // Try UniV3 ABI first
  console.log('');
  console.log('  ── Testing UniV3 ABI: getPool(address, address, uint24 fee) ──');
  const c_uni = new ethers.Contract(FACTORIES.shadow_v3.address, ABI_UNIV3, provider);
  const uniV3Results = [];
  for (const fee of FACTORIES.shadow_v3.uniV3FeeTiers) {
    const r = await tryV3PoolUniV3(c_uni, fee);
    uniV3Results.push({ fee, ...r });
    if (!r.ok) {
      console.log(`  ✗ fee=${String(fee).padStart(5)}: error → ${r.error}`);
    } else if (r.pool === ZeroAddress) {
      console.log(`  ⚠ fee=${String(fee).padStart(5)}: NO POOL`);
    } else {
      console.log(`  ✓ fee=${String(fee).padStart(5)}: pool ${r.pool}`);
    }
  }

  const uniV3HasPools = uniV3Results.some((r) => r.ok && r.pool !== ZeroAddress);
  const uniV3AllDecodeErrors = uniV3Results.every(
    (r) => !r.ok && r.error && r.error.toLowerCase().includes('decode')
  );

  console.log('');
  if (uniV3HasPools) {
    console.log('  ✓ UniV3 ABI compatible — shadow_v3 venue type=uniswap_v3 confirmed');
  } else if (uniV3AllDecodeErrors) {
    console.log('  ⚠ UniV3 ABI incompatible (all decode errors)');
    console.log('  → trying Ramses V3 ABI: getPool(address, address, int24 tickSpacing)');

    // Try Ramses V3 ABI
    console.log('');
    console.log('  ── Testing Ramses V3 ABI: getPool(address, address, int24 tickSpacing) ──');
    const c_ram = new ethers.Contract(FACTORIES.shadow_v3.address, ABI_RAMSES_V3, provider);
    const ramResults = [];
    for (const ts of FACTORIES.shadow_v3.ramsesV3TickSpacings) {
      const r = await tryV3PoolRamses(c_ram, ts);
      ramResults.push({ tickSpacing: ts, ...r });
      if (!r.ok) {
        console.log(`  ✗ ts=${String(ts).padStart(5)}: error → ${r.error}`);
      } else if (r.pool === ZeroAddress) {
        console.log(`  ⚠ ts=${String(ts).padStart(5)}: NO POOL`);
      } else {
        console.log(`  ✓ ts=${String(ts).padStart(5)}: pool ${r.pool}`);
      }
    }

    const ramHasPools = ramResults.some((r) => r.ok && r.pool !== ZeroAddress);
    console.log('');
    if (ramHasPools) {
      console.log('  ⚠ ABI VERDICT: Shadow V3 uses Ramses-V3-style ABI (int24 tickSpacing)');
      console.log('     → Step 3 must introduce a ramses_v3 venue type with this ABI');
      console.log('     → Current uniswap_v3 type for shadow_v3 is INCOMPATIBLE');
    } else {
      console.log('  ✗ ABI VERDICT: Neither UniV3 nor Ramses V3 ABI returned pools');
      console.log('     → Factory address may be wrong OR no wS/USDC pools exist on Shadow CL');
      console.log('     → Escalate to Boss before proceeding');
    }
  } else {
    console.log('  ⚠ UniV3 ABI tested but no pools at any tier — could be valid (no liquidity)');
    console.log('     or ABI mismatch with non-standard errors. Inspect error messages above.');
  }

  console.log('');

  // ── Shadow V2 ──
  console.log(`── ${FACTORIES.shadow_v2.name} ──`);
  console.log(`  address:  ${FACTORIES.shadow_v2.address}`);

  try {
    codeInfo = await checkCode(provider, FACTORIES.shadow_v2.address, 'shadow_v2');
  } catch (err) {
    console.log(`  ✗ getCode error: ${err.message}`);
    console.log('');
    process.exit(1);
  }

  if (codeInfo.code === '0x' || codeInfo.codeBytes < 100) {
    console.log(`  ✗ NO CONTRACT CODE at this address (codeBytes=${codeInfo.codeBytes})`);
    process.exit(1);
  }
  console.log(`  ✓ contract code present (${codeInfo.codeBytes} bytes)`);

  // Try Solidly V2 ABI
  const c_v2 = new ethers.Contract(FACTORIES.shadow_v2.address, ABI_SOLIDLY_V2, provider);
  for (const stable of FACTORIES.shadow_v2.stableFlags) {
    const r = await tryV2Pool(c_v2, stable);
    if (!r.ok) {
      console.log(`  ✗ stable=${stable}: error → ${r.error}`);
    } else if (r.pool === ZeroAddress) {
      console.log(`  ⚠ stable=${stable}: NO POOL (method=${r.method})`);
    } else {
      console.log(`  ✓ stable=${stable}: pool ${r.pool} (method=${r.method})`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Step 2 complete.');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Verdict matrix for Boss:');
  console.log('  • Shadow V3 + UniV3 ABI works  → Step 3 = no changes, proceed Step 4');
  console.log('  • Shadow V3 + Ramses V3 ABI    → Step 3 = introduce ramses_v3 venue type');
  console.log('  • Both fail                     → escalate (factory address wrong?)');
  console.log('  • Shadow V2 pool returns        → V2 venue type confirmed');
  console.log('');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
