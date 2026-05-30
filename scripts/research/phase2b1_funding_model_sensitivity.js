#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Phase 2B.1 Funding Model Sensitivity Study :: eth_usdc_ramses
//  PLACEMENT: scripts/research/phase2b1_funding_model_sensitivity.js
//  STATUS:    Boss "Phase 2B.1" approved — READ-ONLY controlled experiment
//
//  ┌───────────────────────────────────────────────────────────────────────┐
//  │  CONTROLLED-VARIABLE EXPERIMENT. The surface, the venues, the pool fees, │
//  │  the gas, the slippage — all held fixed. The ONLY variable is the       │
//  │  funding model: flash-loan (Aave 5bp) vs inventory (own balance sheet). │
//  │                                                                         │
//  │  Question:  "What does inventory funding do to a WINNER?"               │
//  │             (not "can inventory rescue a loser" — that was Phase 2A.2)  │
//  │                                                                         │
//  │  Hypothesis: the delta IS the Aave fee. The interesting number is the   │
//  │              MARGIN UPLIFT RATIO at each spread bucket — and how that   │
//  │              ratio shrinks as raw margin grows.                         │
//  └───────────────────────────────────────────────────────────────────────┘
//
//  CONSTRAINTS (Boss Phase 2B.1)
//    - READ-ONLY analysis. No execution. No capital deployment. No promotion.
//    - No surface config mutation. (Existing realisticBreakevenBps preserved.)
//    - NOT COMPARABLE TO either standalone scorer's surfaceScore — this is
//      a side-by-side funding-model comparison, a different reporting class.
//    - Components below are PHYSICS-DERIVED research assumptions, documented
//      and consistent between the two models (so the delta isolates funding).
//
//  USAGE
//    node scripts/research/phase2b1_funding_model_sensitivity.js
//    node scripts/research/phase2b1_funding_model_sensitivity.js --json
//    node scripts/research/phase2b1_funding_model_sensitivity.js --self-test
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACE_FILE = path.join(REPO, 'surfaces', 'eth_usdc_ramses.json');
const OUT_DIR      = path.join(REPO, 'logs', 'project_metrics');
const OUT_JSON     = path.join(OUT_DIR, 'funding_model_sensitivity.json');
const OUT_TXT      = path.join(OUT_DIR, 'funding_model_sensitivity.txt');

// ─── deterministic components (RESEARCH ASSUMPTIONS — documented + consistent) ───
// Held identical between flash and inventory so the comparison isolates funding.
// Sourced from:
//   - venue fees: eth_usdc_ramses.json venues array (uni 1bp + ramses 5bp)
//   - aaveFeeBps: Boss-approved (Inventory Mode v1)
//   - estimatedSlipBps: ETC baseline reference (flagged: estimate, not measured)
//   - gasUsdPerTx: Boss-approved arbitrum estimate
//   - gasUnitsRef: industry-standard arb tx (~450k gas)
function loadComponents(surface) {
  // venue fees pulled from the surface's declared venues (single source of truth)
  const venueFeeBps = (surface.venues || []).reduce((s, v) => s + Number(v.feeBps || 0), 0);
  return {
    venueFeeBps,                          // 6 bp from uni(1) + ramses(5)
    aaveFeeBps        : 5,                // flash-only; the controlled variable
    estimatedSlipBps  : 4.3,              // ETC baseline; estimate, not measured
    gasUsdPerTx       : 0.20,             // Boss-approved arbitrum estimate
    gasUnitsRef       : 450000,           // standard arb tx
    componentSources  : {
      venueFeeBps      : 'surface.venues.feeBps (uni 1 + ramses 5)',
      aaveFeeBps       : 'Boss Inventory Mode v1 (flash-only)',
      estimatedSlipBps : 'ETC baseline reference (estimate, NOT measured)',
      gasUsdPerTx      : 'Boss arbitrum estimate (estimated)',
    },
  };
}

const SIZES = [1000, 10000, 100000];
const REFERENCE_SIZE = 10000;

// ─── pure math: per-funding-model breakeven (size-aware) ────────────────────
function gasBpsAtSize(gasUsd, sizeUsd) {
  return sizeUsd > 0 ? +((gasUsd / sizeUsd) * 10000).toFixed(6) : 0;
}

function flashBreakevenBps(c, sizeUsd) {
  return +(c.venueFeeBps + c.aaveFeeBps + c.estimatedSlipBps + gasBpsAtSize(c.gasUsdPerTx, sizeUsd)).toFixed(4);
}

