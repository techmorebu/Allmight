// scripts/execution/capital_policy.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Capital Policy Engine
//
// Reads execution gate score + session metrics, outputs position sizing and
// capital mode for any given signal.
//
// Usage:
//   node scripts/execution/capital_policy.js
//   node scripts/execution/capital_policy.js --session logs/sessions/session_20260426_2209
//   node scripts/execution/capital_policy.js --signal '{"netSpreadPct":0.235,"heatClass":"EXTREME","confidence":0.72}'
//   node scripts/execution/capital_policy.js --json
//
// NO TRANSACTIONS. NO PRIVATE KEY. Read-only analytics.
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CAPITAL MODE DEFINITIONS ────────────────────────────────────────────────

const MODES = {
  0: {
    name       : 'PAPER',
    maxTrade   : 0,
    maxPerSess : 0,
    description: 'Default — no wallet interaction',
    requirements: ['Default until Boss live approval'],
  },
  1: {
    name       : 'MICRO',
    maxTrade   : 25,
    maxPerSess : 3,
    description: 'First live trades — minimal capital',
    requirements: [
      'fork test 18/18 PASS',
      'preflight 16/16 PASS',
      'executionScore >= 92',
      'explicit Boss approval',
      'LIVE_DEPLOY_APPROVED=true',
    ],
  },
  2: {
    name       : 'PROBE',
    maxTrade   : 100,
    maxPerSess : 5,
    description: 'Validated live path — small scaling',
    requirements: [
      '5+ successful MICRO trades',
      'realized slippage within model',
      'no unexpected reverts',
    ],
  },
  3: {
    name       : 'CONTROLLED',
    maxTrade   : 200,
    maxPerSess : null,
    description: 'Clean live sessions proven',
    requirements: [
      '3 live sessions net positive',
      'no critical infra incidents',
    ],
  },
  4: {
    name       : 'STANDARD',
    maxTrade   : 500,
    maxPerSess : null,
    description: 'Full operational mode',
    requirements: [
      '5+ clean live sessions',
      'realized capture >= 70%',
      'drawdown < 5%',
    ],
  },
};

// ─── CURRENT APPROVED MODE (Boss-set — do not change without ruling) ─────────
const APPROVED_MODE = 0; // MODE 0 — PAPER ONLY

// ─── ARGS ────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const jsonMode   = args.includes('--json');
const sessionIdx = args.indexOf('--session');
const signalIdx  = args.indexOf('--signal');

let SESSION_DIR = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
let SIGNAL_IN   = null;
if (signalIdx !== -1) {
  try { SIGNAL_IN = JSON.parse(args[signalIdx + 1]); } catch { SIGNAL_IN = null; }
}

const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
const SESSION_FILE = path.join(LOGS_DIR, 'allmight.session');

if (!SESSION_DIR && fs.existsSync(SESSION_FILE)) {
  const sid = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  SESSION_DIR = path.join(LOGS_DIR, 'sessions', `session_${sid}`);
}

