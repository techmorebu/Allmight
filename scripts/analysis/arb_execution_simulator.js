'use strict';
/**
 * scripts/analysis/arb_execution_simulator.js  v2.0
 *
 * Purpose:
 *   Simulate real execution conditions against detected opportunities.
 *   Answers the question: "Does the edge survive friction?"
 *
 * What it models:
 *   1. Quote-to-execution drift  — price movement across +0/+1/+2 block delays
 *   2. Slippage vs size curve    — $10 → $200 sweep at actual UniV3 depth
 *   3. Gas cost (LIVE or MANUAL) — Arbitrum L2 live gas + ETH price reference
 *   4. Boss gate check           — spread >= fee+slip+gas AND depth >= $15k
 *                                  AND delay=0 profitable AND delay=1 non-negative
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --sweep
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --sweep --gas=manual
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --size=50 --delay=1
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --sweep --json
 *
 * Gas modes:
 *   --gas=live    (default) fetch live gasPrice from Arbitrum chain via provider.getFeeData()
 *   --gas=manual  fallback  use hardcoded conservative values
 *
 * Hard rules:
 *   - No execution logic
 *   - No smart contract calls beyond pool reads and getFeeData
 *   - No flash loan logic
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL       = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const UNIV3_FEE_FRAC   = 0.0005;     // 0.05%
const CAMELOT_POOL     = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';
const CAMELOT_FEE_FRAC = 0.000249;   // 0.0249% measured

const DEC0 = 18;  // ARB
const DEC1 = 6;   // USDC

// ─────────────────────────────────────────────────────────────────────────────
// GAS MODEL DEFAULTS  (manual fallback)
//   Arbitrum floor gas is typically 0.005–0.02 gwei off-peak.
//   500k gas units is conservative for a 2-leg arb via flash loan + 2 swaps.
//   ETH price hardcoded — no oracle call needed at this simulation stage.
// ─────────────────────────────────────────────────────────────────────────────
const GAS_MANUAL = {
  gasPriceGwei:   0.01,     // conservative Arbitrum floor
  estimatedUnits: 500_000,  // 2-leg arb tx gas estimate
  ethPriceUSD:    2000,     // ETH reference price
  source:         'manual',
};

// Boss gate constants
const GATE_MIN_DEPTH_USD = 15_000;
const ARBI_BLOCK_MS      = 250;

// ─────────────────────────────────────────────────────────────────────────────
// LIVE GAS FETCH
//   Uses provider.getFeeData() — standard ethers.js call, no extra contracts.
//   Returns gasPrice in wei; we convert to gwei.
//   Falls back to manual if fetch fails.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchLiveGasModel(rpc) {
  try {
    const res = await rpc.callDetailed(
      'sim.gas.feedata',
      async (provider) => provider.getFeeData(),
      { timeoutMs: 3000, hedge: true }
    );
    const fd = res.result;
    const gasPriceWei = fd.gasPrice ?? fd.maxFeePerGas ?? fd.lastBaseFeePerGas;
    if (!gasPriceWei) throw new Error('no gasPrice field in feeData');
    return {
      gasPriceGwei:   Number(gasPriceWei) / 1e9,
      estimatedUnits: GAS_MANUAL.estimatedUnits,
      ethPriceUSD:    GAS_MANUAL.ethPriceUSD,
      source:         'live',
    };
  } catch (e) {
    process.stderr.write(`\n  [gas] live fetch failed (${e.message}) — using manual fallback\n`);
    return { ...GAS_MANUAL, source: 'manual_fallback' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GAS CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
function calcGasUSD(gm) {
  return gm.estimatedUnits * gm.gasPriceGwei * 1e-9 * gm.ethPriceUSD;
}

function calcGasPct(sizeUSD, gm) {
  return (calcGasUSD(gm) / sizeUSD) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE / SLIPPAGE MATH
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToUSDC(sqrtPriceX96) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}

function activeTickDepthUSD(liquidityRaw, sqrtPriceX96) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return (Number(liquidityRaw) * sqrtP) / Math.pow(10, DEC1);
}

function slippagePct(sizeUSD, depthUSD) {
  if (depthUSD <= 0) return Infinity;
  return (sizeUSD / (2 * depthUSD)) * 100;
}

function spreadPct(priceA, priceB) {
  return Math.abs(priceA - priceB) / Math.min(priceA, priceB) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOSS GATE EVALUATION
//   All four must be true to promote toward execution prep
// ─────────────────────────────────────────────────────────────────────────────
function evaluateBossGate(d0Result, d1Result) {
  if (!d0Result || !d1Result) {
    return { passed: false, reason: 'missing delay data' };
  }
  const checks = {
    depth_above_15k:     d0Result.uniDepth >= GATE_MIN_DEPTH_USD,
    delay0_profitable:   d0Result.finalEdge > 0,
    delay1_non_negative: d1Result.finalEdge >= 0,
    spread_above_fees:   d0Result.executedSpread > d0Result.feeBurden + d0Result.gasPct,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// ABIs
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];
const ALGEBRA_ABI = [
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// ─────────────────────────────────────────────────────────────────────────────
// POOL READ
// ─────────────────────────────────────────────────────────────────────────────
async function readBothPools(blockNumber, rpc) {
  const [uniRes, camRes] = await Promise.all([
    rpc.callDetailed(
      `sim.univ3.${blockNumber}`,
      async (provider) => {
        const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
        const [s0, liq] = await Promise.all([
          pool.slot0({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { s0, liq };
      },
      { timeoutMs: 3000, hedge: true }
    ),
    rpc.callDetailed(
      `sim.camelot.${blockNumber}`,
      async (provider) => {
        const pool = new ethers.Contract(CAMELOT_POOL, ALGEBRA_ABI, provider);
        const [gs, liq] = await Promise.all([
          pool.globalState({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { gs, liq };
      },
      { timeoutMs: 3000, hedge: true }
    ),
  ]);

  const uniSqrtP  = uniRes.result.s0[0];
  const uniLiq    = uniRes.result.liq;
  const camSqrtP  = camRes.result.gs[0];
  const camFeeRaw = Number(camRes.result.gs[2]);

  return {
    uniPrice:   sqrtPriceToUSDC(uniSqrtP),
    camPrice:   sqrtPriceToUSDC(camSqrtP),
    uniDepth:   activeTickDepthUSD(uniLiq, uniSqrtP),
    camFee:     camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC,
    blockNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATE ONE POINT
// ─────────────────────────────────────────────────────────────────────────────
function simulateOne(detected, delayed, sizeUSD, gm) {
  const detectedSpread = spreadPct(detected.uniPrice, detected.camPrice);
  const executedSpread = spreadPct(delayed.uniPrice, delayed.camPrice);
  const slip           = slippagePct(sizeUSD, delayed.uniDepth);
  const feeBurden      = (UNIV3_FEE_FRAC + delayed.camFee) * 100;
  const gasUsd         = calcGasUSD(gm);
  const gasPct         = calcGasPct(sizeUSD, gm);
  const finalEdge      = executedSpread - feeBurden - slip - gasPct;

  return {
    size:           sizeUSD,
    delayBlocks:    delayed.blockNumber - detected.blockNumber,
    detectedEdge:   +detectedSpread.toFixed(5),
    executedSpread: +executedSpread.toFixed(5),
    slippage:       +slip.toFixed(5),
    feeBurden:      +feeBurden.toFixed(5),
    gasUsd:         +gasUsd.toFixed(6),
    gasPct:         +gasPct.toFixed(5),
    finalEdge:      +finalEdge.toFixed(5),
    uniDepth:       +delayed.uniDepth.toFixed(2),
    uniPrice:       +delayed.uniPrice.toFixed(6),
    camPrice:       +delayed.camPrice.toFixed(6),
    direction:      delayed.uniPrice > delayed.camPrice ? 'sell_uni_buy_camelot' : 'buy_uni_sell_camelot',
    status:         finalEdge > 0.05 ? 'PROFITABLE' : finalEdge > 0 ? 'MARGINAL' : 'LOST',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SWEEP
// ─────────────────────────────────────────────────────────────────────────────
const SIZE_RANGE  = [10, 25, 50, 100, 200];
const DELAY_RANGE = [0, 1, 2];

async function runSweep(rpc, gm, jsonMode) {
  const { blockNumber: baseBlock } = await rpc.getBlockNumber(
    'sim.sweep.block', { timeoutMs: 3000, hedge: true }
  );

  if (!jsonMode) {
    console.log(`\n[arb_execution_simulator v2.0] ${new Date().toISOString()}`);
    console.log(`  SWEEP MODE — baseBlock ${baseBlock}`);
    console.log(`  Gas: ${gm.source} | ${gm.gasPriceGwei.toFixed(6)} gwei | $${calcGasUSD(gm).toFixed(6)}/tx (${gm.estimatedUnits.toLocaleString()} units × $${gm.ethPriceUSD} ETH)`);
  }

  const detected = await readBothPools(baseBlock, rpc);
  const snaps    = {};
  for (const d of DELAY_RANGE) {
    await sleep(400);
    snaps[d] = await readBothPools(baseBlock + d, rpc);
  }

  // Build result matrix  [delay][size]
  const matrix = {};
  const allResults = [];
  for (const d of DELAY_RANGE) {
    matrix[d] = {};
    for (const s of SIZE_RANGE) {
      const r = simulateOne(detected, snaps[d], s, gm);
      matrix[d][s] = r;
      allResults.push(r);
    }
  }

  // Boss gate per size
  const gates = {};
  for (const s of SIZE_RANGE) {
    gates[s] = evaluateBossGate(matrix[0][s], matrix[1][s]);
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      mode: 'sweep', baseBlock,
      gas: { source: gm.source, gasPriceGwei: gm.gasPriceGwei, gasUsd: +calcGasUSD(gm).toFixed(6) },
      results: allResults, gates,
    }, null, 2));
    return;
  }

  const W   = 120;
  const DIV = '─'.repeat(W);
  const EQ  = '═'.repeat(W);
  console.log('\n' + EQ);
  console.log('  ARB/USDC — EXECUTION SIMULATOR v2.0   size × delay matrix');
  console.log(EQ);
  console.log(
    `  ${'size'.padEnd(7)} ${'delay'.padEnd(7)} ${'det%'.padEnd(9)} ${'exec%'.padEnd(9)} ` +
    `${'slip%'.padEnd(9)} ${'fee%'.padEnd(8)} ${'gasUsd'.padEnd(10)} ${'gas%'.padEnd(9)} ` +
    `${'final%'.padEnd(9)} ${'depth$'.padEnd(10)} status`
  );
  console.log('  ' + DIV);

  let lastDelay = null;
  for (const r of allResults) {
    if (lastDelay !== null && r.delayBlocks !== lastDelay) console.log('  ' + DIV);
    lastDelay = r.delayBlocks;
    const tag = r.status === 'PROFITABLE' ? '✓ PROFITABLE'
              : r.status === 'MARGINAL'   ? '~ MARGINAL'
              :                             '✗ LOST';
    console.log(
      `  $${String(r.size).padEnd(6)} ${(r.delayBlocks+'blk').padEnd(7)} ` +
      `${String(r.detectedEdge).padEnd(9)} ${String(r.executedSpread).padEnd(9)} ` +
      `${String(r.slippage).padEnd(9)} ${String(r.feeBurden).padEnd(8)} ` +
      `$${String(r.gasUsd.toFixed(5)).padEnd(9)} ${String(r.gasPct).padEnd(9)} ` +
      `${String(r.finalEdge).padEnd(9)} $${String(r.uniDepth).padEnd(9)} ${tag}`
    );
  }

  console.log('\n' + EQ);
  console.log('  BOSS GATE  (depth>=$15k  AND  d0>0  AND  d1>=0  AND  spread>fee+gas)');
  console.log('  ' + DIV);
  for (const s of SIZE_RANGE) {
    const g  = gates[s];
    const ok = g.passed ? '✓ PASS' : '✗ FAIL';
    const detail = g.checks
      ? Object.entries(g.checks).map(([k,v]) => `${k}:${v?'Y':'N'}`).join('  ')
      : g.reason;
    console.log(`  $${String(s).padEnd(5)} ${ok}   ${detail}`);
  }

  const prof   = allResults.filter(r => r.status === 'PROFITABLE');
  const marg   = allResults.filter(r => r.status === 'MARGINAL');
  const lost   = allResults.filter(r => r.status === 'LOST');
  console.log('\n' + EQ);
  console.log(`  PROFITABLE: ${prof.length}/${allResults.length}   MARGINAL: ${marg.length}/${allResults.length}   LOST: ${lost.length}/${allResults.length}`);
  if (prof.length > 0) {
    const best     = prof.reduce((a,b) => a.finalEdge > b.finalEdge ? a : b);
    const profSizes = [...new Set(prof.map(r => '$'+r.size))].join(', ');
    console.log(`  Best:       size=$${best.size}  delay=${best.delayBlocks}blk  finalEdge=+${best.finalEdge}%  depth=$${best.uniDepth}`);
    console.log(`  Profitable sizes (any delay): ${profSizes}`);
    // First size where delay-0 final edge goes negative
    const firstLoss = SIZE_RANGE.find(s => (matrix[0][s]?.finalEdge ?? -1) < 0);
    if (firstLoss) console.log(`  Edge turns negative (delay=0) at: $${firstLoss}`);
  }
  console.log(EQ + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE MODE
// ─────────────────────────────────────────────────────────────────────────────
async function runSingle(sizeUSD, delayBlocks, rpc, gm, jsonMode) {
  const { blockNumber: baseBlock } = await rpc.getBlockNumber(
    'sim.single.block', { timeoutMs: 3000, hedge: true }
  );

  if (!jsonMode) {
    console.log(`\n[arb_execution_simulator v2.0] ${new Date().toISOString()}`);
    console.log(`  SINGLE MODE — size=$${sizeUSD}  delay=${delayBlocks}blk  gas=${gm.source}`);
  }

  const detected = await readBothPools(baseBlock, rpc);
  let   delayed  = detected;
  if (delayBlocks > 0) {
    await sleep(delayBlocks * 400);
    delayed = await readBothPools(baseBlock + delayBlocks, rpc);
  }

  const result = simulateOne(detected, delayed, sizeUSD, gm);

  if (jsonMode) {
    console.log(JSON.stringify({ mode: 'single', baseBlock,
      gas: { source: gm.source, gasPriceGwei: gm.gasPriceGwei, gasUsd: +calcGasUSD(gm).toFixed(6) },
      result }, null, 2));
    return;
  }

  const LINE = '═'.repeat(92);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — EXECUTION SIMULATOR v2.0  SINGLE');
  console.log(LINE);
  console.log(`  Detected block:    ${baseBlock}`);
  console.log(`  Executed block:    ${baseBlock + delayBlocks}  (+${delayBlocks} blk ~${delayBlocks * ARBI_BLOCK_MS}ms)`);
  console.log(`  Direction:         ${result.direction}`);
  console.log(`  Notional size:     $${result.size}`);
  console.log('');
  console.log(`  Detected spread:   ${result.detectedEdge}%`);
  console.log(`  Executed spread:   ${result.executedSpread}%`);
  console.log(`  Slippage:         -${result.slippage}%   (size / 2×$${result.uniDepth})`);
  console.log(`  Fee burden:       -${result.feeBurden}%`);
  console.log(`  Gas cost:         -${result.gasPct}%   ($${result.gasUsd} | ${gm.gasPriceGwei.toFixed(6)} gwei | ${gm.source})`);
  console.log('                     ─────────');
  console.log(`  Final edge:       ${result.finalEdge >= 0 ? '+' : ''}${result.finalEdge}%`);
  console.log('');
  console.log(`  STATUS:  ${result.status}`);
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=')[1] : d; };
  return {
    sweep:   args.includes('--sweep'),
    json:    args.includes('--json'),
    size:    getN('--size',  25),
    delay:   getN('--delay',  1),
    gasMode: getS('--gas', 'live'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { sweep, json, size, delay, gasMode } = parseArgs();
  const rpc = createProvider('arbitrum');

  let gm;
  if (gasMode === 'manual') {
    gm = { ...GAS_MANUAL };
    if (!json) console.log(`\n  Gas mode: manual (${gm.gasPriceGwei} gwei)`);
  } else {
    if (!json) process.stdout.write('\n  Fetching live Arbitrum gas price... ');
    gm = await fetchLiveGasModel(rpc);
    if (!json) console.log(`${gm.gasPriceGwei.toFixed(6)} gwei | $${calcGasUSD(gm).toFixed(6)}/tx`);
  }

  if (sweep) {
    await runSweep(rpc, gm, json);
  } else {
    await runSingle(size, delay, rpc, gm, json);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
