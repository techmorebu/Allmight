// scripts/validators/wbtc_spread_validator.js
// BOSS DIRECTIVE — WBTC ROUTING-FAMILY SPREAD VALIDATION
//
// Compares at the same block per sample:
//   direct WBTC/USDT     ← existing pool (stablecoin path)
//   synthetic WBTC/USD   ← WBTC/WETH × ETH/USDC (ETH-routed path)
//   synthetic cross-check← WBTC/WETH × ETH/USDT
//
// This is the first surface with a potentially fee-positive spread.
// Same-block anchoring is MANDATORY — all legs from same block.
//
// Usage:
//   node -r dotenv/config scripts/validators/wbtc_spread_validator.js
//   node -r dotenv/config scripts/validators/wbtc_spread_validator.js --samples 20 --interval 8000

'use strict';
require('dotenv').config();

const arbitrumFetcher = require('../data_collection/masterFetcher/arbitrumFetcher');

// ── Config ────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const getArg      = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i+1]) : d; };
const SAMPLES     = getArg('--samples', 10);
const INTERVAL_MS = getArg('--interval', 8000);  // 8s = ~32 Arbitrum blocks between reads

// Fee model: WBTC/USDT direct (0.05%) vs WBTC/WETH×ETH/USDC synthetic (0.05%+0.05%)
// Round-trip = direct + synthetic = 0.05% + 0.10% = 0.15%
// Note: this is a one-sided swap model for monitoring. Actual execution requires 2-sided.
// One-sided fee to move from USDT path → ETH path: just the spread - fee of each pool
const WBTC_USDT_FEE       = 0.0005;   // 0.05%
const WBTC_WETH_FEE       = 0.0005;   // 0.05%
const ETH_USDC_FEE        = 0.0005;   // 0.05%
const ETH_USDT_FEE        = 0.0005;   // 0.05%
const SYNTHETIC_FEE_USDC  = WBTC_WETH_FEE + ETH_USDC_FEE;  // 0.10% (2 hops)
const ROUND_TRIP_USDC     = WBTC_USDT_FEE + SYNTHETIC_FEE_USDC; // 0.15% full round-trip

// ── Helpers ───────────────────────────────────────────────────────────────────

function bar(n = 112) { return '─'.repeat(n); }
function pct(n)       { return (n * 100).toFixed(4) + '%'; }
function usd(n, d=2)  { return '$' + n.toFixed(d); }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }

function findPrice(prices, venue, pair) {
  return prices.find(p => p.venue === venue && p.pair === pair);
}

function avg(arr)    { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function min(arr)    { return arr.length ? Math.min(...arr) : null; }
function max(arr)    { return arr.length ? Math.max(...arr) : null; }
function stddev(arr) {
  if (arr.length < 2) return null;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s,v) => s+(v-m)**2, 0) / (arr.length-1));
}

// ── Sample collector ──────────────────────────────────────────────────────────

