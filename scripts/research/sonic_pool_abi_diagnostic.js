#!/usr/bin/env node
/**
 * AllMight — Wave 8 Step 3B: Sonic Shadow V3 pool ABI diagnostic
 *
 * Purpose:
 *   Verify that the Shadow V3 pool ABI is compatible with standard UniV3
 *   slot0() / liquidity() / fee() / tickSpacing() / token0() / token1()
 *   methods. The factory ABI was already confirmed UniV3-style int24
 *   tickSpacing in Step 2 (commit a6e4852). Pool-level ABI is the
 *   remaining open question before discovery can proceed.
 *
 * Boss directive (2026-06-03) Step 3B:
 *   "REQUIRED. Do not proceed to discovery yet. Verify slot0(), liquidity(),
 *    fee(), tickSpacing(). Success criteria: call succeeds, decode succeeds,
 *    values look sane. I do not care about exact numbers yet — compatibility."
 *
 * Test pools (verified in Step 2 wave8 commit 2):
 *   Primary (ts=50):   0x324963c267C354c7660Ce8CA3F5f167E05649970
 *   Secondary (ts=100): 0xeAA89d6319c3105329C7b23c31DF449e8394E35A
 *
 * Expected:
 *   ~95% prior that standard UniV3 ABI works (Ramses V3 historically
 *   maintained UniV3 pool semantics; Boss prior).
 *   If slot0 decode fails, fall back to slipstream 6-field variant.
 */

'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

// ─── compatibility shim ───────────────────────────────────────────────────
const ZeroAddress =
  ethers.ZeroAddress ||
  (ethers.constants && ethers.constants.AddressZero) ||
  '0x0000000000000000000000000000000000000000';

const JsonRpcProvider =
  ethers.JsonRpcProvider ||
  (ethers.providers && ethers.providers.JsonRpcProvider);

// ─── config ───────────────────────────────────────────────────────────────
const RPC_URL = process.env.SONIC_MAINNET_RPC_URL;
if (!RPC_URL) {
  console.error('FATAL: SONIC_MAINNET_RPC_URL not set');
  process.exit(1);
}

const WS_EXPECTED = '0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38';
const USDC_EXPECTED = '0x29219dd400f2Bf60E5a23d13Be72B486D4038894';

const POOLS = [
  {
    label: 'ts=50',
    address: '0x324963c267C354c7660Ce8CA3F5f167E05649970',
    expectedTickSpacing: 50,
  },
  {
    label: 'ts=100',
    address: '0xeAA89d6319c3105329C7b23c31DF449e8394E35A',
    expectedTickSpacing: 100,
  },
];

// Standard UniV3 slot0 ABI (7 fields)
const ABI_UNIV3_POOL = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Slipstream variant slot0 ABI (6 fields, drops feeProtocol)
const ABI_SLIPSTREAM_SLOT0 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)',
];

// ─── helpers ──────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

function fmtBigInt(v) {
  if (v === undefined || v === null) return 'undefined';
  if (typeof v === 'bigint') return v.toString();
  return String(v);
}

function fmtAddr(a) {
  if (!a) return 'null';
  return a.toLowerCase();
}

function assertEq(actual, expected, label) {
  const ok = String(actual).toLowerCase() === String(expected).toLowerCase();
  return ok ? `✓ ${label} matches` : `✗ ${label} MISMATCH: got ${actual}, expected ${expected}`;
}

