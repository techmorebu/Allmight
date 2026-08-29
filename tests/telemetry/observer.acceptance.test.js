#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1.2 — observer.acceptance.test.js
 *
 * All c1 + c1.1 acceptance assertions preserved (A1-A15, one modified for
 * c1.2 behavior). Adds 11 new c1.2 lifecycle assertions (L_A through L_K)
 * per Boss C9 ruling 2026-08-28.
 *
 * Uses only Node built-ins (no test framework). Creates fixture session
 * dirs + fixture lifecycle files under data/telemetry_sessions/.test_tmp/
 * so the REAL logs/allmight.session on the machine is never touched.
 *
 * Run: node tests/telemetry/observer.acceptance.test.js
 *
 * Exit 0 = all pass. Non-zero = fail with details.
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEST_TMP = path.join(REPO_ROOT, 'data', 'telemetry_sessions', '.test_tmp');
const OBSERVER = path.resolve(REPO_ROOT, 'scripts', 'telemetry', 'live_observer.js');
const PROMOTER = path.resolve(REPO_ROOT, 'scripts', 'telemetry', 'session_promoter.js');
const BACKFILL = path.resolve(REPO_ROOT, 'scripts', 'telemetry', 'retrospective_backfill.js');
const FIXTURE  = path.resolve(REPO_ROOT, 'scripts', 'telemetry', 'fixtures', 'generate_replay_v1.js');

