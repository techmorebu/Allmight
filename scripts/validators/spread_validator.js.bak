// scripts/tools/spread_validator.js
// BOSS DIRECTIVE — CROSS-VENUE PRICE DIVERGENCE VALIDATION
//
// Runs N timed fetch samples to determine whether the observed ETH/USDC
// spread between UniV3 and Camelot is real, repeatable, and tradeable.
//
// Also tracks ETH/USDT and USDC/USDT across samples.
//
// Usage:
//   node -r dotenv/config scripts/tools/spread_validator.js
//   node -r dotenv/config scripts/tools/spread_validator.js --samples 20 --interval 8000

'use strict';
require('dotenv').config();

const arbitrumFetcher = require('../data_collection/masterFetcher/arbitrumFetcher');

// ── Config ────────────────────────────────────────────────────────────────────

const args          = process.argv.slice(2);
const getArg        = (flag, def) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i+1]) : def; };

const SAMPLES       = getArg('--samples', 10);
const INTERVAL_MS   = getArg('--interval', 7000);  // 7s default — typically crosses block boundaries on Arbitrum (~250ms)

// Fee tiers (decimal fractions, not pct)
const UNIV3_ETH_USDC_FEE   = 0.0005;   // 0.05%
const CAMELOT_ETH_USDC_FEE = 0.003;    // 0.30%
const ROUND_TRIP_FEE       = UNIV3_ETH_USDC_FEE + CAMELOT_ETH_USDC_FEE; // 0.35%

// ── Helpers ───────────────────────────────────────────────────────────────────

