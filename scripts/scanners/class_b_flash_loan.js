#!/usr/bin/env node
/**
 * AllMight — Class B (Flash Loan) financing overlay scanner v1
 * ═══════════════════════════════════════════════════════════════
 *
 * Boss C9 ruling 2026-06-05:
 *   Class B is a FINANCING OVERLAY on underlying arbitrage, NOT an
 *   opportunity generator. The underlying arb must be valid BEFORE
 *   financing is evaluated.
 *
 * Constitutional constraints:
 *   - Analytics only
 *   - No probe, no execution, no capital movement
 *   - executionAuthorized: false hardcoded in all output
 *   - Does not alter execution/capital/contract/broadcast state
 *
 * Design:
 *   - Generic economics engine (accepts any surface object)
 *   - Size ladder ($100 → $10M) with binding-constraint identification
 *   - Five distinct output states per Boss ruling
 *   - Canonical JSON to stdout (versioned schema)
 *   - Human summary to stderr
 *
 * Usage:
 *   node scripts/scanners/class_b_flash_loan.js
 *   node scripts/scanners/class_b_flash_loan.js > scan.json
 *   node scripts/scanners/class_b_flash_loan.js 2> scan.summary.txt
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Constants ──────────────────────────────────────────────────────────

const SCHEMA_VERSION = 'class_b_flash_loan_scan_v1';

// Boss-directed ladder: $100 → $10M. Filter by executable cap at eval time.
const SIZE_LADDER_USD = [
  100, 250, 500,
  1000, 2500, 5000,
  10000, 25000, 50000,
  100000, 250000, 500000,
  1000000, 2500000, 5000000, 10000000,
];

const SAFETY_BUFFER_BPS = 1;      // 1 bp per-trade safety buffer
const GAS_COST_USD = 0.50;        // Approximate Arbitrum gas for a swap-pair
const SPREAD_BPS_FALLBACK = 0;    // If observed_spread_bps missing, assume none

// ─── Test fixture ───────────────────────────────────────────────────────
// One hardcoded test case per Boss ruling. Engine is generic; this
// is just an input example. UniV3 pool + depth are REAL (from Wave 10A
// discovery); Ramses V2 pool address is a placeholder (getPair
// resolution deferred); observed spread is illustrative.

const TEST_FIXTURE_RAMSES_UNIV3 = {
  surfaceId: 'arbitrum:WETH/USDC:univ3-3000:ramses-v2',
  chain: 'arbitrum',
  chainId: 42161,
  pair: {
    tokenA: {
      symbol: 'WETH',
      address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      decimals: 18,
    },
    tokenB: {
      symbol: 'USDC',
      address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      decimals: 6,
    },
  },
  venues: {
    dominant: {
      name: 'uniswap_v3_arbitrum_weth_usdc_30bps',
      type: 'uniswap_v3',
      pool_address: '0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c',  // real (discovery Wave 10A)
      fee_bps: 30,
      active_tick_depth_usd: 35170000,  // real (discovery Wave 10A)
    },
    counterpart: {
      name: 'ramses_v2_arbitrum_weth_usdc',
      type: 'ramses_v2',
      pool_address: '0x0000000000000000000000000000000000000000',  // FIXTURE PLACEHOLDER
      fee_bps: 5,
      active_tick_depth_usd: 7000000,  // canonical Ramses depth reference
    },
  },
  observed_spread_bps: 15,           // FIXTURE VALUE — representative
  observed_at: '2026-06-05T00:00:00Z',
  fixture_note: 'Test fixture combining real UniV3 discovery data + canonical Ramses reference depth + representative spread. Ramses V2 pool address is a placeholder pending getPair() resolution. Scanner engine works on any surface conforming to this schema.',
};

// ─── Cost / economics engine ────────────────────────────────────────────

/**
 * Nonlinear slippage approximation.
 *
 * For a swap of size Q against a pool with effective depth D:
 *   slippage_bps ≈ 5000 * (Q / D)
 *
 * This linear-in-ratio model overstates slippage for CL pools with
 * concentrated liquidity within the active tick range (where slippage
 * is near-zero until the tick is crossed) and understates it once the
 * tick is fully consumed. For v1 this suffices to establish the shape
 * of the size ladder. A production scanner would compute per-tick
 * slippage from the concentrated-liquidity math.
 */