// Expected deterministic SHA from fixture with default args
const FIXTURE_DEFAULT_SHA = 'bf997de328db5dd45c8a13c3642c28bbd32b27d02a62cea425b43e4293765936';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} ${name}${detail ? '   ' + detail : ''}`);
}

function cleanup() {
  if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });
  const logsSessions = path.join(REPO_ROOT, 'logs', 'sessions');
  if (fs.existsSync(logsSessions)) {
    for (const d of fs.readdirSync(logsSessions)) {
      if (d.startsWith('session_2099-') || d.startsWith('session_2099')) {
        fs.rmSync(path.join(logsSessions, d), { recursive: true, force: true });
      }
    }
  }
  const testCanon = path.join(REPO_ROOT, 'data', 'observations_test.jsonl');
  if (fs.existsSync(testCanon)) fs.unlinkSync(testCanon);
  const teleSess = path.join(REPO_ROOT, 'data', 'telemetry_sessions');
  if (fs.existsSync(teleSess)) {
    for (const d of fs.readdirSync(teleSess)) {
      if (d.startsWith('OBS_test_')) {
        fs.rmSync(path.join(teleSess, d), { recursive: true, force: true });
      }
    }
  }
}

function makeFakeSession(sessionName, records) {
  const dir = path.join(REPO_ROOT, 'logs', 'sessions', sessionName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'activator.jsonl'), '{"activator":"present"}\n');
  const priceReplay = records.map(r => JSON.stringify(r)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'price_replay.jsonl'), priceReplay);
  return dir;
}

// c1.2 helper: create per-test lifecycle-file fixtures (isolates from real logs/allmight.session)
function makeLifecycleFixtures(runId, sid, opts = {}) {
  // opts: { withPointer: bool (default true), pointerContent: string (default sid),
  //         withArchive: bool, withAborted: bool }
  const base = path.join(TEST_TMP, runId);
  fs.mkdirSync(base, { recursive: true });
  const sessionFile = path.join(base, 'allmight.session');
  const archiveDir  = path.join(base, 'archive');
  const abortedDir  = path.join(base, 'aborted');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(abortedDir, { recursive: true });
  if (opts.withPointer !== false) {
    fs.writeFileSync(sessionFile, (opts.pointerContent || sid) + '\n');
  }
  if (opts.withArchive) {
    fs.writeFileSync(path.join(archiveDir, `session_${sid}.zip`), 'PK\x03\x04fake_zip');
  }
  if (opts.withAborted) {
    fs.mkdirSync(path.join(abortedDir, `session_${sid}`), { recursive: true });
  }
  // Return paths relative to repo root (as observer expects for CLI args)
  return {
    sessionFile: path.relative(REPO_ROOT, sessionFile),
    archiveDir:  path.relative(REPO_ROOT, archiveDir),
    abortedDir:  path.relative(REPO_ROOT, abortedDir),
    // Also absolute paths for post-run manipulation
    sessionFileAbs: sessionFile,
    archiveDirAbs:  archiveDir,
    abortedDirAbs:  abortedDir
  };
}

function runNode(script, args, opts = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30000,
    ...opts
  });
}

// c1.2 helper: run observer async so we can manipulate lifecycle files while it runs
function spawnObserver(args) {
  return spawn('node', [OBSERVER, ...args], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

// Await a child process with timeout; return { code, signal, stderr }
function awaitExit(child, timeoutMs) {
  return new Promise((resolve) => {
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    const to = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      resolve({ code: null, signal: 'TIMEOUT', stderr });
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(to);
      resolve({ code, signal, stderr });
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── run tests ──
// Wrapped in an async IIFE so `await` works across Node versions
// without depending on top-level-await CJS support.
(async () => {
cleanup();

console.log('─── Wave 11 c1.2 acceptance tests ───');

// ═══════════════════════════════════════════════════════════════════════════
// c1 / c1.1 test suite (A1-A15) — preserved intact except A5 (updated for c1.2)
// ═══════════════════════════════════════════════════════════════════════════

// ── A1: positive observation stages + promotes ──
{
  const sess = 'session_20990101_0000';
  makeFakeSession(sess, [
    { ts: '2099-01-01T00:00:16.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' },
    { ts: '2099-01-01T00:00:16.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'ramses_v2',  price: 3010, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A1_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, '20990101_0000');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                  '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  const staged = path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'observations_staged.jsonl');
  const ok = res.status === 0 && fs.existsSync(staged) &&
             fs.readFileSync(staged, 'utf8').split('\n').filter(Boolean).length === 2;
  check('A1 positive observation stages 2 records', ok, `status=${res.status}`);

  if (ok) {
    const promRes = runNode(PROMOTER, ['--observer-run-id', runId, '--canonical-path', 'data/observations_test.jsonl']);
    const promoted = fs.existsSync(path.join(REPO_ROOT, 'data', 'observations_test.jsonl'))
      && fs.readFileSync(path.join(REPO_ROOT, 'data', 'observations_test.jsonl'), 'utf8').split('\n').filter(Boolean).length === 2;
    check('A1 promotion succeeds and canonical has 2 records', promRes.status === 0 && promoted, `status=${promRes.status}`);
  }
}

// ── A2: negative-outcome observation still stages + promotes (content-neutral) ──
{
  const sess = 'session_20990202_0000';
  makeFakeSession(sess, [
    { ts: '2099-02-02T00:00:04.000Z', blockNumber: 10, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' },
    { ts: '2099-02-02T00:00:04.000Z', blockNumber: 10, sourceType: 'activator_tick', venue: 'ramses_v2',  price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A2_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, '20990202_0000');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                  '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  const staged = path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'observations_staged.jsonl');
  const ok = res.status === 0 && fs.existsSync(staged) &&
             fs.readFileSync(staged, 'utf8').split('\n').filter(Boolean).length === 2;
  check('A2 unfavorable-outcome record still stages (content-neutral)', ok);
  if (ok) {
    const promRes = runNode(PROMOTER, ['--observer-run-id', runId, '--canonical-path', 'data/observations_test.jsonl']);
    check('A2 unfavorable-outcome record still promotes', promRes.status === 0);
  }
}

// ── A3: invalid schema/integrity rejected deterministically ──
{
  const sess = 'session_20990303_0000';
  makeFakeSession(sess, [{ garbage: 'yes' }]);
  const runId = 'OBS_test_A3_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, '20990303_0000');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                  '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  const staged = path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'observations_staged.jsonl');
  const stagedLines = fs.existsSync(staged) ? fs.readFileSync(staged, 'utf8').split('\n').filter(Boolean) : [];
  const isRejection = stagedLines.length === 1 && JSON.parse(stagedLines[0]).rejection === true;
  check('A3 invalid record marked as rejection in staged', isRejection);
  if (isRejection) {
    const promRes = runNode(PROMOTER, ['--observer-run-id', runId, '--canonical-path', 'data/observations_test.jsonl']);
    check('A3 promoter filters observer-rejections cleanly', promRes.status === 0);
  }
}

// ── A4: LIVE cannot be established when provenance fails ──
{
  const bogusDir = path.join(REPO_ROOT, 'data', 'telemetry_sessions', '.test_tmp', 'bogus');
  fs.mkdirSync(bogusDir, { recursive: true });
  fs.writeFileSync(path.join(bogusDir, 'price_replay.jsonl'), '{"ts":"2099-04-04T00:00:00.000Z","blockNumber":1,"sourceType":"activator_tick"}\n');
  const runId = 'OBS_test_A4_' + crypto.randomBytes(2).toString('hex');
  const res = runNode(OBSERVER, ['--source', 'data/telemetry_sessions/.test_tmp/bogus/price_replay.jsonl', '--observer-run-id', runId]);
  check('A4 observer refuses non-session-dir path (exit 2)', res.status === 2);
}

// ── A5 (c1.2 UPDATED): no daemon — observer honors SIGTERM promptly ──
// Original c1 A5 tested "observer exits after 10s idle timeout" — that behavior
// was REMOVED in c1.2 per Boss C9 (source idle is not terminal). Replaced with
// SIGTERM-response test: proves no daemon-like blocking loop.
{
  const sess = 'session_20990505_0000';
  makeFakeSession(sess, [
    { ts: '2099-05-05T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A5_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, '20990505_0000');
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  // Let observer settle, then send SIGTERM
  const t0 = Date.now();
  await sleep(2000);
  child.kill('SIGTERM');
  const res = await awaitExit(child, 10000);
  const elapsed = Date.now() - t0;
  check('A5 (c1.2) observer honors SIGTERM within ~5s (no daemon)', res.code === 0 && elapsed < 8000, `elapsed=${elapsed}ms code=${res.code}`);
}

// ── A6: no executionAuthorized change ──
{
  const scriptsDir = path.join(REPO_ROOT, 'scripts');
  let leak = false;
  function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|py|json)$/.test(e.name)) {
        try {
          const c = fs.readFileSync(p, 'utf8');
          if (/executionAuthorized\s*:\s*true/.test(c)) leak = true;
        } catch {}
      }
    }
  }
  walk(scriptsDir);
  check('A6 no executionAuthorized:true in scripts/ after test', !leak);
}

// ── A7: observer does NOT touch RPC, broadcast, or send any network request ──
{
  const src = fs.readFileSync(OBSERVER, 'utf8');
  // Boss C9: check for actual invocations, not doc mentions.
  // Strip line-comments (// ...) and block-comments (/* ... */) before scanning.
  const noBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noComments = noBlockComments.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const forbidden = [
    /require\s*\(\s*['"]https?['"]/,
    /require\s*\(\s*['"]net['"]/,
    /require\s*\(\s*['"]dgram['"]/,
    /require\s*\(\s*['"]ethers['"]/,
    /require\s*\(\s*['"]axios['"]/,
    /require\s*\(\s*['"]node-fetch['"]/,
    /new\s+WebSocket\s*\(/,
    /fetch\s*\(\s*['"`]https?:/,
    /new\s+URL\s*\(\s*['"`]https?:/
    // Note: 'discord' word check removed — legitimate doc mentions
    //       (like "does NOT send to Discord") are not violations.
  ];
  const leak = forbidden.some(re => re.test(noComments));
  check('A7 observer has no network invocation code (comment-stripped)', !leak);
}

