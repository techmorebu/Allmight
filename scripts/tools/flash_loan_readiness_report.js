'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Flash-Loan Readiness Analysis  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/flash_loan_readiness_report.js
//  STATUS    : NEW — Boss ruling 2026-04-19
//
//  PURPOSE
//  ───────
//  Determine whether CONFIRMED_STRICT (Band A) candidates survive the added
//  cost of Aave V3 atomic flash-loan execution across the approved size ladder.
//
//  Models three flash-specific cost layers on top of the realism simulator:
//    1. Flash loan premium  — Aave V3 fee: 0.05% of notional borrowed
//    2. Atomic gas overhead — extra gas for flash callback complexity vs
//                            normal non-atomic execution (~350k gas units extra)
//    3. Complexity penalty  — slightly higher MEV exposure in atomic bundles
//
//  For each approved size ($200 → $1000), reports:
//    - flash-adjusted viable rate
//    - avg flash-adjusted net USD
//    - minimum spread required to survive flash at this size
//    - non-atomic vs atomic net comparison
//    - per-regime breakdown (surge / persistent_depth_regime)
//    - per-hour breakdown (which UTC hours remain viable atomically)
//
//  BAND A ONLY — Band B has not earned flash-loan analysis yet.
//
//  THIS MODULE DOES NOT:
//    ✗ Send transactions  ✗ Change filter rules  ✗ Modify blueprints
//
//  USAGE
//  ─────
//  node scripts/tools/flash_loan_readiness_report.js \
//    --blueprints  logs/session_YYYYMMDD_HHMM/blueprints.jsonl \
//    --audit       logs/session_YYYYMMDD_HHMM/execution_candidate_audit.jsonl
//
//  node scripts/tools/flash_loan_readiness_report.js \
//    --blueprints  logs/.../blueprints.jsonl \
//    --audit       logs/.../execution_candidate_audit.jsonl \
//    --json > logs/.../flash_loan_readiness.json
//
//  node scripts/tools/flash_loan_readiness_report.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { simulateExecutionRealism,
        CORE_REAL_SCENARIO,
        COMBINED_WORST_SCENARIO }  = require('../execution/execution_realism_simulator');
const { TIER_CONFIRMED_SPREAD }    = require('../execution/candidate_audit');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
function argVal(flag, def) {
  const eq = ARGS.find(a => a.startsWith(flag + '='));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = ARGS.indexOf(flag);
  return (i !== -1 && ARGS[i + 1] && !ARGS[i + 1].startsWith('--')) ? ARGS[i + 1] : def;
}

const FLAG_SELF_TEST   = ARGS.includes('--self-test');
const FLAG_JSON        = ARGS.includes('--json');
const BLUEPRINTS_PATH  = argVal('--blueprints', 'logs/trade_blueprints.jsonl');
const AUDIT_PATH       = argVal('--audit', null);

// ─── FLASH-LOAN PARAMETERS ────────────────────────────────────────────────────
// Boss ruling 2026-04-19: Band A flash-loan readiness analysis.
//
// Aave V3 on Arbitrum charges 0.05% (5 bps) on the borrowed amount.
// The borrowed amount equals the full trade notional (USDC).
//
// Atomic execution overhead vs non-atomic:
//   - Flash callback adds ~350k extra gas units for pool interaction + repayment
//   - At 0.02 gwei on Arbitrum → ~350k * 0.02e-9 * $2300 ≈ $0.016 overhead
//   - We use the live gas price from the blueprint for accuracy, not a constant
//   - Gas overhead multiplier applied on top of simulation's existing gas model
//
// MEV complexity penalty:
//   - Atomic bundles have slightly higher MEV exposure (+5pp) — they are
//     larger transactions that are more visible to searchers
//
// Flash viable floor:
//   - flash-adjusted worst-case must be > $0 (same as normal EXECUTION_VIABLE)
//   - flash-adjusted core net must be > $0.05 (minimum meaningful profit)

const AAVE_V3_FEE_PCT          = 0.0005;  // 0.05% of notional
const ATOMIC_GAS_EXTRA_UNITS   = 350_000; // extra gas units for flash callback
const MEV_PENALTY_EXTRA        = 0.05;    // +5pp MEV exposure in atomic bundles
const FLASH_MIN_CORE_NET       = 0.05;    // minimum profitable flash-adjusted core net
const ETH_PRICE_USD            = 2300;    // ETH price for gas USD conversion

