#!/usr/bin/env node
/**
 * AllMight — Wave 9 Step 3: Mantle Cleopatra CL pool ABI diagnostic
 *
 * Purpose:
 *   Verify that Cleopatra CL pools on Mantle respond to standard UniV3
 *   pool ABI: slot0() / liquidity() / fee() / tickSpacing() / token0()
 *   / token1(). The factory ABI was empirically confirmed STANDARD
 *   UniV3 (uint24 fee) in Step 2 (commit 316995e); pool-level ABI is
 *   the remaining open question before discovery can proceed.
 *
 * Boss directive (2026-06-04 C9):
 *   "Step 3 = pool ABI diagnostic. Test one or two live Cleopatra CL
 *    pools: slot0(), liquidity(), fee(), tickSpacing(). Expected result:
 *    standard UniV3 pool ABI — but do not assume it. Verify it."
 *
 * Test pools (from Step 2 commit 316995e discovery):
 *   WETH/USDC fee=500   0xC0b66C7535423395Fc53eB4cb0CE9bcA1621DaE6
 *   WETH/USDC fee=3000  0xAAA87a36B92344436adcd880677e6842B227d931  (AAA vanity)
 *   WMNT/USDC fee=100   0xB05088D53f2Dbc0e2723C0aFe28471736875dAd2
 *   WMNT/USDC fee=10000 0x37a6B77F1a8ef09AC96E9cDA3eD56F615802d713
 *
 * Expected (priors high, but verify):
 *   - slot0() decodes as standard UniV3 7-field (with feeProtocol)
 *   - All pools have token0=USDC (smallest address in token set)
 *   - fee() matches the fee tier each pool was registered at
 *   - tickSpacing() returns standard UniV3 convention per fee tier
 *   - liquidity() returns a non-zero uint128 (depth measurement is Step 4)
 *
 * If slot0 decode fails → fall back to Slipstream 6-field variant.
 * If both fail → escalate Boss before Step 4.
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
  console.error('FATAL: MANTLE_MAINNET_RPC_URL not set');
  process.exit(1);
}

// Mantle token addresses (verified Step 1, EIP-55 normalized fix(wave9))
const USDC_EXPECTED = '0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9';
const WETH_EXPECTED = '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111';
const WMNT_EXPECTED = '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8';

// Cleopatra CL pools (from Step 2 commit 316995e discovery)
// Token sort: USDC (0x09Bc) < WETH (0xdEAd) and < WMNT (0x78c1)
// → token0=USDC, token1=WETH or WMNT for all pools
//
// Standard UniV3 convention for tickSpacing:
//   fee=100   (0.01%) → tickSpacing=1
//   fee=500   (0.05%) → tickSpacing=10
//   fee=3000  (0.30%) → tickSpacing=60
//   fee=10000 (1.00%) → tickSpacing=200
const POOLS = [
  {
    label: 'WETH/USDC fee=500',
    address: '0xC0b66C7535423395Fc53eB4cb0CE9bcA1621DaE6',
    expectedFee: 500,
    expectedTickSpacing: 10,
    expectedToken0: USDC_EXPECTED,
    expectedToken1: WETH_EXPECTED,
    token0Label: 'USDC',
    token1Label: 'WETH',
  },
  {
    label: 'WETH/USDC fee=3000 (AAA vanity)',
    address: '0xAAA87a36B92344436adcd880677e6842B227d931',
    expectedFee: 3000,
    expectedTickSpacing: 60,
    expectedToken0: USDC_EXPECTED,
    expectedToken1: WETH_EXPECTED,
    token0Label: 'USDC',
    token1Label: 'WETH',
  },
  {
    label: 'WMNT/USDC fee=100',
    address: '0xB05088D53f2Dbc0e2723C0aFe28471736875dAd2',
    expectedFee: 100,
    expectedTickSpacing: 1,
    expectedToken0: USDC_EXPECTED,
    expectedToken1: WMNT_EXPECTED,
    token0Label: 'USDC',
    token1Label: 'WMNT',
  },
  {
    label: 'WMNT/USDC fee=10000',
    address: '0x37a6B77F1a8ef09AC96E9cDA3eD56F615802d713',
    expectedFee: 10000,
    expectedTickSpacing: 200,
    expectedToken0: USDC_EXPECTED,
    expectedToken1: WMNT_EXPECTED,
    token0Label: 'USDC',
    token1Label: 'WMNT',
  },
];

// Standard UniV3 pool ABI (7-field slot0)
const ABI_UNIV3_POOL = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function fee() external view returns (uint24)',
  'function tickSpacing() external view returns (int24)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
];

// Slipstream variant (6-field slot0, no feeProtocol) — fallback ABI
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
  return ok
    ? `✓ ${label} matches`
    : `✗ ${label} MISMATCH: got ${actual}, expected ${expected}`;
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
    abiVariant: 'univ3',
    feeMatches: false,
    token0Matches: false,
    token1Matches: false,
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
    results.feeMatches = results.fee === pool.expectedFee;
    const sanityFee = results.feeMatches
      ? `(expected ${pool.expectedFee} ✓)`
      : `(MISMATCH — expected ${pool.expectedFee})`;
    console.log(
      `  ✓ fee():              ${results.fee} (${(results.fee / 10000).toFixed(4)}%) ${sanityFee}`
    );
  } catch (err) {
    console.log(`  ✗ fee() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('fee failed');
  }

  // tickSpacing
  try {
    const v = await withTimeout(c.tickSpacing(), 10000, 'tickSpacing');
    results.tickSpacing = Number(v);
    const sanity =
      results.tickSpacing === pool.expectedTickSpacing
        ? `(expected ${pool.expectedTickSpacing} ✓)`
        : `(NON-STANDARD — expected ${pool.expectedTickSpacing})`;
    console.log(`  ✓ tickSpacing():      ${results.tickSpacing} ${sanity}`);
  } catch (err) {
    console.log(`  ✗ tickSpacing() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('tickSpacing failed');
  }

  // token0
  try {
    const v = await withTimeout(c.token0(), 10000, 'token0');
    results.token0 = fmtAddr(v);
    results.token0Matches = String(v).toLowerCase() === String(pool.expectedToken0).toLowerCase();
    const note = assertEq(v, pool.expectedToken0, `token0=${pool.token0Label}`);
    console.log(`  ${note}`);
  } catch (err) {
    console.log(`  ✗ token0() failed: ${err.message.slice(0, 100)}`);
    results.errors.push('token0 failed');
  }

  // token1
  try {
    const v = await withTimeout(c.token1(), 10000, 'token1');
    results.token1 = fmtAddr(v);
    results.token1Matches = String(v).toLowerCase() === String(pool.expectedToken1).toLowerCase();
    const note = assertEq(v, pool.expectedToken1, `token1=${pool.token1Label}`);
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
  console.log('  AllMight Wave 9 Step 3 — Mantle Cleopatra CL Pool ABI Diagnostic');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  const provider = new JsonRpcProvider(RPC_URL);

  // Network check
  const network = await withTimeout(provider.getNetwork(), 10000, 'getNetwork');
  const chainId =
    typeof network.chainId === 'bigint' ? Number(network.chainId) : network.chainId;
  if (chainId !== 5000) {
    console.error(`✗ chainId mismatch: got ${chainId}, expected 5000`);
    process.exit(1);
  }
  const block = await withTimeout(provider.getBlockNumber(), 10000, 'getBlockNumber');
  console.log(`Network: Mantle mainnet (chainId 5000), block ${block}`);
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
    r.errors.some(
      (e) => e.includes('failed both') || e === 'tickSpacing failed' || e === 'fee failed'
    )
  );

  // Token-sort sanity
  const allToken0Match = results.every((r) => r.token0Matches);
  const allToken1Match = results.every((r) => r.token1Matches);
  const allFeeMatch = results.every((r) => r.feeMatches);

  if (allUniV3) {
    console.log('  ✓ STANDARD UniV3 POOL ABI CONFIRMED');
    console.log('    All 4 Cleopatra CL pools returned valid data with standard');
    console.log('    UniV3 pool ABI (7-field slot0, liquidity, fee, tickSpacing,');
    console.log('    token0, token1). No fallback needed.');
    console.log('');
  } else if (someSlipstream && !anyFailed) {
    console.log('  ⚠ SLIPSTREAM SLOT0 VARIANT REQUIRED');
    console.log('    slot0() decoded only with the 6-field Slipstream variant');
    console.log('    (no feeProtocol field). Other methods worked normally.');
    console.log('');
    console.log('  Action required:');
    console.log('  - Update uniswap_v3 dispatch slotFn from \'slot0\' to');
    console.log('    \'slot0_slipstream\' for cleopatra_cl in chains.json,');
    console.log('    OR introduce a per-pool slot0 variant resolver before Step 4.');
    console.log('');
  } else {
    console.log('  ✗ POOL ABI INCOMPATIBLE');
    console.log('    One or more pool methods failed.');
    console.log('    Escalate to Boss before Step 4.');
    console.log('');
    console.log('  Per-pool error summary:');
    for (const r of results) {
      if (r.errors.length) {
        console.log(`    ${r.label}: ${r.errors.join('; ')}`);
      }
    }
    console.log('');
  }

  // Sanity matrix
  console.log('  ── sanity matrix ──');
  console.log(`    token0 match (all=USDC):      ${allToken0Match ? '✓ all pools' : '✗ MISMATCH'}`);
  console.log(`    token1 match (WETH/WMNT):     ${allToken1Match ? '✓ all pools' : '✗ MISMATCH'}`);
  console.log(`    fee() == expectedFee:         ${allFeeMatch ? '✓ all pools' : '✗ MISMATCH'}`);
  console.log('');

  if (allUniV3 && allToken0Match && allToken1Match && allFeeMatch) {
    console.log('  → uniswap_v3 venue dispatch is CORRECT for cleopatra_cl');
    console.log('  → Proceed to Step 4 (discovery sweep)');
  } else if (!allUniV3 && someSlipstream) {
    console.log('  → Boss ruling needed: slot0 variant strategy before Step 4');
  } else {
    console.log('  → Escalate Boss before Step 4');
  }
  console.log('');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
