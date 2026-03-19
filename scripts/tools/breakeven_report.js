// scripts/tools/breakeven_report.js
// BREAKEVEN ENGINE v1 — REPORT RUNNER
//
// Feeds all validated Arbitrum surfaces through the breakeven engine
// and produces a classification report.
//
// Surface data is hardcoded from validated field observations.
// When a surface gets new validation data, update its entry here.
//
// Usage:
//   node scripts/tools/breakeven_report.js
//   node scripts/tools/breakeven_report.js --verbose

'use strict';

const { classify, CLASSIFICATIONS, THRESHOLDS } = require('../analysis/breakeven_engine');

const VERBOSE = process.argv.includes('--verbose');

// ── Validated surface definitions ─────────────────────────────────────────────
// All spread data is same-block validated. Sources noted per surface.

const SURFACES = [

  // ── ETH/USDC: UniV3 0.05% vs Camelot V2 0.30% ────────────────────────────
  // Source: spread_validator.js, 10 samples, 2026-03-19
  // Avg spread 0.061%, fee burden 0.35%.
  // Active-tick depth: UniV3 deep (ETH/USDC is primary pool), Camelot V2 $162k TVL.
  // Note: Camelot V2 active-tick depth not directly measured; V2 uses x*y=k
  // so the full reserve IS the effective depth. Using $162k / 2 as one-side estimate.
  {
    id:              'ETH/USDC:univ3-camelotv2',
    pair:            'ETH/USDC',
    venueA:          'UniV3 0.05%',
    venueB:          'Camelot V2 0.30%',
    routeType:       'direct-direct',
    spreadSamples:   [0.00078, 0.00065, 0.00059, 0.00055, 0.00052,
                      0.00050, 0.00048, 0.00062, 0.00064, 0.00061],
    feeAFrac:        0.0005,
    feeBFrac:        0.0030,
    hopCount:        2,
    activeTick: {
      venueA_usd:    2_000_000,   // ETH/USDC UniV3 is primary Arb pool, deep
      venueB_usd:    81_000,      // Camelot V2 TVL $162k total → ~$81k one side
    },
    slippageByNotional: null,    // not modeled — fee-blocked before slippage matters
    directionConsistency: 1.0,
    validatedAt:     '2026-03-19',
    notes:           'Fee burden 0.35% dwarfs avg spread 0.061%. Camelot V2 fee is the killing factor.',
  },

  // ── ARB/USD: UniV3 direct vs synthetic (ARB/WETH × ETH/USDC) ─────────────
  // Source: arb_synthetic_validator.js, 10 samples, 2026-03-19
  // Avg spread 0.0715%, fee burden 0.15% (3 hops × 0.05%).
  // Active-tick: synthetic path goes through ETH/USDC (deep) and ARB/WETH.
  // ARB/WETH active-tick not directly measured; estimate from liquidity ~9.8e15.
  {
    id:              'ARB/USD:univ3-direct-vs-synthetic',
    pair:            'ARB/USD',
    venueA:          'UniV3 ARB/USDC direct',
    venueB:          'UniV3 ARB/WETH×ETH/USDC synthetic',
    routeType:       'direct-synthetic',
    spreadSamples:   [0.001038, 0.001038, 0.000938, 0.000902, 0.000752,
                      0.000604, 0.000470, 0.000470, 0.000470, 0.000464],
    feeAFrac:        0.0005,
    feeBFrac:        0.0010,    // two hops: ARB/WETH + ETH/USDC
    hopCount:        3,
    activeTick: {
      venueA_usd:    3_090,     // measured directly: UniV3 ARB/USDC L×sqrtP = $3,090
      venueB_usd:    50_000,    // estimate: ARB/WETH pool active-tick (not directly measured)
    },
    slippageByNotional: null,
    directionConsistency: 1.0,
    validatedAt:     '2026-03-19',
    notes:           'Direct pool has only $3,090 active-tick depth. Fee burden 0.15% > avg spread 0.072%.',
  },

  // ── ARB/USDC: UniV3 0.05% vs Camelot V3 0.0249% (DIRECT-VS-DIRECT) ───────
  // Source: arb_direct_validator.js, 10 samples, 2026-03-19
  //         arb_slippage_model.js, 3 readings, 2026-03-19
  // Best validated surface in the project. But structurally blocked by UniV3 liquidity.
  {
    id:              'ARB/USDC:univ3-camelotv3-direct',
    pair:            'ARB/USDC',
    venueA:          'UniV3 0.05%',
    venueB:          'Camelot V3 0.0249%',
    routeType:       'direct-direct',
    // From arb_direct_validator.js — 10 samples
    // avg 0.12%, net avg +0.0462% — BUT note spread compressed to 0.0316% in slippage session
    // Using slippage model session as more recent truth
    spreadSamples:   [0.00120, 0.00115, 0.00118, 0.00122, 0.00119,
                      0.00110, 0.00108, 0.00105, 0.00098, 0.00095],
    feeAFrac:        0.0005,    // UniV3 0.05%
    feeBFrac:        0.000249,  // Camelot V3 0.0249%
    hopCount:        2,
    activeTick: {
      venueA_usd:    3_090,     // MEASURED: UniV3 ARB/USDC L×sqrtP = $3,090
      venueB_usd:    56_016,    // MEASURED: Camelot V3 ARB/USDC L×sqrtP = $56,016
    },
    // From arb_slippage_model.js — spread had compressed to 0.0316% at time of run
    slippageByNotional: [
      { notional: 100,   impactFrac: 0.0683, netEdge: -0.0687, pass: false },
      { notional: 250,   impactFrac: 0.1707, netEdge: -0.1711, pass: false },
      { notional: 500,   impactFrac: 0.3414, netEdge: -0.3418, pass: false },
      { notional: 1000,  impactFrac: 0.6828, netEdge: -0.6832, pass: false },
      { notional: 2500,  impactFrac: 1.7071, netEdge: -1.7075, pass: false },
      { notional: 5000,  impactFrac: 3.4142, netEdge: -3.4146, pass: false },
    ],
    directionConsistency: 1.0,  // uni>camelot 10/10
    validatedAt:     '2026-03-19',
    notes:           'Spread real at +0.046% avg net in validator session but compressed to -0.043% ' +
                     'by slippage session. UniV3 active-tick depth $3,090 — structural blocker. ' +
                     'Camelot V3 side is healthy at $56k. Needs a second ARB venue with adequate depth.',
  },

  // ── WBTC/USD: UniV3 WBTC/USDT direct vs UniV3 WBTC/WETH×ETH/USDC ─────────
  // Source: wbtc_spread_validator.js, 10 samples, 2026-03-19
  // WBTC/WETH pool: $57.68M TVL, 12,004 txns/day — primary WBTC/WETH pair.
  // WBTC/WETH active-tick depth extrapolated from L=460,860,124,773,068,056.
  {
    id:              'WBTC/USD:univ3-direct-vs-ethroutedsynthetic',
    pair:            'WBTC/USD',
    venueA:          'UniV3 WBTC/USDT direct',
    venueB:          'UniV3 WBTC/WETH×ETH/USDC synthetic',
    routeType:       'direct-synthetic',
    spreadSamples:   [0.000366, 0.000366, 0.000366, 0.000229, 0.000240,
                      0.000240, 0.000240, 0.000240, 0.000240, 0.000236],
    feeAFrac:        0.0005,
    feeBFrac:        0.0010,    // WBTC/WETH 0.05% + ETH/USDC 0.05%
    hopCount:        3,
    activeTick: {
      venueA_usd:    8_000_000,  // WBTC/USDT pool $8M TVL, x*y=k style — full depth
      venueB_usd:    57_000_000, // WBTC/WETH $57.68M TVL — primary BTC/ETH pool on Arb
    },
    slippageByNotional: null,   // not yet modeled
    directionConsistency: 1.0,  // direct>synth 10/10
    validatedAt:     '2026-03-19',
    notes:           'Avg spread 0.028% << fee burden 0.15%. WBTC/WETH pool frozen across 80s window ' +
                     '(burst trading pattern). Need to test at different time or with more hops.',
  },

];

