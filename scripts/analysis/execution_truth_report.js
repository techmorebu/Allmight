#!/usr/bin/env node
'use strict';
/**
 * execution_truth_report.js
 * ───────────────────────────────────────────────────────────────────────────
 * ETC Phase — Economic Truth Calibration
 * Boss G2.13 approved | READ-ONLY | no patches, no thresholds, no live, no deploy
 *
 * Purpose:
 *   Reconcile shadow EXPECTATION against contract EXECUTION REALITY by
 *   decomposing profitability into its friction layers, isolating
 *   DETERMINISTIC friction (model-knowable) from EMERGENT friction
 *   (market-created), and quantifying the unexplained execution drift.
 *
 * Architectural principle (Boss G2.13):
 *   "The quoted spread is not the executable spread."
 *
 * Inputs (immutable baseline — logs/evidence/etc_baseline_v0/):
 *   blueprints_pre_correction.jsonl        (shadow predictions, 464 records)
 *   contract_verdict_pre_correction.jsonl  (contract reality, 58 records)
 *
 * Join:
 *   verdict.signalId = "<session>-<block>"   → integer block
 *   blueprint.signalBlock = <integer block>
 *   Disambiguated when needed by spreadBps ≈ economics.spreadPct * 100.
 *
 * KNOWN LIMITATION (stated honestly, per Boss "truthful, boring, honest"):
 *   A reverted staticCall does NOT return realized output amounts. The
 *   contract verdict therefore only tells us realized profit was < minProfit
 *   (1 wei ≈ $0). It is NOT a precise realized figure. Accordingly:
 *     • "realized edge" is reported as an UPPER BOUND (≤ 0 bps)
 *     • "unexplained drift" is reported as a LOWER BOUND (≥ modeled edge)
 *   Precise realized bps requires a future quoter-based realized-output
 *   capture at the historical block (a separate, later ETC step).
 *
 * Deterministic friction (model SHOULD know exactly):
 *   venue fees, Aave flash fee, configured gas, configured slippage
 * Emergent friction (market creates dynamically):
 *   depth traversal, price impact, liquidity shape, state mutation,
 *   same-block competition, pool imbalance, execution timing
 * ───────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ─── Deterministic constants ────────────────────────────────────────────────
const AAVE_FLASH_FEE_BPS = 5.0;  // Aave V3 flash loan fee = 0.05% = 5 bps
const MIN_PROFIT_WEI     = 1;    // dry engine threshold (≈ $0); reverts below this

// ─── Spread bands (bps) ──────────────────────────────────────────────────────
const BANDS = [
  { lo:  0, hi: 18, label: '<18bps'   },
  { lo: 18, hi: 20, label: '18-20bps' },
  { lo: 20, hi: 22, label: '20-22bps' },
  { lo: 22, hi: 24, label: '22-24bps' },
  { lo: 24, hi: 26, label: '24-26bps' },
  { lo: 26, hi: 28, label: '26-28bps' },
  { lo: 28, hi: 1e9, label: '28bps+'  },
];

// ─── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs() {
  const a = process.argv.slice(2);
  const opt = { dir: 'logs/evidence/etc_baseline_v0', bp: null, cv: null, json: null };
  for (let i = 0; i < a.length; i++) {
    if      (a[i] === '--dir')  opt.dir  = a[++i];
    else if (a[i] === '--bp')   opt.bp   = a[++i];
    else if (a[i] === '--cv')   opt.cv   = a[++i];
    else if (a[i] === '--json') opt.json = a[++i];
    else if (a[i] === '--help' || a[i] === '-h') { printHelp(); process.exit(0); }
  }
  if (!opt.bp) opt.bp = path.join(opt.dir, 'blueprints_pre_correction.jsonl');
  if (!opt.cv) opt.cv = path.join(opt.dir, 'contract_verdict_pre_correction.jsonl');
  return opt;
}
function printHelp() {
  console.log(`
execution_truth_report.js — ETC calibration (READ-ONLY)

Usage:
  node scripts/analysis/execution_truth_report.js [options]

Options:
  --dir  <path>   baseline dir (default logs/evidence/etc_baseline_v0)
  --bp   <file>   blueprints jsonl   (default <dir>/blueprints_pre_correction.jsonl)
  --cv   <file>   verdicts jsonl     (default <dir>/contract_verdict_pre_correction.jsonl)
  --json <file>   also write machine-readable report to <file>
  -h, --help      show this help
`);
}

// ─── IO + math helpers ───────────────────────────────────────────────────────
function loadJsonl(p) {
  if (!fs.existsSync(p)) { console.error(`FATAL: missing input file: ${p}`); process.exit(1); }
  const out = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return out;
}
const pctToBps = (x)      => (x == null ? null : x * 100);              // 0.2043 → 20.43
const usdToBps = (usd, s) => (usd == null || !s ? null : (usd / s) * 10000);
function blockFromSignalId(sid) {
  if (typeof sid !== 'string') return null;
  const n = parseInt(sid.split('-').pop(), 10);
  return Number.isFinite(n) ? n : null;
}
function mean(arr) {
  const v = arr.filter(x => x != null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function percentile(arr, p) {
  const v = arr.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.floor((p / 100) * v.length));
  return v[idx];
}
function fmt(n, d = 2) { return (n == null || Number.isNaN(n)) ? 'n/a' : n.toFixed(d); }
function padR(s, w) { s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function padL(s, w) { s = String(s); return s.length >= w ? s : ' '.repeat(w - s.length) + s; }
function bandOf(bps) { for (const b of BANDS) if (bps >= b.lo && bps < b.hi) return b.label; return 'unknown'; }
function rule(c = '─', n = 75) { return c.repeat(n); }

// ─── Main ────────────────────────────────────────────────────────────────────
function main() {
  const opt = parseArgs();
  const blueprints = loadJsonl(opt.bp);
  const verdicts   = loadJsonl(opt.cv);

  // Index blueprints by signalBlock for the join
  const bpByBlock = new Map();
  for (const bp of blueprints) {
    const b = bp.signalBlock;
    if (b == null) continue;
    if (!bpByBlock.has(b)) bpByBlock.set(b, []);
    bpByBlock.get(b).push(bp);
  }

  // Join verdicts → blueprints
  let unmatched = 0;
  const joined = [];
  for (const v of verdicts) {
    const blk = blockFromSignalId(v.signalId);
    let cands = (blk != null && bpByBlock.has(blk)) ? bpByBlock.get(blk) : [];
    let bp = null;
    if (cands.length === 1) {
      bp = cands[0];
    } else if (cands.length > 1) {
      let best = null, bestD = Infinity;
      for (const c of cands) {
        const cb = pctToBps(c.economics?.spreadPct);
        const d = Math.abs((cb ?? 1e9) - (v.spreadBps ?? -1e9));
        if (d < bestD) { bestD = d; best = c; }
      }
      bp = best;
    } else {
      // fallback: nearest spread match across all blueprints, within 0.5 bps
      let best = null, bestD = Infinity;
      for (const c of blueprints) {
        const cb = pctToBps(c.economics?.spreadPct);
        if (cb == null) continue;
        const d = Math.abs(cb - (v.spreadBps ?? -1e9));
        if (d < bestD) { bestD = d; best = c; }
      }
      if (best && bestD <= 0.5) bp = best;
    }
    if (!bp) { unmatched++; continue; }
    joined.push({ v, bp });
  }

  // Per-record layer decomposition
  const recs = joined.map(({ v, bp }) => {
    const e = bp.economics || {};
    const size      = bp.sizing?.targetUsd ?? 200;
    const quoted    = pctToBps(e.spreadPct);        // quoted top-of-book spread
    const venueFee  = pctToBps(e.feeBurden);        // 0.06 → 6 bps (Uni 1 + Ramses 5)
    const bpSlip    = e.slippageBps ?? null;        // blueprint-modeled slippage (bps)
    const gasBps    = usdToBps(e.gasCostUsd, size); // gas as bps of size
    const bpEdge    = pctToBps(e.expectedEdgePct);  // blueprint final edge (NO aave)
    const aaveBps   = AAVE_FLASH_FEE_BPS;           // deterministic, omitted by blueprint
    const trueModeled = (bpEdge == null) ? null : bpEdge - aaveBps; // blueprint − aave
    const v2Edge    = usdToBps(v.v2RealisticNetUsd, size); // v2 modeled (aave + friction)
    const reverted  = (v.wouldExecute === false) || (v.passesDryRun === false);
    // realized: reverted at 1-wei threshold → bounded ≤ 0 bps (upper bound)
    const realizedUB = reverted ? 0 : v2Edge;
    // drift = modeled − realized; realized ≤ 0 ⇒ drift ≥ modeled (lower bound)
    const v2DriftLB = (v2Edge == null)  ? null : v2Edge  - realizedUB;
    const bpDriftLB = (bpEdge == null)  ? null : bpEdge  - realizedUB;
    return {
      signalId: v.signalId, block: blockFromSignalId(v.signalId), size,
      quoted, venueFee, bpSlip, gasBps, bpEdge, aaveBps, trueModeled,
      v2Edge, reverted, realizedUB, v2DriftLB, bpDriftLB,
      revertReason: v.revertReason, wouldExecute: v.wouldExecute === true,
      v2NetUsd: v.v2RealisticNetUsd,
    };
  });

  const survivors = recs.filter(r => r.wouldExecute).length;
  const surviveRate = recs.length ? (survivors / recs.length) * 100 : 0;

  // ── Header ──────────────────────────────────────────────────────────────
  console.log('═'.repeat(75));
  console.log('  AllMight — Execution Truth Report (ETC Baseline v1)');
  console.log('  Boss G2.13 | READ-ONLY | "quoted spread ≠ executable spread"');
  console.log(`  Generated: ${new Date().toISOString()}`);
  console.log('═'.repeat(75));
  console.log(`  Blueprints loaded:  ${blueprints.length}`);
  console.log(`  Contract verdicts:  ${verdicts.length}`);
  console.log(`  Joined records:     ${joined.length}`);
  console.log(`  Unmatched verdicts: ${unmatched}`);
  console.log(`  Contract survivors: ${survivors} / ${recs.length}  (${fmt(surviveRate)}%)`);
  console.log('');

  // ── SECTION 1: Layered friction decomposition (the centerpiece) ──────────
  console.log(rule());
  console.log('  SECTION 1 — LAYERED FRICTION DECOMPOSITION (avg across survivors)');
  console.log(rule());
  const avg = {
    quoted:   mean(recs.map(r => r.quoted)),
    venueFee: mean(recs.map(r => r.venueFee)),
    bpSlip:   mean(recs.map(r => r.bpSlip)),
    gasBps:   mean(recs.map(r => r.gasBps)),
    bpEdge:   mean(recs.map(r => r.bpEdge)),
    v2Edge:   mean(recs.map(r => r.v2Edge)),
  };
  const trueModeledAvg = (avg.bpEdge == null) ? null : avg.bpEdge - AAVE_FLASH_FEE_BPS;
  const line = (label, bps, kind) =>
    console.log(`  ${padR(label, 30)} ${padL(fmt(bps), 8)} bps   ${kind}`);
  console.log(`  ${padR('Layer', 30)} ${padL('BPS', 8)}       Class`);
  console.log(`  ${rule('-', 60)}`);
  line('quoted spread',            avg.quoted,        '(starting point)');
  line('  − venue fees',           avg.venueFee  == null ? null : -avg.venueFee, 'DETERMINISTIC');
  line('  − blueprint slippage',   avg.bpSlip    == null ? null : -avg.bpSlip,   'DETERMINISTIC (configured)');
  line('  − gas',                  avg.gasBps    == null ? null : -avg.gasBps,   'DETERMINISTIC');
  line('= blueprint modeled edge', avg.bpEdge,        '(blueprint finalEdge — NO aave)');
  line('  − Aave flash fee',       -AAVE_FLASH_FEE_BPS, 'DETERMINISTIC (X-bug: omitted by blueprint)');
  line('= true modeled edge',      trueModeledAvg,    '(blueprint − aave)');
  line('  − v2 extra friction',    (avg.v2Edge == null || trueModeledAvg == null) ? null : -(trueModeledAvg - avg.v2Edge), 'v2 friction term');
  line('= v2 modeled edge',        avg.v2Edge,        '(v2RealisticNetUsd → bps)');
  line('realized execution',       0,                 'UPPER BOUND (reverted ≤ 0)');
  line('UNEXPLAINED DRIFT',        avg.v2Edge,        'EMERGENT — ≥ this (the truth gap)');
  console.log('');
  console.log('  Note: "realized" is an upper bound (≤0) because all candidates');
  console.log('  reverted at the ~zero (1-wei) profit threshold. Unexplained drift is');
  console.log('  therefore a LOWER bound: at least the entire v2 modeled edge vanished.');
  console.log('');

  // ── SECTION 2: Spread-band survival table ────────────────────────────────
  console.log(rule());
  console.log('  SECTION 2 — SPREAD-BAND SURVIVAL');
  console.log(rule());
  console.log(`  ${padR('Band', 10)} ${padL('n', 5)} ${padL('survive%', 9)} ${padL('avgQuoted', 10)} ${padL('avgV2Edge', 10)}`);
  console.log(`  ${rule('-', 50)}`);
  for (const b of BANDS) {
    const inBand = recs.filter(r => r.quoted != null && bandOf(r.quoted) === b.label);
    if (!inBand.length) continue;
    const surv = inBand.filter(r => r.wouldExecute).length;
    const sr = (surv / inBand.length) * 100;
    console.log(`  ${padR(b.label, 10)} ${padL(inBand.length, 5)} ${padL(fmt(sr) + '%', 9)} ${padL(fmt(mean(inBand.map(r => r.quoted))), 10)} ${padL(fmt(mean(inBand.map(r => r.v2Edge))), 10)}`);
  }
  console.log('');

  // ── SECTION 3: Modeled-vs-realized drift table ───────────────────────────
  console.log(rule());
  console.log('  SECTION 3 — MODELED vs REALIZED DRIFT (by band)');
  console.log(rule());
  console.log(`  ${padR('Band', 10)} ${padL('n', 4)} ${padL('bpEdge', 8)} ${padL('v2Edge', 8)} ${padL('realiz', 8)} ${padL('driftLB', 8)}`);
  console.log(`  ${rule('-', 56)}`);
  for (const b of BANDS) {
    const inBand = recs.filter(r => r.quoted != null && bandOf(r.quoted) === b.label);
    if (!inBand.length) continue;
    console.log(`  ${padR(b.label, 10)} ${padL(inBand.length, 4)} ${padL(fmt(mean(inBand.map(r => r.bpEdge))), 8)} ${padL(fmt(mean(inBand.map(r => r.v2Edge))), 8)} ${padL('≤0', 8)} ${padL('≥' + fmt(mean(inBand.map(r => r.v2DriftLB))), 8)}`);
  }
  console.log('  (realiz = realized edge upper bound; driftLB = unexplained drift lower bound)');
  console.log('');

  // ── SECTION 4: Revert taxonomy ───────────────────────────────────────────
  console.log(rule());
  console.log('  SECTION 4 — REVERT TAXONOMY');
  console.log(rule());
  const taxonomy = {};
  for (const r of recs) {
    const k = r.wouldExecute ? 'WOULD_EXECUTE' : (r.revertReason || 'UNKNOWN');
    taxonomy[k] = (taxonomy[k] || 0) + 1;
  }
  const total = recs.length || 1;
  console.log(`  ${padR('Outcome', 28)} ${padL('count', 7)} ${padL('%', 7)}`);
  console.log(`  ${rule('-', 44)}`);
  for (const [k, n] of Object.entries(taxonomy).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${padR(k, 28)} ${padL(n, 7)} ${padL(fmt((n / total) * 100), 7)}`);
  }
  console.log('');

  // ── SECTION 5: Unexplained drift distribution ────────────────────────────
  console.log(rule());
  console.log('  SECTION 5 — UNEXPLAINED DRIFT DISTRIBUTION (v2 modeled edge that vanished)');
  console.log(rule());
  const drifts = recs.map(r => r.v2DriftLB);
  console.log(`  Drift is a LOWER BOUND (≥) since realized ≤ 0.`);
  console.log(`  n=${drifts.filter(x => x != null).length}`);
  console.log(`  min   = ≥${fmt(percentile(drifts, 0))} bps`);
  console.log(`  p25   = ≥${fmt(percentile(drifts, 25))} bps`);
  console.log(`  median= ≥${fmt(percentile(drifts, 50))} bps`);
  console.log(`  p75   = ≥${fmt(percentile(drifts, 75))} bps`);
  console.log(`  max   = ≥${fmt(percentile(drifts, 100))} bps`);
  console.log(`  mean  = ≥${fmt(mean(drifts))} bps`);
  console.log('');

  // ── SECTION 6: Profitability frontier estimate ───────────────────────────
  console.log(rule());
  console.log('  SECTION 6 — PROFITABILITY FRONTIER ESTIMATE');
  console.log(rule());
  const quotedVals = recs.map(r => r.quoted).filter(x => x != null);
  const maxQuoted = quotedVals.length ? Math.max(...quotedVals) : null;
  const minQuoted = quotedVals.length ? Math.min(...quotedVals) : null;
  if (survivors === 0) {
    console.log(`  Observed survival: 0% across the ENTIRE sampled range`);
    console.log(`  Sampled spread range: ${fmt(minQuoted)} – ${fmt(maxQuoted)} bps`);
    console.log('');
    console.log(`  ⇒ The profitability frontier lies ABOVE ${fmt(maxQuoted)} bps.`);
    console.log(`    Every candidate up to the observed maximum was unprofitable.`);
    console.log(`    This is MORE pessimistic than the predicted curve. Locating the`);
    console.log(`    true frontier requires higher-spread samples (none exist in this`);
    console.log(`    single-session baseline).`);
  } else {
    // find lowest band with >0 survival
    let frontier = null;
    for (const b of BANDS) {
      const inBand = recs.filter(r => r.quoted != null && bandOf(r.quoted) === b.label);
      if (inBand.length && inBand.some(r => r.wouldExecute)) { frontier = b.label; break; }
    }
    console.log(`  First band with any survival: ${frontier}`);
    console.log(`  Overall survival: ${fmt(surviveRate)}%`);
  }
  console.log('');

  // ── SECTION 7: Deterministic vs Emergent friction summary ────────────────
  console.log(rule());
  console.log('  SECTION 7 — FRICTION CLASSIFICATION (Boss G2.13)');
  console.log(rule());
  const detTotal = (avg.venueFee || 0) + (avg.bpSlip || 0) + (avg.gasBps || 0) + AAVE_FLASH_FEE_BPS;
  console.log(`  DETERMINISTIC friction (model should know exactly):`);
  console.log(`    venue fees:          ${fmt(avg.venueFee)} bps`);
  console.log(`    blueprint slippage:  ${fmt(avg.bpSlip)} bps (configured tolerance)`);
  console.log(`    gas:                 ${fmt(avg.gasBps)} bps`);
  console.log(`    Aave flash fee:      ${fmt(AAVE_FLASH_FEE_BPS)} bps  ← X-bug: omitted by blueprint`);
  console.log(`    ──────────────────────────────`);
  console.log(`    total deterministic: ${fmt(detTotal)} bps`);
  console.log('');
  console.log(`  EMERGENT friction (market-created, the calibration target):`);
  console.log(`    unexplained drift:   ≥${fmt(mean(drifts))} bps (avg)`);
  console.log(`    = depth traversal + price impact + liquidity shape + state mutation`);
  console.log(`    This is what NO deterministic model captured. THIS is the Z-gap.`);
  console.log('');

  // ── Limitations ──────────────────────────────────────────────────────────
  console.log(rule());
  console.log('  LIMITATIONS (honest disclosure)');
  console.log(rule());
  console.log('  1. Realized output is BOUNDED, not measured. Reverted staticCalls');
  console.log('     return nothing; realized profit only known to be < 1 wei (≈$0).');
  console.log('     → realized edge ≤ 0; drift ≥ modeled edge.');
  console.log('  2. Single-session baseline (20260522_0135). Frontier above the');
  console.log('     observed max spread cannot be located without more samples.');
  console.log('  3. Blueprint netProfitUsd vs expectedEdgePct showed internal');
  console.log('     inconsistency in recon — this report uses expectedEdgePct for');
  console.log('     edge and v2RealisticNetUsd for the realistic modeled edge.');
  console.log('  4. Precise realized bps requires future quoter-based capture at the');
  console.log('     historical block (separate ETC step, needs Boss approval).');
  console.log('');
  console.log('═'.repeat(75));
  console.log('  ETC BASELINE v1 COMPLETE — no patches applied, baseline preserved');
  console.log('═'.repeat(75));

  // ── Optional JSON output ──────────────────────────────────────────────────
  if (opt.json) {
    const report = {
      generatedAt: new Date().toISOString(),
      inputs: { blueprints: opt.bp, verdicts: opt.cv },
      counts: { blueprints: blueprints.length, verdicts: verdicts.length,
                joined: joined.length, unmatched, survivors, surviveRatePct: surviveRate },
      layeredFrictionAvg: {
        quotedBps: avg.quoted, venueFeeBps: avg.venueFee, blueprintSlipBps: avg.bpSlip,
        gasBps: avg.gasBps, blueprintModeledEdgeBps: avg.bpEdge,
        aaveFeeBps: AAVE_FLASH_FEE_BPS, trueModeledEdgeBps: trueModeledAvg,
        v2ModeledEdgeBps: avg.v2Edge, realizedEdgeUpperBoundBps: 0,
        unexplainedDriftLowerBoundBps: avg.v2Edge,
      },
      bands: BANDS.map(b => {
        const inBand = recs.filter(r => r.quoted != null && bandOf(r.quoted) === b.label);
        return {
          band: b.label, n: inBand.length,
          surviveRatePct: inBand.length ? (inBand.filter(r => r.wouldExecute).length / inBand.length) * 100 : 0,
          avgQuotedBps: mean(inBand.map(r => r.quoted)),
          avgV2EdgeBps: mean(inBand.map(r => r.v2Edge)),
          avgDriftLBBps: mean(inBand.map(r => r.v2DriftLB)),
        };
      }).filter(x => x.n > 0),
      revertTaxonomy: taxonomy,
      driftDistributionBps: {
        min: percentile(drifts, 0), p25: percentile(drifts, 25),
        median: percentile(drifts, 50), p75: percentile(drifts, 75),
        max: percentile(drifts, 100), mean: mean(drifts),
        note: 'lower bound (≥); realized ≤ 0',
      },
      frontier: { observedMinBps: minQuoted, observedMaxBps: maxQuoted,
                  survivors, note: survivors === 0 ? `frontier above ${fmt(maxQuoted)} bps` : 'see bands' },
      frictionClassification: {
        deterministicBps: { venueFee: avg.venueFee, blueprintSlip: avg.bpSlip,
                            gas: avg.gasBps, aaveFee: AAVE_FLASH_FEE_BPS, total: detTotal },
        emergentDriftLowerBoundBps: mean(drifts),
      },
    };
    fs.writeFileSync(opt.json, JSON.stringify(report, null, 2));
    console.log(`\n  JSON written: ${opt.json}`);
  }
}

main();