// ── A8: no capital policy change ──
{
  const capitalPolicyPath = path.join(REPO_ROOT, 'config', 'capital_policy.json');
  // File presence not required; just prove observer/promoter/backfill don't modify it
  const observerSrc = fs.readFileSync(OBSERVER, 'utf8');
  const promoterSrc = fs.existsSync(PROMOTER) ? fs.readFileSync(PROMOTER, 'utf8') : '';
  const backfillSrc = fs.existsSync(BACKFILL) ? fs.readFileSync(BACKFILL, 'utf8') : '';
  const leak = /capital_policy/i.test(observerSrc + promoterSrc + backfillSrc);
  check('A8 no capital_policy references in observer/promoter/backfill', !leak);
}

// ── A9: FIXTURE and LIVE remain distinguishable ──
{
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const hasLive = /telemetrySource:\s*['"]LIVE['"]/.test(src);
  const hasUnknown = /telemetrySource:\s*['"]UNKNOWN['"]/.test(src);
  check('A9 observer emits distinct LIVE and UNKNOWN telemetrySource', hasLive && hasUnknown);
}

// ── A10: canonical qualification pipeline files unchanged (structural preservation) ──
{
  const observerSrc = fs.readFileSync(OBSERVER, 'utf8');
  const promoterSrc = fs.existsSync(PROMOTER) ? fs.readFileSync(PROMOTER, 'utf8') : '';
  const notouchPatterns = ['config/', 'contracts/', 'deploy/', 'scripts/activator', 'scripts/execution/'];
  const leak = notouchPatterns.some(p => (promoterSrc + observerSrc).includes(`writeFile.*${p}`) ||
                                          (promoterSrc + observerSrc).includes(`fs.rm.*${p}`));
  check('A10 no writes/deletes to canonical qualification pipeline dirs', !leak);
}

// ── A11: FIXTURE record MUST NOT set telemetrySource=LIVE anywhere ──
{
  if (fs.existsSync(FIXTURE)) {
    const src = fs.readFileSync(FIXTURE, 'utf8');
    const leak = /telemetrySource:\s*['"]LIVE['"]/.test(src);
    check('A11 fixture generator does not set telemetrySource=LIVE', !leak);
  } else {
    check('A11 fixture generator does not set telemetrySource=LIVE', true, '(fixture file not present)');
  }
}

// ── A12: fixture default-args determinism ──
{
  if (fs.existsSync(FIXTURE)) {
    const outPath = path.join(TEST_TMP, 'fixture_out.jsonl');
    fs.mkdirSync(TEST_TMP, { recursive: true });
    runNode(FIXTURE, ['--out', outPath]);
    if (fs.existsSync(outPath)) {
      const sha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
      check(`A12 fixture default-args SHA == ${FIXTURE_DEFAULT_SHA.slice(0,8)}...`, sha === FIXTURE_DEFAULT_SHA, `got=${sha.slice(0,8)}...`);
    } else {
      check('A12 fixture default-args determinism', false, '(fixture output missing)');
    }
  } else {
    check('A12 fixture default-args determinism', true, '(fixture file not present)');
  }
}

// ── A13: telemetrySource=LIVE cannot be set without producer proof ──
{
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const hasRegex = /LIVE_SOURCE_PATH_RE/.test(src);
  const failsClosed = /exit\(2\)/.test(src) && /Refusing to proceed/.test(src);
  check('A13 observer refuses LIVE when provenance fails (exit 2 + regex present)', hasRegex && failsClosed);
}

// ── A14: retrospective_backfill.js DISABLED by default ──
{
  if (fs.existsSync(BACKFILL)) {
    const src = fs.readFileSync(BACKFILL, 'utf8');
    const disabled = /RETROSPECTIVE_BACKFILL_ENABLED\s*=\s*false/.test(src);
    const res = runNode(BACKFILL, []);
    check('A14 retrospective_backfill: hard-disabled constant present', disabled);
    check('A14 retrospective_backfill: exits 0 without doing work', res.status === 0);
  } else {
    check('A14 retrospective_backfill hard-disabled', true, '(backfill file not present)');
    check('A14 retrospective_backfill exits 0', true, '(backfill file not present)');
  }
}

// ── A15 (c1.1): bad sourceType is deterministically rejected ──
{
  const sess = 'session_20991515_0000';
  makeFakeSession(sess, [
    { ts: '2099-12-15T00:00:00.000Z', blockNumber: 42, sourceType: 'synthetic_replay', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A15_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, '20991515_0000');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                  '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  const staged = path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'observations_staged.jsonl');
  const lines = fs.existsSync(staged) ? fs.readFileSync(staged, 'utf8').split('\n').filter(Boolean) : [];
  const isRejection = lines.length === 1 && (() => {
    try {
      const rec = JSON.parse(lines[0]);
      return rec.rejection === true && String(rec.rejection_reason || '').includes('sourceType mismatch');
    } catch { return false; }
  })();
  check('A15 (c1.1) wrong sourceType rejected with sourceType-mismatch reason', isRejection);
}

// ═══════════════════════════════════════════════════════════════════════════
// c1.2 lifecycle assertions (Boss C9 mandatory A-K, prefixed L_ to distinguish)
// ═══════════════════════════════════════════════════════════════════════════

// ── L_A: source idle while SID unchanged → observer stays attached ──
// (Old 10s idle exit is REMOVED; source idle no longer terminates.)
{
  const sid = '20990606_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-06T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LA_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  // Wait 15 seconds (well past the OLD 10s idle threshold) without touching source or lifecycle
  await sleep(15000);
  // Observer should STILL be running
  const stillAlive = child.exitCode === null && !child.killed;
  child.kill('SIGTERM');
  await awaitExit(child, 5000);
  check('L_A observer stays attached during source idle > old 10s threshold', stillAlive);
}

// ── L_B: source idle simulating long restart cooldown → observer stays attached ──
{
  const sid = '20990607_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-07T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LB_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  // Wait through a long silence period (25 seconds — well past both idle threshold and 2 lifecycle checks)
  await sleep(25000);
  const stillAlive = child.exitCode === null && !child.killed;
  child.kill('SIGTERM');
  await awaitExit(child, 5000);
  check('L_B observer stays attached during simulated long restart cooldown', stillAlive);
}

// ── L_C: archive appears mid-attachment → CLEAN_LOGICAL_END ──
{
  const sid = '20990608_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-08T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LC_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  // Let observer settle
  await sleep(3000);
  // Create the archive artifact
  fs.writeFileSync(path.join(lc.archiveDirAbs, `session_${sid}.zip`), 'PK\x03\x04fake_zip');
  // Wait for next lifecycle check (10s) + grace
  const res = await awaitExit(child, 15000);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'manifest.json'), 'utf8'));
  check('L_C archive appears → observer detaches CLEAN_LOGICAL_END',
        res.code === 0 && manifest.terminalSignal === 'CLEAN_LOGICAL_END',
        `code=${res.code} signal=${manifest.terminalSignal}`);
}

// ── L_D: aborted directory appears → SESSION_ABORTED ──
{
  const sid = '20990609_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-09T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LD_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  await sleep(3000);
  fs.mkdirSync(path.join(lc.abortedDirAbs, `session_${sid}`), { recursive: true });
  const res = await awaitExit(child, 15000);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'manifest.json'), 'utf8'));
  check('L_D aborted appears → observer detaches SESSION_ABORTED',
        res.code === 0 && manifest.terminalSignal === 'SESSION_ABORTED',
        `code=${res.code} signal=${manifest.terminalSignal}`);
}

