'use strict';
/**
 * scripts/analysis/arb_opportunity_watcher.js  v2.0
 *
 * Three-tier depth structure (Boss ruling 2026-03-22):
 *
 *   Tier 1 — execution   uniDepth >= 15000
 *     → triggers full simulation + Boss gate evaluation
 *     → only tier that can promote toward execution prep
 *
 *   Tier 2 — subcritical  5000 <= uniDepth < 15000
 *     → logged as subcritical_depth for research only
 *     → does NOT trigger simulation or Boss gate
 *     → records spread/depth for post-session analysis
 *
 *   Tier 3 — dead  uniDepth < 5000
 *     → baseline tick only, no action
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js --gas=manual
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js --duration=7200
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js --log=./opp_log.jsonl
 *
 * Hard rules:
 *   - No execution logic
 *   - No Redis
 *   - No smart contract calls beyond pool reads + getFeeData
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL       = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const UNIV3_FEE_FRAC   = 0.0005;
const CAMELOT_POOL     = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';
const CAMELOT_FEE_FRAC = 0.000249;

const DEC0 = 18;
const DEC1 = 6;

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH TIERS (Boss ruling)
// ─────────────────────────────────────────────────────────────────────────────
const DEPTH_EXECUTION   = 15_000;
const DEPTH_SUBCRITICAL =  5_000;

function depthTier(d) {
  if (d >= DEPTH_EXECUTION)   return 'execution';
  if (d >= DEPTH_SUBCRITICAL) return 'subcritical';
  return 'dead';
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGER CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const TRIGGER_BUFFER_PCT    = 0.02;
const TRIGGER_SIZE_USD      = 25;     // reference size for threshold computation
const POLL_INTERVAL_MS      = 1_500;
const COOLDOWN_AFTER_SIM_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// SIM CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SIM_SIZE_RANGE  = [10, 25, 50, 100, 200];
const SIM_DELAY_RANGE = [0, 1, 2];
const ARBI_BLOCK_MS   = 250;

// ─────────────────────────────────────────────────────────────────────────────
// GAS MODEL
// ─────────────────────────────────────────────────────────────────────────────
const GAS_MANUAL = {
  gasPriceGwei:   0.01,
  estimatedUnits: 500_000,
  ethPriceUSD:    2000,
  source:         'manual',
};

async function fetchLiveGasModel(rpc) {
  try {
    const res = await rpc.callDetailed(
      'watcher.gas.feedata',
      async (p) => p.getFeeData(),
      { timeoutMs: 3000, hedge: true }
    );
    const fd  = res.result;
    const wei = fd.gasPrice ?? fd.maxFeePerGas ?? fd.lastBaseFeePerGas;
    if (!wei) throw new Error('no gasPrice in feeData');
    return { gasPriceGwei: Number(wei) / 1e9, estimatedUnits: 500_000, ethPriceUSD: 2000, source: 'live' };
  } catch (e) {
    process.stderr.write(`  [gas] live fetch failed (${e.message}) — manual fallback\n`);
    return { ...GAS_MANUAL, source: 'manual_fallback' };
  }
}

function calcGasUSD(gm)         { return gm.estimatedUnits * gm.gasPriceGwei * 1e-9 * gm.ethPriceUSD; }
function calcGasPct(size, gm)   { return (calcGasUSD(gm) / size) * 100; }

// ─────────────────────────────────────────────────────────────────────────────
// MATH
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToUSDC(sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}
function activeTickDepthUSD(liq, sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return (Number(liq) * sqrtP) / Math.pow(10, DEC1);
}
function slippagePct(size, depth) { return depth <= 0 ? Infinity : (size / (2 * depth)) * 100; }
function spreadPct(a, b)          { return Math.abs(a - b) / Math.min(a, b) * 100; }

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
    rpc.callDetailed(`watcher.univ3.${blockNumber}`, async (p) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, p);
      const [s0, liq] = await Promise.all([
        pool.slot0({ blockTag: blockNumber }),
        pool.liquidity({ blockTag: blockNumber }),
      ]);
      return { s0, liq };
    }, { timeoutMs: 2000, hedge: true }),
    rpc.callDetailed(`watcher.camelot.${blockNumber}`, async (p) => {
      const pool = new ethers.Contract(CAMELOT_POOL, ALGEBRA_ABI, p);
      const [gs, liq] = await Promise.all([
        pool.globalState({ blockTag: blockNumber }),
        pool.liquidity({ blockTag: blockNumber }),
      ]);
      return { gs, liq };
    }, { timeoutMs: 2000, hedge: true }),
  ]);

  const uniSqrtP  = uniRes.result.s0[0];
  const camSqrtP  = camRes.result.gs[0];
  const camFeeRaw = Number(camRes.result.gs[2]);

  return {
    uniPrice: sqrtPriceToUSDC(uniSqrtP),
    camPrice: sqrtPriceToUSDC(camSqrtP),
    uniDepth: activeTickDepthUSD(uniRes.result.liq, uniSqrtP),
    camFee:   camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC,
    blockNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOSS GATE
// ─────────────────────────────────────────────────────────────────────────────
function bossGate(d0, d1) {
  if (!d0 || !d1) return { passed: false, reason: 'missing data' };
  const checks = {
    depth_above_15k:     d0.uniDepth >= DEPTH_EXECUTION,
    delay0_profitable:   d0.finalEdge > 0,
    delay1_non_negative: d1.finalEdge >= 0,
    spread_above_fees:   d0.executedSpread > d0.feeBurden + d0.gasPct,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATE ONE POINT
// ─────────────────────────────────────────────────────────────────────────────
function simulateOne(detected, delayed, size, gm) {
  const detSpread  = spreadPct(detected.uniPrice, detected.camPrice);
  const execSpread = spreadPct(delayed.uniPrice, delayed.camPrice);
  const slip       = slippagePct(size, delayed.uniDepth);
  const feeBurden  = (UNIV3_FEE_FRAC + delayed.camFee) * 100;
  const gasUsd     = calcGasUSD(gm);
  const gasPct     = calcGasPct(size, gm);
  const finalEdge  = execSpread - feeBurden - slip - gasPct;

  return {
    size,
    delayBlocks:    delayed.blockNumber - detected.blockNumber,
    detectedEdge:   +detSpread.toFixed(5),
    executedSpread: +execSpread.toFixed(5),
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
// FULL SIMULATION  (Tier 1 only)
// ─────────────────────────────────────────────────────────────────────────────
async function runSimulation(detectedSnap, rpc, gm) {
  const base  = detectedSnap.blockNumber;
  const snaps = { 0: detectedSnap };
  for (const d of [1, 2]) {
    await sleep(400);
    try   { snaps[d] = await readBothPools(base + d, rpc); }
    catch { snaps[d] = { ...detectedSnap, blockNumber: base + d }; }
  }

  const matrix = {};
  const all    = [];
  for (const d of SIM_DELAY_RANGE) {
    matrix[d] = {};
    for (const s of SIM_SIZE_RANGE) {
      const r = simulateOne(detectedSnap, snaps[d], s, gm);
      matrix[d][s] = r;
      all.push(r);
    }
  }

  const gates = {};
  for (const s of SIM_SIZE_RANGE) gates[s] = bossGate(matrix[0][s], matrix[1][s]);

  return { matrix, all, gates };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT SIM RESULTS
// ─────────────────────────────────────────────────────────────────────────────
function printSimResults(snap, simResult, gm, triggerTime) {
  const { all, gates, matrix } = simResult;
  const W  = 120;
  const EQ = '★'.repeat(W);
  const DV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  ★★★  TIER 1 EXECUTION-GRADE OPPORTUNITY — SIMULATED  ★★★');
  console.log(`  Time: ${triggerTime}   Block: ${snap.blockNumber}`);
  console.log(`  cam=$${snap.camPrice.toFixed(6)}  uni=$${snap.uniPrice.toFixed(6)}  depth=$${snap.uniDepth.toFixed(2)}`);
  console.log(`  Gas: ${gm.source} | ${gm.gasPriceGwei.toFixed(6)} gwei | $${calcGasUSD(gm).toFixed(6)}/tx`);
  console.log(EQ);
  console.log(
    `  ${'size'.padEnd(7)} ${'delay'.padEnd(7)} ${'det%'.padEnd(9)} ${'exec%'.padEnd(9)} ` +
    `${'slip%'.padEnd(9)} ${'fee%'.padEnd(8)} ${'gas%'.padEnd(9)} ${'final%'.padEnd(9)} status`
  );
  console.log('  ' + DV);

  let lastDelay = null;
  for (const r of all) {
    if (lastDelay !== null && r.delayBlocks !== lastDelay) console.log('  ' + DV);
    lastDelay = r.delayBlocks;
    const tag = r.status === 'PROFITABLE' ? '✓ PROFITABLE'
              : r.status === 'MARGINAL'   ? '~ MARGINAL'  : '✗ LOST';
    console.log(
      `  $${String(r.size).padEnd(6)} ${(r.delayBlocks+'blk').padEnd(7)} ` +
      `${String(r.detectedEdge).padEnd(9)} ${String(r.executedSpread).padEnd(9)} ` +
      `${String(r.slippage).padEnd(9)} ${String(r.feeBurden).padEnd(8)} ` +
      `${String(r.gasPct).padEnd(9)} ${String(r.finalEdge).padEnd(9)} ${tag}`
    );
  }

  console.log('\n  BOSS GATE  (depth>=$15k  d0>0  d1>=0  spread>fee+gas)');
  console.log('  ' + DV);
  let anyPass = false;
  for (const s of SIM_SIZE_RANGE) {
    const g  = gates[s];
    if (g.passed) anyPass = true;
    const ok = g.passed ? '✓ GATE PASS' : '✗ GATE FAIL';
    const chk = g.checks
      ? Object.entries(g.checks).map(([k,v]) => `${k.replace(/_/g,'-')}:${v?'Y':'N'}`).join('  ')
      : g.reason;
    console.log(`  $${String(s).padEnd(6)} ${ok}   ${chk}`);
  }

  const prof = all.filter(r => r.status === 'PROFITABLE');
  const marg = all.filter(r => r.status === 'MARGINAL');
  console.log('\n  ───────────────────────────────────────────────────────');
  console.log(`  PROFITABLE: ${prof.length}/${all.length}   MARGINAL: ${marg.length}/${all.length}   BOSS GATE: ${anyPass ? '✓ PASS' : '✗ FAIL'}`);
  if (prof.length > 0) {
    const best = prof.reduce((a,b) => a.finalEdge > b.finalEdge ? a : b);
    console.log(`  Best: size=$${best.size}  delay=${best.delayBlocks}blk  finalEdge=+${best.finalEdge}%`);
    const negStart = SIM_SIZE_RANGE.find(s => (matrix[0]?.[s]?.finalEdge ?? -1) < 0);
    if (negStart) console.log(`  Edge turns negative at: $${negStart} (delay=0)`);
  }
  console.log(EQ + '\n');
  return anyPass;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUBCRITICAL RESEARCH LOG  (Tier 2 — no simulation, logged only)
// ─────────────────────────────────────────────────────────────────────────────
function logSubcritical(snap, spread, threshold, logPath) {
  if (!logPath) return;
  const record = {
    ts:         new Date().toISOString(),
    type:       'subcritical_depth',
    block:      snap.blockNumber,
    uniDepth:   +snap.uniDepth.toFixed(2),
    uniPrice:   +snap.uniPrice.toFixed(6),
    camPrice:   +snap.camPrice.toFixed(6),
    spread:     +spread.toFixed(5),
    threshold:  +threshold.toFixed(5),
    direction:  snap.uniPrice > snap.camPrice ? 'sell_uni_buy_camelot' : 'buy_uni_sell_camelot',
    note:       'research_only_not_execution_signal',
  };
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (e) {
    process.stderr.write(`  [log] ${e.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL LOG
// ─────────────────────────────────────────────────────────────────────────────
function appendLog(logPath, record) {
  if (!logPath) return;
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (e) {
    process.stderr.write(`  [log] ${e.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WATCH LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function watchLoop(rpc, gm, durationS, logPath) {
  const endMs  = Date.now() + durationS * 1000;
  let lastBlock = null;
  let lastLabel = null;
  let cooldownUntil = 0;

  const stats = {
    ticks: 0, errors: 0,
    t1detections: 0, t1gatePasses: 0,
    t2logged: 0,
    startMs: Date.now(),
  };

  const W   = 108;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  ARB/USDC — OPPORTUNITY WATCHER v2.0   (three-tier depth)');
  console.log(`  Gas: ${gm.source}  |  ${gm.gasPriceGwei.toFixed(6)} gwei  |  $${calcGasUSD(gm).toFixed(6)}/tx`);
  console.log(`  Tier 1 execution: depth >= $${DEPTH_EXECUTION.toLocaleString()}  → simulate + gate`);
  console.log(`  Tier 2 subcrit:   depth $${DEPTH_SUBCRITICAL.toLocaleString()}–$${(DEPTH_EXECUTION-1).toLocaleString()}     → log only (research)`);
  console.log(`  Tier 3 dead:      depth < $${DEPTH_SUBCRITICAL.toLocaleString()}       → baseline only`);
  if (logPath) console.log(`  Log: ${logPath}`);
  console.log(EQ);
  console.log(
    `  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'depth$'.padEnd(11)} ` +
    `${'spread%'.padEnd(10)} ${'thresh%'.padEnd(10)} tier`
  );
  console.log('  ' + DIV);

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    // Block
    let blockNumber;
    try {
      const b = await rpc.getBlockNumber('watcher.block', { timeoutMs: 1200, hedge: true });
      blockNumber = b.blockNumber;
    } catch {
      stats.errors++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Cooldown
    if (Date.now() < cooldownUntil) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Pools
    let snap;
    try {
      snap = await readBothPools(blockNumber, rpc);
    } catch (e) {
      stats.errors++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    stats.ticks++;

    const spread    = spreadPct(snap.uniPrice, snap.camPrice);
    const feeBurden = (UNIV3_FEE_FRAC + snap.camFee) * 100;
    const slip      = slippagePct(TRIGGER_SIZE_USD, snap.uniDepth);
    const threshold = feeBurden + slip + TRIGGER_BUFFER_PCT;
    const tier      = depthTier(snap.uniDepth);
    const aboveThreshold = spread > threshold;

    // Determine label for display / change detection
    let label;
    if (tier === 'execution' && aboveThreshold)    label = '★ T1 TRIGGERED';
    else if (tier === 'execution')                  label = 'T1 below_thresh';
    else if (tier === 'subcritical' && aboveThreshold) label = '~ T2 subcritical';
    else if (tier === 'subcritical')                label = 'T2 low_spread';
    else                                            label = 'T3 dead';

    // Print on block change or label change
    if (blockNumber !== lastBlock || label !== lastLabel) {
      const tierIcon = tier === 'execution'   ? '[T1]'
                     : tier === 'subcritical' ? '[T2]'
                     :                          '[T3]';
      const line =
        `  ${fmtTime().padEnd(10)} ${String(blockNumber).padEnd(12)} ` +
        `$${String(snap.uniDepth.toFixed(2)).padEnd(10)} ` +
        `${String(spread.toFixed(5)).padEnd(10)} ${String(threshold.toFixed(5)).padEnd(10)} ` +
        `${tierIcon} ${label}`;
      if (tier === 'execution' && aboveThreshold) console.log('\x1b[1m' + line + '\x1b[0m');
      else console.log(line);
      lastBlock = blockNumber;
      lastLabel = label;
    }

    // ── Tier 1: trigger + simulate ──────────────────────────────────────────
    if (tier === 'execution' && aboveThreshold) {
      stats.t1detections++;
      const triggerTime = new Date().toISOString();
      console.log(`\n  → Tier 1 trigger at block ${blockNumber}. Running simulation...`);

      try {
        const simResult  = await runSimulation(snap, rpc, gm);
        const gatePassed = printSimResults(snap, simResult, gm, triggerTime);
        if (gatePassed) stats.t1gatePasses++;

        appendLog(logPath, {
          ts: triggerTime, type: 'tier1_execution',
          block: blockNumber, spread: +spread.toFixed(5),
          threshold: +threshold.toFixed(5),
          uniDepth: +snap.uniDepth.toFixed(2),
          uniPrice: +snap.uniPrice.toFixed(6),
          camPrice: +snap.camPrice.toFixed(6),
          gasSource: gm.source, gasPriceGwei: gm.gasPriceGwei,
          gatePassed, simResults: simResult.all, gates: simResult.gates,
        });
      } catch (e) {
        console.error(`  [sim] ERROR: ${e.message}`);
      }

      cooldownUntil = Date.now() + COOLDOWN_AFTER_SIM_MS;
      console.log(`  → Cooldown ${COOLDOWN_AFTER_SIM_MS / 1000}s...\n`);
    }

    // ── Tier 2: research log only ────────────────────────────────────────────
    else if (tier === 'subcritical' && aboveThreshold) {
      stats.t2logged++;
      logSubcritical(snap, spread, threshold, logPath);
    }

    const elapsed = Date.now() - loopStart;
    await sleep(Math.max(0, POLL_INTERVAL_MS - elapsed));
  }

  // Summary
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  console.log('\n' + EQ);
  console.log(`  WATCHER SUMMARY   (${elapsed}s  |  ${stats.ticks} ticks  |  ${stats.errors} errors)`);
  console.log(`  Tier 1 triggers detected:  ${stats.t1detections}`);
  console.log(`  Tier 1 Boss gate passes:   ${stats.t1gatePasses}`);
  console.log(`  Tier 2 subcritical logged: ${stats.t2logged}  (research only)`);
  if (logPath) console.log(`  Log file: ${logPath}`);
  console.log(EQ + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function fmtTime() { return new Date().toISOString().slice(11, 19); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f,d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f,d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=')[1] : d; };
  return {
    gasMode:  getS('--gas',      'live'),
    duration: getN('--duration', 7200),
    logPath:  getS('--log',      null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { gasMode, duration, logPath } = parseArgs();
  const rpc = createProvider('arbitrum');

  let gm;
  if (gasMode === 'manual') {
    gm = { ...GAS_MANUAL };
    console.log(`\n  Gas mode: manual (${gm.gasPriceGwei} gwei)`);
  } else {
    process.stdout.write('\n  Fetching live Arbitrum gas price... ');
    gm = await fetchLiveGasModel(rpc);
    console.log(`${gm.gasPriceGwei.toFixed(6)} gwei | $${calcGasUSD(gm).toFixed(6)}/tx`);
  }

  await watchLoop(rpc, gm, duration, logPath);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
