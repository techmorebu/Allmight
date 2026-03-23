'use strict';
/**
 * scripts/analysis/arb_liquidity_event_monitor.js
 *
 * Purpose:
 *   Detect UniV3 ARB/USDC liquidity injection events (Mint/Burn) that create
 *   temporary execution-grade depth windows. Replaces passive time-of-day
 *   depth hunting with event-driven trigger detection.
 *
 * Architecture context (Boss ruling 2026-03-22):
 *   Surface classification: EVENT-DRIVEN EXECUTION CANDIDATE
 *   Baseline state:         unviable (~$3.3k depth)
 *   Spike state:            exploitable (>$15k depth, tied to Mint events)
 *
 *   This script is Stage 1 of the new event-driven pipeline:
 *     Mint detected → [this script alerts] → arb_window_activator.js (Stage 2)
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_liquidity_event_monitor.js
 *   node -r dotenv/config scripts/analysis/arb_liquidity_event_monitor.js --out=./logs/liq_events.jsonl
 *   node -r dotenv/config scripts/analysis/arb_liquidity_event_monitor.js --poll=3   (block poll interval)
 *   node -r dotenv/config scripts/analysis/arb_liquidity_event_monitor.js --lookback=50
 *   node -r dotenv/config scripts/analysis/arb_liquidity_event_monitor.js --duration=7200
 *
 * Output fields per event:
 *   ts            ISO timestamp
 *   block         Arbitrum block number
 *   txHash        transaction hash
 *   eventType     Mint | Burn
 *   owner         LP wallet address
 *   tickLower     lower tick of position
 *   tickUpper     upper tick of position
 *   amount        liquidity units added/removed
 *   amount0       token0 (ARB) units
 *   amount1       token1 (USDC) units
 *   uniPrice      current ARB/USDC price at that block
 *   depthBefore   estimated active-tick depth before event (from last snapshot)
 *   depthAfter    actual active-tick depth read after event
 *   depthDelta    depthAfter - depthBefore
 *   classification small_add | meaningful_add | large_add | small_remove | large_remove
 *   alert         boolean — true if depthAfter crosses execution threshold
 *
 * Classification thresholds (calibrated to this pool):
 *   large_add     depthAfter >= $15,000  (execution-grade)
 *   meaningful_add depthAfter >= $7,500
 *   small_add     any Mint below that
 *   large_remove  depthDelta < -$5,000
 *   small_remove  any Burn below that
 *
 * Hard rules:
 *   - No execution logic
 *   - No fetcher edits
 *   - No Redis required
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *   - Append-only log
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL   = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const DEC0         = 18;   // ARB  (token0)
const DEC1         = 6;    // USDC (token1)

// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFICATION THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
const DEPTH_EXECUTION    = 15_000;   // Boss gate — execution-grade
const DEPTH_MEANINGFUL   =  7_500;   // worth watching
const DEPTH_LARGE_REMOVE = -5_000;   // significant withdrawal

function classifyEvent(type, depthAfter, depthDelta) {
  if (type === 'Mint') {
    if (depthAfter >= DEPTH_EXECUTION)  return 'large_add';
    if (depthAfter >= DEPTH_MEANINGFUL) return 'meaningful_add';
    return 'small_add';
  }
  // Burn
  if (depthDelta <= DEPTH_LARGE_REMOVE) return 'large_remove';
  return 'small_remove';
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_OUT        = './logs/arb_liq_events.jsonl';
const DEFAULT_POLL_BLOCKS = 2;      // check every N blocks (~500ms on Arbitrum)
const DEFAULT_LOOKBACK   = 20;      // blocks to scan on first run
const DEFAULT_DURATION_S = 7_200;   // 2 hours
const BLOCK_INTERVAL_MS  = 300;     // ~250–300ms per Arbitrum block

// ─────────────────────────────────────────────────────────────────────────────
// UniV3 ABI — Mint, Burn, slot0, liquidity
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_ABI = [
  // Events
  'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  // State reads
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

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

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH READ  (post-event snapshot)
// ─────────────────────────────────────────────────────────────────────────────
async function readDepth(blockNumber, rpc) {
  const res = await rpc.callDetailed(
    `liq.depth.${blockNumber}`,
    async (provider) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
      const [s0, liq] = await Promise.all([
        pool.slot0({ blockTag: blockNumber }),
        pool.liquidity({ blockTag: blockNumber }),
      ]);
      return { s0, liq };
    },
    { timeoutMs: 3000, hedge: true }
  );

  const sqrtP = res.result.s0[0];
  return {
    uniPrice: sqrtPriceToUSDC(sqrtP),
    depth:    activeTickDepthUSD(res.result.liq, sqrtP),
    block:    blockNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SCANNER  (getLogs over a block range)
// ─────────────────────────────────────────────────────────────────────────────
async function scanEvents(fromBlock, toBlock, rpc) {
  const res = await rpc.callDetailed(
    `liq.events.${fromBlock}-${toBlock}`,
    async (provider) => {
      const pool       = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
      const mintFilter = pool.filters.Mint();
      const burnFilter = pool.filters.Burn();
      const [mints, burns] = await Promise.all([
        provider.getLogs({ ...mintFilter, fromBlock, toBlock }),
        provider.getLogs({ ...burnFilter, fromBlock, toBlock }),
      ]);
      return { mints, burns };
    },
    { timeoutMs: 5000, hedge: true }
  );

  const iface = new ethers.Interface(UNIV3_ABI);

  const parsed = [];

  for (const log of res.result.mints) {
    try {
      const d = iface.parseLog(log);
      parsed.push({
        type:       'Mint',
        block:      log.blockNumber,
        txHash:     log.transactionHash,
        owner:      d.args.owner,
        tickLower:  Number(d.args.tickLower),
        tickUpper:  Number(d.args.tickUpper),
        amount:     d.args.amount.toString(),
        amount0Raw: d.args.amount0.toString(),
        amount1Raw: d.args.amount1.toString(),
        amount0:    Number(d.args.amount0) / Math.pow(10, DEC0),
        amount1:    Number(d.args.amount1) / Math.pow(10, DEC1),
      });
    } catch { /* skip malformed */ }
  }

  for (const log of res.result.burns) {
    try {
      const d = iface.parseLog(log);
      parsed.push({
        type:       'Burn',
        block:      log.blockNumber,
        txHash:     log.transactionHash,
        owner:      d.args.owner,
        tickLower:  Number(d.args.tickLower),
        tickUpper:  Number(d.args.tickUpper),
        amount:     d.args.amount.toString(),
        amount0Raw: d.args.amount0.toString(),
        amount1Raw: d.args.amount1.toString(),
        amount0:    Number(d.args.amount0) / Math.pow(10, DEC0),
        amount1:    Number(d.args.amount1) / Math.pow(10, DEC1),
      });
    } catch { /* skip malformed */ }
  }

  // Sort by block ascending
  parsed.sort((a, b) => a.block - b.block);
  return parsed;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG WRITER
