#!/usr/bin/env node
/**
 * AllMight — Wave 9 Step 2: Mantle factory verification
 *
 * Purpose:
 *   Verify that Cleopatra Exchange DEX factory addresses on Mantle
 *   (1) have contract code deployed, (2) can return WETH/USDC and
 *   WMNT/USDC pool addresses, and CRITICALLY (3) confirm whether
 *   Cleopatra CL uses the Ramses V3 ABI (int24 tickSpacing) as the
 *   authorized-fork lineage strongly suggests.
 *
 * Boss directive (2026-06-04):
 *   ONLY factory verification in Step 2. No probes, no discovery,
 *   no behavioral conclusions. Just the ABI verdict + pool existence
 *   per pair.
 *
 * Architectural significance:
 *   Cleopatra is officially an AUTHORIZED RAMSES FORK protected
 *   under Ramses' BUSL-1.1 license (per docs.cleo.exchange). Same
 *   AAA-prefix vanity address convention as Arbitrum Ramses. Strong
 *   prior: Cleopatra CL should be Ramses V3 ABI compatible. This
 *   diagnostic confirms the prior.
 *
 * Pattern 4 framing:
 *   This script does NOT measure depth or test viability. It only
 *   confirms wiring. Step 4 discovery measures depth — THE gate.
 *
 * ABIs tested for Cleopatra CL:
 *   - UniV3 standard: getPool(address, address, uint24 fee)
 *   - Ramses V3 alt:  getPool(address, address, int24 tickSpacing)
 *
 * Common tickSpacings for Ramses V3 family: 1, 5, 10, 50, 100, 200, 500.
 */
'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ─── compatibility shim (ethers v5/v6) ────────────────────────────────────
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

// ─── config ───────────────────────────────────────────────────────────────
const RPC_URL = process.env.MANTLE_MAINNET_RPC_URL;
if (!RPC_URL) {
  console.error('FATAL: MANTLE_MAINNET_RPC_URL not set in environment');
  process.exit(1);
}

// Mantle mainnet tokens (verified via mantlescan)
const WETH = '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111';
const USDC = '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9';
const WMNT = '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8';

// Per Boss directive: WETH/USDC + WMNT/USDC. mETH/WETH deferred.
const PAIRS = [
  { label: 'WETH/USDC', tokenA: WETH, tokenB: USDC },
  { label: 'WMNT/USDC', tokenA: WMNT, tokenB: USDC },
];

// ABI variants for Cleopatra CL
const ABI_UNIV3 = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const ABI_RAMSES_V3 = [
  'function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool)',
];

// ABI for Cleopatra Legacy (Solidly V2 fork — getPair primary, getPool fallback)
// Note: Cleopatra Legacy is a Ramses V2 family fork. Ramses V2 uses
// getPair() naming (Solidly-legacy). We try getPool first for forward
// compatibility, then fall back to getPair.
const ABI_SOLIDLY_V2 = [
  'function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)',
  'function getPair(address tokenA, address tokenB, bool stable) external view returns (address pair)',
];

const FACTORIES = {
  cleopatra_cl: {
    name: 'Cleopatra CL (authorized Ramses V3 fork — BUSL-1.1 from Ramses)',
    address: '0xAAA32926fcE6bE95ea2c51cB4Fcb60836D320C42',
    uniV3FeeTiers: [100, 500, 3000, 10000],
    ramsesV3TickSpacings: [1, 5, 10, 50, 100, 200, 500],
  },
  cleopatra_legacy: {
    name: 'Cleopatra Legacy (Solidly V2 fork — Ramses V2 family lineage)',
    address: '0xAAA16c016BF556fcD620328f0759252E29b1AB57',
    stableFlags: [false, true],
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────
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

async function tryV3PoolUniV3(contract, tokenA, tokenB, fee, pairLabel) {
  try {
    const pool = await withTimeout(
      contract.getPool(tokenA, tokenB, fee),
      10000,
      `UniV3 getPool ${pairLabel} fee=${fee}`
    );
    return { ok: true, pool };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 100) };
  }
}

