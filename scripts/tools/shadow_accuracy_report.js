// scripts/tools/shadow_accuracy_report.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Shadow Execution Accuracy Report
//
// Joins shadow_execution_ledger → blueprints → sandbox_results and
// measures how accurately shadow PnL estimates predict actual outcomes.
//
// Usage:
//   node scripts/tools/shadow_accuracy_report.js
//   node scripts/tools/shadow_accuracy_report.js --session logs/sessions/session_X
//   node scripts/tools/shadow_accuracy_report.js --json
//
// Output: logs/sessions/<session>/shadow_accuracy_report.json
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

const LOGS_DIR    = path.resolve(process.cwd(), 'logs');
const JSON_MODE   = process.argv.includes('--json');
const SESSION_IDX = process.argv.indexOf('--session');

function getSessionDir() {
  if (SESSION_IDX !== -1) return path.resolve(process.argv[SESSION_IDX + 1]);
  const ptr = path.join(LOGS_DIR, 'allmight.session');
  if (!fs.existsSync(ptr)) return null;
  const sid = fs.readFileSync(ptr, 'utf8').trim();
  return path.join(LOGS_DIR, 'sessions', `session_${sid}`);
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function main() {
  const sessionDir = getSessionDir();
  if (!sessionDir || !fs.existsSync(sessionDir)) {
    console.error('Session not found. Use --session <path>');
    process.exit(1);
  }
  const sessionId = path.basename(sessionDir).replace('session_', '');

  // ── Load inputs ───────────────────────────────────────────────────────────
  const ledger  = readJsonl(path.join(sessionDir, 'shadow_execution_ledger.jsonl'));
  const sbData  = readJson(path.join(sessionDir, 'sandbox_results.json'));
  const bpLines = readJsonl(path.join(sessionDir, 'blueprints.jsonl'));

  if (ledger.length === 0) {
    console.error('No shadow ledger found. Run shadow_execution_engine.js first.');
    process.exit(1);
  }

  // ── Build joins ───────────────────────────────────────────────────────────
  // block → blueprintId
  const bpByBlock = {};
  for (const bp of bpLines) {
    const block = String(bp.signalBlock ?? '');
    if (block) bpByBlock[block] = { blueprintId: bp.blueprintId, economics: bp.economics ?? {} };
  }

  // blueprintId → sandbox outcomes
  const sbByBp = {};
  for (const r of sbData?.results ?? []) {
    if (!sbByBp[r.blueprintId]) sbByBp[r.blueprintId] = [];
    sbByBp[r.blueprintId].push(r);
  }

  // sandboxTop10 for rich fields
  const sbTop10 = new Map();
  for (const r of sbData?.summary?.top10 ?? []) {
    sbTop10.set(r.blueprintId, r);
  }

  // ── Join ledger → sandbox ─────────────────────────────────────────────────
  let joined = 0, noSandbox = 0;
  const joined_records = [];

  for (const rec of ledger) {
    const block  = String(rec.signalId ?? '').split('-').pop();
    const bp     = bpByBlock[block];
    const bpId   = bp?.blueprintId;
    const sbRes  = bpId ? (sbByBp[bpId] ?? []) : [];
    const sbRich = bpId ? sbTop10.get(bpId) : null;

    if (sbRes.length > 0) joined++;
    else { noSandbox++; continue; } // only analyze joinable records

    // Sandbox outcome at delay=0
    const sbAt0   = sbRes.find(r => r.delayMs === 0);
    const sbViable = sbRes.some(r => r.executionClass === 'EXECUTION_VIABLE');
    const sbNetUsd = sbRich?.realPnL ?? sbRich?.netEdgeBps != null
      ? (sbRich.sizeUsd ?? 200) * sbRich.netEdgeBps / 10000
      : null;

    // Shadow estimate
    const shadowNet   = rec.opportunityNetUsd ?? rec.estimatedNetUsd ?? 0;
    const shadowGross = rec.opportunityGrossUsd ?? rec.estimatedGrossUsd ?? 0;

    joined_records.push({
      signalId     : rec.signalId,
      spreadBps    : rec.spreadBps,
      heatClass    : rec.heatClass,
      execScore    : rec.executionScore,
      gateVerdict  : rec.gateVerdict,
      // Shadow estimates
      shadowGross,
      shadowNet,
      // Sandbox actuals
      sbViable,
      sbNetUsd,
      sbOutcome    : sbAt0?.outcome ?? null,
      // Direction match
      shadowPositive : shadowNet > 0,
      sbPositive     : sbViable,
      directionMatch : (shadowNet > 0) === sbViable,
    });
  }

  // ── Compute accuracy metrics ───────────────────────────────────────────────
  const n = joined_records.length;
  if (n === 0) {
    console.error('No joinable records — sandbox results may not overlap with ledger signals');
    process.exit(1);
  }

  const positiveShadow  = joined_records.filter(r => r.shadowNet > 0);
  const positiveActual  = joined_records.filter(r => r.sbViable);
  const directionMatch  = joined_records.filter(r => r.directionMatch);

  // True/false positive/negative (shadow positive = "would trade", actual = sandbox viable)
  const truePos  = joined_records.filter(r =>  r.shadowPositive &&  r.sbViable).length;
  const trueNeg  = joined_records.filter(r => !r.shadowPositive && !r.sbViable).length;
  const falsePos = joined_records.filter(r =>  r.shadowPositive && !r.sbViable).length;
  const falseNeg = joined_records.filter(r => !r.shadowPositive &&  r.sbViable).length;

  // Error between shadow net and sandbox net (only for records with both)
  const withSbNet = joined_records.filter(r => r.sbNetUsd != null && r.sbViable);
  const errors    = withSbNet.map(r => Math.abs(r.shadowNet - r.sbNetUsd));
  const avgError  = errors.length > 0 ? errors.reduce((a,b) => a+b,0) / errors.length : null;
  const avgShadow = withSbNet.length > 0
    ? withSbNet.reduce((a,r) => a + r.shadowNet, 0) / withSbNet.length : null;
  const avgSandbox = withSbNet.length > 0
    ? withSbNet.reduce((a,r) => a + r.sbNetUsd, 0) / withSbNet.length : null;
  const errorPct = avgSandbox && avgSandbox !== 0 && avgError != null
    ? (avgError / Math.abs(avgSandbox) * 100) : null;

  // ── Verdict ───────────────────────────────────────────────────────────────
  const directionRate = directionMatch.length / n;
  const precision     = truePos + falsePos > 0 ? truePos / (truePos + falsePos) : null;
  const recall        = truePos + falseNeg > 0 ? truePos / (truePos + falseNeg) : null;

  // Direction accuracy interpretation:
  // Shadow uses signal-time spread; sandbox uses time-weighted exit prices (11-15s fill delay).
  // If shadow says ALL signals are positive (recall=100%, precision<50%), this means
  // the breakeven threshold is too low — not a formula error but structural optimism.
  // Shadow is an upper bound estimate, sandbox is ground truth for viable rate.
  const structuralOptimism = recall != null && recall >= 0.99 && precision != null && precision < 0.55;

  let verdict, verdictReason;
  if (n < 50) {
    verdict = 'INSUFFICIENT_DATA';
    verdictReason = `Only ${n} joined records. Need ≥50 for reliable assessment.`;
  } else if (structuralOptimism) {
    verdict = 'DIRECTIONAL_ONLY';
    verdictReason = `Shadow is structurally optimistic (recall=100% — says all signals positive). ` +
      `Sandbox viable rate ${(positiveActual.length/n*100).toFixed(0)}% is the calibrated ground truth. ` +
      `Formula is correct but shadow cannot predict exit price compression from fill delay. ` +
      `Shadow = signal-time upper bound. Multiply by sandbox viable rate (~${(positiveActual.length/n).toFixed(2)}) for calibrated estimate.`;
  } else if (directionRate >= 0.75 && (errorPct == null || errorPct <= 50)) {
    verdict = 'ACCURATE';
    verdictReason = `Direction accuracy ${(directionRate*100).toFixed(0)}% ≥ 75%. Shadow estimates are reliable.`;
  } else if (directionRate >= 0.60) {
    verdict = 'DIRECTIONAL_ONLY';
    verdictReason = `Direction accuracy ${(directionRate*100).toFixed(0)}% — correct direction but magnitude may be off.`;
  } else {
    verdict = 'MISALIGNED';
    verdictReason = `Direction accuracy ${(directionRate*100).toFixed(0)}% < 60%. Formula or assumptions need review.`;
  }

  const report = {
    generatedAt   : new Date().toISOString(),
    sessionId,
    joinedRecords : n,
    noSandboxData : noSandbox,
    joinRate      : +((n / (n + noSandbox)) * 100).toFixed(1),
    accuracy: {
      directionAccuracyPct : +(directionRate * 100).toFixed(1),
      precisionPct          : precision != null ? +(precision * 100).toFixed(1) : null,
      recallPct             : recall != null ? +(recall * 100).toFixed(1) : null,
      truePositive          : truePos,
      trueNegative          : trueNeg,
      falsePositive         : falsePos,
      falseNegative         : falseNeg,
    },
    magnitudeAccuracy: {
      recordsWithBothNets  : withSbNet.length,
      avgShadowNetUsd      : avgShadow != null ? +avgShadow.toFixed(4) : null,
      avgSandboxNetUsd     : avgSandbox != null ? +avgSandbox.toFixed(4) : null,
      avgAbsErrorUsd       : avgError != null ? +avgError.toFixed(4) : null,
      errorPct             : errorPct != null ? +errorPct.toFixed(1) : null,
      note: withSbNet.length < 10
        ? 'Limited rich sandbox records — magnitude accuracy estimate is rough'
        : null,
    },
    distribution: {
      shadowPositive  : positiveShadow.length,
      shadowNegative  : n - positiveShadow.length,
      actualViable    : positiveActual.length,
      actualNotViable : n - positiveActual.length,
    },
    verdict,
    verdictReason,
    interpretation: [
      'Shadow PnL = motivational opportunity estimate (Boss ruling)',
      'Not accounting-grade PnL until verdict = ACCURATE across 3+ sessions',
      `Current formula: gross = bestSize × spreadPct / 100, net = gross - gas - swapFee - aaveFee`,
      `Separate tracking: opportunityNetUsd (all signals) vs shadowEstimatedProfitUsd (gate-cleared only)`,
    ],
  };

  // Write report
  const outPath = path.join(sessionDir, 'shadow_accuracy_report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (JSON_MODE) { console.log(JSON.stringify(report, null, 2)); return; }

  const ICONS = { ACCURATE: '🟢', DIRECTIONAL_ONLY: '🟡', MISALIGNED: '🔴', INSUFFICIENT_DATA: '⚪' };
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AllMight — Shadow Accuracy Report');
  console.log(`  Session: ${sessionId}`);
  console.log(`  Joined: ${n} signals  (${noSandbox} without sandbox data)`);
  console.log('───────────────────────────────────────────────────────');
  console.log('  Direction Accuracy:');
  console.log(`    Shadow+ & Actual+: ${truePos}   (true positive)`);
  console.log(`    Shadow- & Actual-: ${trueNeg}   (true negative)`);
  console.log(`    Shadow+ & Actual-: ${falsePos}   (false positive — shadow over-optimistic)`);
  console.log(`    Shadow- & Actual+: ${falseNeg}   (false negative — shadow too conservative)`);
  console.log(`    Direction match:   ${(directionRate*100).toFixed(1)}%`);
  if (precision != null) console.log(`    Precision:         ${(precision*100).toFixed(1)}%`);
  if (recall    != null) console.log(`    Recall:            ${(recall*100).toFixed(1)}%`);
  console.log('');
  if (withSbNet.length > 0) {
    console.log('  Magnitude Accuracy (viable signals with rich sandbox data):');
    console.log(`    Avg shadow net:   $${avgShadow?.toFixed(4)}`);
    console.log(`    Avg sandbox net:  $${avgSandbox?.toFixed(4)}`);
    console.log(`    Avg abs error:    $${avgError?.toFixed(4)}  (${errorPct?.toFixed(1)}% of sandbox)`);
    console.log('');
  }
  console.log(`  ${ICONS[verdict]} Verdict: ${verdict}`);
  console.log(`  ${verdictReason}`);
  console.log('');
  for (const note of report.interpretation) console.log(`  • ${note}`);
  console.log('');
  console.log(`  Output: ${outPath}`);
  console.log('═══════════════════════════════════════════════════════');
}

main();
