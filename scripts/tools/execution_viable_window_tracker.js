'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Execution-Viable Window Tracker
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/tools/execution_viable_window_tracker.js
//  STATUS    : NEW — Boss ruling 2026-04-14
//
//  PURPOSE
//  ───────
//  Tracks execution-viable candidate density across four dimensions simultaneously:
//
//    1. Hour (UTC)          — which hours consistently produce viable candidates?
//    2. Profile             — AGGRESSIVE vs SAFE contribution per hour
//    3. Regime              — persistent_depth vs surge per hour
//    4. Session strength    — do strong sessions lift all hours, or concentrate?
//
//  KEY QUESTION (Boss directive):
//    Does the 10:00 UTC / 18:00 UTC pattern PERSIST across sessions,
//    or is it an artifact of a few strong sessions?
//
//  PERSISTENCE TEST
//  ─────────────────
//  An hour is classified as:
//    PERSISTENT  — viable candidates appear in ≥50% of sessions that cover it
//    RECURRING   — viable candidates appear in 25–49% of sessions
//    INCIDENTAL  — viable candidates appear in <25% of sessions
//    ABSENT      — no sessions cover this hour yet
//
//  SESSION STRENGTH TIERS
//  ───────────────────────
//    STRONG   — viable rate ≥ 12%
//    MODERATE — viable rate 6–11.9%
//    WEAK     — viable rate < 6%
//
//  USAGE
//  ─────
//  node scripts/tools/execution_viable_window_tracker.js --logs ./logs
//  node scripts/tools/execution_viable_window_tracker.js --logs ./logs --json
//  node scripts/tools/execution_viable_window_tracker.js --self-test
// ═══════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const { simulateBatch } = require('../execution/execution_realism_simulator');

// ─── CLASSIFICATION CONSTANTS ─────────────────────────────────────────────────

const SESSION_STRONG_THRESHOLD   = 12.0;  // viable rate %
const SESSION_MODERATE_THRESHOLD =  6.0;
const HOUR_PERSISTENT_THRESHOLD  =  0.50; // fraction of sessions covering hour
const HOUR_RECURRING_THRESHOLD   =  0.25;
const MIN_BP_FOR_HOUR_COVERAGE   =  3;    // at least 3 blueprints to count session as "covering" an hour

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).reduce((acc, l) => {
    try { acc.push(JSON.parse(l)); } catch {}
    return acc;
  }, []);
}

function pct(n, d)  { return d ? +(100 * n / d).toFixed(1) : 0; }
function avg(arr)   { return arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(4) : null; }
function med(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return +(s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2).toFixed(4);
}

function sessionStrengthTier(viableRate) {
  if (viableRate >= SESSION_STRONG_THRESHOLD)   return 'STRONG';
  if (viableRate >= SESSION_MODERATE_THRESHOLD) return 'MODERATE';
  return 'WEAK';
}

function persistenceLabel(sessionsWithViable, sessionsCovering) {
  if (!sessionsCovering) return 'ABSENT';
  const ratio = sessionsWithViable / sessionsCovering;
  if (ratio >= HOUR_PERSISTENT_THRESHOLD)  return 'PERSISTENT';
  if (ratio >= HOUR_RECURRING_THRESHOLD)   return 'RECURRING';
  return 'INCIDENTAL';
}

// ─── LOAD SESSIONS ────────────────────────────────────────────────────────────

function loadSessions(logsDir) {
  if (!fs.existsSync(logsDir)) return [];
  return fs.readdirSync(logsDir)
    .filter(d => d.startsWith('session_') && fs.statSync(path.join(logsDir, d)).isDirectory())
    .sort()
    .map(sname => {
      const bps = readJsonl(path.join(logsDir, sname, 'blueprints.jsonl'));
      return { name: sname, blueprints: bps };
    })
    .filter(s => s.blueprints.length > 0);
}