async function tryV3PoolRamses(contract, tokenA, tokenB, tickSpacing, pairLabel) {
  try {
    const pool = await withTimeout(
      contract.getPool(tokenA, tokenB, tickSpacing),
      10000,
      `Ramses getPool ${pairLabel} ts=${tickSpacing}`
    );
    return { ok: true, pool };
  } catch (err) {
    return { ok: false, error: err.message.slice(0, 100) };
  }
}

async function tryV2Pool(contract, tokenA, tokenB, stable, pairLabel) {
  // Try getPool first (forward compatibility); fall back to getPair (Solidly legacy)
  try {
    const pool = await withTimeout(
      contract.getPool(tokenA, tokenB, stable),
      10000,
      `getPool ${pairLabel} stable=${stable}`
    );
    return { ok: true, pool, method: 'getPool' };
  } catch (err1) {
    try {
      const pool = await withTimeout(
        contract.getPair(tokenA, tokenB, stable),
        10000,
        `getPair ${pairLabel} stable=${stable}`
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

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AllMight Wave 9 Step 2 — Mantle factory verification');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const provider = new JsonRpcProvider(RPC_URL);

  // Network info
  console.log('── network ──');
  try {
    const network = await withTimeout(provider.getNetwork(), 10000, 'getNetwork');
    const chainId =
      typeof network.chainId === 'bigint' ? Number(network.chainId) : network.chainId;
    console.log(`  chainId:     ${chainId} (expected: 5000)`);
    if (chainId !== 5000) {
      console.log(`  ⚠ chainId mismatch — RPC not pointing to Mantle mainnet`);
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

  // ── Cleopatra CL ──
  console.log(`── ${FACTORIES.cleopatra_cl.name} ──`);
  console.log(`  address:  ${FACTORIES.cleopatra_cl.address}`);

  let codeInfo;
  try {
    codeInfo = await checkCode(provider, FACTORIES.cleopatra_cl.address, 'cleopatra_cl');
  } catch (err) {
    console.log(`  ✗ getCode error: ${err.message}`);
    process.exit(1);
  }
  if (codeInfo.code === '0x' || codeInfo.codeBytes < 100) {
    console.log(`  ✗ NO CONTRACT CODE at this address (codeBytes=${codeInfo.codeBytes})`);
    process.exit(1);
  }
  console.log(`  ✓ contract code present (${codeInfo.codeBytes} bytes)`);
  console.log('');

  // Aggregate UniV3 results across ALL pairs
  console.log('  ── Testing UniV3 ABI: getPool(address, address, uint24 fee) ──');
  const c_uni = new ethers.Contract(FACTORIES.cleopatra_cl.address, ABI_UNIV3, provider);
  const allUniV3Results = [];

  for (const pair of PAIRS) {
    console.log(`    pair ${pair.label}:`);
    for (const fee of FACTORIES.cleopatra_cl.uniV3FeeTiers) {
      const r = await tryV3PoolUniV3(c_uni, pair.tokenA, pair.tokenB, fee, pair.label);
      allUniV3Results.push({ pair: pair.label, fee, ...r });
      if (!r.ok) {
        console.log(`      ✗ fee=${String(fee).padStart(5)}: error → ${r.error}`);
      } else if (r.pool === ZeroAddress) {
        console.log(`      ⚠ fee=${String(fee).padStart(5)}: NO POOL`);
      } else {
        console.log(`      ✓ fee=${String(fee).padStart(5)}: pool ${r.pool}`);
      }
    }
  }

  const uniV3HasPools = allUniV3Results.some((r) => r.ok && r.pool !== ZeroAddress);
  const uniV3AllDecodeErrors = allUniV3Results.every(
    (r) => !r.ok && r.error && r.error.toLowerCase().includes('decode')
  );

  console.log('');

  let clAbiVerdict = 'unknown';
  let ramResultsAll = [];

  if (uniV3HasPools) {
    console.log('  ✓ UniV3 ABI compatible — cleopatra_cl venue type=uniswap_v3 might work');
    console.log('     (NOTE: this would contradict the BUSL-1.1 fork relationship — investigate)');
    clAbiVerdict = 'univ3';
  } else if (uniV3AllDecodeErrors) {
    console.log('  ⚠ UniV3 ABI incompatible (all decode errors — expected for Ramses V3 fork)');
    console.log('  → trying Ramses V3 ABI: getPool(address, address, int24 tickSpacing)');
    console.log('');
    console.log('  ── Testing Ramses V3 ABI: getPool(address, address, int24 tickSpacing) ──');

    const c_ram = new ethers.Contract(FACTORIES.cleopatra_cl.address, ABI_RAMSES_V3, provider);

    for (const pair of PAIRS) {
      console.log(`    pair ${pair.label}:`);
      for (const ts of FACTORIES.cleopatra_cl.ramsesV3TickSpacings) {
        const r = await tryV3PoolRamses(c_ram, pair.tokenA, pair.tokenB, ts, pair.label);
        ramResultsAll.push({ pair: pair.label, tickSpacing: ts, ...r });
        if (!r.ok) {
          console.log(`      ✗ ts=${String(ts).padStart(5)}: error → ${r.error}`);
        } else if (r.pool === ZeroAddress) {
          console.log(`      ⚠ ts=${String(ts).padStart(5)}: NO POOL`);
        } else {
          console.log(`      ✓ ts=${String(ts).padStart(5)}: pool ${r.pool}`);
        }
      }
    }

    const ramHasPools = ramResultsAll.some((r) => r.ok && r.pool !== ZeroAddress);
    console.log('');
    if (ramHasPools) {
      console.log('  ✓ ABI VERDICT: Cleopatra CL uses Ramses-V3-style ABI (int24 tickSpacing)');
      console.log('     → cleopatra_cl venue type=ramses_v3 CONFIRMED');
      console.log('     → matches authorized-fork prior (BUSL-1.1 from Ramses)');
      clAbiVerdict = 'ramses_v3';
    } else {
      console.log('  ✗ ABI VERDICT: Neither UniV3 nor Ramses V3 ABI returned pools');
      console.log('     → Factory may be correct but no WETH/USDC or WMNT/USDC pools exist');
      console.log('     → Could indicate empty CL deployment (architectural lineage without usage)');
      console.log('     → Escalate to Boss before Step 3');
      clAbiVerdict = 'no_pools';
    }
  } else {
    console.log('  ⚠ UniV3 ABI tested but inconclusive (no pools but errors are non-standard)');
    console.log('     → Inspect error messages above');
    clAbiVerdict = 'inconclusive';
  }
  console.log('');

  // Tally pool counts per pair under Ramses V3 ABI
  if (clAbiVerdict === 'ramses_v3' && ramResultsAll.length > 0) {
    console.log('  ── Cleopatra CL pool census (per pair, Ramses V3 ABI) ──');
    for (const pair of PAIRS) {
      const pairResults = ramResultsAll.filter((r) => r.pair === pair.label);
      const withPools = pairResults.filter((r) => r.ok && r.pool !== ZeroAddress);
      const tsList = withPools.map((r) => r.tickSpacing).join(', ');
      console.log(`    ${pair.label}: ${withPools.length} pool(s) across tickSpacings [${tsList || 'none'}]`);
    }
    console.log('');
  }

  // ── Cleopatra Legacy ──
  console.log(`── ${FACTORIES.cleopatra_legacy.name} ──`);
  console.log(`  address:  ${FACTORIES.cleopatra_legacy.address}`);

  try {
    codeInfo = await checkCode(provider, FACTORIES.cleopatra_legacy.address, 'cleopatra_legacy');
  } catch (err) {
    console.log(`  ✗ getCode error: ${err.message}`);
    process.exit(1);
  }
  if (codeInfo.code === '0x' || codeInfo.codeBytes < 100) {
    console.log(`  ✗ NO CONTRACT CODE at this address (codeBytes=${codeInfo.codeBytes})`);
    process.exit(1);
  }
  console.log(`  ✓ contract code present (${codeInfo.codeBytes} bytes)`);
  console.log('');

  const c_v2 = new ethers.Contract(FACTORIES.cleopatra_legacy.address, ABI_SOLIDLY_V2, provider);
  const legacyResults = [];

  for (const pair of PAIRS) {
    console.log(`  ── pair ${pair.label} ──`);
    for (const stable of FACTORIES.cleopatra_legacy.stableFlags) {
      const r = await tryV2Pool(c_v2, pair.tokenA, pair.tokenB, stable, pair.label);
      legacyResults.push({ pair: pair.label, stable, ...r });
      if (!r.ok) {
        console.log(`    ✗ stable=${stable}: error → ${r.error}`);
      } else if (r.pool === ZeroAddress) {
        console.log(`    ⚠ stable=${stable}: NO POOL (method=${r.method})`);
      } else {
        console.log(`    ✓ stable=${stable}: pool ${r.pool} (method=${r.method})`);
      }
    }
  }
  console.log('');

  // Tally pool counts per pair for Legacy
  console.log('  ── Cleopatra Legacy pool census (per pair) ──');
  const methodSet = new Set();
  for (const pair of PAIRS) {
    const pairResults = legacyResults.filter((r) => r.pair === pair.label);
    const volatile = pairResults.find((r) => r.stable === false);
    const stableP = pairResults.find((r) => r.stable === true);
    const status = (r) => (!r ? 'na' : r.ok && r.pool !== ZeroAddress ? r.pool : (r.ok ? 'NO_POOL' : 'ERROR'));
    console.log(`    ${pair.label}: volatile=${status(volatile)} stable=${status(stableP)}`);
    for (const r of pairResults) if (r.ok && r.method) methodSet.add(r.method);
  }
  if (methodSet.size > 0) {
    console.log(`    ABI method that worked: ${[...methodSet].join(', ')}`);
  }
  console.log('');

  // ── Verdict Matrix ──
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Step 2 complete.');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Verdict matrix for Boss:');
  console.log('');
  console.log('  Cleopatra CL ABI:           ' + clAbiVerdict);
  console.log('');
  console.log('  Decision tree:');
  console.log('    • clAbiVerdict=ramses_v3 (expected)  → Step 3 = pool ABI diagnostic');
  console.log('                                            (test standard UniV3 slot0 on');
  console.log('                                             one Cleopatra CL pool — same');
  console.log('                                             check as sonic Step 3 / e5fe6ea)');
  console.log('    • clAbiVerdict=univ3                 → unexpected; investigate (would');
  console.log('                                            contradict BUSL-1.1 fork lineage)');
  console.log('    • clAbiVerdict=no_pools              → escalate Boss; CL deployment may');
  console.log('                                            be empty (lineage without usage)');
  console.log('    • clAbiVerdict=inconclusive          → escalate Boss; ABI errors unclear');
  console.log('');
  console.log('  Cleopatra Legacy: see pool census above');
  console.log('    • At least one volatile pool         → Legacy V2 venue confirmed');
  console.log('    • All zero / errors                  → escalate Boss; V2 may be unused');
  console.log('                                            (Pattern 5 strengthens to n=3)');
  console.log('');
  console.log('REMINDER: this script measures ONLY existence/ABI, NOT depth.');
  console.log('The Pattern 4 gating measurement (Cleopatra Legacy depth) is Step 4 discovery.');
  console.log('');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