// ─────────────────────────────────────────────────────────────────────────────
function appendLog(outPath, record) {
  if (!outPath) return;
  try {
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
  } catch (e) {
    process.stderr.write(`  [log] ${e.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT EVENT
// ─────────────────────────────────────────────────────────────────────────────
function printEvent(record) {
  const icon = record.classification === 'large_add'     ? '★★★ LARGE ADD    '
             : record.classification === 'meaningful_add' ? '★★  MEANINGFUL  '
             : record.classification === 'large_remove'   ? '⚠️  LARGE REMOVE '
             : record.classification === 'small_add'      ? '    small add    '
             :                                              '    small remove ';

  const alertTag = record.alert ? ' ← EXECUTION-GRADE DEPTH' : '';

  console.log(
    `\n  ${icon}  block=${record.block}  ${record.eventType}` +
    `\n    owner:    ${record.owner}` +
    `\n    ticks:    [${record.tickLower}, ${record.tickUpper}]` +
    `\n    amount0:  ${record.amount0.toFixed(4)} ARB` +
    `\n    amount1:  ${record.amount1.toFixed(4)} USDC` +
    `\n    depth before: $${record.depthBefore.toFixed(2)}` +
    `\n    depth after:  $${record.depthAfter.toFixed(2)}  (Δ ${record.depthDelta >= 0 ? '+' : ''}${record.depthDelta.toFixed(2)})` +
    `\n    price at event: $${record.uniPrice.toFixed(6)} USDC/ARB` +
    `\n    classification: ${record.classification}${alertTag}`
  );

  if (record.alert) {
    const STAR = '★'.repeat(80);
    console.log(`\n  ${STAR}`);
    console.log(`  ★★★  EXECUTION-GRADE DEPTH DETECTED — depth=$${record.depthAfter.toFixed(2)}`);
    console.log(`  ★★★  Activate high-frequency spread monitor NOW`);
    console.log(`  ${STAR}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN MONITOR LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function monitorLoop(rpc, outPath, pollBlocks, lookback, durationS) {
  const endMs = Date.now() + durationS * 1000;

  // Get starting block + initial depth
  const { blockNumber: startBlock } = await rpc.getBlockNumber(
    'liq.start', { timeoutMs: 3000, hedge: true }
  );

  const initDepth = await readDepth(startBlock, rpc);
  let lastDepth   = initDepth.depth;
  let lastBlock   = startBlock - lookback;  // scan lookback on first pass
  let scanHead    = startBlock;

  const stats = {
    scans: 0, errors: 0, events: 0,
    mints: 0, burns: 0, alerts: 0,
    startMs: Date.now(),
  };

  const LINE = '═'.repeat(90);
  console.log('\n' + LINE);
  console.log('  UniV3 ARB/USDC — LIQUIDITY EVENT MONITOR');
  console.log(`  Pool:     ${UNIV3_POOL}`);
  console.log(`  Start:    block ${startBlock}  |  lookback ${lookback} blocks`);
  console.log(`  Current depth: $${initDepth.depth.toFixed(2)}`);
  console.log(`  Execution threshold: $${DEPTH_EXECUTION.toLocaleString()}`);
  console.log(`  Poll: every ${pollBlocks} blocks (~${pollBlocks * BLOCK_INTERVAL_MS}ms)`);
  console.log(`  Duration: ${durationS}s`);
  if (outPath) console.log(`  Log: ${outPath}`);
  console.log(LINE);
  console.log('  Watching for Mint / Burn events...\n');

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    // Get current block
    let currentBlock;
    try {
      const b = await rpc.getBlockNumber('liq.poll', { timeoutMs: 2000, hedge: true });
      currentBlock = b.blockNumber;
    } catch {
      stats.errors++;
      await sleep(pollBlocks * BLOCK_INTERVAL_MS);
      continue;
    }

    // Only scan when we have new blocks
    if (currentBlock <= scanHead) {
      await sleep(pollBlocks * BLOCK_INTERVAL_MS);
      continue;
    }

    const fromBlock = scanHead + 1;
    const toBlock   = currentBlock;
    scanHead        = currentBlock;
    stats.scans++;

    // Print periodic heartbeat (every 50 scans)
    if (stats.scans % 50 === 0) {
      const elapsed = ((Date.now() - stats.startMs) / 1000 / 60).toFixed(1);
      console.log(
        `  [${new Date().toISOString().slice(11,19)}] ` +
        `${elapsed}min  scans=${stats.scans}  events=${stats.events}` +
        `  depth=$${lastDepth.toFixed(2)}  mints=${stats.mints}  burns=${stats.burns}  alerts=${stats.alerts}`
      );
    }

    // Scan for events
    let events;
    try {
      events = await scanEvents(fromBlock, toBlock, rpc);
    } catch (e) {
      stats.errors++;
      process.stderr.write(`  [scan] ${fromBlock}–${toBlock}: ${e.message}\n`);
      await sleep(pollBlocks * BLOCK_INTERVAL_MS);
      continue;
    }

    if (events.length === 0) {
      await sleep(pollBlocks * BLOCK_INTERVAL_MS);
      continue;
    }

    // Process each event
    for (const ev of events) {
      stats.events++;
      if (ev.type === 'Mint') stats.mints++;
      else                    stats.burns++;

      // Read actual depth at event block (or closest available)
      let postDepth;
      try {
        postDepth = await readDepth(ev.block, rpc);
      } catch {
        // Fallback: use current depth if event block not available
        try { postDepth = await readDepth(currentBlock, rpc); }
        catch { postDepth = { depth: lastDepth, uniPrice: initDepth.uniPrice, block: currentBlock }; }
      }

      const depthDelta  = postDepth.depth - lastDepth;
      const classif     = classifyEvent(ev.type, postDepth.depth, depthDelta);
      const alert       = postDepth.depth >= DEPTH_EXECUTION;
      if (alert) stats.alerts++;

      const record = {
        ts:             new Date().toISOString(),
        block:          ev.block,
        txHash:         ev.txHash,
        eventType:      ev.type,
        owner:          ev.owner,
        tickLower:      ev.tickLower,
        tickUpper:      ev.tickUpper,
        amountLiquidity: ev.amount,
        amount0:        +ev.amount0.toFixed(6),
        amount1:        +ev.amount1.toFixed(6),
        uniPrice:       +postDepth.uniPrice.toFixed(6),
        depthBefore:    +lastDepth.toFixed(2),
        depthAfter:     +postDepth.depth.toFixed(2),
        depthDelta:     +depthDelta.toFixed(2),
        classification: classif,
        alert,
      };

      printEvent(record);
      appendLog(outPath, record);

      // Update running depth baseline
      lastDepth = postDepth.depth;

      await sleep(200);  // brief pause between event processing
    }

    const elapsed = Date.now() - loopStart;
    await sleep(Math.max(0, pollBlocks * BLOCK_INTERVAL_MS - elapsed));
  }

  // Final summary
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  console.log('\n' + LINE);
  console.log(`  LIQUIDITY MONITOR SUMMARY   (${elapsed}s  |  ${stats.scans} scans  |  ${stats.errors} errors)`);
  console.log(`  Events detected:  ${stats.events}  (${stats.mints} mints  /  ${stats.burns} burns)`);
  console.log(`  Execution alerts: ${stats.alerts}  (depth crossed $${DEPTH_EXECUTION.toLocaleString()})`);
  console.log(`  Final depth:      $${lastDepth.toFixed(2)}`);
  if (outPath) console.log(`  Log: ${outPath}`);
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f,d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f,d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=')[1] : d; };
  return {
    outPath:  getS('--out',      DEFAULT_OUT),
    poll:     getN('--poll',     DEFAULT_POLL_BLOCKS),
    lookback: getN('--lookback', DEFAULT_LOOKBACK),
    duration: getN('--duration', DEFAULT_DURATION_S),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { outPath, poll, lookback, duration } = parseArgs();
  const rpc = createProvider('arbitrum');

  console.log(`\n[arb_liquidity_event_monitor] ${new Date().toISOString()}`);
  console.log(`  Press Ctrl+C to stop early.`);

  await monitorLoop(rpc, outPath, poll, lookback, duration);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
