// scripts/execution/shadow_execution_engine.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Shadow Execution Engine (ANALYTICS ONLY)
//
// Classifies each EXECUTION_READY signal through the execution gate and
// capital policy. Writes shadow_execution_ledger.jsonl and
// shadow_execution_totals.json to the session directory.
//
// NO live execution. NO private key. MODE 0 (PAPER) enforced.
//
// Consumed by:
//   execution_gate_score.js
//   capital_policy.js
//   notification_router.js  (heartbeat + stop summary)
//   project_metrics_tracker.js  (lifetime totals)
//
// Usage:
//   node scripts/execution/shadow_execution_engine.js
//   node scripts/execution/shadow_execution_engine.js --session logs/sessions/session_20260426_2209
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── GATE THRESHOLDS (from EXECUTION_GATING_POLICY.md) ───────────────────────
const GATE_THRESHOLDS = { PAPER: 75, DRY_WALLET: 85, MICRO_ELIGIBLE: 92 };
const APPROVED_MODE   = 0;   // MODE 0 — PAPER. $0 live capital. Never change here.

// ─── SCORING FUNCTIONS ────────────────────────────────────────────────────────

function spreadScore(spreadPct) {
  const bps = (spreadPct || 0) * 100;
  if (bps >= 26.0) return 100;
  if (bps >= 24.0) return 85;
  if (bps >= 23.0) return 65;
  if (bps >= 22.0) return 40;
  return 0;
}

function heatScore(heatClass) {
  return { EXTREME: 100, HOT: 75, WARM: 20, COLD: 0 }[heatClass] ?? 0;
}

function timingScore() {
  const h = new Date().getUTCHours();
  if ([10,11,12,21,22,23,2,3,4].includes(h)) return 100;
  if ([8,9,14,15,16,17].includes(h))          return 70;
  return 40;
}

function infraScore(watchdogStatus, activatorFresh, rpcExhausted) {
  if (watchdogStatus === 'HEALTHY' && activatorFresh && !rpcExhausted) return 100;
  if (watchdogStatus === 'DEGRADED' || !activatorFresh || rpcExhausted)  return 60;
  if (watchdogStatus === 'FAILED')                                         return 25;
  return 0;
}

function simulationScore(viableRate) {
  if (viableRate == null) return 0;
  if (viableRate >= 70) return 100;
  if (viableRate >= 50) return 80;
  if (viableRate >= 35) return 60;
  if (viableRate >= 20) return 35;
  return 0;
}

function confidenceScore(bossValidCount) {
  if (bossValidCount >= 10) return 100;
  if (bossValidCount >= 8)  return 95;
  if (bossValidCount >= 6)  return 85;
  if (bossValidCount >= 5)  return 75;
  if (bossValidCount >= 3)  return 50;
  if (bossValidCount >= 1)  return 25;
  return 0;
}

function computeExecutionScore(components) {
  return (
    0.30 * components.spread     +
    0.20 * components.heat       +
    0.20 * components.timing     +
    0.15 * components.infra      +
    0.10 * components.simulation +
    0.05 * components.confidence
  );
}

function gateVerdict(score, hardBlockers) {
  if (hardBlockers.length > 0)           return 'BLOCK';
  if (score >= GATE_THRESHOLDS.MICRO_ELIGIBLE) return 'MICRO_LIVE_ELIGIBLE';
  if (score >= GATE_THRESHOLDS.DRY_WALLET)     return 'DRY_WALLET_ONLY';
  if (score >= GATE_THRESHOLDS.PAPER)          return 'PAPER_ONLY';
  return 'BLOCK';
}

// ─── SHADOW PnL ESTIMATE ──────────────────────────────────────────────────────

