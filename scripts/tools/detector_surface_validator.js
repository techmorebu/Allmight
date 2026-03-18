'use strict';

// scripts/tools/detector_surface_validator.js
//
// BOSS DIRECTIVE — DETECTOR INTEGRATION VALIDATION
//
// Validates that the restored Arbitrum Phase 1 surface is interpreted
// correctly by detector-grade logic:
//
// - ETH/USDC (UniV3 vs Camelot)
// - ETH/USDT (UniV3)
// - USDC/USDT (UniV3)
//
// This is a validation tool, not an execution engine.
//
// Usage:
//   node -r dotenv/config scripts/tools/detector_surface_validator.js
//

require('dotenv').config();

const arbitrumFetcher = require('../data_collection/masterFetcher/arbitrumFetcher');

const ROUND_TRIP_FEE_BURDEN_PCT = 0.35; // UniV3 0.05% + Camelot 0.30%
const ACTIONABLE_BUFFER_PCT = 0.10;     // extra safety over fee burden
const CANDIDATE_BUFFER_PCT = 0.00;      // exactly fee-neutral line
const MONITOR_MIN_PCT = 0.02;           // visible but tiny divergence floor

function nowIso() {
  return new Date().toISOString();
}

function pctSpread(a, b) {
  return (Math.abs(a - b) / Math.min(a, b)) * 100;
}

function classifySpread(spreadPct) {
  const netPct = spreadPct - ROUND_TRIP_FEE_BURDEN_PCT;

  if (spreadPct < MONITOR_MIN_PCT) {
    return {
      class: 'ignored',
      reason: 'Spread too small even for monitoring significance',
      netPct,
    };
  }

  if (spreadPct < ROUND_TRIP_FEE_BURDEN_PCT + CANDIDATE_BUFFER_PCT) {
    return {
      class: 'monitored',
      reason: 'Real divergence, but fully absorbed by round-trip fees',
      netPct,
    };
  }

  if (spreadPct < ROUND_TRIP_FEE_BURDEN_PCT + ACTIONABLE_BUFFER_PCT) {
    return {
      class: 'candidate',
      reason: 'Above fee burden, but margin too thin for execution confidence',
      netPct,
    };
  }

  return {
    class: 'actionable',
    reason: 'Spread materially exceeds fee burden and safety buffer',
    netPct,
  };
}

function findVenuePair(prices, venue, pair) {
  return prices.find((p) => p.venue === venue && p.pair === pair) || null;
}

function printLine(char = '─', len = 96) {
  console.log(char.repeat(len));
}