// Approved size ladder (Band A — Boss ruling 2026-04-19)
const APPROVED_LADDER = [200, 300, 500, 750, 1000];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean).reduce((acc, line) => {
    try { acc.push(JSON.parse(line)); } catch { /* skip */ }
    return acc;
  }, []);
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function withSize(bp, sizeUsd) {
  return {
    ...bp,
    sizing:   { ...(bp.sizing   ?? {}), targetUsd: sizeUsd },
    _context: { ...(bp._context ?? {}), targetExecutionSizeUsd: sizeUsd },
  };
}

// ─── FLASH ADJUSTMENT ─────────────────────────────────────────────────────────

/**
 * Compute the flash-loan fee and atomic gas overhead for a given blueprint + size.
 * Returns the total cost addition (USD) that flash execution adds.
 */
function flashOverhead(bp, sizeUsd) {
  const gasPriceGwei = bp.economics?.gasPriceGwei ?? 0.02;
  const atomicGasUsd = ATOMIC_GAS_EXTRA_UNITS * gasPriceGwei * 1e-9 * ETH_PRICE_USD;
  const flashFeeUsd  = sizeUsd * AAVE_V3_FEE_PCT;
  return { flashFeeUsd, atomicGasUsd, totalOverheadUsd: flashFeeUsd + atomicGasUsd };
}

/**
 * Compute flash-adjusted simulation result for a blueprint at a given size.
 * Runs the standard realism sim, then applies flash overhead on top.
 */
function simulateFlash(bp, sizeUsd) {
  const sized   = withSize(bp, sizeUsd);
  const baseSim = simulateExecutionRealism(sized);
  const overhead = flashOverhead(bp, sizeUsd);

  // Flash-adjusted core net: subtract flash overhead from expected real net
  const flashCoreNet   = (baseSim.expectedRealNetUsd  ?? 0) - overhead.totalOverheadUsd;

  // Flash-adjusted worst-case: subtract overhead + extra MEV penalty
  // MEV penalty applied to worst-case: lost on any failed tx
  const worstGasCost   = (bp.economics?.gasCostUsd ?? 0.028) * COMBINED_WORST_SCENARIO.gasMult;
  const mevPenalty     = MEV_PENALTY_EXTRA * worstGasCost;
  const flashWorstNet  = (baseSim.worstCaseNetUsd ?? 0) - overhead.totalOverheadUsd - mevPenalty;

  // Flash viability classification
  const flashViable    = flashCoreNet >= FLASH_MIN_CORE_NET && flashWorstNet > 0;
  const flashMarginal  = !flashViable && flashCoreNet >= 0 && flashWorstNet > -0.05;
  const flashClass     = flashViable ? 'FLASH_VIABLE'
                       : flashMarginal ? 'FLASH_MARGINAL'
                       : 'FLASH_FAIL';

  return {
    blueprintId     : bp.blueprintId,
    sizeUsd,
    regime          : bp._context?.regime          ?? '?',
    activeProfile   : bp._context?.activeProfile   ?? '?',
    heatClass       : bp._context?.heatClass       ?? '?',
    tsHour          : (bp.ts ?? '').slice(11, 13) || '?',
    spreadPct       : bp.economics?.spreadPct      ?? null,
    // Non-atomic baseline
    baseExpectedNet : baseSim.expectedRealNetUsd,
    baseWorstNet    : baseSim.worstCaseNetUsd,
    baseViable      : baseSim.executionViable,
    // Flash overhead breakdown
    flashFeeUsd     : +overhead.flashFeeUsd.toFixed(4),
    atomicGasUsd    : +overhead.atomicGasUsd.toFixed(4),
    totalOverheadUsd: +overhead.totalOverheadUsd.toFixed(4),
    // Flash-adjusted outcomes
    flashCoreNet    : +flashCoreNet.toFixed(4),
    flashWorstNet   : +flashWorstNet.toFixed(4),
    flashViable,
    flashMarginal,
    flashClass,
    // Overhead as % of base net (fragility indicator)
    overheadPct     : baseSim.expectedRealNetUsd > 0
      ? +(overhead.totalOverheadUsd / baseSim.expectedRealNetUsd * 100).toFixed(1)
      : null,
  };
}

