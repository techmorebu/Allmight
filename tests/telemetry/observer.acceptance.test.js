#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1 — observer.acceptance.test.js
 *
 * Runnable, deterministic acceptance test for all Boss C9 c1 assertions.
 * Uses only Node built-ins (no test framework). Creates a fake session
 * dir with activator-shape records + activator.jsonl sibling, runs the
 * observer + promoter against it, verifies outputs.
 *
 * Run: node tests/telemetry/observer.acceptance.test.js
 *
 * Exit 0 = all pass. Non-zero = fail with details.
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

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
  // Also clean up any test session dirs created under logs/sessions
  const logsSessions = path.join(REPO_ROOT, 'logs', 'sessions');
  if (fs.existsSync(logsSessions)) {
    for (const d of fs.readdirSync(logsSessions)) {
      if (d.startsWith('session_2099-')) {
        fs.rmSync(path.join(logsSessions, d), { recursive: true, force: true });
      }
    }
  }
  // Clean up test canonical
  const testCanon = path.join(REPO_ROOT, 'data', 'observations_test.jsonl');
  if (fs.existsSync(testCanon)) fs.unlinkSync(testCanon);
  // Clean OBS_test_* dirs
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

function runNode(script, args, opts = {}) {
  return spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30000,
    ...opts
  });
}

// ── run tests ──
cleanup();

console.log('─── Wave 11 c1 acceptance tests ───');

// ── A1: positive observation stages + promotes ──
// c1.1: compact session dirs, real activator record shape (two rows per block)
{
  const sess = 'session_20990101_0000';
  makeFakeSession(sess, [
    // Block 1: two rows (activator writes both venues per successful pool read)
    { ts: '2099-01-01T00:00:16.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' },
    { ts: '2099-01-01T00:00:16.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'ramses_v2',  price: 3010, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A1_' + crypto.randomBytes(2).toString('hex');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId]);
  const staged = path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'observations_staged.jsonl');
  const ok = res.status === 0 && fs.existsSync(staged) &&
             fs.readFileSync(staged, 'utf8').split('\n').filter(Boolean).length === 2;

  check('A1 positive observation stages 2 records', ok, `status=${res.status}`);

  if (ok) {
    // Now promote
    const promRes = runNode(PROMOTER, ['--observer-run-id', runId, '--canonical-path', 'data/observations_test.jsonl']);
    const promoted = fs.existsSync(path.join(REPO_ROOT, 'data', 'observations_test.jsonl'))
      && fs.readFileSync(path.join(REPO_ROOT, 'data', 'observations_test.jsonl'), 'utf8').split('\n').filter(Boolean).length === 2;
    check('A1 promotion succeeds and canonical has 2 records', promRes.status === 0 && promoted, `status=${promRes.status}`);
  }
}