function slippageBps(sizeUsd, effectiveDepthUsd) {
  if (effectiveDepthUsd <= 0) return Infinity;
  return 5000 * (sizeUsd / effectiveDepthUsd);
}

/**
 * Per Boss C9 decision equation:
 *   gross_arb_profit(Q)
 *   − swap_fees(Q)
 *   − slippage(Q)
 *   − gas(Q)
 *   − flash_fee(Q)
 *   − safety_buffer(Q)
 *   ─────────────────
 *   = net_profit(Q)
 */
function computeAtSize(surface, sizeUsd, opts) {
  opts = opts || {};
  const flashFinancingFeeBps = opts.flashFinancingFeeBps || 0;

  const spreadBps = (surface.observed_spread_bps != null)
    ? surface.observed_spread_bps
    : SPREAD_BPS_FALLBACK;

  const grossProfitUsd = sizeUsd * (spreadBps / 10000);

  const totalSwapFeeBps =
    surface.venues.dominant.fee_bps + surface.venues.counterpart.fee_bps;
  const swapFeesUsd = sizeUsd * (totalSwapFeeBps / 10000);

  const slipDominantBps = slippageBps(sizeUsd, surface.venues.dominant.active_tick_depth_usd);
  const slipCounterBps = slippageBps(sizeUsd, surface.venues.counterpart.active_tick_depth_usd);
  const slippageUsd = sizeUsd * ((slipDominantBps + slipCounterBps) / 10000);

  const gasUsd = GAS_COST_USD;
  const flashFeeUsd = sizeUsd * (flashFinancingFeeBps / 10000);
  const safetyBufferUsd = sizeUsd * (SAFETY_BUFFER_BPS / 10000);

  const totalCostsUsd = swapFeesUsd + slippageUsd + gasUsd + flashFeeUsd + safetyBufferUsd;
  const netProfitUsd = grossProfitUsd - totalCostsUsd;

  return {
    sizeUsd,
    grossProfitUsd,
    swapFeesUsd,
    slippageUsd,
    gasUsd,
    flashFeeUsd,
    safetyBufferUsd,
    totalCostsUsd,
    netProfitUsd,
    profitable: netProfitUsd > 0,
  };
}

// ─── Cap resolution ─────────────────────────────────────────────────────

function resolveBorrowSource(surface, registry) {
  // Prefer Aave (larger capacity per c1) for the quote asset
  const quoteSymbol = surface.pair.tokenB.symbol;

  const chainCfg = registry.chains && registry.chains[surface.chain];
  if (!chainCfg || !chainCfg.sources) return null;

  const aave = chainCfg.sources.aave_v3;
  if (aave && aave.assets && aave.assets[quoteSymbol] && !aave.assets[quoteSymbol].error) {
    const asset = aave.assets[quoteSymbol];
    const rawWei = BigInt(asset.available_liquidity_wei);
    const denom = 10n ** BigInt(asset.decimals);
    const capUsd = Number(rawWei / denom);
    return {
      source: 'aave_v3',
      asset: quoteSymbol,
      capUsd,
      feeBps: aave.flash_loan_fee_bps,
      note: asset.snapshot_note,
    };
  }

  // Fallback: Balancer V2
  const balancer = chainCfg.sources.balancer_v2;
  if (balancer && balancer.assets && balancer.assets[quoteSymbol] && !balancer.assets[quoteSymbol].error) {
    const asset = balancer.assets[quoteSymbol];
    const rawWei = BigInt(asset.available_liquidity_wei);
    const denom = 10n ** BigInt(asset.decimals);
    const capUsd = Number(rawWei / denom);
    return {
      source: 'balancer_v2',
      asset: quoteSymbol,
      capUsd,
      feeBps: balancer.flash_loan_fee_bps,
      note: asset.snapshot_note,
    };
  }

  return null;
}