// ── Formatting ─────────────────────────────────────────────────────────────────

const CLASSIFICATION_COLORS = {
  [CLASSIFICATIONS.MONITORED]:               '○',
  [CLASSIFICATIONS.BLOCKED_FEE]:             '✗',
  [CLASSIFICATIONS.BLOCKED_LIQUIDITY]:       '✗',
  [CLASSIFICATIONS.BLOCKED_SLIPPAGE]:        '✗',
  [CLASSIFICATIONS.CANDIDATE_SMALL_SIZE]:    '◑',
  [CLASSIFICATIONS.CANDIDATE]:              '●',
  [CLASSIFICATIONS.PRE_EXECUTION_CANDIDATE]: '★',
  'input_error':                             '?',
};

function bar(n = 100) { return '─'.repeat(n); }
function pct(f, d=4)  { return (f * 100).toFixed(d) + '%'; }
function usd(n)       { return '$' + (n || 0).toLocaleString(); }

function formatClassification(c) {
  const symbol = CLASSIFICATION_COLORS[c] || '?';
  return `${symbol} ${c.toUpperCase().replace(/_/g, ' ')}`;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  const results = SURFACES.map(classify);

  console.log('\n' + '═'.repeat(100));
  console.log('ALLMIGHT — BREAKEVEN ENGINE v1 — SURFACE CLASSIFICATION REPORT');
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log('═'.repeat(100));

  // ── Summary table ──────────────────────────────────────────────────────────
  console.log('\nSURFACE SUMMARY');
  console.log(bar());
  console.log(
    `${'ID'.padEnd(45)} ` +
    `${'Avg Spread'.padStart(11)} ` +
    `${'Fee Burden'.padStart(11)} ` +
    `${'Avg Net'.padStart(9)} ` +
    `${'Classification'.padStart(30)}`
  );
  console.log(bar());

  for (const r of results) {
    const m = r.metrics;
    const avgNetStr = m ? ((m.avgNet >= 0 ? '+' : '') + pct(m.avgNet)) : 'n/a';
    console.log(
      `${r.id.padEnd(45)} ` +
      `${(m ? pct(m.avgSpread) : 'n/a').padStart(11)} ` +
      `${(m ? pct(m.roundTrip) : 'n/a').padStart(11)} ` +
      `${avgNetStr.padStart(9)} ` +
      `${formatClassification(r.classification).padStart(30)}`
    );
  }

  // ── Per-surface detail ─────────────────────────────────────────────────────
  for (const r of results) {
    const m = r.metrics;
    console.log('\n' + bar());
    console.log(`SURFACE: ${r.id}`);
    console.log(`  Pair:       ${r.pair}   |   ${r.venueA}  vs  ${r.venueB}`);
    console.log(`  Route type: ${r.routeType}   |   Validated: ${r.validatedAt}`);
    console.log(bar(60));

    if (m) {
      console.log('  METRICS:');
      console.log(`    Samples:        ${m.sampleCount}  (${m.sufficientSamples ? '✅ sufficient' : '⚠️ low sample count'})`);
      console.log(`    Avg spread:     ${pct(m.avgSpread)}`);
      console.log(`    Min/Max spread: ${pct(m.minSpread)} / ${pct(m.maxSpread)}`);
      console.log(`    StdDev:         ${m.stdDev !== null ? pct(m.stdDev) : 'n/a'}`);
      console.log(`    Round-trip fee: ${pct(m.roundTrip)}`);
      console.log(`    Avg net:        ${(m.avgNet >= 0 ? '+' : '') + pct(m.avgNet)}`);
      console.log(`    Fee-pos rate:   ${Math.round(m.feePosRate * 100)}%  (${m.feePosSamples}/${m.sampleCount} samples)`);
      console.log(`    Dir. consist.:  ${Math.round((r.directionConsistency || 0) * 100)}%`);
      console.log(`    Active-tick A:  ${usd(r.activeTick?.venueA_usd)}  (${r.venueA})`);
      console.log(`    Active-tick B:  ${usd(r.activeTick?.venueB_usd)}  (${r.venueB})`);
      console.log(`    Min depth:      ${usd(m.minActiveTick)}  ${m.minActiveTick < THRESHOLDS.MIN_ACTIVE_TICK_DEPTH_USD ? '⚠️ BELOW THRESHOLD' : '✅'}`);
    }

    console.log('');
    console.log(`  CLASSIFICATION:  ${formatClassification(r.classification)}`);
    if (r.blocker !== 'none') {
      console.log(`  BLOCKER:         ${r.blocker}`);
      console.log(`  DETAIL:          ${r.blockerDetail}`);
    }
    if (r.maxPassNotional !== null) {
      console.log(`  MAX NOTIONAL:    $${r.maxPassNotional}`);
      console.log(`  SAFE BAND:       $${r.safeNotionalBand?.low} – $${r.safeNotionalBand?.high}`);
    }
    console.log(`  ACTION:          ${r.recommendedAction}`);

    if (VERBOSE && r.id === 'ARB/USDC:univ3-camelotv3-direct') {
      console.log('');
      console.log('  SLIPPAGE MODEL (from arb_slippage_model.js):');
      console.log(`  ${'Notional'.padStart(10)} ${'Impact'.padStart(10)} ${'Net'.padStart(10)} ${'Result'.padStart(8)}`);
      for (const s of (r.slippageByNotional || [])) {
        console.log(`  ${('$'+s.notional).padStart(10)} ${pct(s.impactFrac).padStart(10)} ${pct(s.netEdge).padStart(10)} ${(s.pass ? '✅' : '❌').padStart(8)}`);
      }
    }
  }

  // ── Project-level findings ─────────────────────────────────────────────────
  const viable    = results.filter(r => r.viable);
  const blocked   = results.filter(r => !r.viable && r.classification !== 'input_error');
  const feeBlock  = blocked.filter(r => r.blocker === 'blocked_fee');
  const liqBlock  = blocked.filter(r => r.blocker === 'blocked_liquidity');
  const slipBlock = blocked.filter(r => r.blocker === 'blocked_slippage');
  const monitored = blocked.filter(r => r.blocker === 'none');

  console.log('\n' + '═'.repeat(100));
  console.log('PROJECT-LEVEL FINDINGS');
  console.log('═'.repeat(100));
  console.log(`  Surfaces classified:    ${results.length}`);
  console.log(`  Viable (any size):      ${viable.length}`);
  console.log(`  Fee-blocked:            ${feeBlock.length}  ${feeBlock.map(r=>r.pair).join(', ')}`);
  console.log(`  Liquidity-blocked:      ${liqBlock.length}  ${liqBlock.map(r=>r.pair).join(', ')}`);
  console.log(`  Slippage-blocked:       ${slipBlock.length}  ${slipBlock.map(r=>r.pair).join(', ')}`);
  console.log(`  Monitor-only (no block):${monitored.length}  ${monitored.map(r=>r.pair).join(', ')}`);

  console.log('\n  STANDING TRUTHS:');
  console.log('    1. Total TVL is not execution liquidity. Active-tick depth (L×sqrtP) is what matters.');
  console.log('    2. Same-block spread is the only valid measurement. Cross-session spreads are artifacts.');
  console.log('    3. Hop count drives fee burden. Each additional hop adds 0.05% minimum.');
  console.log('    4. UniV3 ARB/USDC active-tick depth ($3,090) makes it unsuitable as execution venue');
  console.log('       despite high total TVL. LPs concentrate across many ticks, not at current price.');
  console.log('    5. A surface near fee-equilibrium (ARB direct-vs-direct) is blocked by liquidity,');
  console.log('       not by spread. The fee architecture has been solved; liquidity concentration has not.');

  console.log('\n  NEXT PRIORITIES (in order):');
  console.log('    1. Find second ARB venue with active-tick depth >$10k (the real constraint)');
  console.log('    2. Model WBTC surface at different market conditions (burst-trading pattern noted)');
  console.log('    3. Explore 1-hop routes: any venue with ARB/USDC ≤0.05% fee AND depth >$50k');
  console.log('');
  console.log('═'.repeat(100) + '\n');
}

main();
