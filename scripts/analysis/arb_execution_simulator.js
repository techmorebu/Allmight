'use strict';
/**
 * scripts/analysis/arb_opportunity_watcher.js
 *
 * Purpose:
 *   Single-loop automation: detects executable opportunities AND immediately
 *   simulates execution friction — no manual intervention required.
 *
 *   When spread > threshold AND depth > $15k:
 *     → runs full size×delay simulation on that exact snapshot
 *     → evaluates Boss gate (d0 > 0, d1 >= 0, depth >= $15k)
 *     → logs result to console + optionally to JSONL file
 *     → enters cooldown to avoid hammering the same window
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js --gas=manual
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js --duration=3600
 *   node -r dotenv/config scripts/analysis/arb_opportunity_watcher.js --log=./opp_log.jsonl
 *
 * Output:
 *   - Live tick display (same as trigger_monitor, suppresses noise)
 *   - ★★★ banner + full simulation table when gate fires
 *   - Optional JSONL log file (one JSON line per opportunity + sim result)
 *
 * Hard rules:
 *   - No execution logic
 *   - No smart contract calls beyond pool reads + getFeeData
 *   - No flash loan logic
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *   - Serial loops with sleep for delay snapshots
 */

require('dotenv').config();

const fs             = require('fs');
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
// TRIGGER CONFIG (mirrors arb_trigger_monitor.js defaults)
// ─────────────────────────────────────────────────────────────────────────────
const TRIGGER_BUFFER_PCT    = 0.02;   // safety buffer on top of fees+slippage
const TRIGGER_SIZE_USD      = 25;     // reference size for trigger threshold
const GATE_MIN_DEPTH_USD    = 15_000;
const POLL_INTERVAL_MS      = 1_500;
const COOLDOWN_AFTER_SIM_MS = 10_000; // wait after sim before detecting again
const ARBI_BLOCK_MS         = 250;

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATION CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const SIM_SIZE_RANGE  = [10, 25, 50, 100, 200];
const SIM_DELAY_RANGE = [0, 1, 2];

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
      async (provider) => provider.getFeeData(),
      { timeoutMs: 3000, hedge: true }
    );
    const fd = res.result;
    const wei = fd.gasPrice ?? fd.maxFeePerGas ?? fd.lastBaseFeePerGas;
    if (!wei) throw new Error('no gasPrice in feeData');
    return { gasPriceGwei: Number(wei) / 1e9, estimatedUnits: 500_000, ethPriceUSD: 2000, source: 'live' };
  } catch (e) {
    process.stderr.write(`  [gas] live fetch failed (${e.message}) — using manual\n`);
    return { ...GAS_MANUAL, source: 'manual_fallback' };
  }
}

