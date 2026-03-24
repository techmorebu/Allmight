'use strict';
/**
 * scripts/analysis/arb_trigger_monitor.js  v2.0
 *
 * PURPOSE:
 *   Continuously monitor Camelot V3 vs UniV3 ARB/USDC spread and emit an
 *   EXECUTABLE signal when spread > fees + slippage + safety buffer.
 *   Primary tool for confirming whether a live executable edge exists.
 *
 * INPUTS:
 *   - Arbitrum mainnet via provider_factory.js (no Redis, no fetchers)
 *   - CLI flags (see --help)
 *
 * OUTPUTS:
 *   - Console tick table (human-readable)
 *   - ★★★ EXECUTABLE banner + JSON payload when threshold is crossed
 *   - Optional JSONL log via --log=
 *   - Session summary on exit
 *
 * IN SCOPE:
 *   - Spread detection between Camelot V3 and UniV3 ARB/USDC
 *   - Threshold calculation: fees + slippage + buffer
 *   - Opportunity logging
 *
 * OUT OF SCOPE:
 *   - No execution logic
 *   - No Redis writes
 *   - No fetcher mutation
 *   - No new venues or chains
 *   - No state machine (see arb_window_activator.js)
 *
 * USAGE:
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --help
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --size=25 --buffer=0.01
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --duration=3600 --log=./logs/trigger.jsonl
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — canonical, do not change without Boss approval
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL       = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const UNIV3_FEE_FRAC   = 0.0005;     // confirmed_default: UniV3 0.05% fee tier
const CAMELOT_POOL     = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';
const CAMELOT_FEE_FRAC = 0.000249;   // confirmed_default: measured dynamic fee
const FEE_BURDEN_FRAC  = UNIV3_FEE_FRAC + CAMELOT_FEE_FRAC;  // 0.0749%
const DEC0 = 18;  // ARB
const DEC1 = 6;   // USDC
const PRICE_MIN = 0.05;
const PRICE_MAX = 10.0;

// JSONL envelope constants
const LOG_SOURCE = 'arb_trigger_monitor';
const LOG_CHAIN  = 'arbitrum';
const LOG_PAIR   = 'ARB/USDC';

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS — labeled by type
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_SIZE_USD    = 50;     // confirmed_default: reference trade notional USD
const DEFAULT_BUFFER_PCT  = 0.02;   // confirmed_default: safety buffer in %
const DEFAULT_INTERVAL_MS = 1500;   // confirmed_default: poll interval ms
const DEFAULT_DURATION_S  = 1800;   // confirmed_default: run duration seconds
const HEARTBEAT_INTERVAL  = 300;    // confirmed_default: heartbeat every 300 ticks

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
// MATH
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToUSDC(sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}
function activeTickDepthUSD(liquidityRaw, sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return (Number(liquidityRaw) * sqrtP) / Math.pow(10, DEC1);
}
function estimateSlippage(sizeUsd, depthUsd) {
  return depthUsd <= 0 ? Infinity : sizeUsd / (2 * depthUsd);
}
function computeSpread(a, b) {
  return Math.abs(a - b) / Math.min(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL READ
// ─────────────────────────────────────────────────────────────────────────────
async function readTick(blockNumber, sizeUsd, bufferFrac, rpc) {
  let uniRes, camRes;
  try {
    uniRes = await rpc.callDetailed(
      `trigger.univ3.${blockNumber}`,
      async (provider) => {
        const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
        const [s0, liq] = await Promise.all([
          pool.slot0({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { s0, liq };
      },
      { timeoutMs: 2000, hedge: true }
    );
  } catch (e) { return { ok: false, error: `univ3: ${String(e.message).slice(0, 80)}` }; }

  try {
    camRes = await rpc.callDetailed(
      `trigger.camelot.${blockNumber}`,
      async (provider) => {
        const pool = new ethers.Contract(CAMELOT_POOL, ALGEBRA_ABI, provider);
        const [gs, liq] = await Promise.all([
          pool.globalState({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { gs, liq };
      },
      { timeoutMs: 2000, hedge: true }
    );
  } catch (e) { return { ok: false, error: `camelot: ${String(e.message).slice(0, 80)}` }; }

  const uniSqrtP  = uniRes.result.s0[0];
  const camSqrtP  = camRes.result.gs[0];
  const camFeeRaw = Number(camRes.result.gs[2]);

  const uniPrice = sqrtPriceToUSDC(uniSqrtP);
  const camPrice = sqrtPriceToUSDC(camSqrtP);

  if (!isFinite(uniPrice) || uniPrice < PRICE_MIN || uniPrice > PRICE_MAX)
    return { ok: false, error: `univ3 price insane: ${uniPrice}` };
  if (!isFinite(camPrice) || camPrice < PRICE_MIN || camPrice > PRICE_MAX)
    return { ok: false, error: `camelot price insane: ${camPrice}` };

  const camFeeFrac   = camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC;
  const feeBurden    = UNIV3_FEE_FRAC + camFeeFrac;
  const depth        = activeTickDepthUSD(uniRes.result.liq, uniSqrtP);
  const slippageFrac = estimateSlippage(sizeUsd, depth);
  const spread       = computeSpread(uniPrice, camPrice);
  const threshold    = feeBurden + slippageFrac + bufferFrac;
  const netEdge      = spread - feeBurden - slippageFrac;
  const direction    = uniPrice < camPrice ? 'buy_uni_sell_camelot' : 'sell_uni_buy_camelot';
  const executable   = spread > threshold;

  const status = executable         ? 'EXECUTABLE'
               : spread < feeBurden ? 'blocked_fee'
               :                      'blocked_slippage';

  return {
    ok: true,
    // JSONL base envelope
    ts:     new Date().toISOString(),
    source: LOG_SOURCE,
    chain:  LOG_CHAIN,
    pair:   LOG_PAIR,
    block:  blockNumber,
    state:  executable ? 'EXECUTABLE' : 'PASSIVE',
    // Canonical field names
    price:     +uniPrice.toFixed(6),
    depth:     +depth.toFixed(2),
    spread:    +(spread * 100).toFixed(5),
    // Trigger-specific fields
    camPrice:  +camPrice.toFixed(6),
    feeBurden: +(feeBurden * 100).toFixed(5),
    slippage:  +(slippageFrac * 100).toFixed(5),
    buffer:    +(bufferFrac * 100).toFixed(4),
    threshold: +(threshold * 100).toFixed(5),
    netEdge:   +(netEdge * 100).toFixed(5),
    direction,
    status,
    executable,
    sizeUsd,
  };
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
// DISPLAY
// ─────────────────────────────────────────────────────────────────────────────
function printHeader(sizeUsd, bufferPct, intervalMs, durationS) {
  const LINE = '═'.repeat(108);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — TRIGGER MONITOR   Camelot V3 (anchor) ↔ UniV3 (mirror)');
  console.log(`  size=$${sizeUsd}  buffer=${bufferPct}%  interval=${intervalMs}ms  duration=${durationS}s`);
  console.log(`  fee_burden=${(FEE_BURDEN_FRAC*100).toFixed(4)}%  (UniV3 ${(UNIV3_FEE_FRAC*100).toFixed(4)}% + Camelot ${(CAMELOT_FEE_FRAC*100).toFixed(4)}%)`);
  console.log(LINE);
  console.log(
    `  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'cam'.padEnd(10)} ${'uni'.padEnd(10)} ` +
    `${'spread%'.padEnd(10)} ${'thresh%'.padEnd(10)} ${'net%'.padEnd(10)} ${'depth$'.padEnd(10)} status`
  );
  console.log('  ' + '─'.repeat(106));
}

function printTick(r) {
  const icon = r.executable ? '★ EXECUTABLE' : r.status;
  const line =
    `  ${r.ts.slice(11,19).padEnd(10)} ${String(r.block).padEnd(12)} ` +
    `$${String(r.camPrice).padEnd(9)} $${String(r.price).padEnd(9)} ` +
    `${String(r.spread).padEnd(10)} ${String(r.threshold).padEnd(10)} ` +
    `${String(r.netEdge).padEnd(10)} $${String(r.depth).padEnd(9)} ${icon}`;
  if (r.executable) console.log('\x1b[1m' + line + '\x1b[0m');
  else              console.log(line);
}

function printOpportunity(r) {
  const LINE = '★'.repeat(108);
  console.log('\n' + LINE);
  console.log('  ★★★  EXECUTABLE OPPORTUNITY DETECTED  ★★★');
  console.log(LINE);
  console.log(JSON.stringify({
    spread: r.spread, fees: r.feeBurden, slippage: r.slippage,
    buffer: r.buffer, threshold: r.threshold, net: r.netEdge,
    status: r.status, direction: r.direction, size: r.sizeUsd,
    block: r.block, time: r.ts, uniDepth: r.depth,
    uniPrice: r.price, camPrice: r.camPrice,
  }, null, 2));
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
arb_trigger_monitor.js — ARB/USDC spread trigger monitor

USAGE:
  node -r dotenv/config scripts/analysis/arb_trigger_monitor.js [flags]

FLAGS:
  --size=N       Trade notional in USD         (default: ${DEFAULT_SIZE_USD})
  --buffer=N     Safety buffer in %            (default: ${DEFAULT_BUFFER_PCT})
  --interval=N   Poll interval in ms           (default: ${DEFAULT_INTERVAL_MS})
  --duration=N   Run duration in seconds       (default: ${DEFAULT_DURATION_S})
  --log=PATH     Append JSONL opportunity log  (default: none)
  --json         Emit opportunity payloads as clean JSON (suppresses table)
  --help         Show this message

OUTPUTS:
  - Console tick table with spread/threshold/status per block
  - ★★★ EXECUTABLE banner + JSON payload when threshold is crossed
  - Optional JSONL log (--log=) with base envelope: ts/source/chain/pair/block/state

EXAMPLES:
  node -r dotenv/config scripts/analysis/arb_trigger_monitor.js
  node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --size=25 --buffer=0.01 --duration=3600
  node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --log=./logs/trigger.jsonl
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { printHelp(); process.exit(0); }
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=').slice(1).join('=') : d; };
  return {
    sizeUsd:    getN('--size',     DEFAULT_SIZE_USD),
    bufferPct:  getN('--buffer',   DEFAULT_BUFFER_PCT),
    intervalMs: getN('--interval', DEFAULT_INTERVAL_MS),
    durationS:  getN('--duration', DEFAULT_DURATION_S),
    logPath:    getS('--log',      null),
    jsonMode:   args.includes('--json'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { sizeUsd, bufferPct, intervalMs, durationS, logPath, jsonMode } = parseArgs();
  const bufferFrac = bufferPct / 100;
  const rpc = createProvider('arbitrum');

  if (!jsonMode) {
    console.log(`\n[arb_trigger_monitor] ${new Date().toISOString()}`);
    printHeader(sizeUsd, bufferPct, intervalMs, durationS);
  }

  const runStats = {
    startMs: Date.now(), ticks: 0, errors: 0, opportunities: 0,
    sumSpread: 0, minSpread: Infinity, maxSpread: -Infinity,
    minDepth: Infinity, maxDepth: -Infinity, minGap: Infinity,
    dirCounts: {}, bufferPct,
  };

  const endMs   = Date.now() + durationS * 1000;
  let lastBlock = null, lastStatus = null;

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    let blockNumber;
    try {
      const b = await rpc.getBlockNumber('trigger.block', { timeoutMs: 1200, hedge: true });
      blockNumber = b.blockNumber;
    } catch {
      runStats.errors++;
      await sleep(intervalMs);
      continue;
    }

    const r = await readTick(blockNumber, sizeUsd, bufferFrac, rpc);

    if (!r.ok) {
      runStats.errors++;
      if (!jsonMode) process.stdout.write(`  [!] ${new Date().toISOString().slice(11,19)} ERR: ${r.error}\n`);
      await sleep(intervalMs);
      continue;
    }

    runStats.ticks++;
    runStats.sumSpread += r.spread;
    if (r.spread < runStats.minSpread) runStats.minSpread = r.spread;
    if (r.spread > runStats.maxSpread) runStats.maxSpread = r.spread;
    if (r.depth  < runStats.minDepth)  runStats.minDepth  = r.depth;
    if (r.depth  > runStats.maxDepth)  runStats.maxDepth  = r.depth;
    const gap = r.spread - r.threshold;
    if (gap < 0) { const absGap = Math.abs(gap); if (absGap < runStats.minGap) runStats.minGap = absGap; }
    runStats.dirCounts[r.direction] = (runStats.dirCounts[r.direction] || 0) + 1;

    // Display
    const isNewBlock  = blockNumber !== lastBlock;
    const isNewStatus = r.status !== lastStatus;
    if (!jsonMode && (isNewBlock || isNewStatus || r.executable)) {
      printTick(r);
      lastBlock = blockNumber; lastStatus = r.status;
    }

    // Heartbeat (every N ticks)
    if (!jsonMode && runStats.ticks % HEARTBEAT_INTERVAL === 0) {
      const uptime = ((Date.now() - runStats.startMs) / 1000 / 60).toFixed(1);
      console.log(
        `\n  ── heartbeat  ${uptime}min  ticks=${runStats.ticks}  errors=${runStats.errors}  opps=${runStats.opportunities}  avgSpread=${runStats.ticks > 0 ? (runStats.sumSpread/runStats.ticks).toFixed(5) : 0}%  depth=$${r.depth} ──\n`
      );
      appendLog(logPath, {
        ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
        type: 'heartbeat', uptime_min: +uptime, ticks: runStats.ticks,
        errors: runStats.errors, opportunities: runStats.opportunities,
        avgSpread: runStats.ticks > 0 ? +(runStats.sumSpread/runStats.ticks).toFixed(5) : 0,
        depth: r.depth, state: r.state,
      });
    }

    // Opportunity
    if (r.executable) {
      runStats.opportunities++;
      if (!jsonMode) printOpportunity(r);
      if (jsonMode)  console.log(JSON.stringify(r));
      appendLog(logPath, { ...r, type: 'opportunity' });
    }

    await sleep(Math.max(0, intervalMs - (Date.now() - loopStart)));
  }

  if (!jsonMode) {
    const elapsed = ((Date.now() - runStats.startMs) / 1000).toFixed(0);
    const LINE = '═'.repeat(108);
    console.log('\n' + LINE);
    console.log(`  MONITOR SUMMARY   (${elapsed}s  |  ${runStats.ticks} ticks  |  ${runStats.errors} errors)`);
    console.log(`  Opportunities:   ${runStats.opportunities}`);
    console.log(`  Spread range:    ${runStats.minSpread.toFixed(5)}% – ${runStats.maxSpread.toFixed(5)}%`);
    console.log(`  Avg spread:      ${runStats.ticks > 0 ? (runStats.sumSpread/runStats.ticks).toFixed(5) : 'n/a'}%`);
    console.log(`  Closest to gate: ${runStats.minGap === Infinity ? 'n/a' : runStats.minGap.toFixed(5)}% below threshold`);
    console.log(`  Depth range:     $${runStats.minDepth.toFixed(2)} – $${runStats.maxDepth.toFixed(2)}`);
    console.log(LINE + '\n');
  }

  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
