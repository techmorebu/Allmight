#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════════════════
//  AllMight — Surface Score · INVENTORY MODE  v1   (Phase 2B Research Branch)
//  PLACEMENT: scripts/tools/surface_score_inventory.js
//  STATUS:    Boss "Inventory Mode v1" approved — READ-ONLY research analytics
//
//  ┌───────────────────────────────────────────────────────────────────────┐
//  │  MODEL = INVENTORY        ***  NOT COMPARABLE TO FLASH SCORE  ***       │
//  │  This is a DIFFERENT economic model from surface_score.js (flash-loan). │
//  │  Different costs, different gate, different risk, different success     │
//  │  metric. Numbers here MUST NOT be compared to flash surfaceScore.       │
//  │  Constitutional separation (Boss): kept as a physically separate script.│
//  └───────────────────────────────────────────────────────────────────────┘
//
//  ECONOMIC MODEL (balance-sheet arbitrage — fund from own inventory, no flash)
//  ────────────────────────────────────────────────────────────────────────
//    perTradeBreakevenBps = venueFeeBps + estimatedSlipBps + gas_bps(size)
//                           *** NO Aave flash fee *** (not borrowing)
//    perTradeMarginBps    = dislocationBps - perTradeBreakevenBps
//    breakevenSpreadBps   = perTradeBreakevenBps  (dislocation needed for margin 0)
//    opportunityCost      = capitalBase * annualYield  (ANNUALIZED $ forgone)
//                           → per-trade bps requires trade FREQUENCY (unmeasured)
//                           → status NEEDS_FREQUENCY (Boss ruling 4)
//    inventoryRisk        = LOW | MEDIUM | HIGH   (flag only, NO penalty math v1)
//
//  v1 DOES NOT produce a final net score — frequency telemetry does not yet
//  exist (Phase 2A.2). It honestly outputs per-trade economics + the
//  opportunity-cost placeholder + a breakeven-frequency hint, so Boss can
//  decide whether the inventory frontier is worth telemetry expansion.
//
//  SCOPE (Boss ruling 5): arbitrum DAI/USDC = CANDIDATE. Other stable inventory
//  surfaces (e.g. ethereum DAI/USDC) = BACKGROUND/informational only.
//  Only surfaces carrying breakevenComponents are processed (flash-only surfaces
//  like ETH/USDC Ramses are intentionally skipped — not inventory candidates).
//
//  USAGE
//    node scripts/tools/surface_score_inventory.js            # report + write files
//    node scripts/tools/surface_score_inventory.js --json     # JSON to stdout
//    node scripts/tools/surface_score_inventory.js --self-test
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return path.resolve(__dirname, '../..'); }
})();
const SURFACES_DIR  = path.join(REPO, 'surfaces');
const REGISTRY_FILE = path.join(SURFACES_DIR, 'registry.json');
const METRICS_DIR   = path.join(REPO, 'logs', 'project_metrics');
const OUT_JSON      = path.join(METRICS_DIR, 'surface_score_inventory.json');
const OUT_TXT       = path.join(METRICS_DIR, 'surface_score_inventory.txt');

// ─── Boss Inventory Mode v1 constants ───────────────────────────────────────
const ANNUAL_YIELD      = 0.04;                 // 4% yield forgone (Boss ruling 2)
const CAPITAL_BASE_USD  = 10000;                // reference capital base (Boss ruling 2)
const OPP_COST_SOURCE   = 'assumed_4pct_v1';    // research assumption, not market truth
const REFERENCE_SIZE    = 10000;                // primary trade-size anchor
const SIZES             = [1000, 10000, 100000];
const MODEL             = 'INVENTORY';
const NOT_COMPARABLE    = 'NOT COMPARABLE TO FLASH SCORE';