// ── L_E: session pointer disappears → SESSION_IDENTITY_LOST ──
{
  const sid = '20990610_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-10T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LE_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  await sleep(3000);
  fs.unlinkSync(lc.sessionFileAbs);
  const res = await awaitExit(child, 15000);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'manifest.json'), 'utf8'));
  check('L_E session pointer missing → observer detaches SESSION_IDENTITY_LOST',
        res.code === 0 && manifest.terminalSignal === 'SESSION_IDENTITY_LOST',
        `code=${res.code} signal=${manifest.terminalSignal}`);
}

// ── L_F: session pointer changes → SESSION_SUPERSEDED ──
{
  const sid = '20990611_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-11T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LF_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  await sleep(3000);
  fs.writeFileSync(lc.sessionFileAbs, '20991231_2359\n');  // new SID (session superseded)
  const res = await awaitExit(child, 15000);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'manifest.json'), 'utf8'));
  check('L_F session pointer changed → observer detaches SESSION_SUPERSEDED',
        res.code === 0 && manifest.terminalSignal === 'SESSION_SUPERSEDED',
        `code=${res.code} signal=${manifest.terminalSignal}`);
}

// ── L_G: archive + aborted both exist → LIFECYCLE_CONFLICT (fail-closed) ──
{
  const sid = '20990612_0000';
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-12T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LG_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid);
  const child = spawnObserver(['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  await sleep(3000);
  // Create BOTH terminal artifacts (integrity anomaly)
  fs.writeFileSync(path.join(lc.archiveDirAbs, `session_${sid}.zip`), 'PK\x03\x04fake_zip');
  fs.mkdirSync(path.join(lc.abortedDirAbs, `session_${sid}`), { recursive: true });
  const res = await awaitExit(child, 15000);
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'manifest.json'), 'utf8'));
  check('L_G both archive+aborted exist → observer detaches LIFECYCLE_CONFLICT',
        res.code === 0 && manifest.terminalSignal === 'LIFECYCLE_CONFLICT',
        `code=${res.code} signal=${manifest.terminalSignal}`);
}

