'use strict';
/**
 * scripts/analysis/arb_execution_simulator.js
 *
 * Purpose:
 *   Simulate real execution conditions against detected opportunities.
 *   Answers the question: "Does the edge survive friction?"
 *
 * What it models:
 *   1. Quote-to-execution drift  — price movement across +0/+1/+2 block delays
 *   2. Slippage vs size curve    — $10 → $200 sweep at actual UniV3 depth
 *   3. Gas cost                  — Arbitrum L2 gas estimate in edge-% equivalent
 *   4. Edge decay classification — PROFITABLE / MARGINAL / LOST
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --size=50
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --delay=2
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --sweep
 *   node -r dotenv/config scripts/analysis/arb_execution_simulator.js --json
 *
 * Modes:
 *   default : simulate a live sample at --size and --delay
 *   --sweep : run full size×delay matrix
 *   --json  : emit results as JSON (for pipeline integration)
 *
 * Hard rules:
 *   - No execution logic
 *   - No smart contract calls
 *   - No flash loan logic
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *   - Serial loops with sleep for multi-pool reads
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL      = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const UNIV3_FEE_FRAC  = 0.0005;     // 0.05%
const CAMELOT_POOL    = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';
const CAMELOT_FEE_FRAC = 0.000249;  // 0.0249% measured dynamic fee
const FEE_BURDEN_FRAC = UNIV3_FEE_FRAC + CAMELOT_FEE_FRAC;

const DEC0 = 18;  // ARB
const DEC1 = 6;   // USDC

// ─────────────────────────────────────────────────────────────────────────────
// GAS MODEL — Arbitrum mainnet empirical estimates
//   Typical 2-swap arb tx: ~400k–600k gas units
//   Arbitrum gas price: ~0.01–0.1 gwei (spikes to 0.5 during congestion)
//   ETH price: $2000 (conservative)
//   For $25 notional @ 0.05 gwei × 500k gas × 1e-9 × 2000 USD/ETH = ~$0.05 = 0.2% of $25
//   We model as a function of notional to get edge-% equivalent
// ─────────────────────────────────────────────────────────────────────────────
const GAS = {
  estimatedUnits:   500_000,   // gas units for 2-leg arb tx (conservative)
  gasPriceGwei:     0.05,      // Arbitrum typical gwei (conservative)
  ethPriceUSD:      2000,      // ETH reference price
};

function gasUSD() {
  return GAS.estimatedUnits * GAS.gasPriceGwei * 1e-9 * GAS.ethPriceUSD;
}

function gasEdgePct(sizeUSD) {
  return (gasUSD() / sizeUSD) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE / SLIPPAGE MATH  (same as trigger_monitor)
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
// BLOCK DRIFT MODEL
//   On Arbitrum, blocks are ~250ms apart at peak, ~1s off-peak
//   For each delay block, we apply a price drift model based on observed
//   volatility from the trigger monitor session.
//   Observed: prices changed tick-to-tick in ~0.05–0.13% range
//   Conservative drift per block: 0.05% (adverse)
// ─────────────────────────────────────────────────────────────────────────────
const DRIFT_PER_BLOCK_PCT = 0.05;   // adverse drift assumption per block
const ARBI_BLOCK_MS       = 250;    // ~250ms per Arbitrum block

// ─────────────────────────────────────────────────────────────────────────────
// LIVE POOL READ — reads both pools at a given block
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];
const ALGEBRA_ABI = [
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

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

  const uniPrice  = sqrtPriceToUSDC(uniSqrtP);
  const camPrice  = sqrtPriceToUSDC(camSqrtP);
  const uniDepth  = activeTickDepthUSD(uniLiq, uniSqrtP);
  const camFee    = camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC;

  return { uniPrice, camPrice, uniDepth, camFee, blockNumber };
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SIMULATION — given detected snapshot + params, compute execution edge
// ─────────────────────────────────────────────────────────────────────────────
function simulateOne(detected, delayed, sizeUSD) {
  const detectedSpread  = spreadPct(detected.uniPrice, detected.camPrice);
  const executedSpread  = spreadPct(delayed.uniPrice, delayed.camPrice);
  const slippage        = slippagePct(sizeUSD, delayed.uniDepth);
  const feeBurden       = (UNIV3_FEE_FRAC + delayed.camFee) * 100;
  const gasPct          = gasEdgePct(sizeUSD);
  const finalEdge       = executedSpread - feeBurden - slippage - gasPct;

  let status;
  if (finalEdge > 0.05)       status = 'PROFITABLE';
  else if (finalEdge > 0)     status = 'MARGINAL';
  else                        status = 'LOST';

  return {
    size:             sizeUSD,
    delayBlocks:      delayed.blockNumber - detected.blockNumber,
    detectedEdge:     +detectedSpread.toFixed(5),
    executedSpread:   +executedSpread.toFixed(5),
    slippage:         +slippage.toFixed(5),
    feeBurden:        +feeBurden.toFixed(5),
    gasCost:          +gasPct.toFixed(5),
    finalEdge:        +finalEdge.toFixed(5),
    uniDepth:         +delayed.uniDepth.toFixed(2),
    uniPrice:         +delayed.uniPrice.toFixed(6),
    camPrice:         +delayed.camPrice.toFixed(6),
    direction:        delayed.uniPrice > delayed.camPrice
                       ? 'sell_uni_buy_camelot'
                       : 'buy_uni_sell_camelot',
    status,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SWEEP — run size × delay matrix
// ─────────────────────────────────────────────────────────────────────────────
const SIZE_RANGE  = [10, 25, 50, 100, 200];
const DELAY_RANGE = [0, 1, 2];

async function runSweep(rpc, jsonMode) {
  const currentBlock = await rpc.getBlockNumber('sim.sweep.block', { timeoutMs: 3000, hedge: true });
  const baseBlock    = currentBlock.blockNumber;

  if (!jsonMode) {
    console.log(`\n[arb_execution_simulator] ${new Date().toISOString()}`);
    console.log(`  SWEEP MODE — reading blocks ${baseBlock}…${baseBlock + 2}`);
    console.log(`  Size range:  ${SIZE_RANGE.map(s => '$'+s).join(', ')}`);
    console.log(`  Delay range: ${DELAY_RANGE.map(d => d+'blk').join(', ')}`);
  }

  // Read detected snapshot (base block)
  const detected = await readBothPools(baseBlock, rpc);

  // Read delayed snapshots serially (anti-stampede)
  const delayedSnapshots = {};
  for (const delay of DELAY_RANGE) {
    await sleep(400);
    const blk = baseBlock + delay;
    delayedSnapshots[delay] = await readBothPools(blk, rpc);
  }

  const results = [];
  for (const delay of DELAY_RANGE) {
    for (const size of SIZE_RANGE) {
      results.push(simulateOne(detected, delayedSnapshots[delay], size));
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify({ mode: 'sweep', baseBlock, results }, null, 2));
    return;
  }

  // Pretty table
  const LINE = '═'.repeat(110);
  const DIV  = '─'.repeat(110);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — EXECUTION SIMULATOR   size × delay matrix');
  console.log(`  Gas model: ${GAS.estimatedUnits.toLocaleString()} gas × ${GAS.gasPriceGwei} gwei × $${GAS.ethPriceUSD}/ETH = $${gasUSD().toFixed(4)} per tx`);
  console.log(LINE);
  console.log(
    `  ${'size'.padEnd(7)} ${'delay'.padEnd(7)} ${'det%'.padEnd(9)} ${'exec%'.padEnd(9)} ` +
    `${'slip%'.padEnd(9)} ${'fee%'.padEnd(8)} ${'gas%'.padEnd(8)} ${'final%'.padEnd(9)} ` +
    `${'depth$'.padEnd(10)} status`
  );
  console.log('  ' + DIV);

  let lastDelay = null;
  for (const r of results) {
    if (lastDelay !== null && r.delayBlocks !== lastDelay) console.log('  ' + DIV);
    lastDelay = r.delayBlocks;
    const tag = r.status === 'PROFITABLE' ? '✓ PROFITABLE'
              : r.status === 'MARGINAL'   ? '~ MARGINAL'
              : '✗ LOST';
    console.log(
      `  $${String(r.size).padEnd(6)} ${String(r.delayBlocks+'blk').padEnd(7)} ` +
      `${String(r.detectedEdge).padEnd(9)} ${String(r.executedSpread).padEnd(9)} ` +
      `${String(r.slippage).padEnd(9)} ${String(r.feeBurden).padEnd(8)} ` +
      `${String(r.gasCost).padEnd(8)} ${String(r.finalEdge).padEnd(9)} ` +
      `$${String(r.uniDepth).padEnd(9)} ${tag}`
    );
  }

  // Summary
  console.log('\n' + LINE);
  const profitable = results.filter(r => r.status === 'PROFITABLE');
  const marginal   = results.filter(r => r.status === 'MARGINAL');
  const lost       = results.filter(r => r.status === 'LOST');
  console.log(`  PROFITABLE: ${profitable.length}/${results.length}`);
  console.log(`  MARGINAL:   ${marginal.length}/${results.length}`);
  console.log(`  LOST:       ${lost.length}/${results.length}`);
  if (profitable.length > 0) {
    const best = profitable.reduce((a, b) => a.finalEdge > b.finalEdge ? a : b);
    console.log(`\n  Best result: size=$${best.size}  delay=${best.delayBlocks}blk  finalEdge=+${best.finalEdge}%  depth=$${best.uniDepth}`);
  }
  const maxProfitableSize = profitable.length > 0
    ? Math.max(...profitable.map(r => r.size))
    : 'none';
  const minProfitableSize = profitable.length > 0
    ? Math.min(...profitable.map(r => r.size))
    : 'none';
  console.log(`  Profitable size range: $${minProfitableSize} – $${maxProfitableSize}`);
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE MODE — sample current market + simulate
// ─────────────────────────────────────────────────────────────────────────────
async function runSingle(sizeUSD, delayBlocks, rpc, jsonMode) {
  const currentBlock = await rpc.getBlockNumber('sim.single.block', { timeoutMs: 3000, hedge: true });
  const baseBlock    = currentBlock.blockNumber;

  if (!jsonMode) {
    console.log(`\n[arb_execution_simulator] ${new Date().toISOString()}`);
    console.log(`  SINGLE MODE — size=$${sizeUSD}  delay=${delayBlocks}blk`);
    console.log(`  baseBlock: ${baseBlock}`);
  }

  const detected = await readBothPools(baseBlock, rpc);

  let delayed = detected;
  if (delayBlocks > 0) {
    await sleep(delayBlocks * 400);
    delayed = await readBothPools(baseBlock + delayBlocks, rpc);
  }

  const result = simulateOne(detected, delayed, sizeUSD);

  if (jsonMode) {
    console.log(JSON.stringify({ mode: 'single', baseBlock, result }, null, 2));
    return;
  }

  const LINE = '═'.repeat(90);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — EXECUTION SIMULATOR RESULT');
  console.log(LINE);
  console.log(`  Detected block:   ${baseBlock}`);
  console.log(`  Executed block:   ${baseBlock + delayBlocks}  (+${delayBlocks} blocks, ~${delayBlocks * ARBI_BLOCK_MS}ms)`);
  console.log(`  Direction:        ${result.direction}`);
  console.log(`  Notional size:    $${result.size}`);
  console.log('');
  console.log(`  Detected spread:  ${result.detectedEdge}%`);
  console.log(`  Executed spread:  ${result.executedSpread}%  (after block drift)`);
  console.log(`  Slippage:        -${result.slippage}%  (size / 2×depth at $${result.uniDepth})`);
  console.log(`  Fee burden:      -${result.feeBurden}%  (UniV3 ${(UNIV3_FEE_FRAC*100).toFixed(4)}% + Camelot ${(result.feeBurden - UNIV3_FEE_FRAC*100).toFixed(4)}%)`);
  console.log(`  Gas cost:        -${result.gasCost}%  ($${gasUSD().toFixed(4)} / $${result.size} notional)`);
  console.log('                    ────────');
  console.log(`  Final edge:      ${result.finalEdge > 0 ? '+' : ''}${result.finalEdge}%`);
  console.log('');
  console.log(`  STATUS:  ${result.status}`);
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (flag, def) => {
    const a = args.find(a => a.startsWith(flag + '='));
    return a ? Number(a.split('=')[1]) : def;
  };
  return {
    sweep:  args.includes('--sweep'),
    json:   args.includes('--json'),
    size:   getN('--size',  25),
    delay:  getN('--delay',  1),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { sweep, json, size, delay } = parseArgs();
  const rpc = createProvider('arbitrum');

  if (sweep) {
    await runSweep(rpc, json);
  } else {
    await runSingle(size, delay, rpc, json);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
