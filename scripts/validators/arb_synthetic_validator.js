// scripts/validators/arb_synthetic_validator.js
// BOSS DIRECTIVE — DIRECT vs SYNTHETIC ARB/USD SPREAD VALIDATION
//
// Compares per sample:
//   direct ARB/USDC    ← pool 0xb0f6cA40... (native USDC)
//   synthetic ARB/USD  ← ARB/WETH × ETH/USDC
//   synthetic ARB/USD  ← ARB/WETH × ETH/USDT
//
// Measures spread persistence and fee-adjusted tradeability.
//
// Usage:
//   node -r dotenv/config scripts/validators/arb_synthetic_validator.js
//   node -r dotenv/config scripts/validators/arb_synthetic_validator.js --samples 20 --interval 8000

'use strict';
require('dotenv').config();

const arbitrumFetcher = require('../data_collection/masterFetcher/arbitrumFetcher');

// ── Config ────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const getArg      = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i+1]) : d; };
const SAMPLES     = getArg('--samples', 10);
const INTERVAL_MS = getArg('--interval', 7000);

// Fee model for fee-adjusted net spread estimate
// Route: buy ARB on cheaper venue, sell on more expensive venue
// Worst-case round-trip: direct pool fee (0.05%) + ARB/WETH fee (0.05%) + ETH/USDC fee (0.05%)
const DIRECT_FEE         = 0.0005;   // ARB/USDC pool 0.05%
const ARB_WETH_FEE       = 0.0005;   // ARB/WETH pool 0.05%
const ETH_USDC_FEE       = 0.0005;   // ETH/USDC pool 0.05%
const ETH_USDT_FEE       = 0.0005;   // ETH/USDT pool 0.05%

const SYNTHETIC_VIA_USDC_FEE = ARB_WETH_FEE + ETH_USDC_FEE;  // 0.10%
const SYNTHETIC_VIA_USDT_FEE = ARB_WETH_FEE + ETH_USDT_FEE;  // 0.10%
const ROUND_TRIP_USDC = DIRECT_FEE + SYNTHETIC_VIA_USDC_FEE;  // 0.15%
const ROUND_TRIP_USDT = DIRECT_FEE + SYNTHETIC_VIA_USDT_FEE;  // 0.15%

// ── Helpers ───────────────────────────────────────────────────────────────────

function bar(n = 104) { return '─'.repeat(n); }
function pct(n) { return (n * 100).toFixed(4) + '%'; }
function usd(n, d = 6) { return '$' + n.toFixed(d); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function findPrice(prices, venue, pair) {
  return prices.find(p => p.venue === venue && p.pair === pair);
}

function avg(arr)    { return arr.length ? arr.reduce((a,b) => a+b, 0) / arr.length : null; }
function min(arr)    { return arr.length ? Math.min(...arr) : null; }
function max(arr)    { return arr.length ? Math.max(...arr) : null; }
function stddev(arr) {
  if (arr.length < 2) return null;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s,v) => s + (v-m)**2, 0) / (arr.length - 1));
}

// ── Sample collector ──────────────────────────────────────────────────────────