function readJson(file) {
  if (!SESSION_DIR) return null;
  const p = path.join(SESSION_DIR, file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// ─── POSITION SIZING ─────────────────────────────────────────────────────────

function baseSize(confidence) {
  if (confidence >= 0.98) return 500;
  if (confidence >= 0.95) return 200;
  if (confidence >= 0.90) return 100;
  if (confidence >= 0.80) return 50;
  return 25;
}

function liquiditySafeSize(sl) {
  // From size_ladder.json — find largest viable size
  if (!sl) return 25;
  const confirmedStrict = sl.confirmedStrict?.ladder;
  if (!confirmedStrict) return 25;
  let maxViable = 0;
  for (const rung of confirmedStrict) {
    if (rung.viableRate >= 0.9 && rung.sizeUsd > maxViable) maxViable = rung.sizeUsd;
  }
  return maxViable || 25;
}

function gasAdjustedSize(fl) {
  // From flash_loan_readiness.json — largest approved ladder rung
  if (!fl) return 25;
  const ladder = fl.approvedLadder;
  if (!ladder || ladder.length === 0) return 0; // flash not ready
  return Math.max(...ladder);
}

function computeSize(confidence, bankrollUsd, sl, fl) {
  const bs    = baseSize(confidence);
  const liqS  = liquiditySafeSize(sl);
  const gasS  = gasAdjustedSize(fl);
  const modeS = MODES[APPROVED_MODE].maxTrade;

  const computed = Math.min(bs, modeS, bankrollUsd * 0.20, liqS, gasS);
  return {
    baseSize  : bs,
    modeMax   : modeS,
    bankroll20: Math.floor(bankrollUsd * 0.20),
    liqSafe   : liqS,
    gasAdj    : gasS,
    final     : Math.max(0, computed),
  };
}

// ─── SIGNAL EVALUATION ───────────────────────────────────────────────────────

function evaluateSignal(signal, gateResult, sl, fl) {
  const confidence   = signal.confidence    ?? 0;
  const spreadPct    = signal.netSpreadPct  ?? 0;
  const heatClass    = signal.heatClass     ?? 'UNKNOWN';
  const bankrollUsd  = parseFloat(process.env.BANKROLL_USD || '0');

  const sizing = computeSize(confidence, bankrollUsd, sl, fl);

  // Per-signal hard blocks
  const perSignalBlockers = [];
  if (spreadPct < 0.22)          perSignalBlockers.push(`spread ${spreadPct.toFixed(4)}% < 0.22% floor`);
  if (sizing.final === 0)         perSignalBlockers.push('computed size = $0 (mode locked or no approved size)');
  if (!signal.amountOutMin && signal.amountOutMin !== 0) perSignalBlockers.push('amountOutMin not in signal');

  const verdict = (() => {
    if (gateResult?.hardBlockers?.length > 0) return 'BLOCK';
    if (perSignalBlockers.length > 0)         return 'BLOCK';
    if (!gateResult || gateResult.totalScore < 75) return 'BLOCK';
    if (gateResult.totalScore < 85)           return 'PAPER_ONLY';
    if (gateResult.totalScore < 92)           return 'DRY_WALLET_ONLY';
    return 'MICRO_LIVE_ELIGIBLE';
  })();

  return {
    verdict,
    sizing,
    perSignalBlockers,
    signal: { confidence, spreadPct, heatClass },
  };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

function main() {
  const gateResult = readJson('execution_gate.json');
  const sl         = readJson('size_ladder.json');
  const fl         = readJson('flash_loan_readiness.json');
  const sb         = readJson('sandbox_results.json');

  const sessionId  = SESSION_DIR
    ? path.basename(SESSION_DIR).replace('session_', '')
    : 'unknown';

  // Build policy report
  const report = {
    ts            : new Date().toISOString(),
    sessionId,
    approvedMode  : APPROVED_MODE,
    modeName      : MODES[APPROVED_MODE].name,
    maxTradeUsd   : MODES[APPROVED_MODE].maxTrade,
    maxPerSession : MODES[APPROVED_MODE].maxPerSess,
    gateScore     : gateResult?.totalScore ?? null,
    gateVerdict   : gateResult?.verdict    ?? 'UNKNOWN',
    hardBlockers  : gateResult?.hardBlockers ?? ['run execution_gate_score.js first'],
    sessionMetrics: {
      sandbox: {
        viableRate : sb?.summary?.viableRate ?? null,
        total      : sb?.summary?.total ?? null,
        avgNetViable: sb?.summary?.avgNetViable ?? null,
      },
      sizeLadder: {
        confirmedCount : sl?.confirmedCount ?? null,
        confirmedSpread: sl?.confirmedSpread ?? null,
      },
      flashLoan: {
        verdict: fl?.verdict ?? null,
        detail : fl?.verdictDetail?.slice(0, 80) ?? null,
      },
    },
    modes: Object.fromEntries(
      Object.entries(MODES).map(([k, m]) => [k, {
        name        : m.name,
        maxTrade    : m.maxTrade,
        maxPerSess  : m.maxPerSess,
        description : m.description,
        approved    : parseInt(k) === APPROVED_MODE,
      }])
    ),
  };

  // If a specific signal was provided, evaluate it
  if (SIGNAL_IN) {
    report.signalEvaluation = evaluateSignal(SIGNAL_IN, gateResult, sl, fl);
  }

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable
  const GATE_ICONS = {
    BLOCK: '🔴', PAPER_ONLY: '🟡', DRY_WALLET_ONLY: '🟠',
    MICRO_LIVE_ELIGIBLE: '🟢', UNKNOWN: '⚪',
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('  AllMight — Capital Policy');
  console.log(`  Session: ${sessionId}  ${new Date().toISOString().slice(0,19)}Z`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Approved Mode: MODE ${APPROVED_MODE} — ${MODES[APPROVED_MODE].name}`);
  console.log(`  Max trade:     $${MODES[APPROVED_MODE].maxTrade}`);
  console.log(`  Max/session:   ${MODES[APPROVED_MODE].maxPerSess ?? 'unlimited'}`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Gate score:    ${gateResult?.totalScore?.toFixed(1) ?? 'N/A'}`);
  console.log(`  ${GATE_ICONS[gateResult?.verdict ?? 'UNKNOWN']} Gate verdict:  ${gateResult?.verdict ?? 'run execution_gate_score.js first'}`);
  if (gateResult?.hardBlockers?.length > 0) {
    console.log('  🚫 Hard blockers active:');
    for (const b of gateResult.hardBlockers) console.log(`    • ${b}`);
  }
  console.log('───────────────────────────────────────────────────────');
  console.log('  Session metrics:');
  if (sb?.summary) {
    console.log(`    Sandbox viable: ${sb.summary.viableRate?.toFixed(1)}%  avg net: $${sb.summary.avgNetViable?.toFixed(3)}`);
  }
  if (sl) {
    console.log(`    Confirmed signals: ${sl.confirmedCount}  spread floor: ${sl.confirmedSpread}%`);
  }
  if (fl) {
    console.log(`    Flash loan: ${fl.verdict}`);
  }
  console.log('───────────────────────────────────────────────────────');
  console.log('  Mode progression:');
  for (const [k, m] of Object.entries(MODES)) {
    const curr = parseInt(k) === APPROVED_MODE ? ' ◄ CURRENT' : '';
    const avail = parseInt(k) <= APPROVED_MODE ? '✅' : '🔒';
    console.log(`    ${avail} MODE ${k}: ${m.name.padEnd(12)} max=$${String(m.maxTrade).padEnd(5)}${curr}`);
  }
  if (SIGNAL_IN) {
    const ev = evaluateSignal(SIGNAL_IN, gateResult, sl, fl);
    console.log('───────────────────────────────────────────────────────');
    console.log('  Signal evaluation:');
    console.log(`    Spread:     ${SIGNAL_IN.netSpreadPct?.toFixed(4)}%`);
    console.log(`    Heat:       ${SIGNAL_IN.heatClass}`);
    console.log(`    Confidence: ${SIGNAL_IN.confidence}`);
    console.log(`    ${GATE_ICONS[ev.verdict]} Verdict:    ${ev.verdict}`);
    console.log(`    Size:       $${ev.sizing.final} (base=$${ev.sizing.baseSize} modeMax=$${ev.sizing.modeMax})`);
    if (ev.perSignalBlockers.length > 0) {
      console.log('    Per-signal blockers:');
      for (const b of ev.perSignalBlockers) console.log(`      • ${b}`);
    }
  }
  console.log('═══════════════════════════════════════════════════════');
}

main();
