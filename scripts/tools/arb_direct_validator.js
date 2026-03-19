// scripts/tools/arb_direct_validator.js
// BOSS DIRECTIVE — DIRECT-VS-DIRECT ARB/USDC SPREAD VALIDATION
//
// Compares at the same block per sample:
//   UniV3 ARB/USDC     0xb0f6cA40...  fee=0.05%
//   Camelot V3 ARB/USDC  0xfae2ae0a...  fee=0.0249% (Algebra dynamic)
//
// Round-trip fee burden: 0.05% + 0.0249% = 0.0749%
// This is the closest surface to the observed ~0.072% spread.
// Same-block anchoring is MANDATORY.
//
// Usage:
//   node -r dotenv/config scripts/tools/arb_direct_validator.js
//   node -r dotenv/config scripts/tools/arb_direct_validator.js --samples 20 --interval 8000

'use strict';
require('dotenv').config();

const arbitrumFetcher = require('../data_collection/masterFetcher/arbitrumFetcher');

// ── Config ────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const getArg      = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i+1]) : d; };
const SAMPLES     = getArg('--samples', 10);
const INTERVAL_MS = getArg('--interval', 8000);

// Fee model — actual on-chain fees from validation
const UNIV3_FEE       = 0.0005;    // 0.05% (fixed)
const CAMELOT_V3_FEE  = 0.000249;  // 0.0249% (Algebra dynamic, observed 2026-03-19)
const ROUND_TRIP      = UNIV3_FEE + CAMELOT_V3_FEE;  // 0.0749%

// ── Helpers ───────────────────────────────────────────────────────────────────