async function collectSample(idx) {
  const result = await arbitrumFetcher();
  if (result.status === 'error') return { idx, error: 'fetcher error', ts: new Date().toISOString() };

  const prices     = result.data.prices;
  const block      = result.data.blockNumber;
  const ts         = result.data.timestamp;
  const durationMs = result.data.durationMs;

  const directRow  = findPrice(prices, 'uniswap_v3', 'ARB/USDC');
  const arbWethRow = findPrice(prices, 'uniswap_v3', 'ARB/WETH');
  const ethUsdcRow = findPrice(prices, 'uniswap_v3', 'ETH/USDC');
  const ethUsdtRow = findPrice(prices, 'uniswap_v3', 'ETH/USDT');

  const s = { idx, block, ts, durationMs, error: null };

  // Direct ARB/USDC price (native USDC)
  s.direct = directRow?.price ?? null;

  // Synthetic via ETH/USDC: ARB/WETH (WETH per ARB) × ETH/USDC (USDC per WETH)
  if (arbWethRow && ethUsdcRow) {
    s.synthViaUsdc = arbWethRow.price * ethUsdcRow.price;
  } else {
    s.synthViaUsdc = null;
    s.synthViaUsdcMissing = [!arbWethRow && 'ARB/WETH', !ethUsdcRow && 'ETH/USDC'].filter(Boolean);
  }

  // Synthetic via ETH/USDT: ARB/WETH × ETH/USDT
  if (arbWethRow && ethUsdtRow) {
    s.synthViaUsdt = arbWethRow.price * ethUsdtRow.price;
  } else {
    s.synthViaUsdt = null;
  }

  // Component prices for reference
  s.arbWeth  = arbWethRow?.price  ?? null;
  s.ethUsdc  = ethUsdcRow?.price  ?? null;
  s.ethUsdt  = ethUsdtRow?.price  ?? null;

  // Spread: direct vs synthetic (via USDC)
  if (s.direct !== null && s.synthViaUsdc !== null) {
    const absSpread = Math.abs(s.direct - s.synthViaUsdc);
    s.spreadPct     = absSpread / Math.min(s.direct, s.synthViaUsdc);
    s.netSpreadUsdc = s.spreadPct - ROUND_TRIP_USDC;
    s.netPositive   = s.netSpreadUsdc > 0;
    s.direction     = s.direct > s.synthViaUsdc ? 'direct>synth' : 'synth>direct';
  }

  return s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('DIRECT vs SYNTHETIC ARB/USD SPREAD VALIDATION');
  console.log(`Samples: ${SAMPLES}  |  Interval: ${INTERVAL_MS}ms`);
  console.log(`Round-trip fee (direct + synth via USDC): ${pct(ROUND_TRIP_USDC)}  (3 × 0.05%)`);
  console.log(bar());
  console.log(
    `${'#'.padStart(3)} ` +
    `${'Block'.padStart(12)} ` +
    `${'Direct'.padStart(10)} ` +
    `${'SynthUSDC'.padStart(10)} ` +
    `${'SynthUSDT'.padStart(10)} ` +
    `${'Spread%'.padStart(9)} ` +
    `${'NetSprd%'.padStart(9)} ` +
    `${'Direction'.padStart(14)}`
  );
  console.log(bar());

  const samples = [];

  for (let i = 1; i <= SAMPLES; i++) {
    const s = await collectSample(i);
    samples.push(s);

    if (s.error) {
      console.log(`${String(i).padStart(3)}  ERROR: ${s.error}`);
    } else if (s.direct === null || s.synthViaUsdc === null) {
      const missing = s.synthViaUsdcMissing?.join(',') || 'direct';
      console.log(`${String(i).padStart(3)}  MISSING: ${missing}`);
    } else {
      const netStr    = s.netPositive ? `+${pct(s.netSpreadUsdc)}` : `-${pct(Math.abs(s.netSpreadUsdc))}`;
      const netLabel  = s.netPositive ? ' ← NET+' : '';
      console.log(
        `${String(i).padStart(3)} ` +
        `${String(s.block).padStart(12)} ` +
        `${usd(s.direct, 5).padStart(10)} ` +
        `${usd(s.synthViaUsdc, 5).padStart(10)} ` +
        `${s.synthViaUsdt ? usd(s.synthViaUsdt, 5).padStart(10) : 'n/a'.padStart(10)} ` +
        `${pct(s.spreadPct).padStart(9)} ` +
        `${netStr.padStart(9)} ` +
        `${s.direction.padStart(14)}` +
        `${netLabel}`
      );
    }

    if (i < SAMPLES) await sleep(INTERVAL_MS);
  }

  // ── Statistics ─────────────────────────────────────────────────────────────
  const valid        = samples.filter(s => s.direct !== null && s.synthViaUsdc !== null);
  const spreads      = valid.map(s => s.spreadPct);
  const nets         = valid.map(s => s.netSpreadUsdc);
  const netPos       = valid.filter(s => s.netPositive).length;
  const dirCounts    = valid.reduce((a, s) => { a[s.direction] = (a[s.direction]||0)+1; return a; }, {});
  const blocks       = valid.map(s => s.block);
  const uniqueBlocks = new Set(blocks).size;

  // USDT cross-check: compare synthViaUSDC vs synthViaUSDT per sample
  const vUsdc = valid.filter(s => s.synthViaUsdt !== null);
  const crossDiffs = vUsdc.map(s => Math.abs(s.synthViaUsdc - s.synthViaUsdt));
  const avgCrossDiff = avg(crossDiffs);

  console.log('\n' + bar());
  console.log('STATISTICS');
  console.log(bar());
  console.log(`Samples collected:      ${valid.length}/${SAMPLES} valid`);
  console.log(`Unique blocks:          ${uniqueBlocks}/${valid.length}${uniqueBlocks < valid.length ? ' ⚠️  SOME SAME-BLOCK' : ' ✅'}`);
  console.log('');
  console.log('DIRECT vs SYNTHETIC (via ETH/USDC) SPREAD:');
  console.log(`  min:    ${pct(min(spreads))}`);
  console.log(`  max:    ${pct(max(spreads))}`);
  console.log(`  avg:    ${pct(avg(spreads))}`);
  console.log(`  stddev: ${stddev(spreads) !== null ? pct(stddev(spreads)) : 'n/a'}`);
  console.log('');
  console.log(`Round-trip fee burden:  ${pct(ROUND_TRIP_USDC)}`);
  console.log('FEE-ADJUSTED NET SPREAD:');
  console.log(`  min:    ${pct(min(nets))}`);
  console.log(`  max:    ${pct(max(nets))}`);
  console.log(`  avg:    ${pct(avg(nets))}`);
  console.log(`  net-positive samples: ${netPos}/${valid.length}`);
  console.log('');
  console.log('DIRECTION CONSISTENCY:');
  Object.entries(dirCounts).forEach(([d, n]) => console.log(`  ${d.padEnd(16)}: ${n}/${valid.length}`));
  console.log('');
  if (avgCrossDiff !== null) {
    console.log(`USDT vs USDC synthetic cross-check (avg diff): ${usd(avgCrossDiff, 6)}`);
    console.log(`  (close to $0 = ETH/USDC and ETH/USDT price legs are consistent)`);
  }

  // ── Verdicts ───────────────────────────────────────────────────────────────
  const avgSpread = avg(spreads) ?? 0;
  const avgNet    = avg(nets)    ?? 0;
  const spreadStd = stddev(spreads) ?? 0;

  let consistencyVerdict;
  if (spreadStd > avgSpread * 0.8 || avgSpread < 0.0001) {
    consistencyVerdict = 'NOISE — spread variance exceeds mean';
  } else if (avgSpread < 0.001) {
    consistencyVerdict = 'WEAK BUT REAL — spread is small but stable';
  } else {
    consistencyVerdict = 'PERSISTENT — spread is consistent and above noise floor';
  }

  let tradeVerdict;
  if (avgNet > 0.001 && netPos >= valid.length * 0.7) {
    tradeVerdict = 'CLEARLY WORTH EXECUTION INVESTIGATION';
  } else if (netPos > 0) {
    tradeVerdict = 'MAYBE TRADEABLE — net-positive windows exist, need slippage model';
  } else {
    tradeVerdict = 'NOT TRADEABLE — fee burden exceeds spread on all samples';
  }

  let blocker;
  if (avgNet <= 0) {
    blocker = `Fee burden (${pct(ROUND_TRIP_USDC)}) exceeds avg spread (${pct(avgSpread)})`;
  } else if (uniqueBlocks < valid.length) {
    blocker = 'Same-block reads — reduce interval to ensure genuine time-separation';
  } else if (netPos < valid.length) {
    blocker = `Only ${netPos}/${valid.length} samples net-positive — spread not persistent enough for reliable execution`;
  } else {
    blocker = 'Slippage model needed before execution — size impact on $1M+ ARB/WETH pool not yet modeled';
  }

  console.log('\n' + bar());
  console.log('VERDICTS');
  console.log(bar());
  console.log(`Consistency:     ${consistencyVerdict}`);
  console.log(`Tradeability:    ${tradeVerdict}`);
  console.log(`Biggest blocker: ${blocker}`);
  console.log(bar() + '\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
