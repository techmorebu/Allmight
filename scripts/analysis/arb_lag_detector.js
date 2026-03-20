'use strict';
/**
 * scripts/analysis/arb_lag_detector.js
 *
 * Purpose:
 *   Measure Camelot V3 → UniV3 price divergence for ARB/USDC on Arbitrum
 *   and determine whether it is executable after fees, slippage, and liquidity.
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_lag_detector.js
 *   node -r dotenv/config scripts/analysis/arb_lag_detector.js --samples=20
 *   node -r dotenv/config scripts/analysis/arb_lag_detector.js --size=500
 *   node -r dotenv/config scripts/analysis/arb_lag_detector.js --json
 *
 * Strategic context:
 *   Venue discovery proved ARB/USDC liquidity on Arbitrum is structurally
 *   concentrated:
 *     - Camelot V3 = deep anchor ($56k active-tick depth)
 *     - UniV3       = thin lagging mirror ($3,090 active-tick depth)
 *   This detector measures the Camelot→UniV3 lag and determines if
 *   a "thin mirror" snapback trade is executable right now.
 *
 * Hard rules:
 *   - No execution logic
 *   - No new venues
 *   - No Redis writes
 *   - No fetcher mutation
 *   - Same-block anchoring MANDATORY for every sample
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *
 * Repo path note:
 *   Lives at scripts/analysis/ → provider_factory at ../../utils/provider_factory
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS — canonical from handoff, do not change
// ─────────────────────────────────────────────────────────────────────────────

// UniV3 ARB/USDC — token0=ARB(18dec) token1=nativeUSDC(6dec) fee=500 (0.05%)
const UNIV3_POOL    = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const UNIV3_FEE_PCT = 0.0005;   // 0.05% as fraction
const UNIV3_DEC0    = 18;       // ARB
const UNIV3_DEC1    = 6;        // USDC

// Camelot V3 ARB/USDC — Algebra protocol
// globalState() → [sqrtPriceX96, tick, fee, ...]; fee at index 2 in hundredths-of-bips
// token0=ARB(18dec) token1=nativeUSDC(6dec)
const CAMELOT_POOL    = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1';
const CAMELOT_FEE_PCT = 0.000249;  // 0.0249% as fraction (measured dynamic fee)
const CAMELOT_DEC0    = 18;
const CAMELOT_DEC1    = 6;

// Round-trip fee burden (both hops)
const FEE_BURDEN = UNIV3_FEE_PCT + CAMELOT_FEE_PCT;  // 0.0749%

// Price sanity: USDC per ARB
const PRICE_MIN = 0.05;
const PRICE_MAX = 10.0;

// Default CLI params
const DEFAULT_SAMPLES    = 10;
const DEFAULT_TRADE_SIZE = 100;   // USD notional
const SLEEP_BETWEEN_SAMPLES = 500; // ms — anti-stampede

// ─────────────────────────────────────────────────────────────────────────────
// ABIs
// ─────────────────────────────────────────────────────────────────────────────
// UniV3: slot0() + liquidity() — Promise.all on SAME contract in ONE callDetailed
const UNIV3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// Camelot V3 (Algebra): globalState() + liquidity() — same rule
// globalState: [sqrtPriceX96(0), tick(1), fee(2), ...]
const ALGEBRA_ABI = [
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * sqrtPriceX96 → USDC-per-ARB price
 * token0=ARB(dec0=18), token1=USDC(dec1=6), priceMode=direct
 * price = (sqrtP)^2 × 10^(dec0 - dec1)
 */
function sqrtPriceToUSDC(sqrtPriceX96, dec0, dec1) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
}

/**
 * Active-tick depth in USD (USDC terms).
 * Formula established in project: activeTick_usd = (L × sqrtP) / 2^96 / 10^dec1
 *
 * This is the virtual USDC reserve at the current tick — the amount of USDC
 * available before the price moves out of the current tick range.
 *
 * Used for slippage estimation only. NOT TVL.
 */
function activeTickDepthUSD(liquidityRaw, sqrtPriceX96, dec1) {
  const Q96   = 2n ** 96n;
  const lNum  = Number(liquidityRaw);
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);
  return (lNum * sqrtP) / Math.pow(10, dec1);
}