// ── A2: negative-outcome observation still stages + promotes (content-neutral) ──
// c1.1: use compact session + real record shape.
// "Unfavorable" here = the two venue prices happen to be identical.
// The observer/promoter must NOT reject on economic outcome — schema/integrity only.
{
  const sess = 'session_20990202_0000';
  makeFakeSession(sess, [
    { ts: '2099-02-02T00:00:04.000Z', blockNumber: 10, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' },
    { ts: '2099-02-02T00:00:04.000Z', blockNumber: 10, sourceType: 'activator_tick', venue: 'ramses_v2',  price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A2_' + crypto.randomBytes(2).toString('hex');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId]);
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
// c1.1: 'garbage' has no blockNumber/ts/sourceType → still rejects.
{
  const sess = 'session_20990303_0000';
  makeFakeSession(sess, [{ garbage: 'yes' }]);
  const runId = 'OBS_test_A3_' + crypto.randomBytes(2).toString('hex');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId]);
  const staged = path.join(REPO_ROOT, 'data', 'telemetry_sessions', runId, 'observations_staged.jsonl');
  const stagedLines = fs.existsSync(staged) ? fs.readFileSync(staged, 'utf8').split('\n').filter(Boolean) : [];
  const isRejection = stagedLines.length === 1 && JSON.parse(stagedLines[0]).rejection === true;
  check('A3 invalid record marked as rejection in staged', isRejection);
  if (isRejection) {
    const promRes = runNode(PROMOTER, ['--observer-run-id', runId, '--canonical-path', 'data/observations_test.jsonl']);
    // Promoter should succeed with 0 records promoted (rejections filtered)
    check('A3 promoter filters observer-rejections cleanly', promRes.status === 0);
  }
}

// ── A4: LIVE cannot be established when provenance fails ──
{
  // Point observer at a NON-session-dir path
  const bogusDir = path.join(REPO_ROOT, 'data', 'telemetry_sessions', '.test_tmp', 'bogus');
  fs.mkdirSync(bogusDir, { recursive: true });
  fs.writeFileSync(path.join(bogusDir, 'price_replay.jsonl'), '{"ts":"2099-04-04T00:00:00.000Z","blockNumber":1,"sourceType":"activator_tick"}\n');
  const runId = 'OBS_test_A4_' + crypto.randomBytes(2).toString('hex');
  const res = runNode(OBSERVER, ['--source', 'data/telemetry_sessions/.test_tmp/bogus/price_replay.jsonl', '--observer-run-id', runId]);
  check('A4 observer refuses non-session-dir path (exit 2)', res.status === 2);
}

// ── A5: no scheduler introduced — observer exits cleanly after source idle ──
{
  // Reuse an A1-shape session; observer should stop within reasonable time (no daemon)
  const sess = 'session_20990505_0000';
  makeFakeSession(sess, [{ ts: '2099-05-05T00:00:00.000Z', blockNumber: 1, sourceType: 'activator_tick', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }]);
  const runId = 'OBS_test_A5_' + crypto.randomBytes(2).toString('hex');
  const start = Date.now();
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId]);
  const elapsed = Date.now() - start;
  check('A5 observer exits without daemon (< 20s)', res.status === 0 && elapsed < 20000, `elapsed=${elapsed}ms`);
}

// ── A6: no executionAuthorized change (grep the codebase after observer runs) ──
{
  // Just re-confirm invariant post-test-run
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
  // Static scan on observer for FORBIDDEN CODE PATTERNS (not doc mentions).
  // The observer's own "DOES NOT" comment legitimately says the word
  // "broadcast" in prose — that's fine. What we're looking for is actual
  // imports and invocations.
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const forbiddenPatterns = [
    /require\(['"]ethers['"]\)/,
    /require\(['"]@ethersproject/,
    /new JsonRpcProvider\(/,
    /\.sendTransaction\(/,
    /\.broadcastTransaction\(/,
    /require\(['"]discord\.js['"]\)/,
    /require\(['"]axios['"]\)/,
    /fetch\(['"]https?:/,
    /http\.request\(/,
    /https\.request\(/
  ];
  const found = forbiddenPatterns.filter(re => re.test(src)).map(re => re.source);
  check('A7 observer source has no RPC/broadcast/network code (patterns)', found.length === 0, found.length ? `found: ${found.join(', ')}` : '');
}

// ── A8: no capital policy change (observer + promoter + backfill do not touch config) ──
{
  const forbiddenPaths = [
    'config/borrowability_registry.json',
    'config/execution',
    '.env'
  ];
  const combined = fs.readFileSync(OBSERVER, 'utf8') + fs.readFileSync(PROMOTER, 'utf8') + fs.readFileSync(BACKFILL, 'utf8');
  const bad = forbiddenPaths.filter(p => combined.includes(p));
  check('A8 c1 scripts do not reference capital/config paths', bad.length === 0, bad.length ? `found: ${bad.join(', ')}` : '');
}

// ── A9: FIXTURE and LIVE remain distinguishable ──
{
  // Run fixture generator, verify record telemetrySource
  const outPath = path.join(REPO_ROOT, 'data', 'telemetry_sessions', '.test_tmp', 'fixture_out.jsonl');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const res = runNode(FIXTURE, ['--out', outPath]);
  const line1 = fs.readFileSync(outPath, 'utf8').split('\n')[0];
  const rec = JSON.parse(line1);
  check('A9 fixture generator emits telemetrySource=FIXTURE', rec.telemetrySource === 'FIXTURE');
}

// ── A10: canonical qualification pipeline files unchanged ──
{
  // Assert these files exist (proxy for "unchanged" since we don't have pre-SHA here)
  const pipeline = [
    'scripts/execution/preflight.py',
    'scripts/execution/preflight_policy.py',
    'scripts/execution/preflight_telemetry.py',
    'scripts/execution/route_simulator/route_composer.py',
    'scripts/execution/route_simulator/v2_simulator.py',
    'scripts/execution/route_simulator/types.py',
    'scripts/detection/opportunity_detector.py'
  ];
  const missing = pipeline.filter(p => !fs.existsSync(path.join(REPO_ROOT, p)));
  check('A10 canonical qualification pipeline files still present', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');
}

// ── A11: FIXTURE record MUST NOT set telemetrySource=LIVE anywhere ──
{
  const genSrc = fs.readFileSync(FIXTURE, 'utf8');
  const hasLiveInFixture = /telemetrySource\s*:\s*['"]LIVE['"]/.test(genSrc);
  check('A11 fixture generator source contains NO telemetrySource=LIVE', !hasLiveInFixture);
}

// ── A12: fixture default-args determinism ──
{
  const outPath = path.join(REPO_ROOT, 'data', 'telemetry_sessions', '.test_tmp', 'fixture_det.jsonl');
  runNode(FIXTURE, ['--out', outPath]);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(outPath)).digest('hex');
  check(`A12 fixture default-args SHA == ${FIXTURE_DEFAULT_SHA.slice(0,8)}...`, sha === FIXTURE_DEFAULT_SHA, `got=${sha.slice(0,8)}...`);
}

// ── A13: telemetrySource=LIVE cannot be set without producer proof ──
{
  // observer source must contain the provenance regex + refuse to emit LIVE on failure
  const src = fs.readFileSync(OBSERVER, 'utf8');
  const hasRegex = /LIVE_SOURCE_PATH_RE/.test(src);
  const failsClosed = /exit\(2\)/.test(src) && /Refusing to proceed/.test(src);
  check('A13 observer refuses LIVE when provenance fails (exit 2 + regex present)', hasRegex && failsClosed);
}

// ── A14: retrospective_backfill.js DISABLED by default ──
{
  const src = fs.readFileSync(BACKFILL, 'utf8');
  const disabled = /RETROSPECTIVE_BACKFILL_ENABLED\s*=\s*false/.test(src);
  const res = runNode(BACKFILL, []);
  check('A14 retrospective_backfill: hard-disabled constant present', disabled);
  check('A14 retrospective_backfill: exits 0 without doing work', res.status === 0);
}

// ── A15 (c1.1): bad sourceType is deterministically rejected ──
{
  const sess = 'session_20991515_0000';
  makeFakeSession(sess, [
    // Structurally valid but sourceType is WRONG — this could be a
    // generate_price_replay.js output masquerading as LIVE. Observer must
    // reject via the sourceType guard, NOT allow it through to canonical.
    { ts: '2099-12-15T00:00:00.000Z', blockNumber: 42, sourceType: 'synthetic_replay', venue: 'uniswap_v3', price: 3000, chain: 'arbitrum', pair: 'ETH/USDC' }
  ]);
  const runId = 'OBS_test_A15_' + crypto.randomBytes(2).toString('hex');
  const res = runNode(OBSERVER, ['--source', `logs/sessions/${sess}/price_replay.jsonl`, '--observer-run-id', runId]);
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