function estimateShadowPnL(signal, theoreticalSize) {
  // FORMULA AUDIT 2026-04-28:
  // spreadPct (e.g. 0.1574) = gross spread in PERCENT form = 0.1574%
  // finalEdge (e.g. 0.06346) = net edge in PERCENT form, ALREADY deducts
  //   swap fees, slippage, and gas — it is NOT gross profit.
  //   Using finalEdge as gross and also subtracting fees = double-counting.
  //
  // Correct approach: use spreadPct as gross, deduct all costs once.
  // This matches blueprint netProfitUsd and sandbox methodology.
  //
  // Verified: size=200, spread=0.1574%, gas=$0.028, swapFee=0.06%×2=$0.12,
  //   aaveFee=0.05%=$0.10 → net=$0.167 ≈ blueprint $0.17 ✓

  const spread    = signal.spread ?? signal.netSpreadPct ?? 0; // percent form
  const gasUnits  = signal.gasUnits ?? 700000;
  const gasGwei   = signal.gasPriceGwei ?? 0.02;
  const ethPrice  = signal.uniPrice ?? signal.ethPrice ?? 2300;

  const grossUsd    = theoreticalSize * spread / 100;          // spread% × size
  const gasUsd      = gasUnits * gasGwei * 1e-9 * ethPrice;   // on-chain gas
  const swapFeeUsd  = theoreticalSize * 0.0006;               // 0.06% × 2 legs (3bps each)
  const aaveFeeUsd  = theoreticalSize * 0.0005;               // 0.05% Aave flash fee

  const netUsd = grossUsd - gasUsd - swapFeeUsd - aaveFeeUsd;

  return {
    estimatedGrossUsd   : +Math.max(0, grossUsd).toFixed(4),
    estimatedGasUsd     : +gasUsd.toFixed(4),
    estimatedSwapFeeUsd : +swapFeeUsd.toFixed(4),
    estimatedAaveFeeUsd : +aaveFeeUsd.toFixed(4),
    estimatedNetUsd     : +netUsd.toFixed(4),
  };
}

// ─── HARD BLOCKER CHECK ───────────────────────────────────────────────────────

function getHardBlockers(signal, sbViableRate, sbVerdict) {
  const blockers = [];
  const spread = signal.spread ?? signal.netSpreadPct ?? 0;

  if (process.env.LIVE_DEPLOY_APPROVED !== 'true')
    blockers.push('LIVE_DEPLOY_APPROVED != true');
  if (spread < 0.22)
    blockers.push(`spread ${(spread*100).toFixed(1)}bps < 22bps floor`);
  if (sbVerdict === 'FLASH_NOT_READY')
    blockers.push('flash_loan NOT_READY');
  if (signal.economicStatus && signal.economicStatus !== 'economically_viable')
    blockers.push(`economicStatus=${signal.economicStatus}`);

  return blockers;
}

// ─── SESSION CONTEXT LOADER ───────────────────────────────────────────────────