// ─── per-trade inventory breakeven (NO Aave) ────────────────────────────────
function inventoryBreakevenAtSize(c, sizeUsd) {
  const venue  = Number(c.venueFeeBps)      || 0;
  const slip   = Number(c.estimatedSlipBps) || 0;
  const gasUsd = Number(c.gasUsdPerTx)      || 0;
  const gasBps = sizeUsd > 0 ? (gasUsd / sizeUsd) * 10000 : 0;
  // NOTE: aaveFeeBps deliberately EXCLUDED — inventory mode does not flash-borrow.
  return +(venue + slip + gasBps).toFixed(4);
}

// dislocation: telemetry observed > config single-snapshot estimate > preferred
function resolveDislocation(cfg) {
  if (typeof cfg.estimatedDislocationBps === 'number' && isFinite(cfg.estimatedDislocationBps)) {
    return { bps: cfg.estimatedDislocationBps, source: cfg.dislocationSource || 'estimate' };
  }
  if (typeof cfg.preferredSpreadBps === 'number' && isFinite(cfg.preferredSpreadBps)) {
    return { bps: cfg.preferredSpreadBps, source: 'config_target' };
  }
  return { bps: null, source: 'missing' };
}

function inventoryRiskFor(cfg) {
  if (cfg.inventoryRisk && ['LOW', 'MEDIUM', 'HIGH'].includes(cfg.inventoryRisk)) return cfg.inventoryRisk;
  // v1 default: stable/stable pairs carry real but moderate depeg exposure
  // (e.g. USDC SVB depeg Mar-2023, DAI collateral mix). Flag only — no math.
  return 'MEDIUM';
}

// ─── score one inventory surface ────────────────────────────────────────────
function scoreInventorySurface(cfg) {
  const c = cfg.breakevenComponents;
  const dis = resolveDislocation(cfg);

  const role = (cfg.chain === 'arbitrum') ? 'CANDIDATE' : 'BACKGROUND';

  const perTradeBreakevenBps = inventoryBreakevenAtSize(c, REFERENCE_SIZE);
  const perTradeMarginBps = (dis.bps != null)
    ? +(dis.bps - perTradeBreakevenBps).toFixed(4) : null;
  const breakevenSpreadBps = perTradeBreakevenBps;   // dislocation needed for margin 0

  const sizeSensitivity = SIZES.map(sz => {
    const be = inventoryBreakevenAtSize(c, sz);
    const m  = (dis.bps != null) ? +(dis.bps - be).toFixed(4) : null;
    return { sizeUsd: sz, perTradeBreakevenBps: be, perTradeMarginBps: m };
  });

  // opportunity cost — annualized; per-trade bps requires frequency (unmeasured)
  const annualUsd = +(CAPITAL_BASE_USD * ANNUAL_YIELD).toFixed(2);
  let breakevenTradesPerYear = null;
  let oppNote;
  if (perTradeMarginBps != null && perTradeMarginBps > 0) {
    const profitPerTradeUsd = (perTradeMarginBps / 10000) * REFERENCE_SIZE;
    breakevenTradesPerYear = Math.ceil(annualUsd / profitPerTradeUsd);
    oppNote = `per-trade margin POSITIVE (${perTradeMarginBps}bp → $${profitPerTradeUsd.toFixed(2)}/trade @ $${REFERENCE_SIZE}); ` +
              `need ~${breakevenTradesPerYear} trades/yr (~${(breakevenTradesPerYear/365).toFixed(1)}/day) to cover $${annualUsd}/yr opportunity cost`;
  } else {
    oppNote = `per-trade margin NOT positive at this dislocation — opportunity cost is moot; ` +
              `inventory not viable here regardless of frequency`;
  }

  const opportunityCost = {
    annualYield        : ANNUAL_YIELD,
    capitalBaseUsd     : CAPITAL_BASE_USD,
    annualUsd,
    source             : OPP_COST_SOURCE,
    status             : 'NEEDS_FREQUENCY',          // Boss ruling 4
    breakevenTradesPerYear,                          // null if per-trade margin <= 0
    note               : oppNote,
  };

  // honest verdict
  let verdict;
  if (perTradeMarginBps == null) {
    verdict = 'NO_DISLOCATION_INPUT';
  } else if (perTradeMarginBps > 0) {
    verdict = 'PER_TRADE_POSITIVE_NET_NEEDS_FREQUENCY';
  } else {
    const gap = +(breakevenSpreadBps - dis.bps).toFixed(4);
    verdict = `PER_TRADE_NEGATIVE (needs +${gap}bp more dislocation to clear floor)`;
  }

  return {
    model               : MODEL,
    notComparableToFlash : true,
    notComparableNote   : NOT_COMPARABLE,
    surfaceId           : cfg.surfaceId,
    chainScopedId       : cfg.chainScopedId || null,
    displayName         : cfg.displayName || cfg.surfaceId,
    chain               : cfg.chain || null,
    role,
    dislocationBps      : dis.bps,
    dislocationSource   : dis.source,
    perTradeBreakevenBps,
    perTradeMarginBps,
    breakevenSpreadBps,
    sizeSensitivity,
    opportunityCost,
    inventoryRisk       : inventoryRiskFor(cfg),
    netMarginScoreable  : false,                     // NEEDS_FREQUENCY (Boss ruling 4)
    verdict,
  };
}

