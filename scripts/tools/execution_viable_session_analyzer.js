'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution-Viable Session Analyzer
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/execution_viable_session_analyzer.js
//  STATUS    : NEW — Boss ruling 2026-04-14
//
//  PURPOSE
//  ───────
//  Answers the three questions Boss defined after v2.1 approval:
//
//    Q1. Which sessions produce the highest execution-viable density?
//    Q2. Which profile/regime combinations produce the most viable trades?
//    Q3. What hourly windows produce the most robust candidates?
//
//  New primary KPI (Boss ruling):
//    execution-viable rate by session
//    execution-viable count by profile and regime
//
//  INPUT
//  ─────
//  A logs root directory containing session_YYYYMMDD_HHMM/ subdirectories,
//  each with a blueprints.jsonl file.
//
//  USAGE
//  ─────
//  node scripts/tools/execution_viable_session_analyzer.js --logs ./logs
//  node scripts/tools/execution_viable_session_analyzer.js --logs ./logs --json
//  node scripts/tools/execution_viable_session_analyzer.js --self-test
//
//  DETERMINISM: same input → same output always (inherits from v2.1 simulator)
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { simulateBatch } = require('../execution/execution_realism_simulator');

// ─── ARGS ─────────────────────────────────────────────────────────────────────

const ARGS      = process.argv.slice(2);
const FLAG_TEST = ARGS.includes('--self-test');
const FLAG_JSON = ARGS.includes('--json');
const LOGS_DIR  = (() => { const i = ARGS.indexOf('--logs'); return i !== -1 ? ARGS[i+1] : './logs'; })();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).reduce((acc, l) => {
    try { acc.push(JSON.parse(l)); } catch {}
    return acc;
  }, []);
}

function pct(n, d) { return d ? +(100 * n / d).toFixed(1) : 0; }
function avg(arr)   { return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4) : null; }
function med(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return +(s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2).toFixed(4);
}

// ─── LOAD ALL SESSIONS ────────────────────────────────────────────────────────

function loadSessions(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir)
    .filter(d => d.startsWith('session_') && fs.statSync(path.join(logsDir, d)).isDirectory())
    .sort()
    .map(sname => {
      const sdir   = path.join(logsDir, sname);
      const bpPath = path.join(sdir, 'blueprints.jsonl');
      const bps    = readJsonl(bpPath);
      return { name: sname, dir: sdir, blueprints: bps };
    })
    .filter(s => s.blueprints.length > 0);
}

// ─── CORE ANALYSIS ────────────────────────────────────────────────────────────

/**
 * Analyse all sessions in a logs directory.
 *
 * Returns:
 *  - sessionRows    : per-session summary with viable rate, counts, top candidates
 *  - profileRegime  : profile × regime breakdown across all sessions
 *  - hourlyWindows  : UTC-hour breakdown of viable candidates
 *  - globalSummary  : totals and project-level KPIs
 */