function inventoryBreakevenBps(c, sizeUsd) {
  // identical to flash MINUS aaveFeeBps (the entire experimental variable)
  return +(c.venueFeeBps + c.estimatedSlipBps + gasBpsAtSize(c.gasUsdPerTx, sizeUsd)).toFixed(4);
}

// ─── side-by-side rows ──────────────────────────────────────────────────────
function buildBreakevenTable(c) {
  return SIZES.map(sz => {
    const fl = flashBreakevenBps(c, sz);
    const inv = inventoryBreakevenBps(c, sz);
    return {
      sizeUsd          : sz,
      flashBreakeven   : fl,
      inventoryBreakeven: inv,
      delta            : +(fl - inv).toFixed(4),       // should ALWAYS equal aaveFeeBps
    };
  });
}

function buildMarginTable(c, spreadBuckets, sizeUsd) {
  return spreadBuckets.map(b => {
    const fl = flashBreakevenBps(c, sizeUsd);
    const inv = inventoryBreakevenBps(c, sizeUsd);
    const flashMargin = +(b.spreadBps - fl).toFixed(4);
    const invMargin   = +(b.spreadBps - inv).toFixed(4);
    let uplift = null;
    if (flashMargin > 0 && invMargin > 0) {
      uplift = +(invMargin / flashMargin).toFixed(4);
    } else if (flashMargin <= 0 && invMargin > 0) {
      uplift = 'INFINITE (flash unviable, inventory viable)';
    } else if (flashMargin <= 0 && invMargin <= 0) {
      uplift = 'N/A (both negative)';
    }
    const deltaMargin = +(invMargin - flashMargin).toFixed(4);
    return {
      bucket           : b.name,
      spreadBps        : b.spreadBps,
      flashMarginBps   : flashMargin,
      inventoryMarginBps: invMargin,
      deltaBps         : deltaMargin,    // always = aaveFeeBps (controlled variable)
      upliftRatio      : uplift,
    };
  });
}

// ─── analysis ───────────────────────────────────────────────────────────────
function analyze(surface) {
  const c = loadComponents(surface);
  const breakevenTable = buildBreakevenTable(c);
  // spread buckets from the surface config (no fabrication, no Boss-mutation)
  const spreadBuckets = [
    { name: 'realisticBreakeven', spreadBps: Number(surface.realisticBreakevenBps) },
    { name: 'minSpread',          spreadBps: Number(surface.minSpreadBps) },
    { name: 'preferredSpread',    spreadBps: Number(surface.preferredSpreadBps) },
    { name: 'eliteSpread',        spreadBps: Number(surface.eliteSpreadBps) },
  ].filter(b => isFinite(b.spreadBps));
  const marginTable = buildMarginTable(c, spreadBuckets, REFERENCE_SIZE);

  // headline numbers at preferred spread @ reference size
  const preferred = marginTable.find(r => r.bucket === 'preferredSpread') || marginTable[0];

  return {
    generatedAt          : new Date().toISOString(),
    phase                : '2B.1',
    studyName            : 'Funding Model Sensitivity Study',
    surface              : {
      surfaceId       : surface.surfaceId,
      chainScopedId   : surface.chainScopedId,
      displayName     : surface.displayName,
      chain           : surface.chain,
      venues          : (surface.venues || []).map(v => ({ name: v.name, feeBps: v.feeBps })),
    },
    components           : c,
    referenceSizeUsd     : REFERENCE_SIZE,
    breakevenTable,
    marginTable,
    headline             : preferred ? {
      bucket            : preferred.bucket,
      spreadBps         : preferred.spreadBps,
      flashMarginBps    : preferred.flashMarginBps,
      inventoryMarginBps: preferred.inventoryMarginBps,
      deltaBps          : preferred.deltaBps,
      upliftRatio       : preferred.upliftRatio,
    } : null,
    notes                : [
      'Controlled-variable experiment: only funding model changes between rows.',
      'Delta column equals aaveFeeBps by construction; this confirms isolation.',
      'Uplift ratio shrinks as spread grows (fixed-cost amortization at scale).',
      'NOT comparable to surface_score.js or surface_score_inventory.js as scores.',
      'No execution, no promotion, no capital deployment.',
    ],
  };
}

// ─── reporting ──────────────────────────────────────────────────────────────
function pad(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }

