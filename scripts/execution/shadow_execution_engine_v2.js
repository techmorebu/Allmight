// scripts/execution/shadow_execution_engine_v2.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Shadow Execution Engine v2 (Realistic Estimates)
//
// Adds calibrated execution realism on top of v1's opportunity estimates.
// v1 = signal-time upper bound (assumes instant fill at entry spread)
// v2 = execution-adjusted estimate (models real-world friction)
//
// CALIBRATION SOURCE: session_20260426_2209 sandbox results (6,749 records)
//
// Key findings that drive the model:
//   Sandbox breakeven spread:   17.4bps (min spread for SANDBOX_PROFIT)
//   Cost-model breakeven:       12.4bps (gas + swap + aave at $200)
//   Gap = execution friction:    5.0bps ($0.10 at $200, calibrated fixed overhead)
//   Fill delay:                 ~11s (constant — does NOT predict outcome)
//   Liquidity impact:           ~0.4bps at $200/$450k pool (negligible)
//   Gas variability:            <$0.0003 range (treat as fixed)
//
// What the 5bps friction represents:
//   Real exit spread < entry spread. By the time execution completes (~11s),
//   the arbitrage spread partially closes. This is a structural feature of
//   the surface, not random noise. The sandbox replay confirms it is consistent.
//
// Expected improvement vs v1:
//   False positives:       1357 → ~48 (eliminates 12.4-17.4bps gap zone)
//   Direction accuracy:    40.7% → ~97%
//
// ANALYTICS ONLY. No live execution. MODE 0 PAPER enforced.
//
// Usage:
//   node scripts/execution/shadow_execution_engine_v2.js
//   node scripts/execution/shadow_execution_engine_v2.js --session logs/sessions/session_X
//   node scripts/execution/shadow_execution_engine_v2.js --json
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs    = require('fs');
const path  = require('path');

// Import base engine — v2 extends v1, does not replace it
const v1 = require('./shadow_execution_engine.js');

// ─── REALISM MODEL (calibrated from sandbox 2026-04-29) ──────────────────────

const REALISM = {
  // Execution friction: 5bps fixed overhead beyond simple cost model.
  // = sandbox breakeven (17.4bps) - cost-model breakeven (12.4bps)
  // Represents: partial spread compression during ~11s fill window.
  // Calibrated from 6,749 sandbox records. Treat as fixed until more data.
  frictionBps       : 5.0,

  // Fill delay: ~11s constant. Does NOT predict outcome — spread level does.
  // Included for documentation; not used in penalty calculation.
  fillDelayMs       : 11000,

  // Liquidity impact at current sizes (negligible — included for completeness)
  // impact = tradeSize / poolDepth = $200 / $450,000 = 0.044% = 0.44bps
  // Below measurement noise — set to 0 until trade size increases.
  liquidityImpactBps: 0.0,

  // Gas: fixed at Arbitrum conditions. No variability penalty needed.
  gasMultiplier     : 1.0,

  // Survival rate from sandbox at delay=0 (ground truth calibration)
  sandboxSurvivalRate: 0.40,
};

// ─── REALISTIC PnL ESTIMATE ──────────────────────────────────────────────────