function bar(n = 108) { return '─'.repeat(n); }
function pct(n)       { return (n * 100).toFixed(4) + '%'; }
function usd(n, d=6)  { return '$' + n.toFixed(d); }
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
  if (result.status === 'error') return { idx, error: 'fetcher error' };

  const prices = result.data.prices;
  const block  = result.data.blockNumber;

  const uniRow  = findPrice(prices, 'uniswap_v3', 'ARB/USDC');
  const camRow  = findPrice(prices, 'camelot_v3', 'ARB/USDC');

  const s = { idx, block, ts: result.data.timestamp };
  s.uniPrice  = uniRow?.price  ?? null;
  s.camPrice  = camRow?.price  ?? null;
  s.uniFee    = uniRow?.fee    ?? UNIV3_FEE;
  s.camFee    = camRow?.fee    ?? CAMELOT_V3_FEE;

  if (s.uniPrice !== null && s.camPrice !== null) {
    s.absSpread  = Math.abs(s.uniPrice - s.camPrice);
    s.spreadPct  = s.absSpread / Math.min(s.uniPrice, s.camPrice);
    s.netSpread  = s.spreadPct - ROUND_TRIP;
    s.netPositive = s.netSpread > 0;
    s.direction   = s.uniPrice > s.camPrice ? 'uni>camelot' : 'camelot>uni';
  }

  return s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('DIRECT-VS-DIRECT ARB/USDC SPREAD VALIDATION');
  console.log('UniV3 0.05%  vs  Camelot V3 (Algebra) 0.0249%');
  console.log(`Samples: ${SAMPLES}  |  Interval: ${INTERVAL_MS}ms (~${Math.round(INTERVAL_MS/250)} Arbitrum blocks)`);
  console.log(`Round-trip fee burden: ${pct(ROUND_TRIP)}  (${pct(UNIV3_FEE)} + ${pct(CAMELOT_V3_FEE)})`);
  console.log(bar());
  console.log(
    `${'#'.padStart(3)} ` +
    `${'Block'.padStart(12)} ` +
    `${'UniV3'.padStart(12)} ` +
    `${'CamelotV3'.padStart(12)} ` +
    `${'|Spread|'.padStart(10)} ` +
    `${'Spread%'.padStart(9)} ` +
    `${'NetSprd%'.padStart(9)} ` +
    `${'Direction'.padStart(13)}`
  );
  console.log(bar());

  const samples = [];

  for (let i = 1; i <= SAMPLES; i++) {
    const s = await collectSample(i);
    samples.push(s);

    if (s.error) {
      console.log(`${String(i).padStart(3)}  ERROR: ${s.error}`);
    } else if (s.uniPrice === null || s.camPrice === null) {
      const missing = [s.uniPrice === null && 'UniV3', s.camPrice === null && 'CamelotV3'].filter(Boolean);
      console.log(`${String(i).padStart(3)}  MISSING: ${missing.join(', ')}`);
    } else {
      const netStr   = s.netPositive ? `+${pct(s.netSpread)}` : `-${pct(Math.abs(s.netSpread))}`;
      const netLabel = s.netPositive ? ' ← NET+' : '';
      console.log(
        `${String(i).padStart(3)} ` +
        `${String(s.block).padStart(12)} ` +
        `${usd(s.uniPrice).padStart(12)} ` +
        `${usd(s.camPrice).padStart(12)} ` +
        `${usd(s.absSpread).padStart(10)} ` +
        `${pct(s.spreadPct).padStart(9)} ` +
        `${netStr.padStart(9)} ` +
        `${s.direction.padStart(13)}` +
        `${netLabel}`
      );
    }

    if (i < SAMPLES) await sleep(INTERVAL_MS);
  }

  // ── Statistics ─────────────────────────────────────────────────────────────
  const valid       = samples.filter(s => s.uniPrice !== null && s.camPrice !== null);
  const spreadsAbs  = valid.map(s => s.absSpread);
  const spreadsPct  = valid.map(s => s.spreadPct);
  const nets        = valid.map(s => s.netSpread);
  const netPos      = valid.filter(s => s.netPositive).length;
  const dirCounts   = valid.reduce((a,s) => { a[s.direction]=(a[s.direction]||0)+1; return a; }, {});
  const uniqueBlocks = new Set(valid.map(s => s.block)).size;

  console.log('\n' + bar());
  console.log('STATISTICS');
  console.log(bar());
  console.log(`Samples collected:      ${valid.length}/${SAMPLES} valid`);
  console.log(`Unique blocks:          ${uniqueBlocks}/${valid.length}${uniqueBlocks < valid.length ? ' ⚠️  SAME-BLOCK READS' : ' ✅'}`);
  console.log('');
  console.log('SPREAD (UniV3 vs Camelot V3 ARB/USDC):');
  console.log(`  min abs:  ${usd(min(spreadsAbs) ?? 0)}`);
  console.log(`  max abs:  ${usd(max(spreadsAbs) ?? 0)}`);
  console.log(`  avg abs:  ${usd(avg(spreadsAbs) ?? 0)}`);
  console.log(`  min pct:  ${pct(min(spreadsPct) ?? 0)}`);
  console.log(`  max pct:  ${pct(max(spreadsPct) ?? 0)}`);
  console.log(`  avg pct:  ${pct(avg(spreadsPct) ?? 0)}`);
  console.log(`  stddev:   ${stddev(spreadsPct) !== null ? pct(stddev(spreadsPct)) : 'n/a'}`);
  console.log('');
  console.log(`Round-trip fee burden:  ${pct(ROUND_TRIP)}`);
  console.log('FEE-ADJUSTED NET SPREAD:');
  console.log(`  min:    ${pct(min(nets) ?? 0)}`);
  console.log(`  max:    ${pct(max(nets) ?? 0)}`);
  console.log(`  avg:    ${pct(avg(nets) ?? 0)}`);
  console.log(`  net-positive samples: ${netPos}/${valid.length}`);
  console.log('');
  console.log('DIRECTION CONSISTENCY:');
  Object.entries(dirCounts).forEach(([d,n]) => console.log(`  ${d.padEnd(16)}: ${n}/${valid.length}`));

  // ── Verdicts ───────────────────────────────────────────────────────────────
  const avgSpread = avg(spreadsPct) ?? 0;
  const avgNet    = avg(nets)       ?? 0;
  const spreadStd = stddev(spreadsPct) ?? 0;
  const netPosFrac = valid.length > 0 ? netPos / valid.length : 0;

  let consistencyVerdict;
  if (spreadStd > avgSpread * 0.8 || avgSpread < 0.00005) {
    consistencyVerdict = 'NOISE';
  } else {
    consistencyVerdict = 'PERSISTENT — spread stable across samples';
  }

  let classification;
  if (avgNet > 0.001 && netPosFrac >= 0.8) {
    classification = 'ACTIONABLE — consistent net-positive; proceed to execution modeling';
  } else if (avgNet > 0 && netPosFrac >= 0.5) {
    classification = 'CANDIDATE — net-positive majority; worth slippage modeling';
  } else if (avgNet > -0.0010) {
    classification = 'MONITORED (AT EQUILIBRIUM) — within 10bps of breakeven; watch for widening';
  } else {
    classification = 'MONITORED — fee burden exceeds spread';
  }

  let blocker;
  if (netPosFrac >= 0.8) {
    blocker = 'Slippage model required — size impact across $310k Camelot V3 + $2M UniV3 ARB/USDC pools';
  } else if (netPosFrac >= 0.5) {
    blocker = `Net-positive only ${netPos}/${valid.length} samples — spread not consistently above ${pct(ROUND_TRIP)} threshold`;
  } else {
    blocker = `Avg spread (${pct(avgSpread)}) below fee burden (${pct(ROUND_TRIP)}) — market at equilibrium`;
  }

  console.log('\n' + bar());
  console.log('VERDICTS');
  console.log(bar());
  console.log(`Consistency:     ${consistencyVerdict}`);
  console.log(`Classification:  ${classification}`);
  console.log(`Biggest blocker: ${blocker}`);
  console.log(bar() + '\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
