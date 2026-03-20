'use strict';
/**
 * scripts/analysis/arb_trigger_monitor.js
 *
 * Purpose:
 *   Continuously monitor Camelot V3 vs UniV3 ARB/USDC spread and emit
 *   an EXECUTABLE signal when spread > fees + slippage + safety buffer.
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --size=50
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --buffer=0.03
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --interval=1500
 *   node -r dotenv/config scripts/analysis/arb_trigger_monitor.js --duration=1800
 *
 * Threshold logic:
 *   trigger = fee_burden + slippage_estimate + safety_buffer
 *   fee_burden    = UniV3(0.05%) + Camelot(0.0249%) = 0.0749%
 *   safety_buffer = 0.02% default (CLI: --buffer=N where N is %)
 *   slippage      = size / (2 × uniActiveTick)
 *
 *   EXECUTABLE when: spread > trigger
 *
 * Hard rules (same as lag_detector):
 *   - No execution logic
 *   - No new venues
 *   - No Redis writes
 *   - No fetcher mutation
 *   - Same-block reads mandatory
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *
 * Path note: scripts/analysis/ → provider_factory at ../../utils/provider_factory
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS — canonical, do not change
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL      = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const UNIV3_FEE_FRAC  = 0.0005;     // 0.05%

const CAMELOT_POOL    = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';
const CAMELOT_FEE_FRAC = 0.000249;  // 0.0249% measured dynamic fee

const FEE_BURDEN_FRAC = UNIV3_FEE_FRAC + CAMELOT_FEE_FRAC;  // 0.0749%

const DEC0 = 18;  // ARB
const DEC1 = 6;   // USDC

const PRICE_MIN = 0.05;
const PRICE_MAX = 10.0;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULTS (overridden by CLI)
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_SIZE_USD     = 50;      // trade notional in USD
const DEFAULT_BUFFER_PCT   = 0.02;    // safety buffer in %
const DEFAULT_INTERVAL_MS  = 1500;    // poll interval in ms
const DEFAULT_DURATION_S   = 1800;    // run duration in seconds (30 min)

// ─────────────────────────────────────────────────────────────────────────────
// ABIs — same as lag_detector
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
// MATH — identical to lag_detector for consistency
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToUSDC(sqrtPriceX96, dec0, dec1) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
}

function activeTickDepthUSD(liquidityRaw, sqrtPriceX96, dec1) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return (Number(liquidityRaw) * sqrtP) / Math.pow(10, dec1);
}

function estimateSlippage(sizeUsd, activeTickUsd) {
  if (activeTickUsd <= 0) return Infinity;
  return sizeUsd / (2 * activeTickUsd);
}

function computeSpread(priceA, priceB) {
  return Math.abs(priceA - priceB) / Math.min(priceA, priceB);
}

function tradeDirection(uniPrice, camelotPrice) {
  if (uniPrice < camelotPrice) return 'buy_uni_sell_camelot';
  if (uniPrice > camelotPrice) return 'sell_uni_buy_camelot';
  return 'none';
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE TICK — read both pools at same block
// ─────────────────────────────────────────────────────────────────────────────
async function tick(blockNumber, sizeUsd, bufferFrac, rpc) {
  // UniV3 — slot0 + liquidity, single callDetailed on same contract
  let uniRes;
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
  } catch (e) {
    return { ok: false, error: `univ3: ${String(e.message).slice(0, 80)}` };
  }

  // Camelot V3 — globalState + liquidity, single callDetailed on same contract
  let camRes;
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
  } catch (e) {
    return { ok: false, error: `camelot: ${String(e.message).slice(0, 80)}` };
  }

  const uniSqrtP   = uniRes.result.s0[0];
  const uniLiq     = uniRes.result.liq;
  const camSqrtP   = camRes.result.gs[0];
  const camFeeRaw  = Number(camRes.result.gs[2]);

  const uniPrice     = sqrtPriceToUSDC(uniSqrtP,  DEC0, DEC1);
  const camPrice     = sqrtPriceToUSDC(camSqrtP,  DEC0, DEC1);

  if (!isFinite(uniPrice) || uniPrice < PRICE_MIN || uniPrice > PRICE_MAX)
    return { ok: false, error: `univ3 price insane: ${uniPrice}` };
  if (!isFinite(camPrice) || camPrice < PRICE_MIN || camPrice > PRICE_MAX)
    return { ok: false, error: `camelot price insane: ${camPrice}` };

  const camFeeFrac   = camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC;
  const feeBurden    = UNIV3_FEE_FRAC + camFeeFrac;

  const uniDepth     = activeTickDepthUSD(uniLiq, uniSqrtP, DEC1);
  const slippageFrac = estimateSlippage(sizeUsd, uniDepth);
  const spread       = computeSpread(uniPrice, camPrice);
  const threshold    = feeBurden + slippageFrac + bufferFrac;
  const netEdge      = spread - feeBurden - slippageFrac;
  const direction    = tradeDirection(uniPrice, camPrice);
  const executable   = spread > threshold;

  const status = executable          ? 'EXECUTABLE'
               : spread < feeBurden  ? 'blocked_fee'
               : spread < threshold  ? 'blocked_slippage'
               : 'blocked_fee';

  return {
    ok: true,
    blockNumber,
    uniPrice:      parseFloat(uniPrice.toFixed(6)),
    camPrice:      parseFloat(camPrice.toFixed(6)),
    spread:        parseFloat((spread * 100).toFixed(5)),
    feeBurden:     parseFloat((feeBurden * 100).toFixed(5)),
    slippage:      parseFloat((slippageFrac * 100).toFixed(5)),
    buffer:        parseFloat((bufferFrac * 100).toFixed(4)),
    threshold:     parseFloat((threshold * 100).toFixed(5)),
    netEdge:       parseFloat((netEdge * 100).toFixed(5)),
    uniDepth:      parseFloat(uniDepth.toFixed(2)),
    direction,
    status,
    executable,
    sizeUsd,
    ts:            new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  return ts.slice(11, 19);  // HH:MM:SS
}

function printHeader(sizeUsd, bufferPct, intervalMs, durationS, threshold) {
  const LINE = '═'.repeat(108);
  console.log('\n' + LINE);
  console.log('  ARB/USDC  —  TRIGGER MONITOR   Camelot V3 (anchor) ↔ UniV3 (mirror)');
  console.log(`  size=$${sizeUsd}  buffer=${bufferPct}%  interval=${intervalMs}ms  duration=${durationS}s`);
  console.log(`  threshold=${threshold.toFixed(5)}%  (fees + slippage + buffer)`);
  console.log(`  UniV3:   ${UNIV3_POOL}`);
  console.log(`  Camelot: ${CAMELOT_POOL}`);
  console.log(LINE);
  console.log(
    `  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'cam'.padEnd(10)} ${'uni'.padEnd(10)} ` +
    `${'spread%'.padEnd(10)} ${'thresh%'.padEnd(10)} ${'net%'.padEnd(10)} ` +
    `${'depth$'.padEnd(10)} status`
  );
  console.log('  ' + '─'.repeat(106));
}

function printTick(r, isNew) {
  const icon = r.executable ? '★ EXECUTABLE' : r.status;
  const line =
    `  ${fmtTime(r.ts).padEnd(10)} ` +
    `${String(r.blockNumber).padEnd(12)} ` +
    `$${String(r.camPrice).padEnd(9)} ` +
    `$${String(r.uniPrice).padEnd(9)} ` +
    `${String(r.spread).padEnd(10)} ` +
    `${String(r.threshold).padEnd(10)} ` +
    `${String(r.netEdge).padEnd(10)} ` +
    `$${String(r.uniDepth).padEnd(9)} ` +
    `${icon}`;

  if (r.executable) {
    // ANSI bold for terminal visibility — degrades gracefully if unsupported
    console.log('\x1b[1m' + line + '\x1b[0m');
  } else if (isNew) {
    console.log(line);
  }
  // Suppress repeated identical blocks to reduce noise
}

function printOpportunity(r) {
  const LINE = '★'.repeat(108);
  console.log('\n' + LINE);
  console.log('  ★★★  EXECUTABLE OPPORTUNITY DETECTED  ★★★');
  console.log(LINE);
  console.log(JSON.stringify({
    spread:    r.spread,
    fees:      r.feeBurden,
    slippage:  r.slippage,
    buffer:    r.buffer,
    threshold: r.threshold,
    net:       r.netEdge,
    status:    r.status,
    direction: r.direction,
    size:      r.sizeUsd,
    block:     r.blockNumber,
    time:      r.ts,
    uniDepth:  r.uniDepth,
    uniPrice:  r.uniPrice,
    camPrice:  r.camPrice,
  }, null, 2));
  console.log(LINE + '\n');
}

function printSummary(stats, durationS) {
  const LINE = '═'.repeat(108);
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  console.log('\n' + LINE);
  console.log(`  MONITOR SUMMARY   (${elapsed}s elapsed, ${stats.ticks} ticks, ${stats.errors} errors)`);
  console.log(LINE);
  console.log(`  Opportunities fired: ${stats.opportunities}`);
  console.log(`  Spread range:        ${stats.minSpread.toFixed(5)}% – ${stats.maxSpread.toFixed(5)}%`);
  console.log(`  Avg spread:          ${stats.ticks > 0 ? (stats.sumSpread / stats.ticks).toFixed(5) : 'n/a'}%`);
  console.log(`  Fee burden:          ${(FEE_BURDEN_FRAC * 100).toFixed(5)}%`);
  console.log(`  Gap to threshold:    ${stats.minGap.toFixed(5)}%  (closest approach)`);
  console.log(`  UniV3 depth range:   $${stats.minDepth.toFixed(2)} – $${stats.maxDepth.toFixed(2)}`);
  console.log(`  Direction counts:    ${JSON.stringify(stats.dirCounts)}`);
  if (stats.opportunities === 0) {
    console.log(`\n  No executable edge during this window.`);
    console.log(`  Closest was ${stats.minGap.toFixed(5)}% below threshold.`);
    console.log(`  Spread needs to reach ${(FEE_BURDEN_FRAC * 100 + stats.bufferPct + 0.001).toFixed(4)}%+ to trigger.`);
  }
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
    sizeUsd:    getN('--size',     DEFAULT_SIZE_USD),
    bufferPct:  getN('--buffer',   DEFAULT_BUFFER_PCT),   // in %
    intervalMs: getN('--interval', DEFAULT_INTERVAL_MS),
    durationS:  getN('--duration', DEFAULT_DURATION_S),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { sizeUsd, bufferPct, intervalMs, durationS } = parseArgs();

  const bufferFrac  = bufferPct / 100;
  // Threshold display uses estimated slippage at typical $8k depth — just for header
  const typicalSlip = estimateSlippage(sizeUsd, 8138);
  const thresholdDisplay = (FEE_BURDEN_FRAC + typicalSlip + bufferFrac) * 100;

  console.log(`\n[arb_trigger_monitor] ${new Date().toISOString()}`);
  console.log(`  Press Ctrl+C to stop early.`);

  printHeader(sizeUsd, bufferPct, intervalMs, durationS, thresholdDisplay);

  const rpc = createProvider('arbitrum');

  const stats = {
    startMs:       Date.now(),
    ticks:         0,
    errors:        0,
    opportunities: 0,
    sumSpread:     0,
    minSpread:     Infinity,
    maxSpread:     -Infinity,
    minDepth:      Infinity,
    maxDepth:      -Infinity,
    minGap:        Infinity,   // closest approach to threshold (negative = how far under)
    dirCounts:     {},
    bufferPct,
  };

  const endMs    = Date.now() + durationS * 1000;
  let lastBlock  = null;
  let lastStatus = null;

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    // Get current block
    let blockNumber;
    try {
      const b = await rpc.getBlockNumber('trigger.block', { timeoutMs: 1200, hedge: true });
      blockNumber = b.blockNumber;
    } catch (e) {
      stats.errors++;
      await sleep(intervalMs);
      continue;
    }

    // Read both pools at this block
    const r = await tick(blockNumber, sizeUsd, bufferFrac, rpc);

    if (!r.ok) {
      stats.errors++;
      process.stdout.write(`  [!] ${fmtTime(new Date().toISOString())} ERR: ${r.error}\n`);
      await sleep(intervalMs);
      continue;
    }

    // Update stats
    stats.ticks++;
    stats.sumSpread += r.spread;
    if (r.spread < stats.minSpread) stats.minSpread = r.spread;
    if (r.spread > stats.maxSpread) stats.maxSpread = r.spread;
    if (r.uniDepth < stats.minDepth) stats.minDepth = r.uniDepth;
    if (r.uniDepth > stats.maxDepth) stats.maxDepth = r.uniDepth;

    const gap = r.spread - r.threshold;  // negative = under threshold
    if (gap < stats.minGap || stats.minGap === Infinity) {
      // Track closest approach (least negative = closest to firing)
      if (gap < 0 && gap > -stats.minGap) stats.minGap = Math.abs(gap);
      else if (gap < 0) stats.minGap = Math.abs(gap);
    }

    stats.dirCounts[r.direction] = (stats.dirCounts[r.direction] || 0) + 1;

    // Only print if block changed or status changed (suppress noise)
    const isNewBlock  = blockNumber !== lastBlock;
    const isNewStatus = r.status    !== lastStatus;

    if (isNewBlock || isNewStatus || r.executable) {
      printTick(r, true);
      lastBlock  = blockNumber;
      lastStatus = r.status;
    }

    // Fire opportunity alert
    if (r.executable) {
      stats.opportunities++;
      printOpportunity(r);
    }

    // Pace to interval
    const elapsed = Date.now() - loopStart;
    const wait    = Math.max(0, intervalMs - elapsed);
    if (wait > 0) await sleep(wait);
  }

  printSummary(stats, durationS);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