async function collectSample(idx) {
  const result = await arbitrumFetcher();
  if (result.status === 'error') return { idx, error: 'fetcher error', ts: new Date().toISOString() };

  const prices     = result.data.prices;
  const block      = result.data.blockNumber;
  const ts         = result.data.timestamp;
  const durationMs = result.data.durationMs;

  const wbtcUsdtRow = findPrice(prices, 'uniswap_v3', 'WBTC/USDT');
  const wbtcWethRow = findPrice(prices, 'uniswap_v3', 'WBTC/WETH');
  const ethUsdcRow  = findPrice(prices, 'uniswap_v3', 'ETH/USDC');
  const ethUsdtRow  = findPrice(prices, 'uniswap_v3', 'ETH/USDT');

  const s = { idx, block, ts, durationMs, error: null };

  // Direct WBTC/USD via USDT pool (already in USDT — USD equivalent)
  s.direct = wbtcUsdtRow?.price ?? null;

  // Synthetic via ETH/USDC: WBTC/WETH (WETH per WBTC) × ETH/USDC (USDC per WETH)
  if (wbtcWethRow && ethUsdcRow) {
    s.synthViaUsdc = wbtcWethRow.price * ethUsdcRow.price;
  } else {
    s.synthViaUsdc = null;
    s.synthMissing = [!wbtcWethRow && 'WBTC/WETH', !ethUsdcRow && 'ETH/USDC'].filter(Boolean);
  }

  // Synthetic cross-check via ETH/USDT
  if (wbtcWethRow && ethUsdtRow) {
    s.synthViaUsdt = wbtcWethRow.price * ethUsdtRow.price;
  } else {
    s.synthViaUsdt = null;
  }

  // Component legs for reference
  s.wbtcWeth = wbtcWethRow?.price ?? null;   // WETH per WBTC
  s.ethUsdc  = ethUsdcRow?.price  ?? null;
  s.ethUsdt  = ethUsdtRow?.price  ?? null;

  // Spread: direct WBTC/USDT vs synthetic WBTC/WETH×ETH/USDC
  if (s.direct !== null && s.synthViaUsdc !== null) {
    const absSpread   = Math.abs(s.direct - s.synthViaUsdc);
    s.spreadAbs       = absSpread;
    s.spreadPct       = absSpread / Math.min(s.direct, s.synthViaUsdc);
    s.netSpread       = s.spreadPct - ROUND_TRIP_USDC;
    s.netPositive     = s.netSpread > 0;
    s.direction       = s.direct > s.synthViaUsdc ? 'direct>synth' : 'synth>direct';
  }

  return s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('WBTC ROUTING-FAMILY SPREAD VALIDATION — STABLECOIN PATH vs ETH-ROUTED SYNTHETIC');
  console.log(`Samples: ${SAMPLES}  |  Interval: ${INTERVAL_MS}ms (~${Math.round(INTERVAL_MS/250)} Arbitrum blocks between reads)`);
  console.log(`Round-trip fee (WBTC/USDT + WBTC/WETH + ETH/USDC): ${pct(ROUND_TRIP_USDC)}`);
  console.log(bar());
  console.log(
    `${'#'.padStart(3)} ` +
    `${'Block'.padStart(12)} ` +
    `${'Direct'.padStart(12)} ` +
    `${'SynthUSDC'.padStart(12)} ` +
    `${'SynthUSDT'.padStart(12)} ` +
    `${'|Spread|'.padStart(9)} ` +
    `${'Spread%'.padStart(8)} ` +
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
      console.log(`${String(i).padStart(3)}  MISSING: ${s.synthMissing?.join(',') || 'direct'}`);
    } else {
      const netStr   = s.netPositive ? `+${pct(s.netSpread)}` : `-${pct(Math.abs(s.netSpread))}`;
      const netLabel = s.netPositive ? ' ← NET+' : '';
      console.log(
        `${String(i).padStart(3)} ` +
        `${String(s.block).padStart(12)} ` +
        `${usd(s.direct).padStart(12)} ` +
        `${usd(s.synthViaUsdc).padStart(12)} ` +
        `${s.synthViaUsdt ? usd(s.synthViaUsdt).padStart(12) : 'n/a'.padStart(12)} ` +
        `${usd(s.spreadAbs).padStart(9)} ` +
        `${pct(s.spreadPct).padStart(8)} ` +
        `${netStr.padStart(9)} ` +
        `${s.direction.padStart(14)}` +
        `${netLabel}`
      );
    }

    if (i < SAMPLES) await sleep(INTERVAL_MS);
  }

  // ── Statistics ─────────────────────────────────────────────────────────────
  const valid       = samples.filter(s => s.direct !== null && s.synthViaUsdc !== null);
  const spreadsAbs  = valid.map(s => s.spreadAbs);
  const spreadsPct  = valid.map(s => s.spreadPct);
  const nets        = valid.map(s => s.netSpread);
  const netPos      = valid.filter(s => s.netPositive).length;
  const dirCounts   = valid.reduce((a,s) => { a[s.direction]=(a[s.direction]||0)+1; return a; }, {});
  const uniqueBlocks = new Set(valid.map(s => s.block)).size;

  // USDT vs USDC synthetic cross-check
  const vUsdt = valid.filter(s => s.synthViaUsdt !== null);
  const crossDiffs = vUsdt.map(s => Math.abs(s.synthViaUsdc - s.synthViaUsdt));
  const avgCross = avg(crossDiffs);

  // WBTC/WETH ratio stats
  const wbtcWethPrices = valid.map(s => s.wbtcWeth).filter(Boolean);

  console.log('\n' + bar());
  console.log('STATISTICS');
  console.log(bar());
  console.log(`Samples collected:      ${valid.length}/${SAMPLES} valid`);
  console.log(`Unique blocks:          ${uniqueBlocks}/${valid.length}${uniqueBlocks < valid.length ? ' ⚠️  SAME-BLOCK READS DETECTED' : ' ✅'}`);
  console.log('');
  console.log('SPREAD (direct WBTC/USDT vs synthetic WBTC/WETH×ETH/USDC):');
  console.log(`  min abs:  ${usd(min(spreadsAbs) ?? 0)}`);
  console.log(`  max abs:  ${usd(max(spreadsAbs) ?? 0)}`);
  console.log(`  avg abs:  ${usd(avg(spreadsAbs) ?? 0)}`);
  console.log(`  min pct:  ${pct(min(spreadsPct) ?? 0)}`);
  console.log(`  max pct:  ${pct(max(spreadsPct) ?? 0)}`);
  console.log(`  avg pct:  ${pct(avg(spreadsPct) ?? 0)}`);
  console.log(`  stddev:   ${stddev(spreadsPct) !== null ? pct(stddev(spreadsPct)) : 'n/a'}`);
  console.log('');
  console.log(`Round-trip fee burden:  ${pct(ROUND_TRIP_USDC)}`);
  console.log('FEE-ADJUSTED NET SPREAD:');
  console.log(`  min:    ${pct(min(nets) ?? 0)}`);
  console.log(`  max:    ${pct(max(nets) ?? 0)}`);
  console.log(`  avg:    ${pct(avg(nets) ?? 0)}`);
  console.log(`  net-positive samples: ${netPos}/${valid.length}`);
  console.log('');
  console.log('DIRECTION CONSISTENCY:');
  Object.entries(dirCounts).forEach(([d,n]) => console.log(`  ${d.padEnd(16)}: ${n}/${valid.length}`));
  console.log('');
  if (wbtcWethPrices.length) {
    console.log(`WBTC/WETH ratio: min=${wbtcWethPrices.reduce((a,b)=>Math.min(a,b)).toFixed(4)} max=${wbtcWethPrices.reduce((a,b)=>Math.max(a,b)).toFixed(4)} avg=${(wbtcWethPrices.reduce((a,b)=>a+b,0)/wbtcWethPrices.length).toFixed(4)} ETH/BTC`);
  }
  if (avgCross !== null) {
    console.log(`USDT vs USDC synth cross-check (avg diff): ${usd(avgCross, 2)}`);
    console.log(`  (near $0 = ETH/USDC and ETH/USDT legs are internally consistent)`);
  }

  // ── Verdicts ───────────────────────────────────────────────────────────────
  const avgSpread = avg(spreadsPct) ?? 0;
  const avgNet    = avg(nets)       ?? 0;
  const spreadStd = stddev(spreadsPct) ?? 0;
  const netPosFraction = valid.length > 0 ? netPos / valid.length : 0;

  let consistencyVerdict;
  if (spreadStd > avgSpread * 0.8 || avgSpread < 0.0001) {
    consistencyVerdict = 'NOISE — spread variance exceeds mean signal';
  } else if (avgSpread < 0.0005) {
    consistencyVerdict = 'WEAK BUT REAL — spread stable but small';
  } else {
    consistencyVerdict = 'PERSISTENT — spread consistent and above noise floor';
  }

  let classification;
  if (avgNet > 0.001 && netPosFraction >= 0.8) {
    classification = 'ACTIONABLE — consistent net-positive spread warrants execution modeling';
  } else if (avgNet > 0 && netPosFraction >= 0.5) {
    classification = 'CANDIDATE — net-positive majority warrants deeper routing analysis';
  } else if (avgNet > -0.001) {
    classification = 'MONITORED — spread exists but sits at/near fee threshold; watch for widening';
  } else {
    classification = 'MONITORED — fee burden exceeds spread across most samples';
  }

  let blocker;
  if (netPosFraction < 0.5) {
    blocker = `Fee burden (${pct(ROUND_TRIP_USDC)}) exceeds spread in ${valid.length - netPos}/${valid.length} samples — spread not persistent enough`;
  } else if (netPosFraction < 0.8) {
    blocker = `Net-positive only ${netPos}/${valid.length} samples — insufficient consistency for execution planning`;
  } else if (uniqueBlocks < valid.length) {
    blocker = 'Same-block reads present — increase interval to guarantee true time-separation';
  } else {
    blocker = 'Slippage model required — size impact on $57M WBTC/WETH pool not yet modeled';
  }

  console.log('\n' + bar());
  console.log('VERDICTS');
  console.log(bar());
  console.log(`Consistency:      ${consistencyVerdict}`);
  console.log(`Classification:   ${classification}`);
  console.log(`Biggest blocker:  ${blocker}`);
  console.log(bar() + '\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