function loadSessionContext(sessionDir) {
  const rj = (f) => {
    try { return JSON.parse(fs.readFileSync(path.join(sessionDir, f), 'utf8')); } catch { return null; }
  };
  const rl = (f, n = 200) => {
    try {
      const lines = fs.readFileSync(path.join(sessionDir, f), 'utf8').split('\n').filter(Boolean);
      return lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  };

  const sb   = rj('sandbox_results.json');
  const fl   = rj('flash_loan_readiness.json');
  const conf = rj('dryrun_confidence.json');
  const wd   = rl('watchdog.jsonl');
  const act  = rl('activator.jsonl', 500);

  // Watchdog status
  let wdStatus = 'UNKNOWN';
  for (let i = wd.length - 1; i >= 0; i--) {
    if (wd[i]?.overallStatus) { wdStatus = wd[i].overallStatus; break; }
  }

  // Activator freshness (10 min)
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const actFresh  = act.some(r => r?.ts && new Date(r.ts).getTime() > tenMinAgo);

  // RPC exhausted count
  const rpcExhausted = rl('rpc_freshness.jsonl', 100).some(r => r.ev === 'rpc_exhausted');

  return {
    sbViableRate  : sb?.summary?.viableRate ?? null,
    sbVerdict     : fl?.verdict ?? null,
    bossValid     : conf?.summary?.bossValidTotal ?? 0,
    wdStatus,
    actFresh,
    rpcExhausted,
    approvedLadder: fl?.approvedLadder ?? [],
  };
}

// ─── PER-SIGNAL CLASSIFIER ────────────────────────────────────────────────────

function classifySignal(signal, ctx, sessionId) {
  const spread    = signal.spread ?? signal.netSpreadPct ?? 0;
  const heatClass = signal.heatClass ?? signal.heat ?? 'UNKNOWN';
  const conf      = signal.confidence ?? 0.7;

  const components = {
    spread    : spreadScore(spread),
    heat      : heatScore(heatClass),
    timing    : timingScore(),
    infra     : infraScore(ctx.wdStatus, ctx.actFresh, ctx.rpcExhausted),
    simulation: simulationScore(ctx.sbViableRate),
    confidence: confidenceScore(ctx.bossValid),
  };

  const executionScore  = computeExecutionScore(components);
  const hardBlockers    = getHardBlockers(signal, ctx.sbViableRate, ctx.sbVerdict);
  const verdict         = gateVerdict(executionScore, hardBlockers);

  // Theoretical size = activator's own validated size (bestSize field)
  // The activator already computed viability at this size via sizeSweep.
  // Fallback chain: bestSize → confidence tier → $200 default.
  // Do NOT use confidence alone — activator signals don't emit a confidence field.
  const theoreticalSize = signal.bestSize
    ?? (conf >= 0.98 ? 500 : conf >= 0.90 ? 200 : conf >= 0.80 ? 100 : conf >= 0.70 ? 200 : 200);
  const modeMax         = APPROVED_MODE === 0 ? 0 : 25; // MODE 0 = $0
  const shadowSize      = Math.max(0, Math.min(theoreticalSize, modeMax));

  const pnl = estimateShadowPnL(signal, theoreticalSize); // show what WOULD have been

  const wouldTrade = verdict === 'MICRO_LIVE_ELIGIBLE' &&
                     hardBlockers.length === 0 &&
                     signal.economicStatus === 'economically_viable' &&
                     spread >= 0.22;

  return {
    ts                 : signal.ts ?? new Date().toISOString(),
    sessionId,
    signalId           : signal.signalId ?? `${sessionId}-${signal.block ?? Date.now()}`,
    pair               : signal.pair ?? 'ETH/USDC-RAMSES',
    spreadPct          : spread,
    spreadBps          : +(spread * 100).toFixed(2),
    heatClass,
    regime             : signal.regime ?? null,
    executionScore     : +executionScore.toFixed(1),
    scoreComponents    : Object.fromEntries(Object.entries(components).map(([k,v]) => [k, +v.toFixed(1)])),
    gateVerdict        : verdict,
    capitalMode        : APPROVED_MODE,
    approvedMode       : APPROVED_MODE,
    wouldTrade,
    blockedReasons     : [...hardBlockers, ...(verdict === 'BLOCK' && hardBlockers.length === 0 ? [`score ${executionScore.toFixed(1)} < ${GATE_THRESHOLDS.PAPER}`] : [])],
    theoreticalSizeUsd : theoreticalSize,
    shadowSizeUsd      : shadowSize,
    // Opportunity value: what trade WOULD have been worth if live and gate cleared
    // NOT profit — blocked signals show opportunity value, not realised PnL
    opportunityGrossUsd  : pnl.estimatedGrossUsd,
    opportunityNetUsd    : pnl.estimatedNetUsd,     // positive = profitable, negative = unviable
    opportunityGasUsd    : pnl.estimatedGasUsd,
    opportunitySwapFeeUsd: pnl.estimatedSwapFeeUsd,
    opportunityAaveFeeUsd: pnl.estimatedAaveFeeUsd,
    // Backwards-compat aliases (used by notification_router, project_metrics_tracker)
    estimatedGrossUsd    : pnl.estimatedGrossUsd,
    estimatedNetUsd      : pnl.estimatedNetUsd,
    estimatedGasUsd      : pnl.estimatedGasUsd,
    amountOutMinReady  : (signal.sizeSweep?.length ?? 0) > 0,
    liveBlockedBy      : hardBlockers[0] ?? null,
  };
}

// ─── SESSION PROCESSOR ────────────────────────────────────────────────────────

function processSession(sessionDir, sessionId) {
  const ctx       = loadSessionContext(sessionDir);
  const ledgerPath = path.join(sessionDir, 'shadow_execution_ledger.jsonl');
  const totalsPath = path.join(sessionDir, 'shadow_execution_totals.json');

  // Load all signal records from activator.jsonl
  let signals = [];
  try {
    const lines = fs.readFileSync(path.join(sessionDir, 'activator.jsonl'), 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const r = JSON.parse(l);
        if (r.type === 'signal' && r.signal === 'EXECUTION_READY') signals.push(r);
      } catch { /* skip */ }
    }
  } catch { /* file missing */ }

  if (signals.length === 0) {
    return { sessionId, processed: 0, totals: null };
  }

  // Classify each signal
  const classified = signals.map(s => classifySignal(s, ctx, sessionId));

  // Write ledger (append-mode — idempotent via overwrite on full rerun)
  fs.writeFileSync(
    ledgerPath,
    classified.map(r => JSON.stringify(r)).join('\n') + '\n'
  );

  // Build totals
  const blocked       = classified.filter(r => r.gateVerdict === 'BLOCK').length;
  const paperOnly     = classified.filter(r => r.gateVerdict === 'PAPER_ONLY').length;
  const dryWallet     = classified.filter(r => r.gateVerdict === 'DRY_WALLET_ONLY').length;
  const microEligible = classified.filter(r => r.gateVerdict === 'MICRO_LIVE_ELIGIBLE').length;
  const wouldTrade    = classified.filter(r => r.wouldTrade).length;
  // shadowExecutablePnL: only signals that would have traded if live (gate + economic)
  // shadowTheoreticalPnL: all signals, regardless of gate status
  const shadowExecutablePnL   = classified
    .filter(r => r.wouldTrade && r.estimatedNetUsd > 0)
    .reduce((s, r) => s + r.estimatedNetUsd, 0);
  const shadowTheoreticalPnL  = classified
    .filter(r => r.estimatedNetUsd > 0)
    .reduce((s, r) => s + r.estimatedNetUsd, 0);
  const shadowProfit = shadowExecutablePnL; // primary metric = executable only
  const scores        = classified.map(r => r.executionScore);
  const maxScore      = scores.length ? Math.max(...scores) : 0;
  const avgScore      = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const bestSignal    = classified.reduce((best, r) => r.estimatedNetUsd > (best?.estimatedNetUsd ?? -Infinity) ? r : best, null);

  // Blocked opportunity: positive-net signals that gate prevented from executing
  const shadowBlockedOpportunityUsd = classified
    .filter(r => !r.wouldTrade && r.estimatedNetUsd > 0)
    .reduce((s, r) => s + r.estimatedNetUsd, 0);

  // Accuracy diagnostics — join to sandbox results where available
  // Sandbox viable rate comes from session context (sbViableRate = aggregate)
  // Per-signal sandbox join requires blueprints + sandbox_results — done here if present
  let joinedToSandbox = 0, directionMatch = 0, falsePositive = 0, falseNegative = 0;
  const sbViableRate = ctx.sbViableRate; // aggregate rate from sandbox_results.json
  // Per-signal sandbox join (best-effort — no crash if files missing)
  try {
    const bpPath = path.join(sessionDir, 'blueprints.jsonl');
    const sbPath = path.join(sessionDir, 'sandbox_results.json');
    if (fs.existsSync(bpPath) && fs.existsSync(sbPath)) {
      const bpLines = fs.readFileSync(bpPath, 'utf8').split('\n').filter(Boolean);
      const bpByBlock = {};
      for (const l of bpLines) {
        try { const r = JSON.parse(l); bpByBlock[String(r.signalBlock ?? '')] = r.blueprintId; } catch {}
      }
      const sbResults = JSON.parse(fs.readFileSync(sbPath, 'utf8')).results ?? [];
      const sbByBp = {};
      for (const r of sbResults) {
        if (!sbByBp[r.blueprintId]) sbByBp[r.blueprintId] = [];
        sbByBp[r.blueprintId].push(r);
      }
      for (const rec of classified) {
        const block = String(rec.signalId ?? '').split('-').pop();
        const bpId  = bpByBlock[block];
        const sbRes = bpId ? (sbByBp[bpId] ?? []) : [];
        if (sbRes.length === 0) continue;
        joinedToSandbox++;
        const sbViable = sbRes.some(r => r.executionClass === 'EXECUTION_VIABLE');
        const shadowPositive = rec.estimatedNetUsd > 0;
        if (shadowPositive === sbViable) directionMatch++;
        if (shadowPositive && !sbViable)  falsePositive++;
        if (!shadowPositive && sbViable)  falseNegative++;
      }
    }
  } catch { /* fail-silent — accuracy diagnostics are best-effort */ }

  const avgShadowNetUsd = classified.length > 0
    ? +(classified.reduce((s, r) => s + r.estimatedNetUsd, 0) / classified.length).toFixed(4)
    : null;

  // Block reason frequency
  const blockReasonCounts = {};
  for (const r of classified) {
    for (const b of r.blockedReasons) {
      blockReasonCounts[b] = (blockReasonCounts[b] ?? 0) + 1;
    }
  }
  const topBlockedReason = Object.entries(blockReasonCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Runtime hours for value/hr
  let runtimeH = 0;
  try {
    const ts = classified.map(r => new Date(r.ts).getTime()).filter(Boolean);
    if (ts.length >= 2) runtimeH = (Math.max(...ts) - Math.min(...ts)) / 3_600_000;
  } catch { /* skip */ }

  const totals = {
    generatedAt            : new Date().toISOString(),
    sessionId,
    totalSignals           : classified.length,
    blocked,
    paperOnly,
    dryWalletEligible      : dryWallet,
    microLiveEligible      : microEligible,
    wouldTradeIfLive       : wouldTrade,
    shadowEstimatedProfitUsd    : +shadowProfit.toFixed(4),        // executable only (gate cleared)
    shadowTheoreticalPnLUsd     : +shadowTheoreticalPnL.toFixed(4), // all viable signals (gate ignored)
    shadowBlockedOpportunityUsd : +shadowBlockedOpportunityUsd.toFixed(4), // positive-net signals gate-blocked
    shadowEstimatedValuePerHour: runtimeH > 0 ? +(shadowProfit / runtimeH).toFixed(4) : null,
    // Accuracy diagnostics (best-effort — requires blueprints.jsonl + sandbox_results.json)
    avgShadowNetUsd       : avgShadowNetUsd,
    avgSandboxViableRate  : sbViableRate,
    joinedToSandbox       : joinedToSandbox,
    directionAccuracyPct  : joinedToSandbox > 0
      ? +(directionMatch / joinedToSandbox * 100).toFixed(1) : null,
    falsePositiveCount    : falsePositive,
    falseNegativeCount    : falseNegative,
    bestSignalSpreadPct    : bestSignal?.spreadPct ?? null,
    bestSignalProfitUsd    : bestSignal?.estimatedNetUsd ?? null,
    avgExecutionScore      : +avgScore.toFixed(1),
    maxExecutionScore      : +maxScore.toFixed(1),
    topBlockedReason,
    blockReasonCounts,
    currentLiveBlockers    : [
      process.env.LIVE_DEPLOY_APPROVED !== 'true' ? 'LIVE_DEPLOY_APPROVED != true' : null,
      ctx.sbVerdict === 'FLASH_NOT_READY' ? 'flash_loan NOT_READY' : null,
    ].filter(Boolean),
    crossedPaper      : classified.some(r => r.executionScore >= 75),
    crossedDryWallet  : classified.some(r => r.executionScore >= 85),
    crossedMicro      : classified.some(r => r.executionScore >= 92),
    sessionCtx        : {
      sbViableRate  : ctx.sbViableRate,
      bossValid     : ctx.bossValid,
      wdStatus      : ctx.wdStatus,
      sbVerdict     : ctx.sbVerdict,
    },
  };

  fs.writeFileSync(totalsPath, JSON.stringify(totals, null, 2));
  return { sessionId, processed: classified.length, totals };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────

module.exports = {
  classifySignal,
  processSession,
  loadSessionContext,
  computeExecutionScore,
  spreadScore, heatScore, timingScore, infraScore, simulationScore, confidenceScore,
  gateVerdict,
  GATE_THRESHOLDS,
  APPROVED_MODE,
};

// ─── CLI ENTRYPOINT ──────────────────────────────────────────────────────────

if (require.main === module) {
  const args       = process.argv.slice(2);
  const sessionIdx = args.indexOf('--session');
  const jsonMode   = args.includes('--json');

  const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
  const SESSION_FILE = path.join(LOGS_DIR, 'allmight.session');

  let sessionDir = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
  if (!sessionDir && fs.existsSync(SESSION_FILE)) {
    const sid = fs.readFileSync(SESSION_FILE, 'utf8').trim();
    sessionDir = path.join(LOGS_DIR, 'sessions', `session_${sid}`);
  }

  if (!sessionDir || !fs.existsSync(sessionDir)) {
    console.error('ERROR: Session directory not found. Use --session <path>');
    process.exit(1);
  }

  const sessionId = path.basename(sessionDir).replace('session_', '');
  const result    = processSession(sessionDir, sessionId);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const t = result.totals;
    if (!t) { console.log('No signals to process.'); process.exit(0); }
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  Shadow Execution — ${sessionId}`);
    console.log(`  Signals processed: ${result.processed}`);
    console.log('───────────────────────────────────────────────────────');
    console.log(`  Would trade if live: ${t.wouldTradeIfLive}`);
    console.log(`  Shadow PnL:          $${t.shadowEstimatedProfitUsd.toFixed(3)}`);
    console.log(`  Value/hr:            $${t.shadowEstimatedValuePerHour?.toFixed(3) ?? 'N/A'}/h`);
    console.log(`  Best score:          ${t.maxExecutionScore}`);
    console.log(`  Avg score:           ${t.avgExecutionScore}`);
    console.log(`  Gate:                ${t.crossedMicro ? '🟢 MICRO' : t.crossedDryWallet ? '🟠 DRY_WALLET' : t.crossedPaper ? '🟡 PAPER' : '🔴 BLOCK'}`);
    console.log(`  Main blocker:        ${t.topBlockedReason ?? 'none'}`);
    console.log(`  Breakdown:           blocked=${t.blocked} paper=${t.paperOnly} dry=${t.dryWalletEligible} micro=${t.microLiveEligible}`);
    console.log('═══════════════════════════════════════════════════════');
  }
}