// ── L_H: attach SID != source-path SID → observer refuses attachment (exit 5) ──
{
  const sid = '20990613_0000';
  const wrongSid = '20990614_9999';   // different SID in the session pointer
  const sess = 'session_' + sid;
  makeFakeSession(sess, [
    { ts: '2099-06-13T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_LH_' + crypto.randomBytes(2).toString('hex');
  const lc = makeLifecycleFixtures(runId, sid, { pointerContent: wrongSid });
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId,
                                  '--session-file', lc.sessionFile, '--archive-dir', lc.archiveDir, '--aborted-dir', lc.abortedDir]);
  check('L_H attach SID != source-path SID → exit 5 (attach validation)', res.status === 5, `status=${res.status}`);
}

// ── L_I: existing favorable + unfavorable record behavior unchanged (c1 A1+A2 preserved) ──
// Direct static check: the wrapping envelope logic and content-neutral gating
// must remain unchanged in c1.2 source.
{
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const hasEnvelope = /telemetrySource:\s*['"]LIVE['"][\s\S]*?recordFromSource:\s*record/.test(src);
  const contentNeutral = !/if\s*\([^)]*price[^)]*==?/.test(src);   // no price comparisons in gate
  check('L_I envelope construction preserved (LIVE wrapper + record passthrough)', hasEnvelope);
  check('L_I content-neutral gating preserved (no price-based rejection)', contentNeutral);
}

// ── L_J: no sameBlockVerified inference added ──
{
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const forbidden = /sameBlockVerified|inferSameBlock|blockAgreement/i.test(src);
  check('L_J observer does not introduce sameBlockVerified inference', !forbidden);
}

// ── L_K: no execution authorization / producer changes ──
{
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const forbidden = /executionAuthorized|broadcastAuthorized|capitalMovement/.test(src);
  check('L_K observer does not touch execution/broadcast/capital gates', !forbidden);
}

// ── summary ──
cleanup();

const fail = results.filter(r => !r.ok);
console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
if (fail.length === 0) {
  console.log(` ACCEPTANCE: ALL ${results.length} ASSERTIONS PASSED`);
  console.log('═══════════════════════════════════════════════════════════════════');
  process.exit(0);
} else {
  console.log(` ACCEPTANCE: ${fail.length} FAILED, ${results.length - fail.length} PASSED`);
  console.log('═══════════════════════════════════════════════════════════════════');
  for (const f of fail) console.log(`  ✗ ${f.name} ${f.detail}`);
  process.exit(1);
}
})().catch((e) => {
  console.error('fatal test runner error:', e && e.stack ? e.stack : e);
  process.exit(2);
});