// ─── Binding constraint identification ──────────────────────────────────

function identifyBindingConstraint(bestResult, executableCapUsd, borrowCapUsd, surfaceCapUsd) {
  // No profitable size found at all
  if (!bestResult) return 'SPREAD';

  const optimalSize = bestResult.sizeUsd;

  // Check hard caps first — did executable_cap bind?
  const withinPercent = 1.15;  // if optimal is within 15% of a cap, cap is binding
  if (borrowCapUsd > 0 && optimalSize >= borrowCapUsd / withinPercent && borrowCapUsd <= surfaceCapUsd) {
    return 'BORROW_CAPACITY';
  }
  if (optimalSize >= surfaceCapUsd / withinPercent && surfaceCapUsd <= borrowCapUsd) {
    return 'SURFACE_DEPTH';
  }

  // Otherwise, which cost dominates at the optimal size?
  const costs = {
    SWAP_FEES: bestResult.swapFeesUsd,
    SLIPPAGE: bestResult.slippageUsd,
    GAS: bestResult.gasUsd,
    FLASH_FEE: bestResult.flashFeeUsd,
  };
  const largest = Object.entries(costs).sort((a, b) => b[1] - a[1])[0];
  return largest[0];
}

// ─── Main evaluator ─────────────────────────────────────────────────────

function evaluateSurface(surface, registry) {
  const borrowSource = resolveBorrowSource(surface, registry);
  const borrowCapUsd = borrowSource ? borrowSource.capUsd : 0;
  const surfaceCapUsd = Math.min(
    surface.venues.dominant.active_tick_depth_usd,
    surface.venues.counterpart.active_tick_depth_usd
  );
  const executableCapUsd = Math.min(surfaceCapUsd, borrowCapUsd || Infinity);

  // Ladder: filter to sizes within executable cap
  const feasibleSizes = SIZE_LADDER_USD.filter(s => s <= executableCapUsd);

  // Underlying (no flash financing)
  const underlyingLadder = feasibleSizes.map(s =>
    computeAtSize(surface, s, { flashFinancingFeeBps: 0 })
  );
  const underlyingBest = underlyingLadder
    .filter(r => r.profitable)
    .sort((a, b) => b.netProfitUsd - a.netProfitUsd)[0] || null;

  // Flash-financed
  const flashFeeBps = borrowSource ? borrowSource.feeBps : 0;
  const flashLadder = feasibleSizes.map(s =>
    computeAtSize(surface, s, { flashFinancingFeeBps: flashFeeBps })
  );
  const flashBest = flashLadder
    .filter(r => r.profitable)
    .sort((a, b) => b.netProfitUsd - a.netProfitUsd)[0] || null;

  // The five distinct facts (Boss C9)
  const underlyingArbValid = !!underlyingBest;
  const flashFinanceAvailable = !!borrowSource;
  const flashFinanceEconomic = !!flashBest;
  const flashFinanceImprovesCapacity = !!(flashBest && underlyingBest && flashBest.sizeUsd > underlyingBest.sizeUsd);
  const flashFinanceImprovesProfit = !!(flashBest && underlyingBest && flashBest.netProfitUsd > underlyingBest.netProfitUsd);

  // Best result for reporting
  const bestResult = flashFinanceImprovesProfit ? flashBest : underlyingBest;
  const bindingConstraint = identifyBindingConstraint(
    bestResult, executableCapUsd, borrowCapUsd, surfaceCapUsd
  );

  // Opportunity classes
  const opportunityClass = [];
  if (underlyingArbValid) opportunityClass.push('A');
  if (underlyingArbValid && flashFinanceImprovesProfit) opportunityClass.push('B');

  return {
    surfaceId: surface.surfaceId,
    chain: surface.chain,
    opportunityClass,

    // Boss C9 five distinct facts
    underlyingArbValid,
    flashFinanceAvailable,
    flashFinanceEconomic,
    flashFinanceImprovesCapacity,
    flashFinanceImprovesProfit,

    // Underlying best
    underlyingBestSizeUsd: underlyingBest ? underlyingBest.sizeUsd : null,
    underlyingBestNetProfitUsd: underlyingBest ? underlyingBest.netProfitUsd : null,

    // Flash best
    flashBestSizeUsd: flashBest ? flashBest.sizeUsd : null,
    flashBestNetProfitUsd: flashBest ? flashBest.netProfitUsd : null,

    // Borrow context
    borrowSource: borrowSource ? borrowSource.source : null,
    borrowAsset: borrowSource ? borrowSource.asset : null,
    borrowCapacityUsd: borrowCapUsd,
    borrowFeeBps: borrowSource ? borrowSource.feeBps : null,

    // Cap analysis
    surfaceCapacityUsd: surfaceCapUsd,
    slippageCapUsd: null,   // v1: not computed as separate cap
    policyCapUsd: null,     // v1: not enforced (analytics only)
    executableCapUsd,

    // Recommendation
    recommendedTestSizeUsd: bestResult ? bestResult.sizeUsd : null,
    bindingConstraint,

    // Size ladders (audit trail)
    sizeLadder: {
      underlying: underlyingLadder,
      withFlashLoan: flashLadder,
    },

    // Constitutional
    executionAuthorized: false,   // c2 is analytics only
  };
}