/**
 * Slippage estimate for selling size_usd into a UniV3 pool.
 * First-pass model: slippage_pct ≈ size_usd / (2 × activeTick_usd)
 *
 * Derived from constant-product approximation within a single tick band.
 * Understates true impact for multi-tick trades — intentionally conservative.
 */
function estimateSlippage(sizeUsd, activeTickUsd) {
  if (activeTickUsd <= 0) return Infinity;
  return sizeUsd / (2 * activeTickUsd);
}

/**
 * Spread as a fraction: |pA - pB| / min(pA, pB)
 * Always positive regardless of direction.
 */
function computeSpread(priceA, priceB) {
  return Math.abs(priceA - priceB) / Math.min(priceA, priceB);
}

/**
 * Direction: which way does the trade flow?
 *   'buy_arb_on_uni'    → UniV3 price < Camelot → buy ARB cheap on UniV3, sell on Camelot
 *   'sell_arb_on_uni'   → UniV3 price > Camelot → sell ARB expensive on UniV3, buy on Camelot
 *   'none'              → no spread
 */
function tradeDirection(uniPrice, camelotPrice) {
  if (uniPrice < camelotPrice) return 'buy_arb_on_uni';
  if (uniPrice > camelotPrice) return 'sell_arb_on_uni';
  return 'none';
}

/**
 * Net edge after fees + slippage
 *   net = spread - feeBurden - slippage
 * All as fractions.
 */
function computeNetEdge(spread, feeBurden, slippage) {
  return spread - feeBurden - slippage;
}

/**
 * Classification logic — mirrors the breakeven engine blocker classes.
 */
