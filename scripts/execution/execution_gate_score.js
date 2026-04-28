// scripts/execution/execution_gate_score.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Execution Gate Score
//
// Reads current session data and computes the ExecutionScore.
// Outputs: BLOCK / PAPER_ONLY / DRY_WALLET_ONLY / MICRO_LIVE_ELIGIBLE
//
// Usage:
//   node scripts/execution/execution_gate_score.js
//   node scripts/execution/execution_gate_score.js --session logs/sessions/session_20260426_2209
//   node scripts/execution/execution_gate_score.js --json   (machine-readable output)
//
// Output written to: logs/sessions/<session>/execution_gate.json
//
// NO TRANSACTIONS. Read-only.
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const WEIGHTS = {
  spread     : 0.30,
  heat       : 0.20,
  timing     : 0.20,
  infra      : 0.15,
  simulation : 0.10,
  confidence : 0.05,
};

const GATE = {
  BLOCK           : { min: 0,  max: 74,  label: 'BLOCK' },
  PAPER_ONLY      : { min: 75, max: 84,  label: 'PAPER_ONLY' },
  DRY_WALLET_ONLY : { min: 85, max: 91,  label: 'DRY_WALLET_ONLY' },
  MICRO_ELIGIBLE  : { min: 92, max: 100, label: 'MICRO_LIVE_ELIGIBLE' },
};

// ─── ARGS ────────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const jsonMode   = args.includes('--json');
const sessionIdx = args.indexOf('--session');
let   SESSION_DIR = sessionIdx !== -1 ? args[sessionIdx + 1] : null;

// Auto-detect current session from allmight.session if not specified
const LOGS_DIR     = path.resolve(process.cwd(), 'logs');
const SESSION_FILE = path.join(LOGS_DIR, 'allmight.session');

if (!SESSION_DIR && fs.existsSync(SESSION_FILE)) {
  const sid = fs.readFileSync(SESSION_FILE, 'utf8').trim();
  SESSION_DIR = path.join(LOGS_DIR, 'sessions', `session_${sid}`);
}

if (!SESSION_DIR || !fs.existsSync(SESSION_DIR)) {
  console.error('ERROR: Cannot find session directory. Use --session <path>');
  process.exit(1);
}

const SESSION_ID = path.basename(SESSION_DIR).replace('session_', '');