function calcGasUSD(gm) { return gm.estimatedUnits * gm.gasPriceGwei * 1e-9 * gm.ethPriceUSD; }
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
function slippagePct(size, depth) {
  return depth <= 0 ? Infinity : (size / (2 * depth)) * 100;
}
function spreadPct(a, b) {
  return Math.abs(a - b) / Math.min(a, b) * 100;
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
    uniPrice:   sqrtPriceToUSDC(uniSqrtP),
    camPrice:   sqrtPriceToUSDC(camSqrtP),
    uniDepth:   activeTickDepthUSD(uniRes.result.liq, uniSqrtP),
    camFee:     camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC,
    blockNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SIM POINT
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
// BOSS GATE
// ─────────────────────────────────────────────────────────────────────────────
function bossGate(d0, d1) {
  if (!d0 || !d1) return { passed: false, reason: 'missing data' };
  const checks = {
    depth_above_15k:     d0.uniDepth >= GATE_MIN_DEPTH_USD,
    delay0_profitable:   d0.finalEdge > 0,
    delay1_non_negative: d1.finalEdge >= 0,
    spread_above_fees:   d0.executedSpread > d0.feeBurden + d0.gasPct,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL SIMULATION — runs immediately on a detected snapshot
// ─────────────────────────────────────────────────────────────────────────────
async function runSimulation(detectedSnap, rpc, gm) {
  const baseBlock = detectedSnap.blockNumber;

  // Read delay snapshots serially
  const snaps = { 0: detectedSnap };
  for (const d of [1, 2]) {
    await sleep(400);
    try {
      snaps[d] = await readBothPools(baseBlock + d, rpc);
    } catch (e) {
      snaps[d] = { ...detectedSnap, blockNumber: baseBlock + d }; // fallback: same price
    }
  }

  // Build matrix
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

  // Gates per size
  const gates = {};
  for (const s of SIM_SIZE_RANGE) {
    gates[s] = bossGate(matrix[0][s], matrix[1][s]);
  }

  return { matrix, all, gates, snaps };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT SIM RESULTS
// ─────────────────────────────────────────────────────────────────────────────
function printSimResults(detectedSnap, simResult, gm, triggerTime) {
  const { all, gates, matrix } = simResult;
  const W   = 120;
  const EQ  = '★'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  ★★★  OPPORTUNITY DETECTED + SIMULATED  ★★★');
  console.log(`  Time: ${triggerTime}   Block: ${detectedSnap.blockNumber}`);
  console.log(`  Snapshot: cam=$${detectedSnap.camPrice.toFixed(6)}  uni=$${detectedSnap.uniPrice.toFixed(6)}  depth=$${detectedSnap.uniDepth.toFixed(2)}`);
  console.log(`  Gas: ${gm.source} | ${gm.gasPriceGwei.toFixed(6)} gwei | $${calcGasUSD(gm).toFixed(6)}/tx`);
  console.log(EQ);
  console.log(
    `  ${'size'.padEnd(7)} ${'delay'.padEnd(7)} ${'det%'.padEnd(9)} ${'exec%'.padEnd(9)} ` +
    `${'slip%'.padEnd(9)} ${'fee%'.padEnd(8)} ${'gas%'.padEnd(9)} ${'final%'.padEnd(9)} status`
  );
  console.log('  ' + DIV);

  let lastDelay = null;
  for (const r of all) {
    if (lastDelay !== null && r.delayBlocks !== lastDelay) console.log('  ' + DIV);
    lastDelay = r.delayBlocks;
    const tag = r.status === 'PROFITABLE' ? '✓ PROFITABLE'
              : r.status === 'MARGINAL'   ? '~ MARGINAL'
              :                             '✗ LOST';
    console.log(
      `  $${String(r.size).padEnd(6)} ${(r.delayBlocks+'blk').padEnd(7)} ` +
      `${String(r.detectedEdge).padEnd(9)} ${String(r.executedSpread).padEnd(9)} ` +
      `${String(r.slippage).padEnd(9)} ${String(r.feeBurden).padEnd(8)} ` +
      `${String(r.gasPct).padEnd(9)} ${String(r.finalEdge).padEnd(9)} ${tag}`
    );
  }

  console.log('\n  BOSS GATE  (depth>=$15k  d0>0  d1>=0  spread>fee+gas)');
  console.log('  ' + DIV);
  let anyGatePassed = false;
  for (const s of SIM_SIZE_RANGE) {
    const g  = gates[s];
    if (g.passed) anyGatePassed = true;
    const ok = g.passed ? '✓ GATE PASS' : '✗ GATE FAIL';
    const chk = g.checks
      ? Object.entries(g.checks).map(([k,v]) => `${k.replace(/_/g,'-')}:${v?'Y':'N'}`).join('  ')
      : g.reason;
    console.log(`  $${String(s).padEnd(6)} ${ok}   ${chk}`);
  }

  // Summary line
  const prof = all.filter(r => r.status === 'PROFITABLE');
  const marg = all.filter(r => r.status === 'MARGINAL');
  console.log('\n  ──────────────────────────────────────────────────────────');
  console.log(`  PROFITABLE: ${prof.length}/${all.length}   MARGINAL: ${marg.length}/${all.length}   BOSS GATE: ${anyGatePassed ? '✓ PASS (at least one size)' : '✗ FAIL (all sizes)'}`);
  if (prof.length > 0) {
    const best = prof.reduce((a,b) => a.finalEdge > b.finalEdge ? a : b);
    console.log(`  Best: size=$${best.size}  delay=${best.delayBlocks}blk  finalEdge=+${best.finalEdge}%`);
    const negStart = SIM_SIZE_RANGE.find(s => (matrix[0]?.[s]?.finalEdge ?? -1) < 0);
    if (negStart) console.log(`  Edge turns negative at: $${negStart} (delay=0)`);
  }
  console.log(EQ + '\n');

  return anyGatePassed;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL LOGGER
// ─────────────────────────────────────────────────────────────────────────────
function appendLog(logPath, record) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (e) {
    process.stderr.write(`  [log] write failed: ${e.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN WATCH LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function watchLoop(rpc, gm, durationS, logPath) {
  const endMs    = Date.now() + durationS * 1000;
  let lastBlock  = null;
  let lastStatus = null;
  let inCooldown = false;
  let cooldownUntil = 0;

  // Session stats
  const stats = {
    ticks:         0,
    errors:        0,
    detections:    0,
    gatePasses:    0,
    startMs:       Date.now(),
  };

  const LINE = '═'.repeat(108);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — OPPORTUNITY WATCHER   (trigger + auto-simulate)');
  console.log(`  Gas: ${gm.source}  |  ${gm.gasPriceGwei.toFixed(6)} gwei  |  $${calcGasUSD(gm).toFixed(6)}/tx`);
  console.log(`  Duration: ${durationS}s   Cooldown after sim: ${COOLDOWN_AFTER_SIM_MS/1000}s`);
  if (logPath) console.log(`  Log file: ${logPath}`);
  console.log(LINE);
  console.log(
    `  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'cam'.padEnd(10)} ${'uni'.padEnd(10)} ` +
    `${'spread%'.padEnd(10)} ${'thresh%'.padEnd(10)} ${'depth$'.padEnd(10)} state`
  );
  console.log('  ' + '─'.repeat(106));

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    // Get current block
    let blockNumber;
    try {
      const b = await rpc.getBlockNumber('watcher.block', { timeoutMs: 1200, hedge: true });
      blockNumber = b.blockNumber;
    } catch {
      stats.errors++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Skip if cooldown active
    if (inCooldown && Date.now() < cooldownUntil) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    inCooldown = false;

    // Read pools
    let snap;
    try {
      snap = await readBothPools(blockNumber, rpc);
    } catch (e) {
      stats.errors++;
      process.stdout.write(`  [!] ${fmtTime()} ERR: ${String(e.message).slice(0,80)}\n`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    stats.ticks++;

    // Compute trigger metrics (using reference size for threshold)
    const spread    = spreadPct(snap.uniPrice, snap.camPrice);
    const feeBurden = (UNIV3_FEE_FRAC + snap.camFee) * 100;
    const slip      = slippagePct(TRIGGER_SIZE_USD, snap.uniDepth);
    const threshold = feeBurden + slip + TRIGGER_BUFFER_PCT;
    const triggered = spread > threshold && snap.uniDepth >= GATE_MIN_DEPTH_USD;

    const stateLabel = triggered   ? '★ TRIGGERED'
                     : snap.uniDepth < GATE_MIN_DEPTH_USD ? 'low_depth'
                     : spread < feeBurden ? 'blocked_fee'
                     : 'blocked_slippage';

    // Print tick only on block change or state change
    const isNew = blockNumber !== lastBlock || stateLabel !== lastStatus;
    if (isNew) {
      const line =
        `  ${fmtTime().padEnd(10)} ${String(blockNumber).padEnd(12)} ` +
        `$${snap.camPrice.toFixed(5).padEnd(9)} $${snap.uniPrice.toFixed(5).padEnd(9)} ` +
        `${String(spread.toFixed(5)).padEnd(10)} ${String(threshold.toFixed(5)).padEnd(10)} ` +
        `$${snap.uniDepth.toFixed(2).padEnd(9)} ${stateLabel}`;
      if (triggered) console.log('\x1b[1m' + line + '\x1b[0m');
      else console.log(line);
      lastBlock  = blockNumber;
      lastStatus = stateLabel;
    }

    // If triggered — run simulation immediately
    if (triggered) {
      stats.detections++;
      const triggerTime = new Date().toISOString();
      console.log(`\n  → Trigger confirmed at block ${blockNumber}. Running simulation...`);

      try {
        const simResult  = await runSimulation(snap, rpc, gm);
        const gatePassed = printSimResults(snap, simResult, gm, triggerTime);
        if (gatePassed) stats.gatePasses++;

        appendLog(logPath, {
          ts:          triggerTime,
          block:       blockNumber,
          spread:      +spread.toFixed(5),
          threshold:   +threshold.toFixed(5),
          uniDepth:    +snap.uniDepth.toFixed(2),
          uniPrice:    +snap.uniPrice.toFixed(6),
          camPrice:    +snap.camPrice.toFixed(6),
          gasSource:   gm.source,
          gasPriceGwei: gm.gasPriceGwei,
          gatePassed,
          simResults:  simResult.all,
          gates:       simResult.gates,
        });
      } catch (e) {
        console.error(`  [sim] ERROR: ${e.message}`);
      }

      // Enter cooldown so we don't re-simulate the same window on every tick
      inCooldown    = true;
      cooldownUntil = Date.now() + COOLDOWN_AFTER_SIM_MS;
      console.log(`  → Cooldown ${COOLDOWN_AFTER_SIM_MS/1000}s — watching for next opportunity...\n`);
    }

    const elapsed = Date.now() - loopStart;
    await sleep(Math.max(0, POLL_INTERVAL_MS - elapsed));
  }

  // Final summary
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  console.log('\n' + LINE);
  console.log(`  WATCHER SUMMARY   (${elapsed}s  |  ${stats.ticks} ticks  |  ${stats.errors} errors)`);
  console.log(`  Triggers detected:  ${stats.detections}`);
  console.log(`  Boss gate passes:   ${stats.gatePasses}`);
  console.log(LINE + '\n');
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
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=')[1] : d; };
  return {
    gasMode:  getS('--gas',      'live'),
    duration: getN('--duration', 1800),      // default 30 minutes
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