function estimateRealisticPnL(signal, theoreticalSize) {
  const spread    = signal.spread ?? signal.netSpreadPct ?? 0;
  const spreadBps = spread * 100;

  // Base costs (same as v1)
  const gasUnits   = signal.gasUnits ?? 700000;
  const gasGwei    = signal.gasPriceGwei ?? 0.02;
  const ethPrice   = signal.uniPrice ?? signal.ethPrice ?? 2300;
  const gasUsd     = gasUnits * gasGwei * 1e-9 * ethPrice * REALISM.gasMultiplier;
  const swapFeeUsd = theoreticalSize * 0.0006;
  const aaveFeeUsd = theoreticalSize * 0.0005;

  // v1 opportunity estimate (signal-time upper bound)
  const grossUsd      = theoreticalSize * spread / 100;
  const opportunityNet = grossUsd - gasUsd - swapFeeUsd - aaveFeeUsd;

  // v2 realism adjustment
  const frictionUsd    = theoreticalSize * REALISM.frictionBps / 10000;
  const impactUsd      = theoreticalSize * REALISM.liquidityImpactBps / 10000;
  const realisticNet   = opportunityNet - frictionUsd - impactUsd;

  // Calibrated survival: does spread survive execution?
  // Threshold = cost-model breakeven + friction = 12.4 + 5.0 = 17.4bps
  const realisticBreakevenBps = (gasUsd + swapFeeUsd + aaveFeeUsd + frictionUsd) / theoreticalSize * 10000;
  const survives = spreadBps >= realisticBreakevenBps;

  return {
    // v1 fields (unchanged for backwards-compatibility)
    estimatedGrossUsd   : +Math.max(0, grossUsd).toFixed(4),
    estimatedGasUsd     : +gasUsd.toFixed(4),
    estimatedSwapFeeUsd : +swapFeeUsd.toFixed(4),
    estimatedAaveFeeUsd : +aaveFeeUsd.toFixed(4),
    estimatedNetUsd     : +opportunityNet.toFixed(4),

    // v2 realism fields (additive — do not replace v1)
    realisticFrictionUsd       : +frictionUsd.toFixed(4),
    realisticLiquidityImpactUsd: +impactUsd.toFixed(4),
    realisticNetUsd            : +realisticNet.toFixed(4),
    realisticBreakevenBps      : +realisticBreakevenBps.toFixed(1),
    realisticSurvives          : survives,
  };
}

// ─── PER-SIGNAL CLASSIFIER (v2) ──────────────────────────────────────────────

function classifySignalV2(signal, ctx, sessionId) {
  // Run v1 classification first
  const base = v1.classifySignal(signal, ctx, sessionId);

  const spread    = signal.spread ?? signal.netSpreadPct ?? 0;
  const theoreticalSize = signal.bestSize
    ?? (signal.confidence >= 0.98 ? 500 : 200);

  const pnl = estimateRealisticPnL(signal, theoreticalSize);

  // ── G-7 EXECUTION-EVIDENCE PROPAGATION (Boss C9) ────────────────────────
  // COPY ONLY. This writer is not a calculator: it never computes, infers or
  // derives executability. realisticSurvives must NEVER manufacture it.
  //   present upstream  → exact value preserved (including false)
  //   absent upstream   → field remains absent
  // failureClass is deliberately excluded per ruling.
  // signalId arrives via ...base (v1.classifySignal) and is preserved by the
  // spread; it is re-copied explicitly only when the upstream signal carries
  // one, so provenance is unambiguous.
  const evidence = {};
  if (Object.prototype.hasOwnProperty.call(signal, 'modelVersion')) {
    evidence.modelVersion = signal.modelVersion;
  }
  if (Object.prototype.hasOwnProperty.call(signal, 'executableUnderCurrentExecutor')) {
    evidence.executableUnderCurrentExecutor = signal.executableUnderCurrentExecutor;
  }
  if (signal.signalId !== undefined) {
    evidence.signalId = signal.signalId;
  }

  return {
    ...base,
    // v2 realism additions
    realisticFrictionUsd       : pnl.realisticFrictionUsd,
    realisticLiquidityImpactUsd: pnl.realisticLiquidityImpactUsd,
    realisticNetUsd            : pnl.realisticNetUsd,
    realisticBreakevenBps      : pnl.realisticBreakevenBps,
    realisticSurvives          : pnl.realisticSurvives,
    // G-7 propagated execution evidence — copied, never derived
    ...evidence,
  };
}

// ─── SESSION PROCESSOR (v2) ──────────────────────────────────────────────────