function classify(spread, feeBurden, slippage, netEdge, activeTickUsd, sizeUsd) {
  if (spread < feeBurden)                    return 'blocked_fee';
  if (activeTickUsd < sizeUsd * 2)           return 'blocked_liquidity';
  if (spread >= feeBurden && slippage >= spread - feeBurden) return 'blocked_slippage';
  if (netEdge > 0)                           return 'candidate';
  return 'blocked_slippage';
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SAMPLE — reads both pools at same block
// ─────────────────────────────────────────────────────────────────────────────
async function takeSample(blockNumber, sizeUsd, rpc) {
  const sampleStart = Date.now();

  // ── UniV3: slot0 + liquidity — single callDetailed on same contract ────────
  let uniResult;
  try {
    uniResult = await rpc.callDetailed(
      `lag.univ3.arb_usdc.${blockNumber}`,
      async (provider) => {
        const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
        const [s0, liq] = await Promise.all([
          pool.slot0({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { s0, liq };
      },
      { timeoutMs: 2500, hedge: true }
    );
  } catch (e) {
    return { ok: false, venue: 'univ3', error: String(e.message).slice(0, 120) };
  }

  // ── Camelot V3 (Algebra): globalState + liquidity — single callDetailed ───
  let camelotResult;
  try {
    camelotResult = await rpc.callDetailed(
      `lag.camelot.arb_usdc.${blockNumber}`,
      async (provider) => {
        const pool = new ethers.Contract(CAMELOT_POOL, ALGEBRA_ABI, provider);
        const [gs, liq] = await Promise.all([
          pool.globalState({ blockTag: blockNumber }),
          pool.liquidity({ blockTag: blockNumber }),
        ]);
        return { gs, liq };
      },
      { timeoutMs: 2500, hedge: true }
    );
  } catch (e) {
    return { ok: false, venue: 'camelot', error: String(e.message).slice(0, 120) };
  }

  // ── Extract values ─────────────────────────────────────────────────────────
  const uniSqrtP  = uniResult.result.s0[0];
  const uniLiq    = uniResult.result.liq;
  const camSqrtP  = camelotResult.result.gs[0];
  const camFeeRaw = Number(camelotResult.result.gs[2]);  // dynamic fee in hundredths-of-bips

  const uniPrice    = sqrtPriceToUSDC(uniSqrtP,  UNIV3_DEC0,   UNIV3_DEC1);
  const camelotPrice = sqrtPriceToUSDC(camSqrtP, CAMELOT_DEC0, CAMELOT_DEC1);

  // Sanity checks
  if (!isFinite(uniPrice)    || uniPrice < PRICE_MIN    || uniPrice > PRICE_MAX)
    return { ok: false, venue: 'univ3',   error: `price insane: ${uniPrice}` };
  if (!isFinite(camelotPrice) || camelotPrice < PRICE_MIN || camelotPrice > PRICE_MAX)
    return { ok: false, venue: 'camelot', error: `price insane: ${camelotPrice}` };

  // ── Active-tick depth (UniV3 only — this is the thin mirror) ──────────────
  const uniActiveTick = activeTickDepthUSD(uniLiq, uniSqrtP, UNIV3_DEC1);

  // ── Dynamic fee from Camelot (override default if non-zero) ───────────────
  const camelotFeePct = camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_PCT;
  const feeBurden     = UNIV3_FEE_PCT + camelotFeePct;

  // ── Spread + direction ─────────────────────────────────────────────────────
  const spread    = computeSpread(uniPrice, camelotPrice);
  const direction = tradeDirection(uniPrice, camelotPrice);

  // ── Slippage model — UniV3 is always the thin side ─────────────────────────
  const slippage  = estimateSlippage(sizeUsd, uniActiveTick);

  // ── Net edge + classification ──────────────────────────────────────────────
  const netEdge   = computeNetEdge(spread, feeBurden, slippage);
  const status    = classify(spread, feeBurden, slippage, netEdge, uniActiveTick, sizeUsd);

  return {
    ok:              true,
    blockNumber,
    uniPrice:        parseFloat(uniPrice.toFixed(6)),
    camelotPrice:    parseFloat(camelotPrice.toFixed(6)),
    spread:          parseFloat((spread * 100).toFixed(5)),      // in %
    feeBurden:       parseFloat((feeBurden * 100).toFixed(5)),   // in %
    slippage:        parseFloat((slippage * 100).toFixed(5)),    // in %
    netEdge:         parseFloat((netEdge * 100).toFixed(5)),     // in %
    direction,
    uniActiveTick:   parseFloat(uniActiveTick.toFixed(2)),
    uniLiqRaw:       uniLiq.toString(),
    sizeTested:      sizeUsd,
    status,
    camelotFeePct:   parseFloat((camelotFeePct * 100).toFixed(4)),
    durationMs:      Date.now() - sampleStart,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGGREGATE STATS
// ─────────────────────────────────────────────────────────────────────────────
function aggregate(samples) {
  const ok = samples.filter(s => s.ok);
  if (!ok.length) return null;

  const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
  const min = arr => Math.min(...arr);
  const max = arr => Math.max(...arr);

  const spreads   = ok.map(s => s.spread);
  const netEdges  = ok.map(s => s.netEdge);
  const depths    = ok.map(s => s.uniActiveTick);
  const slippages = ok.map(s => s.slippage);

  const statusCounts = {};
  ok.forEach(s => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });

  const dirCounts = {};
  ok.forEach(s => { dirCounts[s.direction] = (dirCounts[s.direction] || 0) + 1; });

  const candidateCount = ok.filter(s => s.status === 'candidate').length;

  return {
    sampleCount:         ok.length,
    candidateCount,
    candidatePct:        parseFloat(((candidateCount / ok.length) * 100).toFixed(1)),
    spread: {
      avg: parseFloat(avg(spreads).toFixed(5)),
      min: parseFloat(min(spreads).toFixed(5)),
      max: parseFloat(max(spreads).toFixed(5)),
    },
    netEdge: {
      avg: parseFloat(avg(netEdges).toFixed(5)),
      min: parseFloat(min(netEdges).toFixed(5)),
      max: parseFloat(max(netEdges).toFixed(5)),
    },
    uniActiveTick: {
      avg: parseFloat(avg(depths).toFixed(2)),
      min: parseFloat(min(depths).toFixed(2)),
      max: parseFloat(max(depths).toFixed(2)),
    },
    slippage: {
      avg: parseFloat(avg(slippages).toFixed(5)),
      min: parseFloat(min(slippages).toFixed(5)),
      max: parseFloat(max(slippages).toFixed(5)),
    },
    feeBurden:      ok[0].feeBurden,
    sizeTested:     ok[0].sizeTested,
    statusCounts,
    directionCounts: dirCounts,
    dominantStatus: Object.entries(statusCounts).sort((a,b) => b[1]-a[1])[0][0],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT RESULTS
// ─────────────────────────────────────────────────────────────────────────────
function printResults(samples, stats) {
  const LINE = '═'.repeat(112);
  const DASH = '─'.repeat(112);

  console.log('\n' + LINE);
  console.log('  ARB/USDC  —  CAMELOT → UNIV3  LAG DETECTOR');
  console.log('  Camelot V3 (anchor, deep) vs UniV3 (thin mirror)');
  console.log(LINE);

  // Per-sample table
  console.log('\n  SAMPLES:');
  console.log(`  ${'#'.padEnd(4)} ${'block'.padEnd(12)} ${'cam_px'.padEnd(10)} ${'uni_px'.padEnd(10)} ` +
              `${'spread%'.padEnd(10)} ${'slippage%'.padEnd(11)} ${'netEdge%'.padEnd(11)} ` +
              `${'activeTick$'.padEnd(13)} ${'status'.padEnd(22)} dir`);
  console.log('  ' + DASH.slice(2));

  samples.forEach((s, i) => {
    if (!s.ok) {
      console.log(`  ${String(i+1).padEnd(4)} [FAIL] ${s.venue}: ${s.error}`);
      return;
    }
    const statusIcon = s.status === 'candidate' ? '★ candidate          '
                     : s.status.padEnd(21);
    console.log(
      `  ${String(i+1).padEnd(4)} ` +
      `${String(s.blockNumber).padEnd(12)} ` +
      `$${String(s.camelotPrice).padEnd(9)} ` +
      `$${String(s.uniPrice).padEnd(9)} ` +
      `${String(s.spread).padEnd(10)} ` +
      `${String(s.slippage).padEnd(11)} ` +
      `${String(s.netEdge).padEnd(11)} ` +
      `$${String(s.uniActiveTick).padEnd(12)} ` +
      `${statusIcon} ` +
      `${s.direction}`
    );
  });

  if (!stats) {
    console.log('\n  No valid samples to aggregate.\n');
    return;
  }

  // Aggregate stats
  console.log('\n' + DASH);
  console.log('  AGGREGATE STATS  (' + stats.sampleCount + ' samples, size=$' + stats.sizeTested + ')');
  console.log(DASH);
  console.log(`  Spread:           avg=${stats.spread.avg}%   min=${stats.spread.min}%   max=${stats.spread.max}%`);
  console.log(`  Fee burden:       ${stats.feeBurden}%  (UniV3 ${(UNIV3_FEE_PCT*100).toFixed(4)}% + Camelot ${stats.feeBurden - UNIV3_FEE_PCT*100 < 0.001 ? CAMELOT_FEE_PCT*100 : (stats.feeBurden - UNIV3_FEE_PCT*100).toFixed(4)}%)`);
  console.log(`  Slippage:         avg=${stats.slippage.avg}%   min=${stats.slippage.min}%   max=${stats.slippage.max}%`);
  console.log(`  Net edge:         avg=${stats.netEdge.avg}%   min=${stats.netEdge.min}%   max=${stats.netEdge.max}%`);
  console.log(`  UniV3 depth:      avg=$${stats.uniActiveTick.avg}   min=$${stats.uniActiveTick.min}   max=$${stats.uniActiveTick.max}`);
  console.log(`  Candidates:       ${stats.candidateCount}/${stats.sampleCount} (${stats.candidatePct}%)`);
  console.log(`  Status breakdown: ${JSON.stringify(stats.statusCounts)}`);
  console.log(`  Direction:        ${JSON.stringify(stats.directionCounts)}`);

  // Verdict
  console.log('\n' + LINE);
  const verdict = stats.candidateCount > 0
    ? `★  EXECUTABLE EDGE DETECTED — ${stats.candidateCount}/${stats.sampleCount} samples passed`
    : `   DOMINANT BLOCKER: ${stats.dominantStatus.toUpperCase()}`;

  console.log('  ' + verdict);

  if (stats.dominantStatus === 'blocked_liquidity') {
    const depthNeeded = (stats.sizeTested * 2).toFixed(0);
    console.log(`  UniV3 active-tick depth too thin for $${stats.sizeTested} trades.`);
    console.log(`  Depth needed: ~$${depthNeeded}   Actual avg: $${stats.uniActiveTick.avg}`);
    console.log(`  Spread is fee-positive (avg ${stats.spread.avg}% > ${stats.feeBurden}% burden).`);
    console.log(`  Edge exists on paper. Blocker = UniV3 liquidity only.`);
  } else if (stats.dominantStatus === 'blocked_fee') {
    console.log(`  Spread (avg ${stats.spread.avg}%) is below fee burden (${stats.feeBurden}%).`);
    console.log(`  No edge even before slippage.`);
  } else if (stats.dominantStatus === 'blocked_slippage') {
    console.log(`  Spread clears fees but slippage consumes the edge at $${stats.sizeTested}.`);
    console.log(`  Try smaller size (--size=50 or --size=10).`);
  } else if (stats.candidateCount > 0) {
    console.log(`  Best net edge observed: ${stats.netEdge.max}%`);
    console.log(`  Direction: ${Object.entries(stats.directionCounts).sort((a,b)=>b[1]-a[1])[0][0]}`);
  }

  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARG PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get  = (flag, def) => {
    const a = args.find(a => a.startsWith(flag + '='));
    return a ? Number(a.split('=')[1]) : def;
  };
  return {
    samples:    get('--samples', DEFAULT_SAMPLES),
    size:       get('--size',    DEFAULT_TRADE_SIZE),
    jsonOutput: args.includes('--json'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { samples: N, size: sizeUsd, jsonOutput } = parseArgs();

  console.log(`\n[arb_lag_detector] ${nowIso()}`);
  console.log(`  samples=${N}  size=$${sizeUsd}  feeBurden=${(FEE_BURDEN*100).toFixed(4)}%`);
  console.log(`  UniV3:   ${UNIV3_POOL}  (fee=${UNIV3_FEE_PCT*100}%)`);
  console.log(`  Camelot: ${CAMELOT_POOL}  (fee=${CAMELOT_FEE_PCT*100}%)`);

  const rpc     = createProvider('arbitrum');
  const allSamples = [];

  for (let i = 0; i < N; i++) {
    // Get fresh block anchor for each sample
    let blockNumber;
    try {
      const b = await rpc.getBlockNumber(`lag.block.${i}`, { timeoutMs: 1500, hedge: true });
      blockNumber = b.blockNumber;
    } catch (e) {
      allSamples.push({ ok: false, venue: 'block', error: String(e.message).slice(0, 80) });
      await sleep(SLEEP_BETWEEN_SAMPLES);
      continue;
    }

    const sample = await takeSample(blockNumber, sizeUsd, rpc);
    allSamples.push(sample);

    // Live progress line
    if (sample.ok) {
      const icon = sample.status === 'candidate' ? '★' : sample.status === 'blocked_fee' ? '✗' : '~';
      process.stdout.write(
        `  [${icon}] #${String(i+1).padEnd(3)} blk=${blockNumber} ` +
        `spread=${sample.spread}% net=${sample.netEdge}% ` +
        `depth=$${sample.uniActiveTick} → ${sample.status}\n`
      );
    } else {
      process.stdout.write(`  [!] #${String(i+1).padEnd(3)} FAIL: ${sample.error}\n`);
    }

    if (i < N - 1) await sleep(SLEEP_BETWEEN_SAMPLES);
  }

  const stats = aggregate(allSamples);
  printResults(allSamples, stats);

  if (jsonOutput) {
    console.log('── JSON ──────────────────────────────────────────────────────────────────────');
    console.log(JSON.stringify({ runAt: nowIso(), params: { samples: N, sizeUsd }, stats, samples: allSamples }, null, 2));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