// ─── loaders (inventory candidates = surfaces with breakevenComponents) ──────
function loadInventorySurfaces() {
  let registry;
  try { registry = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8')); }
  catch (e) { return { configs: [], error: `cannot read registry.json: ${e.message}` }; }
  const configs = [];
  for (const entry of (registry.surfaces || [])) {
    const file = entry.file || `${entry.surfaceId}.json`;
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(SURFACES_DIR, file), 'utf8'));
      cfg.surfaceId = cfg.surfaceId || entry.surfaceId;
      // INVENTORY scope: only surfaces carrying breakevenComponents (stable geometry).
      // Flash-only surfaces (no components, e.g. ETH/USDC Ramses) are skipped.
      if (cfg.breakevenComponents && typeof cfg.breakevenComponents === 'object') {
        configs.push(cfg);
      }
    } catch { /* skip unreadable */ }
  }
  return { configs, error: null };
}

// ─── report ──────────────────────────────────────────────────────────────────
function buildTextReport(rows, meta) {
  const L = [];
  const bar = '═'.repeat(78);
  L.push(bar);
  L.push('  AllMight — Surface Score · INVENTORY MODE v1  (Phase 2B Research)  READ-ONLY');
  L.push(`  *** MODEL = INVENTORY — ${NOT_COMPARABLE} ***`);
  L.push(`  generatedAt: ${meta.generatedAt}`);
  L.push(`  opportunity cost: ${ANNUAL_YIELD * 100}% / $${CAPITAL_BASE_USD} (${OPP_COST_SOURCE}) — status NEEDS_FREQUENCY`);
  L.push(bar);
  L.push('');
  // CANDIDATE rows first, BACKGROUND after
  const ordered = rows.slice().sort((a, b) => (a.role === 'CANDIDATE' ? -1 : 1) - (b.role === 'CANDIDATE' ? -1 : 1));
  for (const s of ordered) {
    L.push(`▸ ${s.displayName}  [${s.surfaceId}]   role: ${s.role}`);
    L.push(`    economic id: ${s.chainScopedId || '(none)'}`);
    L.push(`    per-trade: dislocation ${s.dislocationBps == null ? 'n/a' : s.dislocationBps} [${s.dislocationSource}]` +
           ` − breakeven ${s.perTradeBreakevenBps} (venue+slip+gas, NO aave)  →  margin ${s.perTradeMarginBps == null ? 'n/a' : (s.perTradeMarginBps > 0 ? '+' : '') + s.perTradeMarginBps} bps`);
    L.push(`    breakeven spread (per-trade): ${s.breakevenSpreadBps} bps   inventoryRisk: ${s.inventoryRisk} (flag only)`);
    const cells = s.sizeSensitivity.map(r => {
      const sz = `$${r.sizeUsd / 1000}k`;
      const m  = r.perTradeMarginBps == null ? 'n/a' : (r.perTradeMarginBps > 0 ? '+' : '') + r.perTradeMarginBps;
      return `${sz}: be ${r.perTradeBreakevenBps} / margin ${m}`;
    });
    L.push(`    size sensitivity: ${cells.join('  |  ')}`);
    L.push(`    opportunity cost: $${s.opportunityCost.annualUsd}/yr [${s.opportunityCost.status}]`);
    L.push(`      ${s.opportunityCost.note}`);
    L.push(`    verdict: ${s.verdict}`);
    L.push('');
  }
  L.push(bar);
  L.push('  NOTES');
  L.push(`  - *** ${NOT_COMPARABLE}. *** Different economic model entirely.`);
  L.push('  - perTradeBreakevenBps EXCLUDES the Aave 5bp flash fee (own-inventory funding).');
  L.push('  - NET margin is NOT scoreable in v1 — opportunity cost needs trade-frequency');
  L.push('    telemetry (Phase 2A.2). v1 reports per-trade economics + frequency hint only.');
  L.push('  - inventoryRisk is a FLAG (no penalty math v1, Boss ruling 3).');
  L.push('  - Research only. No execution, no wallet, no inventory funding. (Phase 2B)');
  L.push(bar);
  return L.join('\n');
}

