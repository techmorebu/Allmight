#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Class C (Triangular) closed-cycle route scanner — v1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AllMight Wave 10B, commit 3.  Implements Boss C9 ruling.
 *
 * PURPOSE
 *   Evaluate closed-loop token cycles (e.g. WETH → USDC → ARB → WETH) to
 *   determine whether cycle-level price inconsistency creates a triangular
 *   arbitrage opportunity independent of any two-venue spread.
 *
 * DESIGN CONSTRAINTS (Boss C9)
 *   1. Declarative legs[] cycle schema — engine consumes legs generically so
 *      c3b can enumerate thousands of routes without rewriting economics.
 *   2. Token-flow propagation — each leg receives the OUTPUT of the previous
 *      leg.  We track TOKEN AMOUNTS through the cycle, not summed bps.  USD
 *      is computed only at endpoints (Q0 in, Q3 out).  Per-token spot USD
 *      prices are provided to derive per-leg trade size for slippage math.
 *   3. Weakest-leg capacity USD-normalized (conservative approximation for
 *      v1; production must propagate per-leg execution capacity).
 *   4. Reuse c2's size ladder + binding-constraint vocabulary.
 *   5. Retain BOTH highest-net-profit size AND highest-ROI size.  Capital
 *      policy may later prefer one over the other.
 *   6. Class C output must be consumable by Class B — but Class C must NOT
 *      contain Aave-specific financing math.  Composition happens in c6.
 *   7. Record bindingLeg — critical search-optimization telemetry so we know
 *      that 73% of triangles die at leg 2, not merely that they fail.
 *   8. Analytics only — executionAuthorized: false hardcoded.
 *
 * OUTPUT
 *   stdout: canonical JSON (schema class_c_triangular_scan_v1)
 *   stderr: human-readable summary
 *
 * NON-GOALS FOR v1 (per Boss C9)
 *   - Automatic cycle enumeration (c3b if promoted)
 *   - Live quoting via on-chain quoter contracts
 *   - Reverse-direction cycle evaluation
 *   - Multi-venue optimization per leg (c6 router territory)
 *   - Any Class B financing math inside Class C
 *
 * CAPITAL LOCKED. EXECUTION LOCKED. BROADCAST LOCKED.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Constants (reused from c2 where possible)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 'class_c_triangular_scan_v1';

// Same USD size ladder as c2 Class B scanner — reuse gives comparable telemetry
const SIZE_LADDER_USD = [
  100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000,
  100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000,
];

// Costs
const GAS_PER_LEG_USD  = 0.50;   // Arbitrum, one swap ~ $0.30–0.70 typical
const SAFETY_BUFFER_BPS = 1;     // 1 bp reserve

// Inventory heuristic (v1 fixture threshold — future: read live wallet balance)
// If underlying best-profit size ≤ this, INVENTORY_ECONOMIC = true.
// If greater, the cycle needs external financing (→ Class B evaluation).
const INVENTORY_THRESHOLD_USD = 100000;

