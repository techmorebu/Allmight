'use strict';
/**
 * scripts/analysis/arb_opportunity_watcher.js  v3.0
 *
 * Predictive state machine (Boss ruling 2026-03-23):
 *
 *   PASSIVE      default state — slow poll, log spread/depth baseline
 *                currentPrice < $0.1000
 *
 *   ARMED        predictive pre-alert — price approaching known liquidity wall
 *                currentPrice >= $0.1000  (80 ticks below $17k zone entry)
 *                → high-frequency polling (500ms)
 *                → spread + depth checks active
 *                → simulator gating primed
 *
 *   EXECUTABLE   full execution-quality gate passed
 *                uniDepth >= $15k AND spread >= threshold AND d0>0 AND d1>=0
 *                → simulation runs + Boss gate evaluated
 *
 *   DISARMED     price fell back below $0.1000 after being ARMED
 *                → log transition, return to PASSIVE
 *
 * Why $0.1000 threshold (Boss ruling):
 *   Tick map confirmed: first HIGH zone ($17,650 depth) at tick -299250 = $0.101015
 *   Pre-alert at $0.1000 gives ~80-tick warning before depth activates
 *   That is the earliest viable detection point for this surface
 *
 * Polling rates:
 *   PASSIVE:  1500ms  (baseline, low RPC cost)
 *   ARMED:     500ms  (high-frequency, 3× faster)
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
// STATE MACHINE THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
const ARMED_PRICE_THRESHOLD = 0.1000;   // Boss ruling: pre-alert activation
const DEPTH_EXECUTION       = 15_000;   // Boss gate: execution-grade depth
const DEPTH_SUBCRITICAL     =  5_000;   // research band

// ─────────────────────────────────────────────────────────────────────────────
// POLLING RATES
// ─────────────────────────────────────────────────────────────────────────────
const POLL_PASSIVE_MS       = 1_500;    // PASSIVE mode
const POLL_ARMED_MS         =   500;    // ARMED mode — 3× faster
const COOLDOWN_AFTER_SIM_MS = 10_000;

// ─────────────────────────────────────────────────────────────────────────────
// SIM CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const TRIGGER_BUFFER_PCT = 0.02;
const TRIGGER_SIZE_USD   = 25;
const SIM_SIZE_RANGE     = [10, 25, 50, 100, 200];
const SIM_DELAY_RANGE    = [0, 1, 2];

// ─────────────────────────────────────────────────────────────────────────────
// GAS MODEL
// ─────────────────────────────────────────────────────────────────────────────
const GAS_MANUAL = {
  gasPriceGwei: 0.01, estimatedUnits: 500_000, ethPriceUSD: 2000, source: 'manual',
};

async function fetchLiveGasModel(rpc) {
  try {
    const res = await rpc.callDetailed(
      'watcher.gas.feedata', async (p) => p.getFeeData(),
      { timeoutMs: 3000, hedge: true }
    );
    const fd  = res.result;
    const wei = fd.gasPrice ?? fd.maxFeePerGas ?? fd.lastBaseFeePerGas;
    if (!wei) throw new Error('no gasPrice in feeData');
    return { gasPriceGwei: Number(wei) / 1e9, estimatedUnits: 500_000, ethPriceUSD: 2000, source: 'live' };
  } catch (e) {
    process.stderr.write(`  [gas] ${e.message} — manual fallback\n`);
    return { ...GAS_MANUAL, source: 'manual_fallback' };
  }
}

function calcGasUSD(gm)       { return gm.estimatedUnits * gm.gasPriceGwei * 1e-9 * gm.ethPriceUSD; }
function calcGasPct(size, gm) { return (calcGasUSD(gm) / size) * 100; }

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
// BOSS GATE (execution quality — unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function bossGate(d0, d1) {
  if (!d0 || !d1) return { passed: false, reason: 'missing data' };
  const checks = {
    price_armed:         d0.uniPrice >= ARMED_PRICE_THRESHOLD,
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
    size, delayBlocks: delayed.blockNumber - detected.blockNumber,
    detectedEdge: +detSpread.toFixed(5), executedSpread: +execSpread.toFixed(5),
    slippage: +slip.toFixed(5), feeBurden: +feeBurden.toFixed(5),
    gasUsd: +gasUsd.toFixed(6), gasPct: +gasPct.toFixed(5),
    finalEdge: +finalEdge.toFixed(5),
    uniDepth: +delayed.uniDepth.toFixed(2),
    uniPrice: +delayed.uniPrice.toFixed(6), camPrice: +delayed.camPrice.toFixed(6),
    direction: delayed.uniPrice > delayed.camPrice ? 'sell_uni_buy_camelot' : 'buy_uni_sell_camelot',
    status: finalEdge > 0.05 ? 'PROFITABLE' : finalEdge > 0 ? 'MARGINAL' : 'LOST',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL SIMULATION (EXECUTABLE state only)
// ─────────────────────────────────────────────────────────────────────────────
async function runSimulation(snap, rpc, gm) {
  const base  = snap.blockNumber;
  const snaps = { 0: snap };
  for (const d of [1, 2]) {
    await sleep(400);
    try   { snaps[d] = await readBothPools(base + d, rpc); }
    catch { snaps[d] = { ...snap, blockNumber: base + d }; }
  }
  const matrix = {};
  const all    = [];
  for (const d of SIM_DELAY_RANGE) {
    matrix[d] = {};
    for (const s of SIM_SIZE_RANGE) {
      const r = simulateOne(snap, snaps[d], s, gm);
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
function printSimResults(snap, simResult, gm, ts) {
  const { all, gates, matrix } = simResult;
  const EQ = '★'.repeat(110);
  const DV = '─'.repeat(110);
  console.log('\n' + EQ);
  console.log('  ★★★  STATE: EXECUTABLE — FULL SIMULATION  ★★★');
  console.log(`  ${ts}   block=${snap.blockNumber}   price=$${snap.uniPrice.toFixed(6)}   depth=$${snap.uniDepth.toFixed(2)}`);
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
  console.log('\n  BOSS GATE');
  console.log('  ' + DV);
  let anyPass = false;
  for (const s of SIM_SIZE_RANGE) {
    const g = gates[s];
    if (g.passed) anyPass = true;
    const ok  = g.passed ? '✓ GATE PASS' : '✗ GATE FAIL';
    const chk = g.checks
      ? Object.entries(g.checks).map(([k,v]) => `${k.replace(/_/g,'-')}:${v?'Y':'N'}`).join('  ')
      : g.reason;
    console.log(`  $${String(s).padEnd(6)} ${ok}   ${chk}`);
  }
  const prof = all.filter(r => r.status === 'PROFITABLE');
  console.log(`\n  PROFITABLE: ${prof.length}/${all.length}   GATE: ${anyPass ? '✓ PASS' : '✗ FAIL'}`);
  if (prof.length > 0) {
    const best     = prof.reduce((a,b) => a.finalEdge > b.finalEdge ? a : b);
    const negStart = SIM_SIZE_RANGE.find(s => (matrix[0]?.[s]?.finalEdge ?? -1) < 0);
    console.log(`  Best: size=$${best.size}  delay=${best.delayBlocks}blk  edge=+${best.finalEdge}%`);
    if (negStart) console.log(`  Edge turns negative at: $${negStart} (delay=0)`);
  }
  console.log(EQ + '\n');
  return anyPass;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE TRANSITION PRINTER
// ─────────────────────────────────────────────────────────────────────────────
function printStateTransition(from, to, snap, reason) {
  const icons = { PASSIVE: '○', ARMED: '◉', EXECUTABLE: '★', DISARMED: '✗' };
  const LINE  = '─'.repeat(90);
  console.log(`\n  ${LINE}`);
  console.log(
    `  [STATE] ${icons[from] || '?'} ${from} → ${icons[to] || '?'} ${to}` +
    `   ${fmtTime()}   price=$${snap.uniPrice.toFixed(6)}   depth=$${snap.uniDepth.toFixed(2)}`
  );
  if (reason) console.log(`  [STATE] reason: ${reason}`);
  console.log(`  ${LINE}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG
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
// MAIN WATCH LOOP — state machine
// ─────────────────────────────────────────────────────────────────────────────
async function watchLoop(rpc, gm, durationS, logPath) {
  const endMs = Date.now() + durationS * 1000;

  // State
  let state         = 'PASSIVE';   // PASSIVE | ARMED | EXECUTABLE | DISARMED
  let lastBlock     = null;
  let lastPrintKey  = null;
  let cooldownUntil = 0;

  const stats = {
    ticks: 0, errors: 0,
    armedCount: 0, disarmedCount: 0,
    executableCount: 0, gatePasses: 0,
    startMs: Date.now(),
  };

  const W   = 108;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  ARB/USDC — OPPORTUNITY WATCHER v3.0   (predictive state machine)');
  console.log(`  Gas: ${gm.source}  |  ${gm.gasPriceGwei.toFixed(6)} gwei  |  $${calcGasUSD(gm).toFixed(6)}/tx`);
  console.log(`  PASSIVE threshold:    price < $${ARMED_PRICE_THRESHOLD}   → poll ${POLL_PASSIVE_MS}ms`);
  console.log(`  ARMED threshold:      price >= $${ARMED_PRICE_THRESHOLD}  → poll ${POLL_ARMED_MS}ms`);
  console.log(`  EXECUTABLE gate:      depth >= $${DEPTH_EXECUTION.toLocaleString()} + spread + d0>0 + d1>=0`);
  console.log(`  Nearest HIGH zone:    $0.101015  (+927 ticks from today's price)`);
  if (logPath) console.log(`  Log: ${logPath}`);
  console.log(EQ);
  console.log(
    `  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'price$'.padEnd(10)} ` +
    `${'depth$'.padEnd(10)} ${'spread%'.padEnd(9)} state`
  );
  console.log('  ' + DIV);

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    // Cooldown check
    if (Date.now() < cooldownUntil) {
      await sleep(POLL_PASSIVE_MS);
      continue;
    }

    // Block
    let blockNumber;
    try {
      const b = await rpc.getBlockNumber('watcher.block', { timeoutMs: 1200, hedge: true });
      blockNumber = b.blockNumber;
    } catch {
      stats.errors++;
      await sleep(POLL_PASSIVE_MS);
      continue;
    }

    if (blockNumber === lastBlock) {
      await sleep(state === 'ARMED' ? POLL_ARMED_MS : POLL_PASSIVE_MS);
      continue;
    }
    lastBlock = blockNumber;

    // Pool read
    let snap;
    try {
      snap = await readBothPools(blockNumber, rpc);
    } catch (e) {
      stats.errors++;
      await sleep(POLL_PASSIVE_MS);
      continue;
    }

    stats.ticks++;

    // ── STATE MACHINE ────────────────────────────────────────────────────────
    const spread         = spreadPct(snap.uniPrice, snap.camPrice);
    const feeBurden      = (UNIV3_FEE_FRAC + snap.camFee) * 100;
    const slip           = slippagePct(TRIGGER_SIZE_USD, snap.uniDepth);
    const threshold      = feeBurden + slip + TRIGGER_BUFFER_PCT;
    const isArmedPrice   = snap.uniPrice >= ARMED_PRICE_THRESHOLD;
    const isExecDepth    = snap.uniDepth >= DEPTH_EXECUTION;
    const isAboveThresh  = spread > threshold;
    const prevState      = state;

    // State transitions
    if (state === 'PASSIVE' && isArmedPrice) {
      state = 'ARMED';
      stats.armedCount++;
      printStateTransition('PASSIVE', 'ARMED', snap, `price $${snap.uniPrice.toFixed(6)} >= $${ARMED_PRICE_THRESHOLD}`);
      appendLog(logPath, { ts: new Date().toISOString(), type: 'state_transition', from: 'PASSIVE', to: 'ARMED', block: blockNumber, uniPrice: +snap.uniPrice.toFixed(6), uniDepth: +snap.uniDepth.toFixed(2) });
    }
    else if (state === 'ARMED' && !isArmedPrice) {
      state = 'DISARMED';
      stats.disarmedCount++;
      printStateTransition('ARMED', 'DISARMED', snap, `price $${snap.uniPrice.toFixed(6)} fell below $${ARMED_PRICE_THRESHOLD}`);
      appendLog(logPath, { ts: new Date().toISOString(), type: 'state_transition', from: 'ARMED', to: 'DISARMED', block: blockNumber, uniPrice: +snap.uniPrice.toFixed(6), uniDepth: +snap.uniDepth.toFixed(2) });
      state = 'PASSIVE';  // immediately return to PASSIVE
    }
    else if (state === 'ARMED' && isExecDepth && isAboveThresh) {
      state = 'EXECUTABLE';
      stats.executableCount++;
      printStateTransition('ARMED', 'EXECUTABLE', snap, `depth=$${snap.uniDepth.toFixed(2)} spread=${spread.toFixed(5)}% > threshold ${threshold.toFixed(5)}%`);
    }
    else if (state === 'EXECUTABLE' && (!isExecDepth || !isAboveThresh)) {
      // Opportunity window closed — return to ARMED if price still above threshold
      const nextState = isArmedPrice ? 'ARMED' : 'PASSIVE';
      printStateTransition('EXECUTABLE', nextState, snap, 'window closed');
      appendLog(logPath, { ts: new Date().toISOString(), type: 'state_transition', from: 'EXECUTABLE', to: nextState, block: blockNumber, uniPrice: +snap.uniPrice.toFixed(6), uniDepth: +snap.uniDepth.toFixed(2) });
      state = nextState;
    }

    // ── PRINT TICK LINE ──────────────────────────────────────────────────────
    const printKey = `${blockNumber}:${state}`;
    if (printKey !== lastPrintKey) {
      const stateTag = state === 'PASSIVE'    ? '○ PASSIVE   '
                     : state === 'ARMED'      ? '◉ ARMED     '
                     : state === 'EXECUTABLE' ? '★ EXECUTABLE'
                     :                          '✗ DISARMED  ';
      const line =
        `  ${fmtTime().padEnd(10)} ${String(blockNumber).padEnd(12)} ` +
        `$${String(snap.uniPrice.toFixed(6)).padEnd(9)} ` +
        `$${String(snap.uniDepth.toFixed(2)).padEnd(9)} ` +
        `${String(spread.toFixed(5)).padEnd(9)} ${stateTag}`;
      if (state === 'EXECUTABLE') console.log('\x1b[1m' + line + '\x1b[0m');
      else if (state === 'ARMED') console.log('\x1b[33m' + line + '\x1b[0m');  // yellow
      else console.log(line);
      lastPrintKey = printKey;
    }

    // ── ACTIONS BY STATE ─────────────────────────────────────────────────────

    // ARMED — high-frequency, spread/depth monitoring only, log subcritical
    if (state === 'ARMED') {
      if (snap.uniDepth >= DEPTH_SUBCRITICAL && isAboveThresh) {
        appendLog(logPath, {
          ts: new Date().toISOString(), type: 'armed_subcritical',
          block: blockNumber, spread: +spread.toFixed(5), threshold: +threshold.toFixed(5),
          uniDepth: +snap.uniDepth.toFixed(2), uniPrice: +snap.uniPrice.toFixed(6),
        });
      }
    }

    // EXECUTABLE — run full simulation
    else if (state === 'EXECUTABLE') {
      const triggerTime = new Date().toISOString();
      console.log(`\n  → EXECUTABLE at block ${blockNumber}. Running simulation...`);
      try {
        const simResult  = await runSimulation(snap, rpc, gm);
        const gatePassed = printSimResults(snap, simResult, gm, triggerTime);
        if (gatePassed) stats.gatePasses++;

        appendLog(logPath, {
          ts: triggerTime, type: 'executable',
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
      state = isArmedPrice ? 'ARMED' : 'PASSIVE';
      console.log(`  → Cooldown ${COOLDOWN_AFTER_SIM_MS / 1000}s → back to ${state}\n`);
    }

    // Adaptive poll interval
    const elapsed = Date.now() - loopStart;
    const pollMs  = state === 'ARMED' ? POLL_ARMED_MS : POLL_PASSIVE_MS;
    await sleep(Math.max(0, pollMs - elapsed));
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  console.log('\n' + EQ);
  console.log(`  WATCHER SUMMARY v3.0   (${elapsed}s  |  ${stats.ticks} ticks  |  ${stats.errors} errors)`);
  console.log(`  PASSIVE→ARMED transitions:  ${stats.armedCount}`);
  console.log(`  ARMED→DISARMED transitions: ${stats.disarmedCount}`);
  console.log(`  EXECUTABLE events:          ${stats.executableCount}`);
  console.log(`  Boss gate passes:           ${stats.gatePasses}`);
  if (logPath) console.log(`  Log: ${logPath}`);
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