// ─── Human-readable summary (stderr) ────────────────────────────────────

function renderSummary(output, surfaces) {
  const err = (s) => process.stderr.write(s + '\n');

  err('');
  err('═══════════════════════════════════════════════════════════════════');
  err(' Class B (Flash Loan) financing overlay scanner — v1');
  err('═══════════════════════════════════════════════════════════════════');
  err('');
  err(' Schema version:  ' + output.$schema);
  err(' Scanned at:      ' + output.scannedAt);
  err(' Chain:           ' + output.chain);
  err(' Surfaces:        ' + output.meta.surfacesScanned);
  err(' Candidates:      ' + output.meta.candidatesFound);
  err('');
  err(' Constitutional state:');
  err('   Capital LOCKED:   ' + output.constitutionalState.capitalLocked);
  err('   Broadcast LOCKED: ' + output.constitutionalState.broadcastLocked);
  err('   Execution LOCKED: ' + output.constitutionalState.executionLocked);
  err('   Analytics only:   ' + output.constitutionalState.analyticsOnly);
  err('');

  for (const r of output.surfaces) {
    err(' ── ' + r.surfaceId + ' ──');
    err('   Opportunity class:               [' + r.opportunityClass.join(', ') + ']');
    err('');
    err('   Underlying arb valid:            ' + r.underlyingArbValid);
    if (r.underlyingBestSizeUsd !== null) {
      err('     Best size (underlying):        $' + r.underlyingBestSizeUsd.toLocaleString());
      err('     Best net profit (underlying):  $' + r.underlyingBestNetProfitUsd.toFixed(2));
    }
    err('');
    err('   Flash finance available:         ' + r.flashFinanceAvailable);
    err('     Source:                        ' + (r.borrowSource || 'none'));
    err('     Asset:                         ' + (r.borrowAsset || 'n/a'));
    err('     Borrow capacity:               $' + r.borrowCapacityUsd.toLocaleString());
    err('     Fee (bps):                     ' + (r.borrowFeeBps != null ? r.borrowFeeBps : 'n/a'));
    err('');
    err('   Flash finance economic:          ' + r.flashFinanceEconomic);
    err('   Flash improves capacity:         ' + r.flashFinanceImprovesCapacity);
    err('   Flash improves profit:           ' + r.flashFinanceImprovesProfit);
    if (r.flashBestSizeUsd !== null) {
      err('     Best size (with flash):        $' + r.flashBestSizeUsd.toLocaleString());
      err('     Best net profit (with flash):  $' + r.flashBestNetProfitUsd.toFixed(2));
    }
    err('');
    err('   Surface capacity:                $' + r.surfaceCapacityUsd.toLocaleString());
    err('   Executable capacity:             $' + r.executableCapUsd.toLocaleString());
    err('   Recommended test size:           ' + (r.recommendedTestSizeUsd !== null ? '$' + r.recommendedTestSizeUsd.toLocaleString() : 'none'));
    err('   Binding constraint:              ' + r.bindingConstraint);
    err('   Execution authorized:            ' + r.executionAuthorized);
    err('');
  }

  // Ramses interpretation (Boss C9 point e)
  const ramses = output.surfaces.find(s => s.surfaceId.includes('ramses'));
  if (ramses) {
    err(' ── Ramses ETH/USDC interpretation ──');
    err('');
    if (ramses.opportunityClass.includes('A') && ramses.opportunityClass.includes('B')) {
      err('   The Ramses × UniV3 surface (at fixture spread of 15 bps) presents as');
      err('   viable in BOTH Class A (Cross-DEX arbitrage) and Class B (Flash-Loan');
      err('   supported). Flash financing improves either capacity or profit vs.');
      err('   the underlying-only case.');
    } else if (ramses.opportunityClass.includes('A')) {
      err('   The Ramses × UniV3 surface (at fixture spread of 15 bps) is Class A');
      err('   viable but flash financing does NOT improve profit at any tested size.');
      err('   Underlying-capital execution is preferred over flash-loan-supported.');
    } else {
      err('   Under the fixture spread, the surface is not profitable at any tested');
      err('   size after fees + slippage + gas. This is expected at a 15 bp fixture');
      err('   spread — real Ramses arb opportunities occur when the spread widens');
      err('   above the combined-cost floor, typically 20+ bps.');
    }
    err('');
    err('   IMPORTANT: This is a fixture-based analysis. observed_spread_bps=15');
    err('   is illustrative. Live execution decision requires:');
    err('     - live spread measurement from same-block anchoring');
    err('     - live depth measurement (not canonical reference)');
    err('     - Boss ruling');
    err('');
  }

  err(' Capital LOCKED. Proven winner UNTOUCHED. Broadcast LOCKED.');
  err(' Class B is a financing overlay, not an opportunity generator.');
  err('');
}