// Slippage model — same as c2: linear-in-ratio (5000 × trade/depth)
// Marked explicitly as approximation.  Production must use quoter simulation.
const SLIPPAGE_MODEL_COEFFICIENT = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Fixture cycle — Boss C9 approved: WETH → USDC → ARB → WETH
// ─────────────────────────────────────────────────────────────────────────────
//
// Legs 1 & 2 use REAL Wave 10A discovery data (pool addresses + depths verified
// at Arbitrum block 470,376,319).  Leg 3 is a fixture (placeholder pool + price
// crafted to give a demonstrable ~2.6% pure edge so the engine can display both
// profitable and unprofitable regimes on the ladder).
//
// Expected outcome at these fixture values:
//   - profitable sizes: roughly $100–$1000
//   - peak profit near $1000 (limited by Camelot ARB/USDC leg 2 depth $52K)
//   - bindingLeg = 2, bindingConstraint = LEG_SLIPPAGE
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_CYCLE_WETH_USDC_ARB = {
  cycleId: 'arbitrum:WETH->USDC->ARB->WETH',
  chain: 'arbitrum',
  chainId: 42161,
  startAsset: {
    symbol: 'WETH',
    address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    decimals: 18,
  },
  // Per-token spot USD prices — used to derive per-leg trade size for slippage
  // math and to convert start/end amounts to USD.  Intermediate propagation
  // remains in native token amounts.
  tokenPricesUsd: {
    WETH: 1605,
    USDC: 1,
    ARB:  0.082,
  },
  atomic: true,  // single-tx cycle, no cross-block risk
  legs: [
    {
      leg: 1,
      venue: 'uniswap_v3_arbitrum_weth_usdc_30bps',
      pool_address: '0xc473e2aEE3441BF9240Be85eb122aBB059A3B57c',  // REAL W10A
      tokenIn:  { symbol: 'WETH', decimals: 18 },
      tokenOut: { symbol: 'USDC', decimals: 6  },
      price_out_per_in: 1607.5,      // 1 WETH -> 1607.5 USDC (approx spot + slight edge)
      fee_bps: 30,
      depth_usd: 35170000,           // REAL W10A active-tick depth
      depth_source: 'real_w10a_discovery',
    },
    {
      leg: 2,
      venue: 'camelot_v3_arbitrum_arb_usdc',
      pool_address: '0xfaE2AE0a9f87FD35b5b0E24B47BAC796A7EEfEa1',  // REAL W10A
      tokenIn:  { symbol: 'USDC', decimals: 6  },
      tokenOut: { symbol: 'ARB',  decimals: 18 },
      price_out_per_in: 12.16,       // 1 USDC -> 12.16 ARB (approx 1/0.082 spot)
      fee_bps: 25,                   // Camelot dynamic ~25 bps observed
      depth_usd: 52100,              // REAL W10A active-tick depth
      depth_source: 'real_w10a_discovery',
    },
    {
      leg: 3,
      venue: 'uniswap_v3_arbitrum_arb_weth_30bps',
      pool_address: '0x0000000000000000000000000000000000000000',  // FIXTURE PLACEHOLDER
      tokenIn:  { symbol: 'ARB',  decimals: 18 },
      tokenOut: { symbol: 'WETH', decimals: 18 },
      price_out_per_in: 0.0000525,   // FIXTURE — ~2.6% pure edge for demo
      fee_bps: 30,
      depth_usd: 500000,             // FIXTURE PLACEHOLDER
      depth_source: 'fixture_placeholder',
    },
  ],
  observed_at: '2026-06-05T00:00:00Z',
  fixture_note: [
    'Illustrative triangular cycle.',
    'Legs 1 & 2 use real Wave 10A discovery data (block 470,376,319).',
    'Leg 3 is a fixture — pool address is a zero-placeholder and price is',
    'crafted to yield ~2.6% pure edge for engine demonstration.',
    'Live execution decision requires live quoter output per leg,',
    'live per-leg depth measurement, and Boss ruling.',
  ].join(' '),
};

// ─────────────────────────────────────────────────────────────────────────────
// Cost engine — per-leg execution (TOKEN FLOW, not summed bps)
// ─────────────────────────────────────────────────────────────────────────────
//
// Per Boss C9: propagate token amounts through legs.  Each leg applies its own
// price, fee, and slippage.  USD is only computed at endpoints (Q0 in, Q3 out).
// The per-leg trade-size USD (needed for slippage math) is derived from the
// input token amount × spot USD price of the input token — NOT compounded from
// prior legs.  This correctly preserves any cycle edge that arises from the
// leg-price product.
// ─────────────────────────────────────────────────────────────────────────────

function executeLeg(leg, inputAmount, tokenPricesUsd) {
  const tokenInPriceUsd = tokenPricesUsd[leg.tokenIn.symbol];
  if (tokenInPriceUsd === undefined) {
    throw new Error(`No USD price for token ${leg.tokenIn.symbol}`);
  }
  const tradeSizeUsd = inputAmount * tokenInPriceUsd;

  const feeMultiplier = 1 - (leg.fee_bps / 10000);
  const inputAfterFee = inputAmount * feeMultiplier;

  let slippageBps;
  if (leg.depth_usd > 0) {
    slippageBps = SLIPPAGE_MODEL_COEFFICIENT * (tradeSizeUsd / leg.depth_usd);
  } else {
    slippageBps = Infinity;
  }
  const slippageMultiplier = Math.max(0, 1 - (slippageBps / 10000));

  const nominalOutput = inputAfterFee * leg.price_out_per_in;
  const actualOutput = nominalOutput * slippageMultiplier;

  return {
    inputAmount,
    outputAmount: actualOutput,
    tradeSizeUsd,
    appliedFeeBps: leg.fee_bps,
    appliedSlippageBps: slippageBps,
  };
}