async function main() {
  printLine();
  console.log('DETECTOR SURFACE VALIDATOR — ARBITRUM PHASE 1');
  console.log(`Timestamp: ${nowIso()}`);
  printLine();

  const result = await arbitrumFetcher();

  if (!result || !result.data || !Array.isArray(result.data.prices)) {
    console.error('FATAL: fetcher returned invalid shape');
    process.exit(1);
  }

  const prices = result.data.prices;

  const uniEthUsdc = findVenuePair(prices, 'uniswap_v3', 'ETH/USDC');
  const camelotEthUsdc = findVenuePair(prices, 'camelot_v2', 'ETH/USDC');
  const uniEthUsdt = findVenuePair(prices, 'uniswap_v3', 'ETH/USDT');
  const uniUsdcUsdt = findVenuePair(prices, 'uniswap_v3', 'USDC/USDT');

  const missing = [];
  if (!uniEthUsdc) missing.push('uniswap_v3 ETH/USDC');
  if (!camelotEthUsdc) missing.push('camelot_v2 ETH/USDC');
  if (!uniEthUsdt) missing.push('uniswap_v3 ETH/USDT');
  if (!uniUsdcUsdt) missing.push('uniswap_v3 USDC/USDT');

  console.log('\nINPUT SNAPSHOT');
  printLine();
  console.log(`Fetcher status:      ${result.status}`);
  console.log(`Fetcher partial:     ${result.partial}`);
  console.log(`Block number:        ${result.data.blockNumber}`);
  console.log(`Duration:            ${result.data.durationMs}ms`);
  console.log(`Success count:       ${result.data.stats?.successCount ?? 'n/a'}`);
  console.log(`Failure count:       ${result.data.stats?.failureCount ?? 'n/a'}`);
  console.log(`Endpoint ids seen:   ${(result.data.endpointIdsSeen || []).join(',') || 'n/a'}`);

  if (missing.length) {
    console.log('\nMISSING REQUIRED SURFACE');
    printLine();
    missing.forEach((m) => console.log(`- ${m}`));
    console.log('\nVERDICT');
    printLine();
    console.log('Detector surface class: ignored');
    console.log('Reason: Missing required price legs for Arbitrum Phase 1 validation');
    process.exit(1);
  }

  console.log('\nRESTORED SURFACE');
  printLine();
  console.log(`UniV3   ETH/USDC   $${uniEthUsdc.price.toFixed(4)}`);
  console.log(`Camelot ETH/USDC   $${camelotEthUsdc.price.toFixed(4)}`);
  console.log(`UniV3   ETH/USDT   $${uniEthUsdt.price.toFixed(4)}`);
  console.log(`UniV3   USDC/USDT   ${uniUsdcUsdt.price.toFixed(6)}`);

  const ethUsdcSpreadAbs = Math.abs(uniEthUsdc.price - camelotEthUsdc.price);
  const ethUsdcSpreadPct = pctSpread(uniEthUsdc.price, camelotEthUsdc.price);
  const direction =
    uniEthUsdc.price > camelotEthUsdc.price ? 'UniV3>Camelot' :
    uniEthUsdc.price < camelotEthUsdc.price ? 'Camelot>UniV3' :
    'Flat';

  const classification = classifySpread(ethUsdcSpreadPct);

  const stableOk = uniUsdcUsdt.price >= 0.99 && uniUsdcUsdt.price <= 1.01;
  const ethUsdConsistent = Math.abs(uniEthUsdc.price - uniEthUsdt.price) / Math.min(uniEthUsdc.price, uniEthUsdt.price) * 100 < 1.0;

  console.log('\nDETECTOR OUTPUT SNAPSHOT');
  printLine();
  console.log(`ETH/USDC spread abs:     $${ethUsdcSpreadAbs.toFixed(4)}`);
  console.log(`ETH/USDC spread pct:      ${ethUsdcSpreadPct.toFixed(4)}%`);
  console.log(`Round-trip fee burden:    ${ROUND_TRIP_FEE_BURDEN_PCT.toFixed(4)}%`);
  console.log(`Net spread pct:           ${classification.netPct.toFixed(4)}%`);
  console.log(`Direction:                ${direction}`);
  console.log(`Stable reference sane:    ${stableOk ? 'YES' : 'NO'}`);
  console.log(`ETH USD legs consistent:  ${ethUsdConsistent ? 'YES' : 'NO'}`);
  console.log(`Detector class:           ${classification.class.toUpperCase()}`);
  console.log(`Reason:                   ${classification.reason}`);

  let detectorAlignmentVerdict = 'correct';
  let biggestLogicGap = 'none';

  if (!stableOk) {
    detectorAlignmentVerdict = 'incorrect';
    biggestLogicGap = 'USDC/USDT reference leg is out of sane range';
  } else if (!ethUsdConsistent) {
    detectorAlignmentVerdict = 'incorrect';
    biggestLogicGap = 'ETH/USDC and ETH/USDT reference legs disagree materially';
  } else if (classification.class === 'actionable') {
    detectorAlignmentVerdict = 'needs review';
    biggestLogicGap = 'Actionable classification should be reviewed with slippage and size-aware routing';
  }

  console.log('\nFINAL VERDICTS');
  printLine();
  console.log(`ETH/USDC surfaced as:     ${classification.class}`);
  console.log(`Detector alignment:       ${detectorAlignmentVerdict}`);
  console.log(`Biggest logic gap:        ${biggestLogicGap}`);
  console.log(`Execution verdict:        ${classification.class === 'actionable' ? 'Potentially executable' : 'Not execution-grade under current fee model'}`);

  printLine();
}

main().catch((err) => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