// ─── Main ───────────────────────────────────────────────────────────────

function main() {
  const registryPath = path.join(__dirname, '..', '..', 'config', 'borrowability_registry.json');
  if (!fs.existsSync(registryPath)) {
    console.error('FATAL: borrowability_registry.json not found at ' + registryPath);
    process.exit(1);
  }
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  const surfaces = [TEST_FIXTURE_RAMSES_UNIV3];
  const results = surfaces.map(s => evaluateSurface(s, registry));

  const output = {
    $schema: SCHEMA_VERSION,
    scannedAt: new Date().toISOString(),
    chain: 'arbitrum',
    constitutionalState: {
      capitalLocked: true,
      broadcastLocked: true,
      executionLocked: true,
      analyticsOnly: true,
    },
    surfaces: results,
    meta: {
      surfacesScanned: surfaces.length,
      candidatesFound: results.filter(r => r.opportunityClass.length > 0).length,
      classBCandidates: results.filter(r => r.opportunityClass.includes('B')).length,
      fixtureNote: 'v1 uses one hardcoded test fixture. Live surface data ingestion deferred to a later commit.',
    },
  };

  // Canonical output: JSON to stdout
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');

  // Human interpretation: stderr
  renderSummary(output, surfaces);
}

try {
  main();
} catch (e) {
  console.error('FATAL: ' + e.message);
  process.exit(1);
}