function analyseAll(sessions) {
  if (!sessions.length) return _emptyResult();

  const sessionRows    = [];
  const profileRegime  = {};  // key: `${profile}:${regime}`
  const hourBuckets    = {};  // key: '00'–'23'

  let totalBp = 0, totalViable = 0, totalMarginal = 0, totalFail = 0;
  const allViableNets   = [];
  const allViableWorsts = [];

  for (const session of sessions) {
    const bps     = session.blueprints;
    const results = simulateBatch(bps);

    const viable   = results.filter(r => r.executionClass === 'EXECUTION_VIABLE');
    const marginal = results.filter(r => r.executionClass === 'EXECUTION_MARGINAL');
    const failed   = results.filter(r => r.executionClass === 'EXECUTION_FAIL');

    const viableNets   = viable.map(r => r.expectedRealNetUsd).filter(n => n != null);
    const viableWorsts = viable.map(r => r.worstCaseNetUsd).filter(n => n != null);
    const viableConfs  = viable.map(r => r.sourceConfidence).filter(n => n != null);

    // ── Hourly window analysis ─────────────────────────────────────────────
    for (let i = 0; i < bps.length; i++) {
      const r  = results[i];
      const ts = bps[i].ts || bps[i].signalTs || '';
      const hr = ts.length >= 13 ? ts.slice(11, 13) : null;
      if (!hr || r.executionClass !== 'EXECUTION_VIABLE') continue;
      if (!hourBuckets[hr]) hourBuckets[hr] = { count: 0, totalBp: 0, nets: [] };
      hourBuckets[hr].count++;
      hourBuckets[hr].nets.push(r.expectedRealNetUsd);
    }
    // Count all bp per hour (for viable rate)
    for (const bp of bps) {
      const ts = bp.ts || bp.signalTs || '';
      const hr = ts.length >= 13 ? ts.slice(11, 13) : null;
      if (!hr) continue;
      if (!hourBuckets[hr]) hourBuckets[hr] = { count: 0, totalBp: 0, nets: [] };
      hourBuckets[hr].totalBp++;
    }

    // ── Profile × regime breakdown ────────────────────────────────────────
    for (let i = 0; i < bps.length; i++) {
      const r       = results[i];
      if (r.executionClass !== 'EXECUTION_VIABLE') continue;
      const profile = r.profile || bps[i]?._context?.activeProfile || 'unknown';
      const regime  = r.regime  || bps[i]?._context?.regime || 'unknown';
      const key     = `${profile}:${regime}`;
      if (!profileRegime[key]) profileRegime[key] = { profile, regime, count: 0, nets: [], worsts: [] };
      profileRegime[key].count++;
      if (r.expectedRealNetUsd != null) profileRegime[key].nets.push(r.expectedRealNetUsd);
      if (r.worstCaseNetUsd    != null) profileRegime[key].worsts.push(r.worstCaseNetUsd);
    }

    totalBp       += bps.length;
    totalViable   += viable.length;
    totalMarginal += marginal.length;
    totalFail     += failed.length;
    allViableNets.push(...viableNets);
    allViableWorsts.push(...viableWorsts);

    // Top 3 viable in session
    const top3 = viable
      .slice().sort((a, b) => b.expectedRealNetUsd - a.expectedRealNetUsd)
      .slice(0, 3)
      .map(r => ({
        spread : r.sourceSpreadPct,
        core   : r.expectedRealNetUsd,
        worst  : r.worstCaseNetUsd,
        failP  : r.failureProbability,
        latency: r.sensitivity?.latency,
        gas    : r.sensitivity?.gas,
        profile: r.profile,
        regime : r.regime,
      }));

    // Profile split of viable within session
    const profVia = {};
    viable.forEach(r => { const p = r.profile||'?'; profVia[p] = (profVia[p]||0)+1; });
    const regVia  = {};
    viable.forEach(r => { const g = r.regime||'?'; regVia[g]   = (regVia[g]||0)+1; });

    sessionRows.push({
      session        : session.name,
      blueprintCount : bps.length,
      viableCount    : viable.length,
      marginalCount  : marginal.length,
      failCount      : failed.length,
      viableRate     : pct(viable.length, bps.length),
      avgCoreNet     : avg(viableNets),
      medCoreNet     : med(viableNets),
      avgWorstCase   : avg(viableWorsts),
      avgConf        : avg(viableConfs),
      profileSplit   : profVia,
      regimeSplit    : regVia,
      top3,
    });
  }

  // ── Profile × regime summary ───────────────────────────────────────────────
  const profileRegimeSummary = Object.values(profileRegime)
    .map(v => ({
      profile    : v.profile,
      regime     : v.regime,
      viableCount: v.count,
      avgCoreNet : avg(v.nets),
      avgWorstCase: avg(v.worsts),
    }))
    .sort((a, b) => b.viableCount - a.viableCount);

  // ── Hourly window summary ──────────────────────────────────────────────────
  const hourlySummary = Object.entries(hourBuckets)
    .map(([hr, v]) => ({
      hour        : hr,
      viableCount : v.count,
      totalBp     : v.totalBp,
      viableRate  : pct(v.count, v.totalBp),
      avgCoreNet  : avg(v.nets),
    }))
    .sort((a, b) => b.viableCount - a.viableCount);

  // ── Global KPIs ────────────────────────────────────────────────────────────
  const globalSummary = {
    totalSessions      : sessions.length,
    totalBlueprints    : totalBp,
    totalViable        : totalViable,
    totalMarginal      : totalMarginal,
    totalFail          : totalFail,
    viableRate         : pct(totalViable, totalBp),
    avgCoreNetViable   : avg(allViableNets),
    medCoreNetViable   : med(allViableNets),
    minWorstCaseViable : allViableWorsts.length ? +Math.min(...allViableWorsts).toFixed(4) : null,
    maxWorstCaseViable : allViableWorsts.length ? +Math.max(...allViableWorsts).toFixed(4) : null,
    topSession         : sessionRows.slice().sort((a, b) => b.viableRate - a.viableRate)[0]?.session,
    topSessionViable   : sessionRows.slice().sort((a, b) => b.viableRate - a.viableRate)[0]?.viableRate,
    topHour            : hourlySummary[0]?.hour,
    topHourViableRate  : hourlySummary[0]?.viableRate,
  };

  return { sessionRows, profileRegimeSummary, hourlySummary, globalSummary };
}