function bar(n = 96) { return '─'.repeat(n); }
function pct(n) { return (n * 100).toFixed(4) + '%'; }
function usd(n) { return '$' + n.toFixed(4); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function findPrice(prices, venue, pair) {
  return prices.find(p => p.venue === venue && p.pair === pair);
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function min(arr) { return arr.length ? Math.min(...arr) : null; }
function max(arr) { return arr.length ? Math.max(...arr) : null; }
function stddev(arr) {
  if (arr.length < 2) return null;
  const m = avg(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

// ── Sample collector ──────────────────────────────────────────────────────────

async function collectSample(idx) {
  const result = await arbitrumFetcher();

  if (result.status === 'error') {
    return { idx, error: 'fetcher returned status=error', ts: new Date().toISOString() };
  }

  const prices = result.data.prices;
  const block  = result.data.blockNumber;
  const ts     = result.data.timestamp;

  const uniEthUsdc    = findPrice(prices, 'uniswap_v3', 'ETH/USDC');
  const camelotEthUsdc = findPrice(prices, 'camelot_v2', 'ETH/USDC');
  const uniEthUsdt    = findPrice(prices, 'uniswap_v3', 'ETH/USDT');
  const uniUsdcUsdt   = findPrice(prices, 'uniswap_v3', 'USDC/USDT');

  const sample = { idx, block, ts, durationMs: result.data.durationMs };

  // ETH/USDC cross-venue (primary target)
  if (uniEthUsdc && camelotEthUsdc) {
    const uni   = uniEthUsdc.price;
    const camel = camelotEthUsdc.price;
    const absSpread  = Math.abs(uni - camel);
    const spreadPct  = absSpread / Math.min(uni, camel);
    const netSpread  = spreadPct - ROUND_TRIP_FEE;

    sample.ethUsdc = {
      uniPrice:     uni,
      camelPrice:   camel,
      absSpread,
      spreadPct,
      netSpread,
      netPositive:  netSpread > 0,
      direction:    uni > camel ? 'UniV3>Camelot' : 'Camelot>UniV3',
    };
  } else {
    sample.ethUsdc = null;
    sample.ethUsdcMissing = [
      !uniEthUsdc    ? 'UniV3'  : null,
      !camelotEthUsdc ? 'Camelot' : null,
    ].filter(Boolean);
  }

  // ETH/USDT single venue (reference)
  sample.ethUsdt    = uniEthUsdt   ? uniEthUsdt.price   : null;
  // USDC/USDT single venue (stable check)
  sample.usdcUsdt   = uniUsdcUsdt  ? uniUsdcUsdt.price  : null;

  return sample;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('CROSS-VENUE PRICE DIVERGENCE VALIDATION — ETH/USDC (UniV3 vs Camelot)');
  console.log(`Samples: ${SAMPLES}  |  Interval: ${INTERVAL_MS}ms  |  Round-trip fee burden: ${pct(ROUND_TRIP_FEE)}`);
  console.log(bar());
  console.log(
    `${'#'.padStart(3)} ` +
    `${'Block'.padStart(12)} ` +
    `${'UniV3'.padStart(12)} ` +
    `${'Camelot'.padStart(12)} ` +
    `${'|Spread|'.padStart(10)} ` +
    `${'Spread%'.padStart(10)} ` +
    `${'NetSprd%'.padStart(10)} ` +
    `${'Direction'.padStart(16)} ` +
    `${'USDC/USDT'.padStart(10)}`
  );
  console.log(bar());

  const samples = [];

  for (let i = 1; i <= SAMPLES; i++) {
    const s = await collectSample(i);
    samples.push(s);

    if (s.error) {
      console.log(`${String(i).padStart(3)} ERROR: ${s.error}`);
    } else if (!s.ethUsdc) {
      console.log(`${String(i).padStart(3)} MISSING: ${(s.ethUsdcMissing || []).join(', ')}`);
    } else {
      const e = s.ethUsdc;
      const netStr = e.netPositive
        ? `+${pct(e.netSpread)}`
        : `-${pct(Math.abs(e.netSpread))}`;
      const netLabel = e.netPositive ? '← NET+' : '';

      console.log(
        `${String(i).padStart(3)} ` +
        `${String(s.block).padStart(12)} ` +
        `${usd(e.uniPrice).padStart(12)} ` +
        `${usd(e.camelPrice).padStart(12)} ` +
        `${usd(e.absSpread).padStart(10)} ` +
        `${pct(e.spreadPct).padStart(10)} ` +
        `${netStr.padStart(10)} ` +
        `${e.direction.padStart(16)} ` +
        `${s.usdcUsdt ? s.usdcUsdt.toFixed(5).padStart(10) : 'n/a'.padStart(10)} ` +
        `${netLabel}`
      );
    }

    if (i < SAMPLES) await sleep(INTERVAL_MS);
  }

  // ── Statistics ────────────────────────────────────────────────────────────
  const valid = samples.filter(s => s.ethUsdc);
  const spreadsAbs  = valid.map(s => s.ethUsdc.absSpread);
  const spreadsPct  = valid.map(s => s.ethUsdc.spreadPct);
  const netsNet     = valid.map(s => s.ethUsdc.netSpread);
  const netPositive = valid.filter(s => s.ethUsdc.netPositive).length;

  const uniPrices    = valid.map(s => s.ethUsdc.uniPrice);
  const camelPrices  = valid.map(s => s.ethUsdc.camelPrice);
  const dirCounts    = valid.reduce((acc, s) => {
    acc[s.ethUsdc.direction] = (acc[s.ethUsdc.direction] || 0) + 1;
    return acc;
  }, {});

  const blocks     = valid.map(s => s.block);
  const uniqueBlocks = new Set(blocks).size;

  console.log('\n' + bar());
  console.log('STATISTICS');
  console.log(bar());
  console.log(`Samples collected:     ${valid.length}/${SAMPLES} valid`);
  console.log(`Unique blocks:         ${uniqueBlocks}/${valid.length} (${uniqueBlocks === valid.length ? 'all unique — no same-block illusion' : 'SOME SAME-BLOCK — reduce interval'})`);
  console.log('');
  console.log('ETH/USDC SPREAD (absolute):');
  console.log(`  min:    ${usd(min(spreadsAbs))}`);
  console.log(`  max:    ${usd(max(spreadsAbs))}`);
  console.log(`  avg:    ${usd(avg(spreadsAbs))}`);
  console.log(`  stddev: ${stddev(spreadsAbs) !== null ? usd(stddev(spreadsAbs)) : 'n/a'}`);
  console.log('');
  console.log('ETH/USDC SPREAD (%):');
  console.log(`  min:    ${pct(min(spreadsPct))}`);
  console.log(`  max:    ${pct(max(spreadsPct))}`);
  console.log(`  avg:    ${pct(avg(spreadsPct))}`);
  console.log(`  stddev: ${stddev(spreadsPct) !== null ? pct(stddev(spreadsPct)) : 'n/a'}`);
  console.log('');
  console.log(`Round-trip fee burden: ${pct(ROUND_TRIP_FEE)}  (UniV3 0.05% + Camelot 0.30%)`);
  console.log('NET SPREAD (spread% − fee burden):');
  console.log(`  min:    ${pct(min(netsNet))}`);
  console.log(`  max:    ${pct(max(netsNet))}`);
  console.log(`  avg:    ${pct(avg(netsNet))}`);
  console.log(`  net-positive samples: ${netPositive}/${valid.length}`);
  console.log('');
  console.log('DIRECTION CONSISTENCY:');
  Object.entries(dirCounts).forEach(([dir, cnt]) =>
    console.log(`  ${dir.padEnd(20)}: ${cnt}/${valid.length}`)
  );
  console.log('');
  console.log('PRICE REFERENCE (UniV3 ETH/USDC):');
  console.log(`  min: ${usd(min(uniPrices))}   max: ${usd(max(uniPrices))}`);

  // ── Verdicts ──────────────────────────────────────────────────────────────
  const avgSpreadPct = avg(spreadsPct) ?? 0;
  const avgNetPct    = avg(netsNet)    ?? 0;
  const spreadStd    = stddev(spreadsPct) ?? 0;

  let consistencyVerdict;
  if (spreadStd > avgSpreadPct * 0.8 || avgSpreadPct < 0.05 / 100) {
    consistencyVerdict = 'NOISE — spread is not meaningfully above sampling variance';
  } else if (avgSpreadPct < 0.10 / 100) {
    consistencyVerdict = 'WEAK BUT REAL — persistent but below noise floor for execution';
  } else {
    consistencyVerdict = 'PERSISTENT — spread is consistent and above noise floor';
  }

  let tradeVerdict;
  if (avgNetPct > 0.10 / 100 && netPositive >= valid.length * 0.7) {
    tradeVerdict = 'CLEARLY WORTH DETECTOR INTEGRATION — net spread positive and consistent';
  } else if (netPositive > 0) {
    tradeVerdict = 'MAYBE TRADEABLE WITH DEEPER ROUTING LOGIC — intermittent net-positive windows exist';
  } else {
    tradeVerdict = 'NOT TRADEABLE at current fee model — spread absorbed by round-trip fees';
  }

  // Biggest blocker
  let blocker;
  if (avgNetPct <= 0) {
    blocker = `Fee burden (${pct(ROUND_TRIP_FEE)}) exceeds avg spread (${pct(avgSpreadPct)}) — need higher-spread moments or lower-fee routing`;
  } else if (uniqueBlocks < valid.length) {
    blocker = 'Same-block reads present — reduce sample interval to ensure true time-separated observations';
  } else if (valid.length < SAMPLES) {
    blocker = `${SAMPLES - valid.length} samples failed — fetcher reliability needs investigation`;
  } else {
    blocker = 'Execution infrastructure (flash loan + on-chain routing) not yet wired';
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