// ─── CORE TRACKER ─────────────────────────────────────────────────────────────

/**
 * Build the four-dimensional window tracking report.
 *
 * @param {object[]} sessions  Array of { name, blueprints }
 * @returns {object}           Full tracking result
 */
function trackWindows(sessions) {
  if (!sessions.length) return _emptyResult();

  // ── Per-hour tracking structures ───────────────────────────────────────────
  // hourSlots[hr] = {
  //   totalBp, viableCount, nets[], worsts[], failProbs[],
  //   byProfile: { AGGRESSIVE:{bp,viable,nets}, SAFE:{...}, ... },
  //   byRegime:  { persistent_depth_regime:{bp,viable,nets}, surge:{...}, ... },
  //   bySession: { sessionName: { bp, viable } },
  //   sessionsThatCover: Set,
  //   sessionsWithViable: Set,
  // }
  const hourSlots = {};
  for (let h = 0; h < 24; h++) {
    const hr = String(h).padStart(2, '0');
    hourSlots[hr] = {
      totalBp: 0, viableCount: 0, nets: [], worsts: [], failProbs: [],
      byProfile: {}, byRegime: {},
      bySession: {},
      sessionsThatCover  : new Set(),
      sessionsWithViable : new Set(),
    };
  }

  // ── Session-level output ───────────────────────────────────────────────────
  const sessionMeta = [];

  // ── Cross-session hour matrix ──────────────────────────────────────────────
  // hourMatrix[sessionName][hr] = { bp, viable, viableRate }
  const hourMatrix = {};

  for (const session of sessions) {
    const { name, blueprints: bps } = session;
    const results = simulateBatch(bps);

    // Session-level viable rate → strength tier
    const viableAll = results.filter(r => r.executionClass === 'EXECUTION_VIABLE');
    const sessionViableRate = pct(viableAll.length, bps.length);
    const strengthTier = sessionStrengthTier(sessionViableRate);

    hourMatrix[name] = {};

    // Per-hour counts for this session
    const sessionHourBp     = {};
    const sessionHourViable = {};

    for (let i = 0; i < bps.length; i++) {
      const bp = bps[i];
      const r  = results[i];
      const ts = bp.ts || bp.signalTs || '';
      const hr = ts.length >= 13 ? ts.slice(11, 13) : null;
      if (!hr) continue;

      const slot   = hourSlots[hr];
      const profile = r.profile || bp._context?.activeProfile || 'unknown';
      const regime  = r.regime  || bp._context?.regime        || 'unknown';
      const isViable = r.executionClass === 'EXECUTION_VIABLE';

      // Global slot
      slot.totalBp++;
      slot.sessionsThatCover.add(name);
      sessionHourBp[hr]     = (sessionHourBp[hr]     || 0) + 1;
      sessionHourViable[hr] = (sessionHourViable[hr] || 0);

      if (isViable) {
        slot.viableCount++;
        slot.sessionsWithViable.add(name);
        slot.nets.push(r.expectedRealNetUsd);
        slot.worsts.push(r.worstCaseNetUsd);
        slot.failProbs.push(r.failureProbability);
        sessionHourViable[hr]++;
      }

      // Profile breakdown
      if (!slot.byProfile[profile]) slot.byProfile[profile] = { bp: 0, viable: 0, nets: [] };
      slot.byProfile[profile].bp++;
      if (isViable) { slot.byProfile[profile].viable++; slot.byProfile[profile].nets.push(r.expectedRealNetUsd); }

      // Regime breakdown
      if (!slot.byRegime[regime]) slot.byRegime[regime] = { bp: 0, viable: 0, nets: [] };
      slot.byRegime[regime].bp++;
      if (isViable) { slot.byRegime[regime].viable++; slot.byRegime[regime].nets.push(r.expectedRealNetUsd); }
    }

    // Build session-hour matrix entries
    const hoursThisSession = new Set([...Object.keys(sessionHourBp)]);
    for (const hr of hoursThisSession) {
      const b = sessionHourBp[hr] || 0;
      const v = sessionHourViable[hr] || 0;
      hourMatrix[name][hr] = { bp: b, viable: v, viableRate: pct(v, b) };
      // Mark session as covering the hour if enough blueprints
      if (b >= MIN_BP_FOR_HOUR_COVERAGE) {
        hourSlots[hr].sessionsThatCover.add(name);  // already added above but ensure
      }
    }

    sessionMeta.push({ name, blueprintCount: bps.length, viableCount: viableAll.length,
                       viableRate: sessionViableRate, strengthTier });
  }

  // ── Compile hour summary ───────────────────────────────────────────────────
  const hourSummary = Object.entries(hourSlots).map(([hr, slot]) => {
    const sessionsCovering  = slot.sessionsThatCover.size;
    const sessionsWithViable= slot.sessionsWithViable.size;
    const persistence       = persistenceLabel(sessionsWithViable, sessionsCovering);

    // Best profile for this hour
    const profileEntries = Object.entries(slot.byProfile)
      .map(([p, v]) => ({ profile: p, bp: v.bp, viable: v.viable, avgNet: avg(v.nets) }))
      .sort((a, b) => b.viable - a.viable);

    // Best regime
    const regimeEntries = Object.entries(slot.byRegime)
      .map(([r, v]) => ({ regime: r, bp: v.bp, viable: v.viable, avgNet: avg(v.nets) }))
      .sort((a, b) => b.viable - a.viable);

    return {
      hour             : hr,
      totalBp          : slot.totalBp,
      viableCount      : slot.viableCount,
      viableRate       : pct(slot.viableCount, slot.totalBp),
      avgCoreNet       : avg(slot.nets),
      medCoreNet       : med(slot.nets),
      avgWorstCase     : avg(slot.worsts),
      avgFailProb      : avg(slot.failProbs),
      sessionsCovering,
      sessionsWithViable,
      persistence,
      topProfile       : profileEntries[0] || null,
      topRegime        : regimeEntries[0] || null,
      profileBreakdown : profileEntries,
      regimeBreakdown  : regimeEntries,
    };
  });

  // ── Session-strength vs hour correlation ───────────────────────────────────
  // For each strength tier, which hours are most productive?
  const tierHours = { STRONG: {}, MODERATE: {}, WEAK: {} };
  for (const s of sessionMeta) {
    const mat = hourMatrix[s.name];
    for (const [hr, data] of Object.entries(mat)) {
      if (!tierHours[s.strengthTier][hr]) tierHours[s.strengthTier][hr] = { viable: 0, bp: 0 };
      tierHours[s.strengthTier][hr].viable += data.viable;
      tierHours[s.strengthTier][hr].bp     += data.bp;
    }
  }

  // ── Persistence summary ────────────────────────────────────────────────────
  const persistentHours  = hourSummary.filter(h => h.persistence === 'PERSISTENT')
    .sort((a, b) => b.viableCount - a.viableCount);
  const recurringHours   = hourSummary.filter(h => h.persistence === 'RECURRING')
    .sort((a, b) => b.viableCount - a.viableCount);
  const incidentalHours  = hourSummary.filter(h => h.persistence === 'INCIDENTAL');
  const absentHours      = hourSummary.filter(h => h.persistence === 'ABSENT');

  // ── Global summary ─────────────────────────────────────────────────────────
  const allViableNets = hourSummary.flatMap(h => h.avgCoreNet ? [h.avgCoreNet] : []);
  const globalSummary = {
    totalSessions      : sessions.length,
    totalBlueprints    : hourSummary.reduce((a, h) => a + h.totalBp, 0),
    totalViable        : hourSummary.reduce((a, h) => a + h.viableCount, 0),
    persistentHourCount: persistentHours.length,
    recurringHourCount : recurringHours.length,
    topHourByVolume    : hourSummary.slice().sort((a, b) => b.viableCount - a.viableCount)[0]?.hour,
    topHourByRate      : hourSummary.filter(h=>h.totalBp>=20).sort((a, b) => b.viableRate - a.viableRate)[0]?.hour,
    strongSessions     : sessionMeta.filter(s => s.strengthTier === 'STRONG').map(s => s.name),
    benchmarkSession   : sessionMeta.slice().sort((a, b) => b.viableCount - a.viableCount)[0]?.name,
  };

  return {
    hourSummary,
    hourMatrix,
    tierHours,
    persistentHours,
    recurringHours,
    incidentalHours,
    absentHours,
    sessionMeta,
    globalSummary,
  };
}

