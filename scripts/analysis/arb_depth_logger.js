'use strict';
/**
 * scripts/analysis/arb_depth_logger.js
 *
 * Purpose:
 *   Append-only time-series logger for UniV3 depth, prices, spread, and direction.
 *   Runs continuously and writes one record per new block to a JSONL file.
 *   Primary goal: determine when execution-grade depth ($15k+) actually occurs
 *   and whether it is a repeatable time-of-day regime.
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_depth_logger.js
 *   node -r dotenv/config scripts/analysis/arb_depth_logger.js --out=./depth_log.jsonl
 *   node -r dotenv/config scripts/analysis/arb_depth_logger.js --csv --out=./depth_log.csv
 *   node -r dotenv/config scripts/analysis/arb_depth_logger.js --duration=7200
 *
 * Output fields per record:
 *   ts          ISO timestamp
 *   block       Arbitrum block number
 *   uniDepth    UniV3 active-tick depth in USD
 *   uniPrice    UniV3 ARB/USDC price
 *   camPrice    Camelot V3 ARB/USDC price
 *   spread      absolute % spread between pools
 *   direction   sell_uni_buy_camelot | buy_uni_sell_camelot
 *   depthTier   execution | subcritical | dead
 *
 * Depth tiers (Boss ruling 2026-03-22):
 *   execution   uniDepth >= 15000
 *   subcritical 5000 <= uniDepth < 15000
 *   dead        uniDepth < 5000
 *
 * Hard rules:
 *   - No execution logic
 *   - No Redis
 *   - No smart contract calls beyond pool reads
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
// DEPTH TIER THRESHOLDS (Boss ruling)
// ─────────────────────────────────────────────────────────────────────────────
const DEPTH_EXECUTION    = 15_000;   // Tier 1 — execution-grade
const DEPTH_SUBCRITICAL  =  5_000;   // Tier 2 — research band floor
// < 5000 = Tier 3 dead

function depthTier(depth) {
  if (depth >= DEPTH_EXECUTION)   return 'execution';
  if (depth >= DEPTH_SUBCRITICAL) return 'subcritical';
  return 'dead';
}

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_OUT_JSONL   = './logs/arb_depth_log.jsonl';
const DEFAULT_OUT_CSV     = './logs/arb_depth_log.csv';
const POLL_INTERVAL_MS    = 1_500;
const DEFAULT_DURATION_S  = 7_200;   // 2 hours

const CSV_HEADER = 'ts,block,uniDepth,uniPrice,camPrice,spread,direction,depthTier\n';

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
function activeTickDepthUSD(liq, sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return (Number(liq) * sqrtP) / Math.pow(10, DEC1);
}
function spreadPct(a, b) {
  return Math.abs(a - b) / Math.min(a, b) * 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL READ
// ─────────────────────────────────────────────────────────────────────────────
async function readBothPools(blockNumber, rpc) {
  const [uniRes, camRes] = await Promise.all([
    rpc.callDetailed(`depth.univ3.${blockNumber}`, async (p) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, p);
      const [s0, liq] = await Promise.all([
        pool.slot0({ blockTag: blockNumber }),
        pool.liquidity({ blockTag: blockNumber }),
      ]);
      return { s0, liq };
    }, { timeoutMs: 2000, hedge: true }),
    rpc.callDetailed(`depth.camelot.${blockNumber}`, async (p) => {
      const pool = new ethers.Contract(CAMELOT_POOL, ALGEBRA_ABI, p);
      const [gs] = await Promise.all([
        pool.globalState({ blockTag: blockNumber }),
      ]);
      return { gs };
    }, { timeoutMs: 2000, hedge: true }),
  ]);

  const uniSqrtP = uniRes.result.s0[0];
  const camSqrtP = camRes.result.gs[0];

  return {
    uniPrice: sqrtPriceToUSDC(uniSqrtP),
    camPrice: sqrtPriceToUSDC(camSqrtP),
    uniDepth: activeTickDepthUSD(uniRes.result.liq, uniSqrtP),
    blockNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RECORD BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function buildRecord(snap) {
  const spread = spreadPct(snap.uniPrice, snap.camPrice);
  return {
    ts:        new Date().toISOString(),
    block:     snap.blockNumber,
    uniDepth:  +snap.uniDepth.toFixed(2),
    uniPrice:  +snap.uniPrice.toFixed(6),
    camPrice:  +snap.camPrice.toFixed(6),
    spread:    +spread.toFixed(5),
    direction: snap.uniPrice > snap.camPrice ? 'sell_uni_buy_camelot' : 'buy_uni_sell_camelot',
    depthTier: depthTier(snap.uniDepth),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE WRITER
// ─────────────────────────────────────────────────────────────────────────────
function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeRecord(filePath, record, csvMode, isFirstWrite) {
  ensureDir(filePath);
  if (csvMode) {
    if (isFirstWrite && !fs.existsSync(filePath)) {
      fs.appendFileSync(filePath, CSV_HEADER);
    }
    const row = [
      record.ts, record.block, record.uniDepth, record.uniPrice,
      record.camPrice, record.spread, record.direction, record.depthTier,
    ].join(',') + '\n';
    fs.appendFileSync(filePath, row);
  } else {
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function logLoop(rpc, outPath, csvMode, durationS) {
  const endMs   = Date.now() + durationS * 1000;
  let lastBlock = null;
  let firstWrite = true;

  // Running stats for live summary
  const stats = {
    ticks:       0,
    errors:      0,
    execution:   0,
    subcritical: 0,
    dead:        0,
    maxDepth:    0,
    minDepth:    Infinity,
    sumDepth:    0,
    startMs:     Date.now(),
  };

  const LINE = '═'.repeat(100);
  console.log('\n' + LINE);
  console.log('  ARB/USDC — DEPTH LOGGER');
  console.log(`  Output: ${outPath}  (${csvMode ? 'CSV' : 'JSONL'})`);
  console.log(`  Duration: ${durationS}s   Poll: ${POLL_INTERVAL_MS}ms`);
  console.log(`  Tiers:  execution>=$${DEPTH_EXECUTION.toLocaleString()}  |  subcritical $${DEPTH_SUBCRITICAL.toLocaleString()}–$${(DEPTH_EXECUTION-1).toLocaleString()}  |  dead<$${DEPTH_SUBCRITICAL.toLocaleString()}`);
  console.log(LINE);
  console.log(
    `  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'depth$'.padEnd(12)} ` +
    `${'uni'.padEnd(10)} ${'cam'.padEnd(10)} ${'spread%'.padEnd(10)} tier`
  );
  console.log('  ' + '─'.repeat(98));

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    let blockNumber;
    try {
      const b = await rpc.getBlockNumber('depth.block', { timeoutMs: 1200, hedge: true });
      blockNumber = b.blockNumber;
    } catch {
      stats.errors++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (blockNumber === lastBlock) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    lastBlock = blockNumber;

    let snap;
    try {
      snap = await readBothPools(blockNumber, rpc);
    } catch (e) {
      stats.errors++;
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const record = buildRecord(snap);
    stats.ticks++;
    stats.sumDepth += record.uniDepth;
    if (record.uniDepth > stats.maxDepth) stats.maxDepth = record.uniDepth;
    if (record.uniDepth < stats.minDepth) stats.minDepth = record.uniDepth;
    stats[record.depthTier]++;

    // Write to file
    try {
      writeRecord(outPath, record, csvMode, firstWrite);
      firstWrite = false;
    } catch (e) {
      process.stderr.write(`  [write] ${e.message}\n`);
    }

    // Console output — always print (block-level granularity)
    const tierIcon = record.depthTier === 'execution'   ? '★ execution'
                   : record.depthTier === 'subcritical' ? '~ subcritical'
                   :                                       '  dead';
    console.log(
      `  ${record.ts.slice(11,19).padEnd(10)} ${String(record.block).padEnd(12)} ` +
      `$${String(record.uniDepth).padEnd(11)} ` +
      `$${String(record.uniPrice).padEnd(9)} $${String(record.camPrice).padEnd(9)} ` +
      `${String(record.spread).padEnd(10)} ${tierIcon}`
    );

    // Print running summary every 100 ticks
    if (stats.ticks % 100 === 0) {
      const avg  = (stats.sumDepth / stats.ticks).toFixed(2);
      const pctE = ((stats.execution / stats.ticks) * 100).toFixed(1);
      const pctS = ((stats.subcritical / stats.ticks) * 100).toFixed(1);
      const pctD = ((stats.dead / stats.ticks) * 100).toFixed(1);
      console.log(`\n  ── [${stats.ticks} ticks] avg=$${avg}  max=$${stats.maxDepth}  ` +
        `execution:${pctE}%  subcritical:${pctS}%  dead:${pctD}% ──\n`);
    }

    const elapsed = Date.now() - loopStart;
    await sleep(Math.max(0, POLL_INTERVAL_MS - elapsed));
  }

  // Final summary
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  const avg     = stats.ticks > 0 ? (stats.sumDepth / stats.ticks).toFixed(2) : 'n/a';
  const pctE    = stats.ticks > 0 ? ((stats.execution   / stats.ticks) * 100).toFixed(1) : '0';
  const pctS    = stats.ticks > 0 ? ((stats.subcritical / stats.ticks) * 100).toFixed(1) : '0';
  const pctD    = stats.ticks > 0 ? ((stats.dead        / stats.ticks) * 100).toFixed(1) : '0';

  console.log('\n' + LINE);
  console.log(`  DEPTH LOGGER SUMMARY   (${elapsed}s  |  ${stats.ticks} ticks  |  ${stats.errors} errors)`);
  console.log(`  Depth avg:      $${avg}`);
  console.log(`  Depth max:      $${stats.maxDepth}`);
  console.log(`  Depth min:      $${stats.minDepth === Infinity ? 'n/a' : stats.minDepth}`);
  console.log(`  Execution  (>=$${DEPTH_EXECUTION.toLocaleString()}): ${stats.execution} ticks  (${pctE}%)`);
  console.log(`  Subcritical ($${DEPTH_SUBCRITICAL.toLocaleString()}–$${(DEPTH_EXECUTION-1).toLocaleString()}): ${stats.subcritical} ticks  (${pctS}%)`);
  console.log(`  Dead       (<$${DEPTH_SUBCRITICAL.toLocaleString()}): ${stats.dead} ticks  (${pctD}%)`);
  console.log(`  Log file:       ${outPath}`);
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=')[1] : d; };
  const csvMode = args.includes('--csv');
  const defaultOut = csvMode ? DEFAULT_OUT_CSV : DEFAULT_OUT_JSONL;
  return {
    outPath:  getS('--out', defaultOut),
    csvMode,
    duration: getN('--duration', DEFAULT_DURATION_S),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { outPath, csvMode, duration } = parseArgs();
  const rpc = createProvider('arbitrum');
  console.log(`\n[arb_depth_logger] ${new Date().toISOString()}`);
  await logLoop(rpc, outPath, csvMode, duration);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
