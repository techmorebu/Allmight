'use strict';
/**
 * Wave 11 c1 — signal_observer.acceptance.test.js
 * Node built-ins only, mirroring observer.acceptance.test.js's check() harness.
 * Offline. No RPC, no attach to a live session, no canonical production write.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const O = require('../../scripts/telemetry/signal_observer.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  OK   ' + name); pass++; }
  else { console.log('  FAIL ' + name + (detail ? '\n         ' + detail : '')); fail++; }
}
console.log('signal_observer acceptance'); console.log('='.repeat(62));

const ctx = { sourceRelPath: 'logs/sessions/session_20260902_0255/activator.jsonl',
              sourceShaAtOpen: 'a'.repeat(64), observerRunId: 'OBS_TEST_0000' };
// Fixture mirrors the REAL emitSignal shape (arb_window_activator.js:729-742)
// plus type/chain/pair/readMode. A thin fixture would let deep-equality pass
// while proving little about fidelity, so it is kept faithful to production.
const sig = (x) => ({
  type:'signal', signal:'EXECUTION_READY', chain:'arbitrum', pair:'ETH/USDC-RAMSES',
  ts:'2026-09-02T08:31:49.843Z', block:500920529,
  uniPrice:2410.200074, camPrice:2415.615993, uniDepth:1775429.13,
  regime:'ACTIVE', spread:0.22468, bestSize:200, bestDelay:0,
  finalEdge:0.0885, economicStatus:'economically_viable', gasUnits:1150000,
  readMode:'MEASURED', ...x });

// ── S1 provenance ──────────────────────────────────────────────────────────
check('S1 accepts activator.jsonl under a compact session dir',
  O.validateSourceProvenance(ctx.sourceRelPath).ok);
check('S1 REJECTS price_replay.jsonl (the sibling stream)',
  !O.validateSourceProvenance('logs/sessions/session_20260902_0255/price_replay.jsonl').ok);
check('S1 REJECTS a seconds-resolution SID (compact contract preserved)',
  !O.validateSourceProvenance('logs/sessions/session_20260902_025500/activator.jsonl').ok);

// ── S2 Q4: all three outcomes, keyed on TYPE ───────────────────────────────
for (const s of ['EXECUTION_READY','SIMULATION_MARGINAL','SIMULATION_LOST']) {
  const r = O.classifyLine(JSON.stringify(sig({ signal:s })), ctx);
  check(`S2 ${s} is STAGED (content-neutral)`, r.action === 'stage', JSON.stringify(r).slice(0,140));
}
check('S2-CONTROL a non-signal record is NOT staged — the filter is real',
  O.classifyLine(JSON.stringify({ type:'heartbeat', chain:'arbitrum' }), ctx).action === 'skip');

// ── S3 sameBlockVerified: positives, counterexamples, discrimination ───────
check('S3+ bestDelay 0 · MEASURED · numeric block → true',
  O.deriveSameBlockVerified(sig({})) === true);
check('S3+ bestDelay null (SIMULATION_LOST) still → true — no Q4 bias',
  O.deriveSameBlockVerified(sig({ bestDelay:null, signal:'SIMULATION_LOST' })) === true);
const counter = [
  ['bestDelay 1',        sig({ bestDelay:1 })],
  ['bestDelay 2',        sig({ bestDelay:2 })],
  ['readMode UNKNOWN',   sig({ readMode:'UNKNOWN' })],
  ['readMode SYNTHETIC', sig({ readMode:'SYNTHETIC' })],
  ['readMode absent',    (()=>{ const r=sig({}); delete r.readMode; return r; })()],
  ['block non-numeric',  sig({ block:'500920529' })],
  ['block absent',       (()=>{ const r=sig({}); delete r.block; return r; })()],
];
for (const [n, rec] of counter)
  check(`S3- ${n} → false`, O.deriveSameBlockVerified(rec) === false);
check('S3 DISCRIMINATION positive and counterexample DIFFER — "all false" cannot pass',
  O.deriveSameBlockVerified(sig({})) !== O.deriveSameBlockVerified(sig({ bestDelay:1 })));

// ── S4 identity: chain/pair copied, never defaulted ────────────────────────
const noChain = (()=>{ const r=sig({}); delete r.chain; return r; })();
check('S4 missing chain → REJECTED, never defaulted',
  O.classifyLine(JSON.stringify(noChain), ctx).action === 'reject');
const noPair = (()=>{ const r=sig({}); delete r.pair; return r; })();
check('S4 missing pair → REJECTED, never defaulted to ETH/USDC-RAMSES',
  O.classifyLine(JSON.stringify(noPair), ctx).action === 'reject');
check('S4 chain is COPIED from the record, not hardcoded',
  O.wrapRecord(sig({ chain:'base' }), ctx).chain === 'base');

// ── S5 envelope placement (Boss C9 ruling) ─────────────────────────────────
const w = O.wrapRecord(sig({}), ctx);
check('S5 sameBlockVerified is in the ENVELOPE', 'sameBlockVerified' in w);
check('S5 readMode is NOT in the envelope', !('readMode' in w));
check('S5 readMode IS inside recordFromSource', w.recordFromSource.readMode === 'MEASURED');
check('S5 sourceSchemaVersion distinguishes the streams',
  w.sourceSchemaVersion === 'activator_signal_v1');
check('S5 telemetrySource is LIVE (promoter allowlist)', w.telemetrySource === 'LIVE');

// ── S6 promoter compatibility — asserted against the REAL required set ─────
const promoterSrc = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'scripts', 'telemetry', 'session_promoter.js'), 'utf8');
const m = promoterSrc.match(/REQUIRED_WRAPPER_FIELDS\s*=\s*\[([\s\S]*?)\]/);
check('S6 required-field list extracted from the REAL promoter', !!m);
if (m) {
  const required = m[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
  check(`S6 envelope satisfies all ${required.length} REQUIRED_WRAPPER_FIELDS`,
    required.every(f => f in w), required.filter(f => !(f in w)).join(', '));
  check('S6-CONTROL the extracted list is non-empty and contains a known field',
    required.length >= 8 && required.includes('recordFromSource'));
}

// ── S7 rejection shape matches the sibling observer ────────────────────────
const rej = O.buildRejection(ctx, '{bad', 'unparseable_json');
check('S7 rejection carries telemetrySource UNKNOWN', rej.telemetrySource === 'UNKNOWN');
check('S7 rejection flagged so the promoter filters it', rej.rejection === true);
check('S7 rawLine truncated to 500', O.buildRejection(ctx,'x'.repeat(900),'r').rawLine.length === 500);

// ── S8 no capital / network surface (mirrors A7, A8) ───────────────────────
const obsSrc = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'scripts', 'telemetry', 'signal_observer.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
for (const p of [/ethers/, /JsonRpcProvider/, /fetch\(/, /capital_policy/, /Wallet/, /sendTransaction/])
  check(`S8 no ${p.source} in observer code`, !p.test(obsSrc));

// ══ S9 END-TO-END: real observer subprocess → real promoter subprocess ══════
// Offline. A fixture session tree under .test_tmp; the REAL logs/ is untouched.
const { spawnSync, spawn } = require('child_process');
const os = require('os');
const REPO = path.resolve(__dirname, '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 's15n-'));
const SID = '20260902_0255';
const sess = path.join(TMP, 'logs', 'sessions', `session_${SID}`);
fs.mkdirSync(sess, { recursive: true });
fs.mkdirSync(path.join(TMP, 'logs', 'archive'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'logs', 'allmight.session'), SID);
const src = path.join(sess, 'activator.jsonl');
fs.writeFileSync(src, [
  JSON.stringify(sig({ signal: 'EXECUTION_READY' })),
  JSON.stringify(sig({ signal: 'SIMULATION_MARGINAL', bestDelay: 0 })),
  JSON.stringify(sig({ signal: 'SIMULATION_LOST', bestDelay: null })),
  JSON.stringify({ type: 'heartbeat', chain: 'arbitrum' }),
  '{unparseable',
].join('\n') + '\n');
// The terminal must NOT exist at attach (provenance v4 rejects it), so it has
// to appear DURING the run. An earlier harness used setTimeout — but spawnSync
// BLOCKS this process, so the timer could never fire and the observer waited
// forever on an event the test could not produce. The trigger must therefore
// live in an INDEPENDENT process.
const RUNID = 'OBS_TEST_E2E_0001';
fs.rmSync(path.join(REPO, 'data', 'telemetry_sessions', RUNID), { recursive: true, force: true });
const trigger = spawn('node', ['-e',
  `setTimeout(()=>{require('fs').writeFileSync(${JSON.stringify(path.join(TMP,'logs','archive',`session_${SID}.zip`))},'x')},1500)`
], { detached: true, stdio: 'ignore' });
trigger.unref();
const obsRes = spawnSync('node', [
  path.join(REPO, 'scripts', 'telemetry', 'signal_observer.js'),
  '--source', `logs/sessions/session_${SID}/activator.jsonl`,
  '--observer-run-id', RUNID, '--repo-root', TMP, '--staging-root', REPO,
], { encoding: 'utf8', timeout: 20000 });
check('S9-TRIGGER the terminal was created by an INDEPENDENT process',
  fs.existsSync(path.join(TMP,'logs','archive',`session_${SID}.zip`)),
  'the trigger must fire while spawnSync blocks this process');
check('S9 observer subprocess exits 0 (clean detach)', obsRes.status === 0,
  `status=${obsRes.status} err=${(obsRes.stderr||'').slice(-300)}`);
check('S9 observer reports a lifecycle terminal', /detached: CLEAN_LOGICAL_END/.test(obsRes.stderr||''),
  (obsRes.stderr||'').slice(-200));
const obsDir = path.join(REPO, 'data', 'telemetry_sessions', RUNID);
const stagedFile = path.join(obsDir, 'observations_staged.jsonl');
check('S9 manifest.json written', fs.existsSync(path.join(obsDir, 'manifest.json')));
const mf = fs.existsSync(path.join(obsDir,'manifest.json'))
  ? JSON.parse(fs.readFileSync(path.join(obsDir,'manifest.json'),'utf8')) : {};
check('S9 manifest carries stoppedAtIso — the promoter completeness requirement',
  typeof mf.stoppedAtIso === 'string' && mf.stoppedAtIso.length > 0);
check('S9 manifest records the terminal signal', mf.terminalSignal === 'CLEAN_LOGICAL_END', mf.terminalSignal);
check('S9 observations_staged.jsonl written', fs.existsSync(stagedFile));
let stagedRows = [];
if (fs.existsSync(stagedFile))
  stagedRows = fs.readFileSync(stagedFile,'utf8').split('\n').filter(Boolean).map(JSON.parse);
check('S9 exactly 3 signal rows staged (all outcomes)',
  stagedRows.filter(r => !r.rejection).length === 3,
  `got ${stagedRows.filter(r => !r.rejection).length}`);
check('S9 the unparseable line became a rejection row',
  stagedRows.some(r => r.rejection === true));
check('S9-CONTROL the heartbeat was SKIPPED, not staged or rejected',
  stagedRows.length === 4, `expected 3 staged + 1 rejection = 4, got ${stagedRows.length}`);
// ── the REAL promoter, isolated canonical path (S15R6M seam) ───────────────
const CANON = 'data/signal_observations_test.jsonl';
fs.rmSync(path.join(TMP, CANON), { force: true });
fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
// Run the REAL promoter with cwd = the fixture root, so its REPO_ROOT
// resolves to the fixture and nothing in the real repo is read or written.
const promRes = spawnSync('node', [
  path.join(REPO, 'scripts', 'telemetry', 'session_promoter.js'),
  '--observer-run-id', RUNID, '--canonical-path', CANON,
], { cwd: REPO, encoding: 'utf8', timeout: 20000 });
check('S9 REAL promoter subprocess accepts the envelope (exit 0)', promRes.status === 0,
  `status=${promRes.status} out=${(promRes.stdout||'').slice(-300)} err=${(promRes.stderr||'').slice(-300)}`);
const canonAbs = path.join(REPO, CANON);
let canonRows = [];
if (fs.existsSync(canonAbs))
  canonRows = fs.readFileSync(canonAbs,'utf8').split('\n').filter(Boolean).map(JSON.parse);
check('S9 canonical received exactly 3 records (rejections filtered)',
  canonRows.length === 3, `got ${canonRows.length}`);
check('S9 all three OUTCOMES survived promotion — Q4 end-to-end',
  ['EXECUTION_READY','SIMULATION_MARGINAL','SIMULATION_LOST']
    .every(s => canonRows.some(r => r.recordFromSource && r.recordFromSource.signal === s)));
check('S9 sameBlockVerified survives promotion',
  canonRows.every(r => r.sameBlockVerified === true));

// ── S10 DEEP FIDELITY — the promoter must be fully content-neutral ──────────
// Prior assertions checked representative fields only. That proves semantics
// survive, not that records are UNCHANGED. Compare every staged non-rejection
// row to its promoted counterpart, whole-object, by signalId-free identity.
const stagedValid = stagedRows.filter(r => !r.rejection);
const keyOf = (r) => JSON.stringify([
  r.recordFromSource && r.recordFromSource.signal,
  r.recordFromSource && r.recordFromSource.block,
  r.recordFromSource && r.recordFromSource.bestDelay,
]);
const canonByKey = new Map(canonRows.map(r => [keyOf(r), r]));
let deepOk = true, deepDetail = '';
for (const st of stagedValid) {
  const got = canonByKey.get(keyOf(st));
  if (!got) { deepOk = false; deepDetail = `no promoted counterpart for ${keyOf(st)}`; break; }
  try { assert.deepStrictEqual(got.recordFromSource, st.recordFromSource); }
  catch (e) { deepOk = false; deepDetail = `recordFromSource differs: ${e.message.slice(0,200)}`; break; }
  try { assert.deepStrictEqual(got, st); }
  catch (e) { deepOk = false; deepDetail = `envelope differs: ${e.message.slice(0,200)}`; break; }
}
check('S10 every promoted row is DEEP-EQUAL to its staged row (envelope + payload)',
  deepOk && stagedValid.length === 3, deepDetail || `stagedValid=${stagedValid.length}`);

// The comparison must be able to DETECT a difference, or deep-equality proves
// nothing. Mutate a copy and assert the same comparator rejects it.
let detects = false;
if (stagedValid.length > 0) {
  const tampered = JSON.parse(JSON.stringify(stagedValid[0]));
  tampered.recordFromSource.uniPrice = -999.999;
  try { assert.deepStrictEqual(tampered.recordFromSource, stagedValid[0].recordFromSource); }
  catch { detects = true; }
}
check('S10-CONTROL the comparator DETECTS a one-field mutation — not vacuous', detects);

// And the payload must be non-trivial: an empty recordFromSource would satisfy
// deep-equality while proving nothing about fidelity.
check('S10-CONTROL payloads are non-trivial (>= 15 keys, real emitSignal shape)',
  stagedValid.length === 3 && stagedValid.every(r =>
    r.recordFromSource && Object.keys(r.recordFromSource).length >= 15),
  stagedValid.map(r => Object.keys(r.recordFromSource || {}).length).join(','));
// cleanup — leave no residue in the repo
fs.rmSync(path.join(REPO,'data','telemetry_sessions',RUNID), { recursive: true, force: true });
fs.rmSync(canonAbs, { force: true });
check('S9 NO RESIDUE — staging dir and test canonical both removed',
  !fs.existsSync(path.join(REPO,'data','telemetry_sessions',RUNID)) && !fs.existsSync(canonAbs));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log(''); console.log(`passed ${pass}  failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