function buildTextReport(a) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push('  AllMight — Phase 2B.1 Funding Model Sensitivity Study  READ-ONLY');
  L.push('  Controlled experiment: same surface, same economics, only funding model changes.');
  L.push(`  generatedAt: ${a.generatedAt}`);
  L.push(`  surface: ${a.surface.displayName}  [${a.surface.surfaceId}]`);
  L.push(`  economic id: ${a.surface.chainScopedId}`);
  L.push(`  venues: ${a.surface.venues.map(v => `${v.name}(${v.feeBps}bp)`).join(' + ')}`);
  L.push(bar);
  L.push('');
  L.push('  COMPONENTS (held identical between flash and inventory)');
  const c = a.components;
  L.push(`    venueFeeBps        ${c.venueFeeBps}     [${c.componentSources.venueFeeBps}]`);
  L.push(`    aaveFeeBps         ${c.aaveFeeBps}      [${c.componentSources.aaveFeeBps}]`);
  L.push(`    estimatedSlipBps   ${c.estimatedSlipBps}    [${c.componentSources.estimatedSlipBps}]`);
  L.push(`    gasUsdPerTx        $${c.gasUsdPerTx}    [${c.componentSources.gasUsdPerTx}]`);
  L.push(`    gasUnitsRef        ${c.gasUnitsRef}`);
  L.push('');
  L.push('  BREAKEVEN COMPARISON (per size; delta = controlled variable = aaveFeeBps)');
  L.push('    size       flash_be    inventory_be    delta');
  for (const r of a.breakevenTable) {
    L.push(
      '    $' + pad((r.sizeUsd / 1000) + 'k', 6) + '   ' +
      pad(r.flashBreakeven, 7) + '     ' +
      pad(r.inventoryBreakeven, 7) + '      ' +
      pad(r.delta, 5)
    );
  }
  L.push('');
  L.push(`  MARGIN COMPARISON (at reference size $${a.referenceSizeUsd / 1000}k; deltaBps always = aaveFeeBps)`);
  L.push('    bucket               spread   flash_margin    inv_margin     delta    uplift_ratio');
  for (const r of a.marginTable) {
    L.push(
      '    ' + pad(r.bucket, 20) + '  ' +
      pad(r.spreadBps, 5) + '    ' +
      pad((r.flashMarginBps >= 0 ? '+' : '') + r.flashMarginBps, 8) + '       ' +
      pad((r.inventoryMarginBps >= 0 ? '+' : '') + r.inventoryMarginBps, 7) + '     ' +
      pad((r.deltaBps >= 0 ? '+' : '') + r.deltaBps, 5) + '   ' +
      pad(String(r.upliftRatio === null ? 'n/a' : (typeof r.upliftRatio === 'number' ? r.upliftRatio + 'x' : r.upliftRatio)), 12)
    );
  }
  L.push('');
  if (a.headline) {
    const h = a.headline;
    L.push('  HEADLINE (at preferred spread, reference size)');
    L.push(`    spread ${h.spreadBps} bp:  flash margin +${h.flashMarginBps}  inventory margin +${h.inventoryMarginBps}  uplift ${h.upliftRatio}x`);
    L.push('');
  }
  L.push(bar);
  L.push('  NOTES');
  for (const n of a.notes) L.push(`  - ${n}`);
  L.push(bar);
  return L.join('\n');
}

function main() {
  const jsonMode = process.argv.includes('--json');
  let surface;
  try { surface = JSON.parse(fs.readFileSync(SURFACE_FILE, 'utf8')); }
  catch (e) { console.error(`[2b.1] cannot read ${SURFACE_FILE}: ${e.message}`); process.exit(1); }
  const a = analyze(surface);
  if (jsonMode) { console.log(JSON.stringify(a, null, 2)); return; }
  const txt = buildTextReport(a);
  console.log(txt);
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(a, null, 2));
    fs.writeFileSync(OUT_TXT, txt + '\n');
    console.log(`\n[2b.1] wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_TXT)}`);
  } catch (e) {
    console.error(`[2b.1] could not write artifacts: ${e.message}`);
  }
}