// ─── per-pool test ────────────────────────────────────────────────────────
async function testPool(provider, pool) {
  console.log(`── pool ${pool.label} @ ${pool.address} ──`);

  const c = new ethers.Contract(pool.address, ABI_UNIV3_POOL, provider);
  const results = {
    label: pool.label,
    address: pool.address,
    slot0: null,
    liquidity: null,
    fee: null,
    tickSpacing: null,
    token0: null,
    token1: null,
    errors: [],
    abiVariant: 'univ3', // updated to 'slipstream' if fallback used
  };

  // slot0
  try {
    const s = await withTimeout(c.slot0(), 10000, 'slot0');
    results.slot0 = {
      sqrtPriceX96: fmtBigInt(s.sqrtPriceX96 ?? s[0]),
      tick: Number(s.tick ?? s[1]),
      observationIndex: Number(s.observationIndex ?? s[2]),
      observationCardinality: Number(s.observationCardinality ?? s[3]),
      observationCardinalityNext: Number(s.observationCardinalityNext ?? s[4]),
      feeProtocol: Number(s.feeProtocol ?? s[5]),
      unlocked: Boolean(s.unlocked ?? s[6]),
    };
    console.log(`  ✓ slot0() decoded (UniV3 7-field):`);
    console.log(`      sqrtPriceX96:               ${results.slot0.sqrtPriceX96}`);
    console.log(`      tick:                       ${results.slot0.tick}`);
    console.log(`      observationIndex:           ${results.slot0.observationIndex}`);
    console.log(`      observationCardinality:     ${results.slot0.observationCardinality}`);
    console.log(`      observationCardinalityNext: ${results.slot0.observationCardinalityNext}`);
    console.log(`      feeProtocol:                ${results.slot0.feeProtocol}`);
    console.log(`      unlocked:                   ${results.slot0.unlocked}`);
  } catch (err) {
    console.log(`  ⚠ slot0() with UniV3 ABI failed: ${err.message.slice(0, 100)}`);
    console.log(`  → trying Slipstream 6-field variant...`);
    try {
      const c2 = new ethers.Contract(pool.address, ABI_SLIPSTREAM_SLOT0, provider);
      const s = await withTimeout(c2.slot0(), 10000, 'slot0 slipstream');
      results.slot0 = {
        sqrtPriceX96: fmtBigInt(s.sqrtPriceX96 ?? s[0]),
        tick: Number(s.tick ?? s[1]),
        observationIndex: Number(s.observationIndex ?? s[2]),
        observationCardinality: Number(s.observationCardinality ?? s[3]),
        observationCardinalityNext: Number(s.observationCardinalityNext ?? s[4]),
        unlocked: Boolean(s.unlocked ?? s[5]),
      };
      results.abiVariant = 'slipstream';
      console.log(`  ⚠ slot0() decoded with SLIPSTREAM ABI (6 fields, no feeProtocol)`);
      console.log(`      sqrtPriceX96: ${results.slot0.sqrtPriceX96}`);
      console.log(`      tick:         ${results.slot0.tick}`);
      console.log(`      unlocked:     ${results.slot0.unlocked}`);
      results.errors.push('slot0 required slipstream variant');
    } catch (err2) {
      console.log(`  ✗ slot0() with Slipstream ABI also failed: ${err2.message.slice(0, 100)}`);
      results.errors.push('slot0 failed both UniV3 and Slipstream ABIs');
    }
  }

  // liquidity
  try {
    const v = await withTimeout(c.liquidity(), 10000, 'liquidity');
    results.liquidity = fmtBigInt(v);
    console.log(`  ✓ liquidity():        ${results.liquidity}`);
  } catch (err) {
    console.log(`  ✗ liquidity() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('liquidity failed');
  }

  // fee
  try {
    const v = await withTimeout(c.fee(), 10000, 'fee');
    results.fee = Number(v);
    console.log(`  ✓ fee():              ${results.fee} (${(results.fee / 10000).toFixed(4)}%)`);
  } catch (err) {
    console.log(`  ✗ fee() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('fee failed');
  }

  // tickSpacing
  try {
    const v = await withTimeout(c.tickSpacing(), 10000, 'tickSpacing');
    results.tickSpacing = Number(v);
    const sanity = results.tickSpacing === pool.expectedTickSpacing
      ? `(expected ${pool.expectedTickSpacing} ✓)`
      : `(MISMATCH — expected ${pool.expectedTickSpacing})`;
    console.log(`  ✓ tickSpacing():      ${results.tickSpacing} ${sanity}`);
  } catch (err) {
    console.log(`  ✗ tickSpacing() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('tickSpacing failed');
  }

  // token0
  try {
    const v = await withTimeout(c.token0(), 10000, 'token0');
    results.token0 = fmtAddr(v);
    const note = assertEq(v, WS_EXPECTED, 'token0=wS');
    console.log(`  ${note}`);
  } catch (err) {
    console.log(`  ✗ token0() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('token0 failed');
  }

  // token1
  try {
    const v = await withTimeout(c.token1(), 10000, 'token1');
    results.token1 = fmtAddr(v);
    const note = assertEq(v, USDC_EXPECTED, 'token1=USDC');
    console.log(`  ${note}`);
  } catch (err) {
    console.log(`  ✗ token1() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('token1 failed');
  }

  console.log('');
  return results;
}

// ─── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  AllMight Wave 8 Step 3B — Shadow V3 Pool ABI Diagnostic');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const provider = new JsonRpcProvider(RPC_URL);

  // Network check
  const network = await withTimeout(provider.getNetwork(), 10000, 'getNetwork');
  const chainId =
    typeof network.chainId === 'bigint' ? Number(network.chainId) : network.chainId;
  if (chainId !== 146) {
    console.error(`✗ chainId mismatch: got ${chainId}, expected 146`);
    process.exit(1);
  }
  const block = await withTimeout(provider.getBlockNumber(), 10000, 'getBlockNumber');
  console.log(`Network: Sonic mainnet (chainId 146), block ${block}`);
  console.log('');

  // Run tests
  const results = [];
  for (const pool of POOLS) {
    const r = await testPool(provider, pool);
    results.push(r);
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VERDICT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const allUniV3 = results.every((r) => r.abiVariant === 'univ3' && r.errors.length === 0);
  const someSlipstream = results.some((r) => r.abiVariant === 'slipstream');
  const anyFailed = results.some((r) =>
    r.errors.some((e) => e.includes('failed both') || e === 'tickSpacing failed' || e === 'fee failed')
  );

  if (allUniV3) {
    console.log('  ✓ STANDARD UniV3 POOL ABI CONFIRMED');
    console.log('    All methods on both pools returned valid data with standard');
    console.log('    UniV3 pool ABI (7-field slot0, standard liquidity/fee/tickSpacing/');
    console.log('    token0/token1). No fallback needed.');
    console.log('');
    console.log('  ramses_v3 dispatch (slotFn: \'slot0\') is CORRECT.');
    console.log('  → Proceed to Step 3C (discovery).');
  } else if (someSlipstream && !anyFailed) {
    console.log('  ⚠ SLIPSTREAM SLOT0 VARIANT REQUIRED');
    console.log('    slot0() decoded only with the 6-field Slipstream variant');
    console.log('    (no feeProtocol field). Other methods worked normally.');
    console.log('');
    console.log('  Action required:');
    console.log('  - Update ramses_v3 dispatch slotFn from \'slot0\' to');
    console.log('    \'slot0_slipstream\' before discovery.');
  } else {
    console.log('  ✗ POOL ABI INCOMPATIBLE');
    console.log('    One or more methods failed on at least one pool.');
    console.log('    Escalate to Boss before discovery.');
    console.log('');
    console.log('  Per-pool error summary:');
    for (const r of results) {
      if (r.errors.length) {
        console.log(`    ${r.label}: ${r.errors.join('; ')}`);
      }
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