function propagateCycle(cycle, startAmount) {
  const startAssetPriceUsd = cycle.tokenPricesUsd[cycle.startAsset.symbol];
  if (startAssetPriceUsd === undefined) {
    throw new Error(`No USD price for start asset ${cycle.startAsset.symbol}`);
  }
  const startUsdValue = startAmount * startAssetPriceUsd;

  let currentAmount = startAmount;
  const legTrace = [];

  for (const leg of cycle.legs) {
    const result = executeLeg(leg, currentAmount, cycle.tokenPricesUsd);
    legTrace.push({
      leg_index: leg.leg,
      venue: leg.venue,
      tokenIn: leg.tokenIn.symbol,
      tokenOut: leg.tokenOut.symbol,
      inputAmount: result.inputAmount,
      outputAmount: result.outputAmount,
      tradeSizeUsd: result.tradeSizeUsd,
      appliedFeeBps: result.appliedFeeBps,
      appliedSlippageBps: result.appliedSlippageBps,
    });
    currentAmount = result.outputAmount;
  }

  const finalUsdValue = currentAmount * startAssetPriceUsd;

  return {
    startAmount,
    startUsdValue,
    finalAmount: currentAmount,
    finalUsdValue,
    grossReturn: startAmount > 0 ? (currentAmount / startAmount) : 0,
    grossProfitInStartAsset: currentAmount - startAmount,
    grossProfitUsd: finalUsdValue - startUsdValue,
    legTrace,
  };
}