function main() {
  const jsonMode = process.argv.includes('--json');
  const { configs, error } = loadInventorySurfaces();
  if (error) { console.error(`[inventory_score] ${error}`); process.exit(1); }
  if (!configs.length) {
    console.error('[inventory_score] no inventory-candidate surfaces (none carry breakevenComponents)');
    process.exit(1);
  }
  const rows = configs.map(scoreInventorySurface);
  const meta = {
    generatedAt : new Date().toISOString(),
    model       : MODEL,
    notComparableToFlash : true,
    phase       : '2B-research',
    opportunityCostSource : OPP_COST_SOURCE,
  };
  const out = { meta, surfaces: rows };

  if (jsonMode) { console.log(JSON.stringify(out, null, 2)); return; }

  const txt = buildTextReport(rows, meta);
  console.log(txt);
  try {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
    fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));
    fs.writeFileSync(OUT_TXT, txt + '\n');
    console.log(`\n[inventory_score] wrote ${path.relative(REPO, OUT_JSON)} and ${path.relative(REPO, OUT_TXT)}`);
  } catch (e) {
    console.error(`[inventory_score] could not write artifacts: ${e.message}`);
  }
}

// ─── SELF-TEST (deterministic) ──────────────────────────────────────────────
function selfTest() {
  const approx = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
  const cases = [];

  const arbC = { venueFeeBps: 1.5, aaveFeeBps: 5, estimatedSlipBps: 1, gasUsdPerTx: 0.20, referenceSizeUsd: 10000 };
  const ethC = { venueFeeBps: 2.5, aaveFeeBps: 5, estimatedSlipBps: 1, gasUsdPerTx: 2.40, referenceSizeUsd: 10000 };

  // breakeven EXCLUDES aave
  cases.push(['arb be@10k = 2.7 (no aave)',  approx(inventoryBreakevenAtSize(arbC, 10000), 2.7)]);
  cases.push(['arb be@1k  = 4.5',            approx(inventoryBreakevenAtSize(arbC, 1000), 4.5)]);
  cases.push(['arb be@100k= 2.52',           approx(inventoryBreakevenAtSize(arbC, 100000), 2.52)]);
  cases.push(['eth be@10k = 5.9 (no aave)',  approx(inventoryBreakevenAtSize(ethC, 10000), 5.9)]);
  // sanity: flash would be 7.7/10.9 — confirm we are 5bp lower (aave removed)
  cases.push(['arb inventory = flash(7.7) - aave(5) = 2.7', approx(inventoryBreakevenAtSize(arbC, 10000), 7.7 - 5)]);

  // arbitrum CANDIDATE at observed 2bp → margin -0.7, near breakeven, role CANDIDATE
  const arbCfg = {
    surfaceId: 'dai_usdc_candidate', chainScopedId: 'arbitrum:DAI/USDC:uni_camelot',
    displayName: 'Arb DAI/USDC', chain: 'arbitrum',
    estimatedDislocationBps: 2, dislocationSource: 'single_snapshot_estimate',
    breakevenComponents: arbC,
  };
  const rArb = scoreInventorySurface(arbCfg);
  cases.push(['arb role CANDIDATE', rArb.role === 'CANDIDATE']);
  cases.push(['arb perTradeMargin = -0.7', approx(rArb.perTradeMarginBps, -0.7)]);
  cases.push(['arb breakevenSpread = 2.7', approx(rArb.breakevenSpreadBps, 2.7)]);
  cases.push(['arb netMarginScoreable false', rArb.netMarginScoreable === false]);
  cases.push(['arb oppCost status NEEDS_FREQUENCY', rArb.opportunityCost.status === 'NEEDS_FREQUENCY']);
  cases.push(['arb oppCost annual = 400', approx(rArb.opportunityCost.annualUsd, 400)]);
  cases.push(['arb oppCost source assumed_4pct_v1', rArb.opportunityCost.source === 'assumed_4pct_v1']);
  cases.push(['arb breakevenTrades null (neg margin)', rArb.opportunityCost.breakevenTradesPerYear === null]);
  cases.push(['arb inventoryRisk MEDIUM default', rArb.inventoryRisk === 'MEDIUM']);
  cases.push(['arb verdict per-trade negative', /PER_TRADE_NEGATIVE/.test(rArb.verdict)]);
  cases.push(['arb NOT comparable label', rArb.notComparableNote === NOT_COMPARABLE && rArb.model === 'INVENTORY']);

  // ethereum BACKGROUND, margin -3.9
  const ethCfg = { surfaceId:'dai_usdc_eth_curve', chainScopedId:'ethereum:DAI/USDC:curve_uni',
    displayName:'Eth DAI/USDC', chain:'ethereum', estimatedDislocationBps:2, breakevenComponents: ethC };
  const rEth = scoreInventorySurface(ethCfg);
  cases.push(['eth role BACKGROUND', rEth.role === 'BACKGROUND']);
  cases.push(['eth perTradeMargin = -3.9', approx(rEth.perTradeMarginBps, -3.9)]);

  // positive-margin frontier case: dislocation 3 on arbitrum → +0.3, frequency hint appears
  const posCfg = { ...arbCfg, estimatedDislocationBps: 3 };
  const rPos = scoreInventorySurface(posCfg);
  cases.push(['pos perTradeMargin = +0.3', approx(rPos.perTradeMarginBps, 0.3)]);
  // profit = 0.3/10000*10000 = $0.30/trade ; trades = ceil(400/0.30) = 1334
  cases.push(['pos breakevenTrades ~1334', rPos.opportunityCost.breakevenTradesPerYear === 1334]);
  cases.push(['pos verdict positive-needs-frequency', rPos.verdict === 'PER_TRADE_POSITIVE_NET_NEEDS_FREQUENCY']);

  // explicit risk override respected
  const riskCfg = { ...arbCfg, inventoryRisk: 'HIGH' };
  cases.push(['risk override HIGH', scoreInventorySurface(riskCfg).inventoryRisk === 'HIGH']);

  let pass = 0;
  console.log('── surface_score_inventory.js SELF-TEST (Boss Inventory Mode v1) ──\n');
  for (const [label, ok] of cases) { console.log(`  ${ok ? '✅' : '❌'}  ${label}`); if (ok) pass++; }
  console.log(`\n  ${pass}/${cases.length} assertions passed`);
  process.exit(pass === cases.length ? 0 : 1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