function _emptyResult() {
  return { sessionRows: [], profileRegimeSummary: [], hourlySummary: [],
           globalSummary: { totalSessions:0, totalBlueprints:0, totalViable:0 } };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(result) {
  const { sessionRows, profileRegimeSummary, hourlySummary, globalSummary: G } = result;
  const W = 110, EQ = '═'.repeat(W), DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log('  AllMight — Execution-Viable Session Analyzer');
  console.log(`  ${new Date().toISOString()}`);
  console.log(EQ);

  // ── Global KPIs ─────────────────────────────────────────────────────────────
  console.log(`\n  PROJECT KPIs (Boss ruling — primary scoreboard)`);
  console.log(`  ${'─'.repeat(55)}`);
  console.log(`  Sessions analysed:       ${G.totalSessions}`);
  console.log(`  Total blueprints:        ${G.totalBlueprints}`);
  console.log(`  \x1b[1;32mEXECUTION_VIABLE:        ${G.totalViable} (${G.viableRate}%)\x1b[0m  ← primary KPI`);
  console.log(`  EXECUTION_MARGINAL:      ${G.totalMarginal} (${pct(G.totalMarginal, G.totalBlueprints)}%)`);
  console.log(`  EXECUTION_FAIL:          ${G.totalFail} (${pct(G.totalFail, G.totalBlueprints)}%)`);
  console.log(`  Viable core net:         avg=$${G.avgCoreNetViable}  median=$${G.medCoreNetViable}`);
  console.log(`  Viable worst-case range: $${G.minWorstCaseViable} – $${G.maxWorstCaseViable}`);
  console.log(`  Best session (viable%):  ${G.topSession} (${G.topSessionViable}%)`);
  console.log(`  Best hour (UTC):         ${G.topHour}:00  viable rate ${G.topHourViableRate}%`);

  // ── Q1: Session ranking by viable rate ──────────────────────────────────────
  console.log(`\n\n  Q1. SESSION RANKING — execution-viable density`);
  console.log(`  ${'─'.repeat(W-2)}`);
  console.log(`  ${'Session'.padEnd(28)} ${'BPs'.padStart(5)} ${'Viable'.padStart(7)} ${'Rate'.padStart(7)} ${'Marg'.padStart(6)} ${'Fail'.padStart(6)} ${'AvgCore'.padStart(9)} ${'Profile split'}`);
  console.log(`  ${DIV}`);
  const sortedSessions = sessionRows.slice().sort((a, b) => b.viableRate - a.viableRate);
  for (const s of sortedSessions) {
    const profStr = Object.entries(s.profileSplit).map(([k,v])=>`${k}=${v}`).join(' ') || '-';
    const flag = s.viableRate >= 10 ? '\x1b[1;32m★\x1b[0m' : ' ';
    console.log(
      `  ${flag} ${s.session.padEnd(27)} ` +
      `${String(s.blueprintCount).padStart(5)} ` +
      `${String(s.viableCount).padStart(7)} ` +
      `${(s.viableRate+'%').padStart(7)} ` +
      `${String(s.marginalCount).padStart(6)} ` +
      `${String(s.failCount).padStart(6)} ` +
      ('$'+(s.avgCoreNet??0).toFixed(4)).padStart(9) + ' ' +
      `${profStr}`
    );
  }

  // ── Q2: Profile × regime breakdown ──────────────────────────────────────────
  console.log(`\n\n  Q2. PROFILE × REGIME — viable count and quality`);
  console.log(`  ${'─'.repeat(W-2)}`);
  console.log(`  ${'Profile'.padEnd(14)} ${'Regime'.padEnd(28)} ${'Viable'.padStart(7)} ${'AvgCore'.padStart(9)} ${'AvgWorst'.padStart(10)}`);
  console.log(`  ${DIV}`);
  for (const pr of profileRegimeSummary) {
    const agTag = pr.profile === 'AGGRESSIVE' ? '\x1b[33m' : pr.profile === 'SAFE' ? '\x1b[1;32m' : '';
    const rst   = agTag ? '\x1b[0m' : '';
    console.log(
      `  ${agTag}${pr.profile.padEnd(14)} ` +
      `${(pr.regime||'?').padEnd(28)} ` +
      `${String(pr.viableCount).padStart(7)} ` +
      ('$'+(pr.avgCoreNet??0).toFixed(4)).padStart(9) + ' ' +
      ('$'+(pr.avgWorstCase??0).toFixed(4)).padStart(10) + rst
    );
  }

  // ── Q3: Hourly window analysis ───────────────────────────────────────────────
  console.log(`\n\n  Q3. HOURLY WINDOWS (UTC) — viable candidate density`);
  console.log(`  ${'─'.repeat(W-2)}`);
  console.log(`  ${'Hour (UTC)'.padEnd(12)} ${'Viable'.padStart(7)} ${'TotalBP'.padStart(8)} ${'Rate'.padStart(7)} ${'AvgCore'.padStart(9)}  Bar`);
  console.log(`  ${DIV}`);
  const maxViable = Math.max(...hourlySummary.map(h => h.viableCount), 1);
  // Sort by hour for readability
  const byHour = hourlySummary.slice().sort((a, b) => a.hour.localeCompare(b.hour));
  for (const h of byHour) {
    const bar   = '█'.repeat(Math.round(30 * h.viableCount / maxViable));
    const hiTag = h.viableRate >= 15 ? '\x1b[1;32m' : h.viableRate >= 8 ? '\x1b[33m' : '';
    const rst   = hiTag ? '\x1b[0m' : '';
    console.log(
      `  ${hiTag}${(h.hour+':00').padEnd(12)} ` +
      `${String(h.viableCount).padStart(7)} ` +
      `${String(h.totalBp).padStart(8)} ` +
      `${(h.viableRate+'%').padStart(7)} ` +
      ('$'+(h.avgCoreNet??0).toFixed(4)).padStart(9) + `  ${bar}${rst}`
    );
  }

  // ── Top 10 viable across all sessions ────────────────────────────────────────
  const allTop = sessionRows.flatMap(s => s.top3.map(t => ({ ...t, session: s.session })))
    .sort((a, b) => b.core - a.core).slice(0, 10);
  console.log(`\n\n  TOP 10 VIABLE CANDIDATES (all sessions)`);
  console.log(`  ${DIV}`);
  for (const t of allTop) {
    console.log(
      `\x1b[1;32m  ${t.session}  spread=${(t.spread||0).toFixed(4)}%  ` +
      `core=$${(t.core||0).toFixed(4)}  worst=$${(t.worst||0).toFixed(4)}  ` +
      `failP=${(t.failP||0).toFixed(3)}  lat=${t.latency}  gas=${t.gas}  ${t.profile}  ${t.regime||'?'}\x1b[0m`
    );
  }

  console.log('\n' + EQ + '\n');
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────

function runSelfTest() {
  let pass = 0, fail = 0;
  function assert(label, cond, detail) {
    if (cond) { console.log(`  ✓ [PASS] ${label}`); pass++; }
    else       { console.error(`  ✗ [FAIL] ${label}${detail ? ' — '+detail : ''}`); fail++; }
  }

  function mkBp(spread, profile, regime, hr) {
    const ts = `2026-04-14T${hr}:15:00.000Z`;
    return {
      blueprintId : `BP-${spread}-${profile}`,
      ts, pair    : 'ETH/USDC-RAMSES',
      venues      : { entry:{expectedPrice:2185,feePct:0.0001}, exit:{expectedPrice:2185*(1+spread/100),feePct:0.0005} },
      sizing      : { targetUsd: 200 },
      economics   : { spreadPct: spread, gasCostUsd: 0.028 },
      viability   : { confidenceScore: 0.72 },
      _context    : { activeProfile:profile, heatClass:'EXTREME', heatScore:0.62,
                      regime, edgeBucket:'viable', windowId:1,
                      bestSizeObserved:100, policySize:200, targetExecutionSizeUsd:200, heatSizeAdjusted:false },
    };
  }

  // Build two mock sessions
  const sessA = {
    name       : 'session_test_A',
    blueprints : [
      mkBp(0.40,'AGGRESSIVE','persistent_depth_regime','09'),
      mkBp(0.30,'SAFE','persistent_depth_regime','10'),
      mkBp(0.14,'AGGRESSIVE','surge','11'),  // should FAIL
    ],
  };
  const sessB = {
    name       : 'session_test_B',
    blueprints : [
      mkBp(0.25,'SAFE','persistent_depth_regime','09'),
      mkBp(0.22,'AGGRESSIVE','surge','10'),
    ],
  };

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Execution-Viable Session Analyzer — Self-Test');
  console.log('  ════════════════════════════════════════════════════════════\n');

  const result = analyseAll([sessA, sessB]);

  // Q1: session ranking
  assert('Q1: 2 session rows', result.sessionRows.length === 2);
  const rowA = result.sessionRows.find(r => r.session === 'session_test_A');
  const rowB = result.sessionRows.find(r => r.session === 'session_test_B');
  assert('Q1: sessA has 3 blueprints', rowA?.blueprintCount === 3, `${rowA?.blueprintCount}`);
  assert('Q1: sessA fail count ≥ 1 (thin spread)', (rowA?.failCount ?? 0) >= 1, `${rowA?.failCount}`);
  assert('Q1: viable rate is a number', typeof rowA?.viableRate === 'number');
  console.log(`    sessA: viable=${rowA?.viableCount} rate=${rowA?.viableRate}% marginal=${rowA?.marginalCount} fail=${rowA?.failCount}`);
  console.log(`    sessB: viable=${rowB?.viableCount} rate=${rowB?.viableRate}%`);

  // Q2: profile/regime
  assert('Q2: profileRegimeSummary non-empty', result.profileRegimeSummary.length > 0);
  const pr = result.profileRegimeSummary.find(p => p.profile === 'SAFE' && p.regime === 'persistent_depth_regime');
  assert('Q2: SAFE+persistent_depth found', !!pr, 'not found');
  console.log(`    Profile×regime entries: ${result.profileRegimeSummary.length}`);

  // Q3: hourly windows
  assert('Q3: hourlySummary non-empty', result.hourlySummary.length > 0);
  const hr09 = result.hourlySummary.find(h => h.hour === '09');
  assert('Q3: hour 09 exists', !!hr09);
  assert('Q3: hour 09 has viable bps', (hr09?.viableCount ?? 0) > 0, `${hr09?.viableCount}`);
  console.log(`    Hourly buckets: ${result.hourlySummary.length}`);

  // Global summary
  assert('Global: totalSessions = 2', result.globalSummary.totalSessions === 2);
  assert('Global: totalBlueprints = 5', result.globalSummary.totalBlueprints === 5, `${result.globalSummary.totalBlueprints}`);
  assert('Global: viableRate is number', typeof result.globalSummary.viableRate === 'number');
  assert('Global: topSession set', !!result.globalSummary.topSession);
  console.log(`    globalSummary: total=${result.globalSummary.totalBlueprints} viable=${result.globalSummary.totalViable} rate=${result.globalSummary.viableRate}%`);

  // Determinism
  const r2 = analyseAll([sessA, sessB]);
  assert('Determinism: globalSummary identical', JSON.stringify(result.globalSummary) === JSON.stringify(r2.globalSummary));
  assert('Determinism: sessionRows identical', JSON.stringify(result.sessionRows) === JSON.stringify(r2.sessionRows));

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(LOGS_DIR)) {
    console.error(`[execution_viable_session_analyzer] logs dir not found: ${LOGS_DIR}`);
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write(`[execution_viable_session_analyzer] Loading sessions from ${LOGS_DIR}...\n\n`);

  const sessions = loadSessions(LOGS_DIR);
  if (!sessions.length) {
    console.error('[execution_viable_session_analyzer] No sessions with blueprints found.');
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write(`  Found ${sessions.length} session(s). Running v2.1 simulator...\n\n`);

  const result = analyseAll(sessions);

  if (FLAG_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printReport(result);
  }
}

main();