/**
 * Compute minimum spread (%) required for flash viability at a given size.
 * Solves: size*(spread/100) - flash_fee - atomic_gas - venue_fees - 1.5x_gas > FLASH_MIN_CORE_NET
 */
function minFlashSpread(bp, sizeUsd) {
  const overhead     = flashOverhead(bp, sizeUsd);
  const entryFee     = bp.venues?.entry?.feePct ?? 0.0001;
  const exitFee      = bp.venues?.exit?.feePct  ?? 0.0005;
  const gasBase      = (bp.economics?.gasCostUsd ?? 0.028) * CORE_REAL_SCENARIO.gasMult;
  const totalFixed   = overhead.totalOverheadUsd + gasBase + sizeUsd * (entryFee + exitFee) + FLASH_MIN_CORE_NET;
  return +(totalFixed / sizeUsd * 100).toFixed(4);
}

// ─── CORE ANALYSIS ────────────────────────────────────────────────────────────

function analyzeSize(bps, sizeUsd) {
  const results = bps.map(bp => {
    try { return simulateFlash(bp, sizeUsd); }
    catch (err) {
      return { blueprintId: bp.blueprintId, sizeUsd, flashClass: 'FLASH_FAIL',
               flashViable: false, flashCoreNet: null, flashWorstNet: null,
               baseViable: false, _error: err.message };
    }
  });

  const viable   = results.filter(r => r.flashViable);
  const marginal = results.filter(r => r.flashMarginal);
  const failed   = results.filter(r => r.flashClass === 'FLASH_FAIL');

  const nets      = viable.map(r => r.flashCoreNet).filter(n => n != null);
  const worsts    = results.map(r => r.flashWorstNet).filter(n => n != null);
  const overheads = results.map(r => r.totalOverheadUsd).filter(n => n != null);
  const ohPcts    = results.map(r => r.overheadPct).filter(n => n != null);

  // Per-regime breakdown
  const byRegime = {};
  for (const r of results) {
    const k = r.regime ?? '?';
    if (!byRegime[k]) byRegime[k] = { total: 0, viable: 0, nets: [] };
    byRegime[k].total++;
    if (r.flashViable) { byRegime[k].viable++; byRegime[k].nets.push(r.flashCoreNet); }
  }

  // Per-hour breakdown (top viable hours)
  const byHour = {};
  for (const r of results) {
    const h = r.tsHour ?? '?';
    if (!byHour[h]) byHour[h] = { total: 0, viable: 0 };
    byHour[h].total++;
    if (r.flashViable) byHour[h].viable++;
  }

  // Compute min flash spread across all blueprints at this size
  const minSpreads = bps.map(bp => {
    try { return minFlashSpread(bp, sizeUsd); } catch { return null; }
  }).filter(n => n != null);

  // Non-atomic vs atomic comparison
  const baseNets  = results.map(r => r.baseExpectedNet).filter(n => n != null);
  const flashNets = nets;

  return {
    sizeUsd,
    total         : results.length,
    viableCount   : viable.length,
    marginalCount : marginal.length,
    failCount     : failed.length,
    viableRate    : results.length ? viable.length / results.length : 0,
    failRate      : results.length ? failed.length / results.length : 0,
    avgFlashNet   : avg(nets),
    minFlashNet   : nets.length ? Math.min(...nets) : null,
    maxFlashNet   : nets.length ? Math.max(...nets) : null,
    avgFlashWorst : avg(worsts),
    worstPosRate  : worsts.length ? worsts.filter(w => w > 0).length / worsts.length : 0,
    avgOverheadUsd: avg(overheads),
    avgOverheadPct: avg(ohPcts),
    minSpreadRequired: avg(minSpreads),
    nonAtomicAvgNet  : avg(baseNets),
    netDeltaFromFlash: (avg(flashNets) != null && avg(baseNets) != null)
      ? +(avg(flashNets) - avg(baseNets)).toFixed(4) : null,
    byRegime: Object.fromEntries(
      Object.entries(byRegime).map(([k, v]) => [k, {
        total: v.total, viable: v.viable,
        viableRate: v.total ? +(v.viable / v.total).toFixed(4) : 0,
        avgFlashNet: avg(v.nets),
      }])
    ),
    byHour: Object.fromEntries(
      Object.entries(byHour)
        .sort((a, b) => b[1].viable - a[1].viable)
        .map(([h, v]) => [h, {
          total: v.total, viable: v.viable,
          viableRate: v.total ? +(v.viable / v.total).toFixed(4) : 0,
        }])
    ),
  };
}