function readJson(file) {
  const p = path.join(SESSION_DIR, file);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function readJsonl(file, maxLines = 500) {
  const p = path.join(SESSION_DIR, file);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const recent = lines.slice(-maxLines);
  return recent.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ─── COMPONENT SCORERS ───────────────────────────────────────────────────────

function scoreSpread(activatorRecords) {
  // Use recent EXECUTION_READY records' netSpreadPct
  const spreads = activatorRecords
    .filter(r => r.type === 'EXECUTION_READY' && r.netSpreadPct != null)
    .map(r => r.netSpreadPct)
    .slice(-50); // recent 50

  if (spreads.length === 0) return { score: 0, detail: 'no spread data' };

  const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
  const bps = avg * 100;

  let score;
  if      (bps >= 26.0) score = 100;
  else if (bps >= 24.0) score = 85;
  else if (bps >= 23.0) score = 65;
  else if (bps >= 22.0) score = 40;
  else                   score = 0;

  return { score, detail: `avg ${avg.toFixed(4)}% (${bps.toFixed(1)}bps) n=${spreads.length}` };
}

function scoreHeat(activatorRecords) {
  const recent = activatorRecords
    .filter(r => r.type === 'EXECUTION_READY' && r.heatClass)
    .slice(-100);

  if (recent.length === 0) return { score: 0, detail: 'no heat data' };

  const counts = {};
  for (const r of recent) counts[r.heatClass] = (counts[r.heatClass] || 0) + 1;

  const extremePct = (counts.EXTREME || 0) / recent.length;
  const hotPct     = (counts.HOT || 0) / recent.length;

  let score;
  if      (extremePct >= 0.70) score = 100;
  else if (extremePct >= 0.40) score = 85;
  else if (hotPct >= 0.50)     score = 75;
  else if (extremePct > 0)     score = 50;
  else                          score = 20;

  return {
    score,
    detail: `EXTREME=${(extremePct*100).toFixed(0)}% HOT=${(hotPct*100).toFixed(0)}% n=${recent.length}`,
  };
}

function scoreTiming() {
  const nowUtc  = new Date();
  const hourUtc = nowUtc.getUTCHours();

  // Top windows confirmed from session analysis
  const TOP_WINDOWS    = [10, 11, 12, 21, 22, 23, 2, 3, 4];
  const SECOND_WINDOWS = [8, 9, 14, 15, 16, 17];

  let score;
  if      (TOP_WINDOWS.includes(hourUtc))    score = 100;
  else if (SECOND_WINDOWS.includes(hourUtc)) score = 70;
  else                                        score = 40;

  return { score, detail: `UTC hour=${hourUtc}` };
}

function scoreInfra(watchdogRecords, activatorRecords) {
  // Latest watchdog status
  let wdStatus = 'UNKNOWN';
  for (let i = watchdogRecords.length - 1; i >= 0; i--) {
    if (watchdogRecords[i]?.overallStatus) {
      wdStatus = watchdogRecords[i].overallStatus;
      break;
    }
  }

  // Activator freshness
  let activatorStale = true;
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  for (let i = activatorRecords.length - 1; i >= 0; i--) {
    const r = activatorRecords[i];
    if (r?.ts && new Date(r.ts).getTime() > tenMinAgo) {
      activatorStale = false;
      break;
    }
  }

  // RPC health from rpc_freshness
  const rpcRecords  = readJsonl('rpc_freshness.jsonl', 100);
  const recentFails = rpcRecords.filter(r => r.ev === 'rpc_exhausted').length;

  let score;
  let detail;

  if (wdStatus === 'HEALTHY' && !activatorStale && recentFails === 0) {
    score = 100; detail = 'watchdog=HEALTHY rpc=OK activator=fresh';
  } else if (wdStatus === 'DEGRADED' || activatorStale || recentFails > 0) {
    score = 60;
    detail = `watchdog=${wdStatus} stale=${activatorStale} rpcFails=${recentFails}`;
  } else if (wdStatus === 'FAILED' || recentFails > 3) {
    score = 25; detail = `watchdog=${wdStatus} rpcFails=${recentFails}`;
  } else {
    score = 0; detail = 'UNKNOWN infra state';
  }

  return { score, detail };
}

function scoreSimulation() {
  const sb = readJson('sandbox_results.json');
  if (!sb) return { score: 0, detail: 'no sandbox data' };

  const rate = sb.summary?.viableRate ?? 0;

  let score;
  if      (rate >= 70) score = 100;
  else if (rate >= 50) score = 80;
  else if (rate >= 35) score = 60;
  else if (rate >= 20) score = 35;
  else                  score = 0;

  return { score, detail: `viableRate=${rate.toFixed(1)}% total=${sb.summary?.total}` };
}

function scoreConfidence() {
  const conf = readJson('dryrun_confidence.json');
  if (!conf) return { score: 25, detail: 'no confidence log (using default)' };

  const bossValid = conf.summary?.bossValidTotal ?? 0;

  let score;
  if      (bossValid >= 10) score = 100;
  else if (bossValid >=  8) score = 95;
  else if (bossValid >=  6) score = 85;  // current level
  else if (bossValid >=  5) score = 75;
  else if (bossValid >=  3) score = 50;
  else if (bossValid >=  1) score = 25;
  else                       score = 0;

  return {
    score,
    detail: `bossValid=${bossValid} trend=${conf.summary?.trend} confidence=${conf.summary?.confidence}`,
  };
}

// ─── HARD BLOCKER CHECK ───────────────────────────────────────────────────────

function checkHardBlockers(activatorRecords, watchdogRecords) {
  const blockers = [];

  // LIVE_DEPLOY_APPROVED
  if (process.env.LIVE_DEPLOY_APPROVED !== 'true') {
    blockers.push('LIVE_DEPLOY_APPROVED != true (execution fully locked)');
  }

  // Watchdog running
  if (watchdogRecords.length === 0) {
    blockers.push('watchdog not running (no watchdog.jsonl records)');
  } else {
    let latestWd = null;
    for (let i = watchdogRecords.length - 1; i >= 0; i--) {
      if (watchdogRecords[i]?.overallStatus) { latestWd = watchdogRecords[i]; break; }
    }
    if (latestWd?.overallStatus === 'FAILED') blockers.push('watchdog FAILED');
  }

  // Activator freshness (10 min)
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const activatorFresh = activatorRecords.some(r => r?.ts && new Date(r.ts).getTime() > tenMinAgo);
  if (!activatorFresh) blockers.push('activator stale > 10 min');

  // Min spread
  const recentSpreads = activatorRecords
    .filter(r => r.type === 'EXECUTION_READY' && r.netSpreadPct != null)
    .slice(-20)
    .map(r => r.netSpreadPct);
  if (recentSpreads.length > 0) {
    const maxSpread = Math.max(...recentSpreads);
    if (maxSpread < 0.22) {
      blockers.push(`spread < 0.22% (max recent=${maxSpread.toFixed(4)}%)`);
    }
  }

  // Flash loan readiness (blocks live path only)
  const fl = readJson('flash_loan_readiness.json');
  if (fl?.verdict === 'FLASH_NOT_READY') {
    blockers.push(`flash loan NOT_READY: ${fl.verdictDetail?.slice(0, 80)}`);
  }

  return blockers;
}

// ─── GATE VERDICT ─────────────────────────────────────────────────────────────

function gateVerdict(score, hardBlockers) {
  if (hardBlockers.length > 0) return 'BLOCK';
  if (score >= 92) return 'MICRO_LIVE_ELIGIBLE';
  if (score >= 85) return 'DRY_WALLET_ONLY';
  if (score >= 75) return 'PAPER_ONLY';
  return 'BLOCK';
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

function main() {
  const activator = readJsonl('activator.jsonl', 1000);
  const watchdog  = readJsonl('watchdog.jsonl',  200);

  const components = {
    spread     : scoreSpread(activator),
    heat       : scoreHeat(activator),
    timing     : scoreTiming(),
    infra      : scoreInfra(watchdog, activator),
    simulation : scoreSimulation(),
    confidence : scoreConfidence(),
  };

  const totalScore = Object.entries(WEIGHTS).reduce((sum, [key, w]) => {
    return sum + (components[key].score * w);
  }, 0);

  const hardBlockers = checkHardBlockers(activator, watchdog);
  const verdict      = gateVerdict(totalScore, hardBlockers);

  const result = {
    ts          : new Date().toISOString(),
    sessionId   : SESSION_ID,
    totalScore  : Math.round(totalScore * 10) / 10,
    verdict,
    hardBlockers,
    components  : Object.fromEntries(
      Object.entries(components).map(([k, v]) => [k, { weight: WEIGHTS[k], ...v }])
    ),
    gates: {
      BLOCK           : totalScore < 75,
      PAPER_ONLY      : totalScore >= 75 && totalScore < 85,
      DRY_WALLET_ONLY : totalScore >= 85 && totalScore < 92,
      MICRO_ELIGIBLE  : totalScore >= 92,
    },
  };

  // Write to session log
  const outPath = path.join(SESSION_DIR, 'execution_gate.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  } catch { /* best-effort */ }

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  const VERDICT_ICONS = {
    BLOCK           : '🔴',
    PAPER_ONLY      : '🟡',
    DRY_WALLET_ONLY : '🟠',
    MICRO_LIVE_ELIGIBLE: '🟢',
  };
  const icon = VERDICT_ICONS[verdict] || '⚪';

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  AllMight — Execution Gate Score`);
  console.log(`  Session: ${SESSION_ID}  ${new Date().toISOString().slice(0,19)}Z`);
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Total Score: ${totalScore.toFixed(1)} / 100`);
  console.log(`  ${icon} Verdict:     ${verdict}`);
  console.log('───────────────────────────────────────────────────────');
  console.log('  Components:');
  for (const [key, { weight, score, detail }] of Object.entries(components)) {
    const wt     = `${(weight * 100).toFixed(0)}%`.padEnd(5);
    const sc     = score.toString().padStart(3);
    const wscore = (score * weight).toFixed(1).padStart(5);
    console.log(`    ${key.padEnd(12)} wt=${wt} score=${sc}  →${wscore}  ${detail}`);
  }
  console.log('───────────────────────────────────────────────────────');
  if (hardBlockers.length > 0) {
    console.log('  🚫 Hard Blockers (override score):');
    for (const b of hardBlockers) console.log(`    • ${b}`);
  } else {
    console.log('  ✅ No hard blockers');
  }
  console.log('───────────────────────────────────────────────────────');
  console.log('  Gate thresholds:');
  console.log(`    < 75   → BLOCK           ${totalScore < 75 ? '◄ HERE' : ''}`);
  console.log(`    75–84  → PAPER_ONLY       ${totalScore >= 75 && totalScore < 85 ? '◄ HERE' : ''}`);
  console.log(`    85–91  → DRY_WALLET_ONLY  ${totalScore >= 85 && totalScore < 92 ? '◄ HERE' : ''}`);
  console.log(`    92+    → MICRO_ELIGIBLE   ${totalScore >= 92 ? '◄ HERE' : ''}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Output: ${outPath}`);
}

main();