function _emptyResult() {
  return { hourSummary: [], hourMatrix: {}, tierHours: {}, persistentHours: [],
           recurringHours: [], sessionMeta: [], globalSummary: { totalSessions: 0 } };
}

// ─── REPORT PRINTER ───────────────────────────────────────────────────────────

function printReport(result) {
  const { hourSummary, persistentHours, recurringHours, incidentalHours,
          sessionMeta, tierHours, globalSummary: G } = result;
  const W = 115, EQ = '═'.repeat(W), DIV = '─'.repeat(W);

  const persistLabel = p => {
    if (p === 'PERSISTENT')  return '\x1b[1;32mPERSISTENT \x1b[0m';
    if (p === 'RECURRING')   return '\x1b[33mRECURRING  \x1b[0m';
    if (p === 'INCIDENTAL')  return '\x1b[90mINCIDENTAL \x1b[0m';
    return '\x1b[90mABSENT     \x1b[0m';
  };

  console.log('\n' + EQ);
  console.log('  AllMight — Execution-Viable Window Tracker');
  console.log(`  ${new Date().toISOString()}`);
  console.log(EQ);

  // Global
  console.log(`\n  Sessions: ${G.totalSessions}  Blueprints: ${G.totalBlueprints}  Viable: ${G.totalViable}`);
  console.log(`  Persistent hours: ${G.persistentHourCount}  |  Recurring: ${G.recurringHourCount}`);
  console.log(`  Top hour by volume: ${G.topHourByVolume}:00  |  Top hour by rate: ${G.topHourByRate}:00`);
  console.log(`  Strong sessions: ${G.strongSessions.join(', ') || 'none'}`);
  console.log(`  Benchmark session: ${G.benchmarkSession}`);

  // ── KEY QUESTION: Do 10:00 and 18:00 persist? ────────────────────────────
  console.log(`\n\n  KEY QUESTION — Do 10:00 and 18:00 UTC patterns persist?`);
  console.log(`  ${DIV}`);
  for (const hr of ['10', '18', '06', '00', '23']) {
    const h = hourSummary.find(x => x.hour === hr);
    if (!h) continue;
    const profStr = (h.profileBreakdown||[]).slice(0,3).map(p=>`${p.profile}=${p.viable}`).join(' ');
    const regStr  = (h.regimeBreakdown||[]).slice(0,2).map(r=>`${r.regime.replace('persistent_depth_regime','pDepth')}=${r.viable}`).join(' ');
    console.log(
      `  ${hr}:00  ${persistLabel(h.persistence)}` +
      `viable=${String(h.viableCount).padStart(4)}  rate=${(h.viableRate+'%').padStart(6)}  ` +
      `covering=${h.sessionsCovering}sess  withViable=${h.sessionsWithViable}sess  ` +
      `avgCore=$${(h.avgCoreNet||0).toFixed(4)}  [${profStr}] [${regStr}]`
    );
  }

  // ── Full hour map ─────────────────────────────────────────────────────────
  console.log(`\n\n  FULL HOUR MAP (UTC 00–23)`);
  console.log(`  ${'Hr'.padEnd(6)} ${'Persist'.padEnd(12)} ${'Viable'.padStart(7)} ${'BPs'.padStart(6)} ${'Rate'.padStart(7)} ${'Cov'.padStart(4)} ${'W/V'.padStart(4)} ${'AvgCore'.padStart(9)} ${'AvgWorst'.padStart(10)}  Top profile / regime`);
  console.log(`  ${DIV}`);
  const byHour = hourSummary.slice().sort((a, b) => a.hour.localeCompare(b.hour));
  const maxV = Math.max(...hourSummary.map(h => h.viableCount), 1);
  for (const h of byHour) {
    const bar  = '█'.repeat(Math.round(20 * h.viableCount / maxV));
    const topP = h.topProfile?.profile ?? '-';
    const topR = (h.topRegime?.regime ?? '-').replace('persistent_depth_regime','pDepth');
    console.log(
      `  ${h.hour}:00  ${persistLabel(h.persistence)}` +
      `${String(h.viableCount).padStart(7)} ` +
      `${String(h.totalBp).padStart(6)} ` +
      `${(h.viableRate+'%').padStart(7)} ` +
      `${String(h.sessionsCovering).padStart(4)} ` +
      `${String(h.sessionsWithViable).padStart(4)} ` +
      `${'$'+(h.avgCoreNet||0).toFixed(4)}.padStart(9)} ` +
      `${'$'+(h.avgWorstCase||0).toFixed(4)}.padStart(10)}  ` +
      `${topP}/${topR}  ${bar}`
    );
  }

  // ── Session × hour matrix (viable counts) ─────────────────────────────────
  console.log(`\n\n  SESSION × HOUR MATRIX (viable count per cell)`);
  console.log(`  [★=STRONG ◆=MODERATE ·=WEAK]  blank = hour not covered`);
  const hotHours = hourSummary
    .filter(h => h.viableCount > 0)
    .sort((a, b) => b.viableCount - a.viableCount)
    .slice(0, 12)
    .map(h => h.hour)
    .sort();
  const tierSym = { STRONG:'★', MODERATE:'◆', WEAK:'·' };

  // Header
  process.stdout.write(`  ${'Session'.padEnd(28)} ${tierSym['STRONG']} `);
  hotHours.forEach(h => process.stdout.write(h.padStart(5)));
  console.log();
  console.log(`  ${DIV}`);

  for (const s of sessionMeta) {
    const mat = result.hourMatrix[s.name] || {};
    const sym = tierSym[s.strengthTier];
    process.stdout.write(`  ${s.name.padEnd(28)} ${sym} `);
    for (const hr of hotHours) {
      const cell = mat[hr];
      if (!cell || cell.bp < MIN_BP_FOR_HOUR_COVERAGE) {
        process.stdout.write('    -');
      } else {
        const v = String(cell.viable);
        const color = cell.viable > 10 ? '\x1b[1;32m' : cell.viable > 4 ? '\x1b[33m' : '';
        process.stdout.write(`${color}${v.padStart(5)}\x1b[0m`);
      }
    }
    console.log(`  (${s.viableRate}%)`);
  }

  // ── Persistence verdict ───────────────────────────────────────────────────
  console.log(`\n\n  PERSISTENCE VERDICT`);
  console.log(`  ${DIV}`);
  if (persistentHours.length) {
    console.log(`  \x1b[1;32mPERSISTENT hours (viable in ≥50% of covering sessions):\x1b[0m`);
    persistentHours.forEach(h =>
      console.log(`    ${h.hour}:00  viable=${h.viableCount}  rate=${h.viableRate}%  ` +
        `sessions=${h.sessionsWithViable}/${h.sessionsCovering}  avgCore=$${(h.avgCoreNet||0).toFixed(4)}`));
  } else {
    console.log('  No PERSISTENT hours yet — more session coverage needed.');
  }
  if (recurringHours.length) {
    console.log(`\n  \x1b[33mRECURRING hours (viable in 25–49% of covering sessions):\x1b[0m`);
    recurringHours.forEach(h =>
      console.log(`    ${h.hour}:00  viable=${h.viableCount}  sessions=${h.sessionsWithViable}/${h.sessionsCovering}`));
  }

  // ── Strength-tier hour analysis ───────────────────────────────────────────
  console.log(`\n\n  STRENGTH TIER × HOUR (top 6 hours per tier)`);
  console.log(`  ${DIV}`);
  for (const tier of ['STRONG', 'MODERATE', 'WEAK']) {
    const entries = Object.entries(tierHours[tier])
      .map(([hr, v]) => ({ hr, viable: v.viable, bp: v.bp, rate: pct(v.viable, v.bp) }))
      .filter(e => e.bp >= MIN_BP_FOR_HOUR_COVERAGE)
      .sort((a, b) => b.viable - a.viable)
      .slice(0, 6);
    const sym = tierSym[tier];
    const label = tier === 'STRONG' ? '\x1b[1;32m' : tier === 'MODERATE' ? '\x1b[33m' : '\x1b[90m';
    console.log(`\n  ${label}${sym} ${tier} sessions${'\x1b[0m'}:`);
    entries.forEach(e =>
      console.log(`    ${e.hr}:00  viable=${e.viable}  bp=${e.bp}  rate=${e.rate}%`));
    if (!entries.length) console.log('    (no data)');
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
    return {
      blueprintId : `BP-${spread}-${profile}-${hr}`,
      ts          : `2026-04-14T${hr}:15:00.000Z`,
      pair        : 'ETH/USDC-RAMSES',
      venues      : { entry:{expectedPrice:2185,feePct:0.0001}, exit:{expectedPrice:2185*(1+spread/100),feePct:0.0005} },
      sizing      : { targetUsd: 200 },
      economics   : { spreadPct: spread, gasCostUsd: 0.028 },
      viability   : { confidenceScore: 0.72 },
      _context    : { activeProfile: profile, heatClass:'EXTREME', heatScore:0.62,
                      regime, edgeBucket:'viable', windowId:1,
                      bestSizeObserved:100, policySize:200, targetExecutionSizeUsd:200,
                      heatSizeAdjusted:false },
    };
  }

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  AllMight — Execution-Viable Window Tracker — Self-Test');
  console.log('  ════════════════════════════════════════════════════════════\n');

  const sessA = {
    name       : 'session_test_A',
    blueprints : [
      mkBp(0.40,'AGGRESSIVE','persistent_depth_regime','10'),
      mkBp(0.40,'AGGRESSIVE','persistent_depth_regime','10'),
      mkBp(0.40,'AGGRESSIVE','persistent_depth_regime','10'),
      mkBp(0.40,'SAFE','surge','10'),
      mkBp(0.14,'AGGRESSIVE','surge','10'),  // FAIL
      mkBp(0.35,'SAFE','persistent_depth_regime','18'),
      mkBp(0.35,'SAFE','persistent_depth_regime','18'),
      mkBp(0.35,'SAFE','persistent_depth_regime','18'),
    ],
  };
  const sessB = {
    name       : 'session_test_B',
    blueprints : [
      mkBp(0.30,'AGGRESSIVE','persistent_depth_regime','10'),
      mkBp(0.30,'AGGRESSIVE','persistent_depth_regime','10'),
      mkBp(0.30,'AGGRESSIVE','persistent_depth_regime','10'),
      mkBp(0.25,'SAFE','surge','10'),
      mkBp(0.28,'SAFE','persistent_depth_regime','18'),
      mkBp(0.28,'SAFE','persistent_depth_regime','18'),
      mkBp(0.28,'SAFE','persistent_depth_regime','18'),
    ],
  };

  const result = trackWindows([sessA, sessB]);

  // Basic structure
  assert('hourSummary has 24 entries', result.hourSummary.length === 24);
  assert('sessionMeta has 2 entries', result.sessionMeta.length === 2);

  // Hour 10 should have viable candidates from both sessions → PERSISTENT
  const h10 = result.hourSummary.find(h => h.hour === '10');
  assert('Hour 10 exists', !!h10);
  assert('Hour 10 viableCount > 0', h10?.viableCount > 0, `${h10?.viableCount}`);
  assert('Hour 10 both sessions cover it', h10?.sessionsCovering === 2, `${h10?.sessionsCovering}`);
  assert('Hour 10 both sessions have viable', h10?.sessionsWithViable === 2, `${h10?.sessionsWithViable}`);
  assert('Hour 10 PERSISTENT', h10?.persistence === 'PERSISTENT', h10?.persistence);
  console.log(`    Hour 10: ${h10?.persistence}  viable=${h10?.viableCount}  covering=${h10?.sessionsCovering}`);

  // Hour 18 viable from both sessions
  const h18 = result.hourSummary.find(h => h.hour === '18');
  assert('Hour 18 PERSISTENT', h18?.persistence === 'PERSISTENT', h18?.persistence);
  console.log(`    Hour 18: ${h18?.persistence}  viable=${h18?.viableCount}`);

  // Hour 00 should be absent (no bps)
  const h00 = result.hourSummary.find(h => h.hour === '00');
  assert('Hour 00 ABSENT', h00?.persistence === 'ABSENT', h00?.persistence);

  // Profile breakdown
  assert('Hour 10 has AGGRESSIVE in profileBreakdown',
    (h10?.profileBreakdown||[]).some(p => p.profile === 'AGGRESSIVE'),
    JSON.stringify(h10?.profileBreakdown?.map(p=>p.profile)));
  assert('Regime breakdown non-empty', (h10?.regimeBreakdown?.length ?? 0) > 0);

  // Determinism
  const r2 = trackWindows([sessA, sessB]);
  assert('Deterministic hourSummary', JSON.stringify(result.hourSummary) === JSON.stringify(r2.hourSummary));
  assert('Deterministic globalSummary', JSON.stringify(result.globalSummary) === JSON.stringify(r2.globalSummary));

  // Global
  assert('globalSummary.totalSessions = 2', result.globalSummary.totalSessions === 2);
  assert('globalSummary.persistentHourCount ≥ 1', result.globalSummary.persistentHourCount >= 1,
    `${result.globalSummary.persistentHourCount}`);

  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log(`  Self-test: ${pass} passed  ${fail} failed`);
  console.log('  ════════════════════════════════════════════════════════════\n');
  if (fail > 0) process.exit(1);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  if (FLAG_TEST) { runSelfTest(); return; }

  if (!fs.existsSync(LOGS_DIR)) {
    console.error(`[execution_viable_window_tracker] logs dir not found: ${LOGS_DIR}`);
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write(`[execution_viable_window_tracker] Loading from ${LOGS_DIR}...\n\n`);

  const sessions = loadSessions(LOGS_DIR);
  if (!sessions.length) {
    console.error('[execution_viable_window_tracker] No sessions with blueprints found.');
    process.exit(1);
  }

  if (!FLAG_JSON) process.stdout.write(`  ${sessions.length} session(s) loaded. Running v2.1 simulator...\n\n`);

  const result = trackWindows(sessions);

  if (FLAG_JSON) {
    // Serialize Sets before JSON output
    const safe = JSON.parse(JSON.stringify(result, (k, v) =>
      v instanceof Set ? [...v] : v));
    console.log(JSON.stringify(safe, null, 2));
  } else {
    printReport(result);
  }
}

const ARGS      = process.argv.slice(2);
const FLAG_TEST = ARGS.includes('--self-test');
const FLAG_JSON = ARGS.includes('--json');
const LOGS_DIR  = (() => { const i = ARGS.indexOf('--logs'); return i !== -1 ? ARGS[i+1] : './logs'; })();

main();