function analyze(blueprints, auditRecords) {
  // Filter to CONFIRMED_STRICT (Band A) only
  const confirmedIds = new Set(
    auditRecords
      .filter(r => r.auditVerdict === 'CANDIDATE_CONFIRMED')
      .map(r => r.blueprintId)
      .filter(Boolean)
  );

  const bandA = confirmedIds.size > 0
    ? blueprints.filter(bp => confirmedIds.has(bp.blueprintId) &&
                              (bp.economics?.spreadPct ?? 0) >= TIER_CONFIRMED_SPREAD)
    : blueprints.filter(bp => (bp.economics?.spreadPct ?? 0) >= TIER_CONFIRMED_SPREAD);

  const ladder = APPROVED_LADDER.map(size => analyzeSize(bandA, size));

  // Flash readiness verdict
  const viableAtAll   = ladder.filter(r => r.viableRate > 0);
  const viableAt200   = ladder.find(r => r.sizeUsd === 200);
  const viableAt500   = ladder.find(r => r.sizeUsd === 500);
  const viableAt1000  = ladder.find(r => r.sizeUsd === 1000);

  let verdict, verdictDetail;
  if (!bandA.length) {
    verdict = 'INSUFFICIENT_DATA';
    verdictDetail = 'No confirmed Band A blueprints found.';
  } else if ((viableAt200?.viableRate ?? 0) >= 0.80 && (viableAt500?.viableRate ?? 0) >= 0.70) {
    verdict = (viableAt1000?.viableRate ?? 0) >= 0.70
      ? 'FLASH_READY_FULL_LADDER'
      : 'FLASH_READY_TO_500';
    verdictDetail = `${(viableAt200?.viableRate*100).toFixed(1)}% viable at $200, ` +
                    `${(viableAt500?.viableRate*100).toFixed(1)}% at $500, ` +
                    `${((viableAt1000?.viableRate??0)*100).toFixed(1)}% at $1000`;
  } else if ((viableAt200?.viableRate ?? 0) >= 0.50) {
    verdict = 'FLASH_PARTIAL';
    verdictDetail = `Only ${(viableAt200?.viableRate*100).toFixed(1)}% viable at $200 — not ready for full ladder.`;
  } else {
    verdict = 'FLASH_NOT_READY';
    verdictDetail = 'Flash overhead consumes too much of the edge at current spread levels.';
  }

  return {
    generatedAt         : new Date().toISOString(),
    bandAOnly           : true,
    totalBlueprintsIn   : blueprints.length,
    confirmedCount      : bandA.length,
    auditProvided       : auditRecords.length > 0,
    flashParams         : {
      aaveV3FeePct      : AAVE_V3_FEE_PCT,
      atomicGasExtraUnits: ATOMIC_GAS_EXTRA_UNITS,
      mevPenaltyExtra   : MEV_PENALTY_EXTRA,
      flashMinCoreNet   : FLASH_MIN_CORE_NET,
      ethPriceUsd       : ETH_PRICE_USD,
    },
    verdict,
    verdictDetail,
    approvedLadder      : APPROVED_LADDER,
    ladder,
  };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(result) {
  const W   = 80;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  const vClr = {
    FLASH_READY_FULL_LADDER: '\x1b[1;32m',
    FLASH_READY_TO_500     : '\x1b[32m',
    FLASH_PARTIAL          : '\x1b[33m',
    FLASH_NOT_READY        : '\x1b[31m',
    INSUFFICIENT_DATA      : '\x1b[90m',
  };

  console.log('\n' + EQ);
  console.log('  AllMight — Flash-Loan Readiness Analysis  v1.0  (Band A only)');
  console.log(`  ${result.generatedAt}`);
  console.log(EQ);
  console.log(`\n  Confirmed Band A blueprints:  ${result.confirmedCount}`);
  console.log(`  Audit records used:           ${result.auditProvided ? 'yes' : 'no (spread filter only)'}`);
  console.log(`\n  Flash params:`);
  const p = result.flashParams;
  console.log(`    Aave V3 fee:         ${(p.aaveV3FeePct * 100).toFixed(2)}% of notional`);
  console.log(`    Atomic gas overhead: ~${p.atomicGasExtraUnits.toLocaleString()} extra gas units`);
  console.log(`    MEV complexity:      +${(p.mevPenaltyExtra * 100).toFixed(0)}pp extra MEV exposure`);
  console.log(`    Flash viable floor:  core net >= $${p.flashMinCoreNet} AND worst > $0`);

  // ── Ladder table ───────────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  FLASH-ADJUSTED SIZE LADDER — BAND A / CONFIRMED_STRICT');
  console.log(`  ${DIV}`);
  console.log('  ' + [
    'size'.padStart(6), 'viable%'.padStart(8), 'fail%'.padStart(7),
    'flashNet$'.padStart(10), 'minNet$'.padStart(8), 'overhead$'.padStart(10),
    'oh%'.padStart(5), 'worst>0%'.padStart(9), 'minSpread%'.padStart(11),
  ].join('  '));
  console.log('  ' + DIV);

  for (const r of result.ladder) {
    console.log('  ' + [
      ('$'+r.sizeUsd).padStart(6),
      ((r.viableRate*100).toFixed(1)+'%').padStart(8),
      ((r.failRate*100).toFixed(1)+'%').padStart(7),
      (r.avgFlashNet   != null ? '$'+r.avgFlashNet.toFixed(4)   : '-').padStart(10),
      (r.minFlashNet   != null ? '$'+r.minFlashNet.toFixed(4)   : '-').padStart(8),
      (r.avgOverheadUsd != null ? '$'+r.avgOverheadUsd.toFixed(4) : '-').padStart(10),
      (r.avgOverheadPct != null ? r.avgOverheadPct.toFixed(1)+'%' : '-').padStart(5),
      ((r.worstPosRate*100).toFixed(1)+'%').padStart(9),
      (r.minSpreadRequired != null ? r.minSpreadRequired.toFixed(4)+'%' : '-').padStart(11),
    ].join('  '));
  }

  // ── Non-atomic vs atomic comparison ────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  NON-ATOMIC vs ATOMIC NET COMPARISON');
  console.log(`  ${DIV}`);
  console.log('  ' + ['size'.padStart(6), 'base net$'.padStart(10), 'flash net$'.padStart(11), 'delta$'.padStart(8), 'overhead%'.padStart(10)].join('  '));
  console.log('  ' + DIV);
  for (const r of result.ladder) {
    const deltaClr = (r.netDeltaFromFlash ?? 0) < -0.05 ? '\x1b[33m' : '';
    console.log('  ' + deltaClr + [
      ('$'+r.sizeUsd).padStart(6),
      (r.nonAtomicAvgNet != null ? '$'+r.nonAtomicAvgNet.toFixed(4) : '-').padStart(10),
      (r.avgFlashNet     != null ? '$'+r.avgFlashNet.toFixed(4)     : '-').padStart(11),
      (r.netDeltaFromFlash != null ? (r.netDeltaFromFlash >= 0 ? '+' : '') + r.netDeltaFromFlash.toFixed(4) : '-').padStart(8),
      (r.avgOverheadPct  != null ? r.avgOverheadPct.toFixed(1)+'%' : '-').padStart(10),
    ].join('  ') + '\x1b[0m');
  }

  // ── Per-regime breakdown at $200 and $500 ──────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  REGIME BREAKDOWN — flash viable rate by size');
  console.log(`  ${DIV}`);
  const allRegimes = new Set(result.ladder.flatMap(r => Object.keys(r.byRegime)));
  for (const regime of allRegimes) {
    const rates = result.ladder.map(r => {
      const rv = r.byRegime[regime];
      return rv ? ((rv.viableRate * 100).toFixed(0) + '%').padStart(7) : '     -';
    });
    console.log(`  ${regime.padEnd(28)}  ` + rates.join('  '));
  }

  // ── Top hours ──────────────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  TOP UTC HOURS FOR FLASH EXECUTION (at $200)');
  console.log(`  ${DIV}`);
  const at200 = result.ladder.find(r => r.sizeUsd === 200);
  if (at200) {
    const hoursSorted = Object.entries(at200.byHour)
      .filter(([, v]) => v.total >= 2)
      .sort((a, b) => b[1].viable - a[1].viable)
      .slice(0, 10);
    for (const [h, v] of hoursSorted) {
      const bar = '█'.repeat(Math.round(v.viableRate * 10));
      console.log(`  ${h}:00 UTC  viable=${v.viable}/${v.total}  ${(v.viableRate*100).toFixed(0)}%  ${bar}`);
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  console.log(`\n${EQ}`);
  console.log('  FLASH READINESS VERDICT');
  console.log(`  ${DIV}`);
  console.log(`\n  ${(vClr[result.verdict] ?? '')}${result.verdict}\x1b[0m`);
  console.log(`  ${result.verdictDetail}`);
  console.log(`\n  Note: This analysis covers Band A (CONFIRMED_STRICT) only.`);
  console.log(`        Band B has not earned flash-loan analysis yet.`);
  console.log(`        Flash deployment requires separate contract + gas audit.`);
  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, got) {
    if (cond) { pass++; }
    else { fail++; console.log(`    ✗ FAIL: ${label}${got !== undefined ? ` (got ${JSON.stringify(got)})` : ''}`); }
  }

  console.log('\n  Flash-Loan Readiness — Self-Test\n');

  function mkBp(spreadPct, sizeUsd, gasCostUsd) {
    return {
      blueprintId: `TEST-${Math.random().toString(36).slice(2)}`,
      pair: 'ETH/USDC-RAMSES',
      ts  : '2026-04-19T14:00:00Z',
      economics : { spreadPct, gasCostUsd: gasCostUsd ?? 0.028, gasPriceGwei: 0.02, netProfitUsd: 0.15 },
      sizing    : { targetUsd: sizeUsd },
      venues    : { entry: { feePct: 0.0001 }, exit: { feePct: 0.0005 } },
      viability : { confidenceScore: 0.75 },
      _context  : { regime: 'surge', activeProfile: 'SAFE', heatClass: 'EXTREME' },
    };
  }

  // ── Case 1: flashOverhead calculation ─────────────────────────────────────
  console.log('  Case 1: flashOverhead at $200');
  {
    const bp = mkBp(0.23, 200);
    const oh = flashOverhead(bp, 200);
    assert('flash fee = $0.10',     Math.abs(oh.flashFeeUsd - 0.10) < 0.001, oh.flashFeeUsd);
    assert('atomic gas > 0',        oh.atomicGasUsd > 0, oh.atomicGasUsd);
    assert('total overhead > 0.10', oh.totalOverheadUsd > 0.10);
    console.log(`    flashFee=$${oh.flashFeeUsd.toFixed(4)}  atomicGas=$${oh.atomicGasUsd.toFixed(4)}  total=$${oh.totalOverheadUsd.toFixed(4)}`);
  }
  console.log();

  // ── Case 2: simulateFlash — viable at good spread ─────────────────────────
  console.log('  Case 2: simulateFlash — high spread stays viable');
  {
    const bp = mkBp(0.35, 200);  // high spread — should survive flash
    const r  = simulateFlash(bp, 200);
    assert('flashClass string',   typeof r.flashClass === 'string');
    assert('flashCoreNet present', r.flashCoreNet != null);
    assert('high spread is viable or marginal', r.flashViable || r.flashMarginal, r.flashClass);
    console.log(`    spread=0.35%  flashCoreNet=$${r.flashCoreNet}  class=${r.flashClass}`);
  }
  console.log();

  // ── Case 3: simulateFlash — tight spread may not survive flash ────────────
  console.log('  Case 3: simulateFlash — minimum spread at $200');
  {
    const bp = mkBp(0.22, 200);  // at the confirmed floor — flash may squeeze it
    const r  = simulateFlash(bp, 200);
    assert('flashCoreNet is a number', typeof r.flashCoreNet === 'number');
    assert('has overheadPct',          r.overheadPct != null);
    console.log(`    spread=0.22%  flashCoreNet=$${r.flashCoreNet}  overheadPct=${r.overheadPct}%  class=${r.flashClass}`);
  }
  console.log();

  // ── Case 4: minFlashSpread decreases with size (amortization) ───────────────
  console.log('  Case 4: minFlashSpread — decreases with size (fixed gas amortizes over larger notional)');
  {
    const bp   = mkBp(0.23, 200);
    const m200 = minFlashSpread(bp, 200);
    const m500 = minFlashSpread(bp, 500);
    const m1000= minFlashSpread(bp, 1000);
    assert('minSpread at $200 > 0',        m200 > 0, m200);
    assert('minSpread decreases $200→$500', m500 < m200, `m500=${m500} m200=${m200}`);
    assert('minSpread decreases $500→$1000',m1000 < m500, `m1000=${m1000} m500=${m500}`);
    console.log(`    minSpread $200=${m200.toFixed(4)}%  $500=${m500.toFixed(4)}%  $1000=${m1000.toFixed(4)}%  (decreasing — correct)`);
  }
  console.log();

  // ── Case 5: analyze end-to-end with audit records ────────────────────────
  // At $200 with tight spreads (0.23-0.30%), flash worst-case fails because the
  // combined-worst scenario net ($0.02-$0.09) cannot absorb the $0.12 overhead.
  // At $500-$1000, minSpread required is lower (amortization), so same spreads survive.
  console.log('  Case 5: analyze() — tight spreads fail flash worst-case at $200, pass at $1000');
  {
    // Use mid-range spreads: tight ones fail at $200 worst-case, good ones survive
    const bps = [
      mkBp(0.35, 200),  // high spread — survives flash at any size
      mkBp(0.40, 200),  // high spread
      mkBp(0.23, 200),  // tight — fails worst-case at $200
      mkBp(0.25, 200),  // tight — fails worst-case at $200
    ];
    const auditRecs = bps.map(bp => ({
      blueprintId: bp.blueprintId, auditVerdict: 'CANDIDATE_CONFIRMED',
    }));
    const r = analyze(bps, auditRecs);
    assert('confirmedCount = 4',      r.confirmedCount === 4, r.confirmedCount);
    assert('ladder has 5 steps',      r.ladder.length === 5);
    assert('verdict is string',       typeof r.verdict === 'string');
    // High spreads (0.35-0.40%) should survive flash at $200
    const at200 = r.ladder.find(s => s.sizeUsd === 200);
    assert('at $200: some viable (high-spread bps pass)', (at200?.viableCount ?? 0) >= 2, at200?.viableCount);
    // At $1000: more bps survive (amortized overhead), tight spreads (0.23%) may still fail worst-case
    const at1000 = r.ladder.find(s => s.sizeUsd === 1000);
    assert('at $1000: more viable than $200 (amortization)', (at1000?.viableCount ?? 0) >= (at200?.viableCount ?? 0), at1000?.viableCount);
    console.log(`    confirmedCount=${r.confirmedCount}  verdict=${r.verdict}`);
    console.log(`    $200 viable=${at200?.viableCount}/${at200?.total}  $1000 viable=${at1000?.viableCount}/${at1000?.total}`);
    console.log(`    Key insight: flash overhead amortizes → more viable at higher sizes`);
  }
  console.log();

  // ── Case 6: no audit — falls back to spread filter ────────────────────────
  console.log('  Case 6: no audit file — spread filter fallback');
  {
    const bps = [mkBp(0.23,200), mkBp(0.25,200), mkBp(0.15,200)];
    const r   = analyze(bps, []);
    assert('confirmedCount = 2 (only spread >= 0.22%)', r.confirmedCount === 2, r.confirmedCount);
    assert('auditProvided = false', r.auditProvided === false);
    console.log(`    confirmedCount=${r.confirmedCount}  auditProvided=${r.auditProvided}`);
  }
  console.log();

  console.log('  ' + '═'.repeat(60));
  console.log(`  Self-test complete: ${pass} passed  ${fail} failed`);
  console.log('  ' + '═'.repeat(60) + '\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_SELF_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(BLUEPRINTS_PATH)) {
    console.error(`[flash_loan_readiness_report] Blueprint log not found: ${BLUEPRINTS_PATH}`);
    process.exit(1);
  }

  const blueprints   = readJsonl(BLUEPRINTS_PATH);
  const auditRecords = AUDIT_PATH ? readJsonl(AUDIT_PATH) : [];

  if (!FLAG_JSON) {
    process.stdout.write(`[flash_loan_readiness_report] Loaded ${blueprints.length} blueprint(s)`);
    if (auditRecords.length) process.stdout.write(`, ${auditRecords.length} audit record(s)`);
    process.stdout.write('\n');
  }

  const result = analyze(blueprints, auditRecords);

  if (FLAG_JSON) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printReport(result);
  }
}

main();