function evaluateSizeUsd(cycle, sizeUsd) {
  const startAssetPriceUsd = cycle.tokenPricesUsd[cycle.startAsset.symbol];
  const startAmount = sizeUsd / startAssetPriceUsd;
  const prop = propagateCycle(cycle, startAmount);

  const gasUsd = cycle.legs.length * GAS_PER_LEG_USD;
  const safetyBufferUsd = sizeUsd * (SAFETY_BUFFER_BPS / 10000);
  const totalCostsUsd = (prop.startUsdValue - prop.finalUsdValue) + gasUsd + safetyBufferUsd;
  const netProfitUsd = prop.grossProfitUsd - gasUsd - safetyBufferUsd;
  const roiPct = sizeUsd > 0 ? (netProfitUsd / sizeUsd) * 100 : 0;

  return {
    sizeUsd,
    startAmount,
    startAmountAsset: cycle.startAsset.symbol,
    grossReturn: prop.grossReturn,
    grossProfitUsd: prop.grossProfitUsd,
    finalAmount: prop.finalAmount,
    finalUsdValue: prop.finalUsdValue,
    gasUsd,
    safetyBufferUsd,
    totalCostsUsd,
    netProfitUsd,
    roiPct,
    profitable: netProfitUsd > 0,
    legTrace: prop.legTrace,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Binding constraint identifier (with bindingLeg telemetry per Boss C9)
// ─────────────────────────────────────────────────────────────────────────────

const BINDING_ENUM = {
  NO_CYCLE_EDGE:     'NO_CYCLE_EDGE',
  LEG_DEPTH:         'LEG_DEPTH',
  LEG_SLIPPAGE:      'LEG_SLIPPAGE',
  SWAP_FEES:         'SWAP_FEES',
  GAS:               'GAS',
  POLICY_CAP:        'POLICY_CAP',
  ATOMICITY:         'ATOMICITY',
  TOKEN_UNSUPPORTED: 'TOKEN_UNSUPPORTED',
  VENUE_UNSUPPORTED: 'VENUE_UNSUPPORTED',
};

function identifyBindingConstraint(cycle, ladder, bestByProfit) {
  if (!cycle.atomic) {
    return { bindingConstraint: BINDING_ENUM.ATOMICITY, bindingLeg: null };
  }

  if (!bestByProfit) {
    const smallestLadder = ladder[0];
    if (!smallestLadder) {
      return { bindingConstraint: BINDING_ENUM.NO_CYCLE_EDGE, bindingLeg: null };
    }

    if (smallestLadder.grossReturn < 1) {
      const legCosts = smallestLadder.legTrace.map(l =>
        l.appliedFeeBps + l.appliedSlippageBps
      );
      const worstLegIdx = legCosts.indexOf(Math.max(...legCosts));
      return {
        bindingConstraint: BINDING_ENUM.NO_CYCLE_EDGE,
        bindingLeg: worstLegIdx + 1,
      };
    }

    const gasKillsSmall = smallestLadder.gasUsd > smallestLadder.grossProfitUsd;
    if (gasKillsSmall) {
      const anyLegSlipHigh = smallestLadder.legTrace.some(l => l.appliedSlippageBps > 50);
      if (!anyLegSlipHigh) {
        return { bindingConstraint: BINDING_ENUM.GAS, bindingLeg: null };
      }
    }

    const largestLadder = ladder[ladder.length - 1];
    const legSlips = largestLadder.legTrace.map(l => l.appliedSlippageBps);
    const worstSlipIdx = legSlips.indexOf(Math.max(...legSlips));
    return {
      bindingConstraint: BINDING_ENUM.LEG_SLIPPAGE,
      bindingLeg: worstSlipIdx + 1,
    };
  }

  const nextUnprofitable = ladder.find(r =>
    r.sizeUsd > bestByProfit.sizeUsd && !r.profitable
  );

  if (nextUnprofitable) {
    const legSlips = nextUnprofitable.legTrace.map(l => l.appliedSlippageBps);
    const maxSlip = Math.max(...legSlips);
    if (maxSlip > 50) {
      const worstSlipIdx = legSlips.indexOf(maxSlip);
      return {
        bindingConstraint: BINDING_ENUM.LEG_SLIPPAGE,
        bindingLeg: worstSlipIdx + 1,
      };
    }
    return { bindingConstraint: BINDING_ENUM.SWAP_FEES, bindingLeg: null };
  }

  const legCaps = cycle.legs.map(l => l.depth_usd);
  const weakestLegIdx = legCaps.indexOf(Math.min(...legCaps));
  return {
    bindingConstraint: BINDING_ENUM.LEG_DEPTH,
    bindingLeg: weakestLegIdx + 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full cycle evaluation
// ─────────────────────────────────────────────────────────────────────────────

function evaluateCycle(cycle) {
  const legCaps = cycle.legs.map(l => l.depth_usd);
  const weakestLegIdx = legCaps.indexOf(Math.min(...legCaps));
  const weakestLegCapUsd = legCaps[weakestLegIdx];
  const cycleCapacityUsd = weakestLegCapUsd;

  const cutoff = cycleCapacityUsd * 2;
  const feasibleLadder = SIZE_LADDER_USD
    .filter(s => s <= cutoff)
    .map(s => evaluateSizeUsd(cycle, s));

  const profitable = feasibleLadder.filter(r => r.profitable);
  const bestByProfit = profitable.length
    ? [...profitable].sort((a, b) => b.netProfitUsd - a.netProfitUsd)[0]
    : null;
  const bestByRoi = profitable.length
    ? [...profitable].sort((a, b) => b.roiPct - a.roiPct)[0]
    : null;
  const smallestProfitable = profitable.length
    ? [...profitable].sort((a, b) => a.sizeUsd - b.sizeUsd)[0]
    : null;
  const largestProfitable = profitable.length
    ? [...profitable].sort((a, b) => b.sizeUsd - a.sizeUsd)[0]
    : null;

  let firstFailureSizeUsd = null;
  for (let i = 0; i < feasibleLadder.length - 1; i++) {
    if (feasibleLadder[i].profitable && !feasibleLadder[i + 1].profitable) {
      firstFailureSizeUsd = feasibleLadder[i + 1].sizeUsd;
      break;
    }
  }
  if (!firstFailureSizeUsd && !profitable.length && feasibleLadder.length) {
    firstFailureSizeUsd = feasibleLadder[0].sizeUsd;
  }

  const triangleExists = !!(Array.isArray(cycle.legs) && cycle.legs.length >= 3
    && cycle.startAsset && cycle.startAsset.symbol);
  const triangleAtomic = cycle.atomic === true;
  const underlyingCycleValid = !!bestByProfit;
  const inventoryEconomic = underlyingCycleValid
    ? (bestByProfit.sizeUsd <= INVENTORY_THRESHOLD_USD)
    : null;

  const opportunityClass = underlyingCycleValid ? ['C'] : [];

  const binding = identifyBindingConstraint(cycle, feasibleLadder, bestByProfit);

  return {
    cycleId: cycle.cycleId,
    chain: cycle.chain,
    chainId: cycle.chainId,
    startAsset: cycle.startAsset.symbol,
    legCount: cycle.legs.length,

    opportunityClass,

    triangleExists,
    triangleAtomic,
    underlyingCycleValid,
    inventoryEconomic,

    underlyingBestByProfit: bestByProfit,
    underlyingBestByRoi: bestByRoi,
    smallestProfitableSizeUsd: smallestProfitable ? smallestProfitable.sizeUsd : null,
    largestProfitableSizeUsd: largestProfitable ? largestProfitable.sizeUsd : null,
    firstFailureSizeUsd,

    cycleCapacityUsd,
    cycleCapacityNote: 'Conservative approximation: weakest-leg USD depth. '
      + 'Real capacity requires per-leg output-of-preceding-leg propagation. '
      + 'Boss C9 Wave 10B c3: v1 acceptable, must be marked as such.',
    weakestLegIndex: weakestLegIdx + 1,
    weakestLegDepthUsd: weakestLegCapUsd,

    bindingConstraint: binding.bindingConstraint,
    bindingLeg: binding.bindingLeg,

    classBHint: {
      startAssetForFinancing: cycle.startAsset.symbol,
      recommendedCapitalUsd: bestByProfit ? bestByProfit.sizeUsd : null,
      recommendedCapitalStartAsset: bestByProfit ? bestByProfit.startAmount : null,
      inventorySufficientForBest: inventoryEconomic,
      note: 'Class C output prepared for Class B consumption. '
        + 'Per Boss C9: Class C does NOT run Aave financing math. '
        + 'Router c6 composes: if !inventorySufficientForBest, invoke Class B '
        + 'to test flash financing, then set opportunityClass = ["C","B"].',
    },

    sizeLadder: feasibleLadder,

    executionAuthorized: false,
    broadcastAuthorized: false,
    capitalMovement: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output builders
// ─────────────────────────────────────────────────────────────────────────────

function buildScanOutput(cycles) {
  const evaluatedCycles = cycles.map(evaluateCycle);
  const opportunityCount = evaluatedCycles.filter(c => c.opportunityClass.length > 0).length;

  return {
    $schema: SCHEMA_VERSION,
    scannedAt: new Date().toISOString(),
    chain: cycles[0] ? cycles[0].chain : 'arbitrum',
    cycleCount: cycles.length,
    opportunityCount,
    constitutional: {
      capitalLocked: true,
      broadcastLocked: true,
      executionLocked: true,
      analyticsOnly: true,
      note: 'Class C is a triangular-cycle analytics engine. '
        + 'No execution, no broadcast, no capital movement. '
        + 'Per Boss C9 Wave 10B: analytics only.',
    },
    cycles: evaluatedCycles,
  };
}

function fmt$(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  const n = Number(x);
  if (Math.abs(n) < 1)     return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1000)  return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${x.toFixed(3)}%`;
}

function renderHumanSummary(output) {
  const L = [];
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(' Class C (Triangular) closed-cycle scanner — v1');
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(` Schema version:  ${output.$schema}`);
  L.push(` Scanned at:      ${output.scannedAt}`);
  L.push(` Chain:           ${output.chain}`);
  L.push(` Cycles:          ${output.cycleCount}`);
  L.push(` Opportunities:   ${output.opportunityCount}`);
  L.push(' Constitutional state:');
  L.push(`   Capital LOCKED:   ${output.constitutional.capitalLocked}`);
  L.push(`   Broadcast LOCKED: ${output.constitutional.broadcastLocked}`);
  L.push(`   Execution LOCKED: ${output.constitutional.executionLocked}`);
  L.push(`   Analytics only:   ${output.constitutional.analyticsOnly}`);

  for (const c of output.cycles) {
    L.push('');
    L.push(` ── ${c.cycleId} ──`);
    L.push(`   Opportunity class:              [${c.opportunityClass.join(', ')}]`);
    L.push('   Cycle-level facts:');
    L.push(`     TRIANGLE_EXISTS:              ${c.triangleExists}`);
    L.push(`     TRIANGLE_ATOMIC:              ${c.triangleAtomic}`);
    L.push(`     UNDERLYING_CYCLE_VALID:       ${c.underlyingCycleValid}`);
    L.push(`     INVENTORY_ECONOMIC:           ${c.inventoryEconomic === null ? 'n/a' : c.inventoryEconomic}`);
    L.push('   Cycle capacity (conservative):');
    L.push(`     Cycle capacity USD:           ${fmt$(c.cycleCapacityUsd)}`);
    L.push(`     Weakest leg:                  leg ${c.weakestLegIndex} (${fmt$(c.weakestLegDepthUsd)})`);

    if (c.underlyingBestByProfit) {
      L.push('   Best by net profit:');
      L.push(`     Size:                         ${fmt$(c.underlyingBestByProfit.sizeUsd)}`);
      L.push(`     Net profit:                   ${fmt$(c.underlyingBestByProfit.netProfitUsd)}`);
      L.push(`     ROI:                          ${fmtPct(c.underlyingBestByProfit.roiPct)}`);
      L.push(`     Gross return:                 ${c.underlyingBestByProfit.grossReturn.toFixed(6)}`);
    } else {
      L.push('   Best by net profit:             none (no size profitable)');
    }

    if (c.underlyingBestByRoi) {
      L.push('   Best by ROI:');
      L.push(`     Size:                         ${fmt$(c.underlyingBestByRoi.sizeUsd)}`);
      L.push(`     ROI:                          ${fmtPct(c.underlyingBestByRoi.roiPct)}`);
      L.push(`     Net profit:                   ${fmt$(c.underlyingBestByRoi.netProfitUsd)}`);
    }

    L.push('   Ladder summary:');
    L.push(`     Smallest profitable:          ${c.smallestProfitableSizeUsd === null ? 'none' : fmt$(c.smallestProfitableSizeUsd)}`);
    L.push(`     Largest profitable:           ${c.largestProfitableSizeUsd === null ? 'none' : fmt$(c.largestProfitableSizeUsd)}`);
    L.push(`     First failure size:           ${c.firstFailureSizeUsd === null ? 'n/a' : fmt$(c.firstFailureSizeUsd)}`);

    L.push('   Binding diagnosis:');
    L.push(`     Binding constraint:           ${c.bindingConstraint}`);
    L.push(`     Binding leg:                  ${c.bindingLeg === null ? 'n/a' : `leg ${c.bindingLeg}`}`);

    L.push('   Class B composition hint:');
    L.push(`     Start asset for financing:    ${c.classBHint.startAssetForFinancing}`);
    L.push(`     Recommended capital USD:      ${c.classBHint.recommendedCapitalUsd === null ? 'n/a' : fmt$(c.classBHint.recommendedCapitalUsd)}`);
    L.push(`     Inventory sufficient:         ${c.classBHint.inventorySufficientForBest === null ? 'n/a' : c.classBHint.inventorySufficientForBest}`);

    L.push('   Execution authorized:           false');
  }

  L.push('');
  L.push(' ── Interpretation ──');
  L.push('   Class C evaluates closed-loop token cycles for triangular arb.');
  L.push('   Fixture uses real Wave 10A leg 1 & 2 data + fixture leg 3.');
  L.push('   Live execution requires: live per-leg quotes, live depth, Boss ruling.');
  L.push('');
  L.push(' Capital LOCKED. Proven winner UNTOUCHED. Broadcast LOCKED.');
  L.push(' Class C is a cycle-primitive analytics engine. Composition with');
  L.push(' Class B happens in c6 Opportunity Router, not inside C.');
  L.push('');

  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const cycles = [FIXTURE_CYCLE_WETH_USDC_ARB];
  const output = buildScanOutput(cycles);

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.stderr.write(renderHumanSummary(output) + '\n');
}

main();