// ─── SELF-TEST (pure math; no fs, no Redis) ─────────────────────────────────
function selfTest() {
  const approx = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
  const cases = [];

  // mock surface mirroring eth_usdc_ramses.json structure
  const surface = {
    surfaceId: 'eth_usdc_ramses', chainScopedId: 'arbitrum:ETH/USDC:ramses_uni',
    displayName: 'ETH/USDC — Ramses V2', chain: 'arbitrum',
    venues: [{ name: 'uniswap_v3', feeBps: 1 }, { name: 'ramses_v2', feeBps: 5 }],
    realisticBreakevenBps: 17.4, minSpreadBps: 22, preferredSpreadBps: 24, eliteSpreadBps: 26,
  };
  const c = loadComponents(surface);
  cases.push(['venueFeeBps derived from venues = 6', c.venueFeeBps === 6]);
  cases.push(['aaveFeeBps = 5',                       c.aaveFeeBps === 5]);

  // breakeven math @ $10k: flash = 6+5+4.3+0.2 = 15.5  inventory = 6+4.3+0.2 = 10.5
  cases.push(['flash be @10k = 15.5',     approx(flashBreakevenBps(c, 10000), 15.5)]);
  cases.push(['inventory be @10k = 10.5', approx(inventoryBreakevenBps(c, 10000), 10.5)]);
  cases.push(['delta @10k = 5.0 = aave',  approx(flashBreakevenBps(c, 10000) - inventoryBreakevenBps(c, 10000), 5.0)]);

  // breakeven @ $1k: flash = 6+5+4.3+2.0 = 17.3   inventory = 6+4.3+2.0 = 12.3
  cases.push(['flash be @1k = 17.3',      approx(flashBreakevenBps(c, 1000), 17.3)]);
  cases.push(['inventory be @1k = 12.3',  approx(inventoryBreakevenBps(c, 1000), 12.3)]);
  cases.push(['delta @1k still = 5.0 (aave size-independent)',
    approx(flashBreakevenBps(c, 1000) - inventoryBreakevenBps(c, 1000), 5.0)]);

  // breakeven @ $100k
  cases.push(['flash be @100k = 15.32',   approx(flashBreakevenBps(c, 100000), 15.32)]);
  cases.push(['inventory be @100k = 10.32', approx(inventoryBreakevenBps(c, 100000), 10.32)]);

  // analyze end-to-end
  const a = analyze(surface);
  cases.push(['analyze: 4 spread buckets',  a.marginTable.length === 4]);
  // preferred spread 24: flash margin 24-15.5=+8.5, inv 24-10.5=+13.5, uplift 13.5/8.5=1.588x
  const pref = a.marginTable.find(r => r.bucket === 'preferredSpread');
  cases.push(['preferred flash margin = +8.5',  approx(pref.flashMarginBps, 8.5)]);
  cases.push(['preferred inv margin = +13.5',   approx(pref.inventoryMarginBps, 13.5)]);
  cases.push(['preferred uplift ≈ 1.588',       approx(pref.upliftRatio, 1.588, 0.01)]);
  // min spread 22: flash 22-15.5=+6.5, inv 22-10.5=+11.5, uplift 11.5/6.5≈1.769
  const minB = a.marginTable.find(r => r.bucket === 'minSpread');
  cases.push(['min flash margin = +6.5',        approx(minB.flashMarginBps, 6.5)]);
  cases.push(['min uplift ≈ 1.769',             approx(minB.upliftRatio, 1.769, 0.01)]);
  // elite spread 26: flash 26-15.5=+10.5, inv 26-10.5=+15.5, uplift 15.5/10.5≈1.476
  const eli = a.marginTable.find(r => r.bucket === 'eliteSpread');
  cases.push(['elite uplift ≈ 1.476',           approx(eli.upliftRatio, 1.476, 0.01)]);
  // realisticBreakeven 17.4: flash margin 17.4-15.5=+1.9, inv 17.4-10.5=+6.9, uplift 6.9/1.9≈3.63
  const realB = a.marginTable.find(r => r.bucket === 'realisticBreakeven');
  cases.push(['realisticBE uplift ~3.63 (huge near floor)', approx(realB.upliftRatio, 3.63, 0.02)]);

  // delta column always = aave (controlled-variable assertion)
  cases.push(['ALL delta rows == aaveFeeBps (5)',
    a.marginTable.every(r => approx(r.deltaBps, 5.0))]);
  cases.push(['ALL breakeven delta rows == aave (5)',
    a.breakevenTable.every(r => approx(r.delta, 5.0))]);

  // labeling
  cases.push(['phase = 2B.1',                  a.phase === '2B.1']);
  cases.push(['NOT comparable note present',
    a.notes.some(n => /NOT comparable/i.test(n))]);

  // edge case: spread below flash breakeven (flash negative, inv may still be positive)
  const surfNeg = { ...surface, minSpreadBps: 12 };  // below flash be (15.5) but above inv (10.5)
  const a2 = analyze(surfNeg);
  const minNeg = a2.marginTable.find(r => r.bucket === 'minSpread');
  cases.push(['flash negative when spread below flash be', minNeg.flashMarginBps < 0]);
  cases.push(['inventory positive at same spread',         minNeg.inventoryMarginBps > 0]);
  cases.push(['uplift labeled INFINITE when flash unviable',
    /INFINITE/.test(String(minNeg.upliftRatio))]);

  let pass = 0;
  console.log('── phase2b1_funding_model_sensitivity.js SELF-TEST ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