function processSessionV2(sessionDir, sessionId) {
  const ctx = v1.loadSessionContext(sessionDir);

  // Load signals
  let signals = [];
  try {
    const lines = fs.readFileSync(path.join(sessionDir, 'activator.jsonl'), 'utf8')
      .split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const r = JSON.parse(l);
        if (r.type === 'signal' && r.signal === 'EXECUTION_READY') signals.push(r);
      } catch { }
    }
  } catch { }

  if (signals.length === 0) return { sessionId, processed: 0, totals: null };

  const classified = signals.map(s => classifySignalV2(s, ctx, sessionId));

  // Write v2 ledger alongside v1 (separate file — does not overwrite v1)
  const ledgerPath = path.join(sessionDir, 'shadow_execution_ledger_v2.jsonl');
  fs.writeFileSync(ledgerPath, classified.map(r => JSON.stringify(r)).join('\n') + '\n');

  // Compute v2 totals
  const realisticPositive = classified.filter(r => r.realisticSurvives);
  const realisticNegative = classified.filter(r => !r.realisticSurvives);

  // v2 PnL: only signals that both survive execution AND pass gate
  const shadowRealisticPnLUsd = classified
    .filter(r => r.realisticSurvives && r.realisticNetUsd > 0)
    .reduce((s, r) => s + r.realisticNetUsd, 0);

  // v2 PnL: all realistic survivors regardless of gate
  const shadowRealisticTheoreticalUsd = classified
    .filter(r => r.realisticNetUsd > 0)
    .reduce((s, r) => s + r.realisticNetUsd, 0);

  // Calibrated estimate: theoretical × sandbox survival rate
  const shadowCalibratedEstimateUsd = shadowRealisticTheoreticalUsd * REALISM.sandboxSurvivalRate;

  // Direction accuracy improvement: compare v2 vs v1
  // Join to sandbox for ground truth (best-effort)
  let joinedToSandbox = 0, v1DirMatch = 0, v2DirMatch = 0;
  let v1FP = 0, v2FP = 0, v1FN = 0, v2FN = 0;
  try {
    const bpLines = fs.readFileSync(path.join(sessionDir, 'blueprints.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const bpByBlock = {};
    for (const bp of bpLines) bpByBlock[String(bp.signalBlock ?? '')] = bp.blueprintId;

    const sbResults = JSON.parse(fs.readFileSync(
      path.join(sessionDir, 'sandbox_results.json'), 'utf8')).results ?? [];
    const sbByBp = {};
    for (const r of sbResults) {
      if (!sbByBp[r.blueprintId]) sbByBp[r.blueprintId] = [];
      sbByBp[r.blueprintId].push(r);
    }

    for (const rec of classified) {
      const block  = String(rec.signalId ?? '').split('-').pop();
      const bpId   = bpByBlock[block];
      const sbRes  = bpId ? (sbByBp[bpId] ?? []) : [];
      if (sbRes.length === 0) continue;
      joinedToSandbox++;

      const sbViable  = sbRes.some(r => r.executionClass === 'EXECUTION_VIABLE');
      const v1Positive = rec.estimatedNetUsd > 0;
      const v2Positive = rec.realisticSurvives;

      if (v1Positive === sbViable) v1DirMatch++;
      if (v2Positive === sbViable) v2DirMatch++;
      if (v1Positive && !sbViable)  v1FP++;
      if (v2Positive && !sbViable)  v2FP++;
      if (!v1Positive && sbViable)  v1FN++;
      if (!v2Positive && sbViable)  v2FN++;
    }
  } catch { /* fail-silent */ }

  const totals = {
    generatedAt               : new Date().toISOString(),
    sessionId,
    engineVersion             : 'v2',
    totalSignals              : classified.length,
    realism: {
      frictionBps             : REALISM.frictionBps,
      frictionUsdAt200        : REALISM.frictionBps * 200 / 10000,
      realisticBreakevenBps   : +(REALISM.frictionBps + 12.4).toFixed(1),
      calibrationSource       : 'sandbox 6,749 records — session_20260426_2209',
    },
    // Survival counts
    realisticPositiveCount    : realisticPositive.length,
    realisticNegativeCount    : realisticNegative.length,
    realisticSurvivalRate     : +(realisticPositive.length / classified.length * 100).toFixed(1),
    // PnL estimates
    shadowRealisticPnLUsd     : +shadowRealisticPnLUsd.toFixed(4),         // gate-cleared realistic
    shadowRealisticTheoreticalUsd : +shadowRealisticTheoreticalUsd.toFixed(4), // all survivors
    shadowCalibratedEstimateUsd   : +shadowCalibratedEstimateUsd.toFixed(4),   // × sandbox rate
    // Accuracy improvement vs v1
    joinedToSandbox,
    v1DirectionAccuracyPct    : joinedToSandbox > 0 ? +(v1DirMatch / joinedToSandbox * 100).toFixed(1) : null,
    v2DirectionAccuracyPct    : joinedToSandbox > 0 ? +(v2DirMatch / joinedToSandbox * 100).toFixed(1) : null,
    v1FalsePositive           : v1FP,
    v2FalsePositive           : v2FP,
    v1FalseNegative           : v1FN,
    v2FalseNegative           : v2FN,
    falsePositiveReduction    : v1FP > 0 ? +((1 - v2FP / v1FP) * 100).toFixed(1) : null,
  };

  const totalsPath = path.join(sessionDir, 'shadow_execution_totals_v2.json');
  fs.writeFileSync(totalsPath, JSON.stringify(totals, null, 2));
  return { sessionId, processed: classified.length, totals };
}

// ─── CLI ────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const args       = process.argv.slice(2);
  const jsonMode   = args.includes('--json');
  const sessionIdx = args.indexOf('--session');
  const LOGS_DIR   = path.resolve(process.cwd(), 'logs');

  let sessionDir = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
  if (!sessionDir) {
    const ptr = path.join(LOGS_DIR, 'allmight.session');
    if (fs.existsSync(ptr)) {
      const sid = fs.readFileSync(ptr, 'utf8').trim();
      sessionDir = path.join(LOGS_DIR, 'sessions', `session_${sid}`);
    }
  }
  if (!sessionDir || !fs.existsSync(sessionDir)) {
    console.error('Session not found. Use --session <path>');
    process.exit(1);
  }

  const sessionId = path.basename(sessionDir).replace('session_', '');
  const result    = processSessionV2(sessionDir, sessionId);

  if (jsonMode) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

  const t = result.totals;
  if (!t) { console.log('No signals to process.'); process.exit(0); }

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Shadow Execution v2 (Realistic) — ${sessionId}`);
  console.log(`  Signals: ${result.processed.toLocaleString()}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Realism model: ${t.realism.frictionBps}bps friction`);
  console.log(`    Cost-only breakeven:     12.4bps`);
  console.log(`    Realistic breakeven:     ${t.realism.realisticBreakevenBps}bps`);
  console.log(`    Friction at $200:        $${t.realism.frictionUsdAt200}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Realistic survivors: ${t.realisticPositiveCount} / ${t.totalSignals} (${t.realisticSurvivalRate}%)`);
  console.log(`  Realistic PnL (theoretical): $${t.shadowRealisticTheoreticalUsd}`);
  console.log(`  Calibrated estimate (×${REALISM.sandboxSurvivalRate}):  $${t.shadowCalibratedEstimateUsd}`);
  if (t.joinedToSandbox > 0) {
    console.log('───────────────────────────────────────────────────────');
    console.log('  Direction accuracy vs sandbox:');
    console.log(`    v1: ${t.v1DirectionAccuracyPct}%  (FP=${t.v1FalsePositive} FN=${t.v1FalseNegative})`);
    console.log(`    v2: ${t.v2DirectionAccuracyPct}%  (FP=${t.v2FalsePositive} FN=${t.v2FalseNegative})`);
    if (t.falsePositiveReduction) {
      console.log(`    FP reduction: ${t.falsePositiveReduction}%`);
    }
  }
  console.log('═══════════════════════════════════════════════════════');
}

module.exports = { classifySignalV2, processSessionV2, estimateRealisticPnL, REALISM };
