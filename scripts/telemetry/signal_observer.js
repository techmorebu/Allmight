#!/usr/bin/env node
/**
 * Wave 11 c1 — signal_observer.js
 *
 * Sibling of live_observer.js. Tails the activator's LIVE activator.jsonl
 * SIGNAL stream, wraps records in the ratified c1.2 provenance envelope, and
 * stages to JSONL for session_promoter.js.
 *
 * Q1 (refined, Boss C9 2026-09-02): the activator signal stream is the
 * observation source authority; the shadow engine is classifier/control.
 * Q2 (refined): manually attached, source-event cadence, NO scheduler.
 * Q4: CONTENT-NEUTRAL. Filters on record.type === 'signal' and admits ALL
 *     THREE outcomes — EXECUTION_READY, SIMULATION_MARGINAL, SIMULATION_LOST.
 *     Filtering on outcome would discard valid unfavorable observations.
 *
 * Differences from live_observer.js, and ONLY these:
 *   1. source regex targets activator.jsonl, not price_replay.jsonl
 *   2. record filter: type === 'signal' (never keyed on outcome)
 *   3. sourceSchemaVersion: 'activator_signal_v1'
 *
 * Deviation flagged: live_observer.js hardcodes chain:'arbitrum'. The activator
 * SIGNAL record carries `chain`, so this observer COPIES it and REJECTS when
 * absent (Boss C9: never default a surface identity).
 *
 * Envelope placement (Boss C9 ruling):
 *   readMode          stays INSIDE recordFromSource — producer provenance
 *   sameBlockVerified in the ENVELOPE — an observer-derived assertion
 *
 * Exit codes:  0 = clean detach   1 = runtime error   2 = provenance failure
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OBSERVER_SCHEMA_VERSION = 'signal_observer_v1';
const POLL_INTERVAL_MS = 500;

// ── provenance regexes — mirror live_observer.js:74-80 exactly, swapping the
// source filename. session_YYYYMMDD_HHMM  NOT ISO  NOT with seconds.
const LIVE_SOURCE_PATH_RE =
  /^logs\/sessions\/session_(\d{8})_(\d{4})\/activator\.jsonl$/;
const SESSION_DIR_RE  = /^session_(\d{8})_(\d{4})$/;
const COMPACT_SID_RE  = /^(\d{8})_(\d{4})$/;

// ── sameBlockVerified ───────────────────────────────────────────────────────
// Conjunctive and fail-closed. Justification per conjunct:
//   bestDelay 0|null  the activator filters `best` to delayBlocks===0
//                     (arb_window_activator.js:726). null is ADMITTED because a
//                     SIMULATION_LOST record has no `best`; excluding it would
//                     reintroduce a Q4 bias against negatives.
//   readMode MEASURED true requires DIRECT measured provenance. UNKNOWN
//                     (pre-repair rows) and SYNTHETIC must never yield true.
//   numeric block     a malformed identity cannot support a block claim.
function deriveSameBlockVerified(record) {
  if (!record || typeof record !== 'object') return false;
  const bd = record.bestDelay;
  if (!(bd === 0 || bd === null)) return false;
  if (record.readMode !== 'MEASURED') return false;
  if (typeof record.block !== 'number') return false;
  return true;
}

// Q4: keys on TYPE, never on outcome.
function isSignalRecord(record) {
  return !!record && typeof record === 'object' && record.type === 'signal';
}

function validateSourceProvenance(sourceRelPath) {
  const reasons = [];
  if (!LIVE_SOURCE_PATH_RE.test(sourceRelPath)) {
    reasons.push('source path must be logs/sessions/session_<compact>/activator.jsonl');
    return { ok: false, reasons, sid: null };
  }
  const m = sourceRelPath.match(LIVE_SOURCE_PATH_RE);
  const sid = `${m[1]}_${m[2]}`;
  if (!COMPACT_SID_RE.test(sid)) { reasons.push('sid failed compact format'); }
  const parentBase = path.basename(path.dirname(sourceRelPath));
  if (!SESSION_DIR_RE.test(parentBase)) { reasons.push('parent dir failed session_<compact>'); }
  return { ok: reasons.length === 0, reasons, sid };
}

function wrapRecord(record, ctx) {
  return {
    telemetrySource:      'LIVE',
    sourceProcess:        'arb_window_activator',
    sourceSchemaVersion:  'activator_signal_v1',
    chain:                record.chain,          // COPIED — never defaulted
    sourcePath:           ctx.sourceRelPath,
    sourceSha256AtOpen:   ctx.sourceShaAtOpen,
    observerRunId:        ctx.observerRunId,
    observerSchemaVersion: OBSERVER_SCHEMA_VERSION,
    readAtUnixTime:       Math.floor(Date.now() / 1000),
    sameBlockVerified:    deriveSameBlockVerified(record),
    recordFromSource:     record,                // readMode stays in here
  };
}

function buildRejection(ctx, line, reason) {
  return {
    telemetrySource: 'UNKNOWN',
    rejection: true,
    rejection_reason: reason,
    observerRunId: ctx.observerRunId,
    sourcePath: ctx.sourceRelPath,
    sourceSha256AtOpen: ctx.sourceShaAtOpen,
    rawLine: String(line).slice(0, 500),
  };
}

// Returns { action, payload } — the pure decision for one source line.
function classifyLine(line, ctx) {
  let rec;
  try { rec = JSON.parse(line); }
  catch { return { action: 'reject', payload: buildRejection(ctx, line, 'unparseable_json') }; }
  if (!isSignalRecord(rec)) return { action: 'skip' };
  if (rec.chain === undefined || rec.chain === null || rec.chain === '') {
    return { action: 'reject', payload: buildRejection(ctx, line, 'missing_chain') };
  }
  if (rec.pair === undefined || rec.pair === null || rec.pair === '') {
    return { action: 'reject', payload: buildRejection(ctx, line, 'missing_pair') };
  }
  return { action: 'stage', payload: wrapRecord(rec, ctx) };
}

function newObserverRunId() {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `OBS_${now}_${crypto.randomBytes(2).toString('hex')}`;
}

// ── lifecycle terminals — adapted from live_observer.js:11-17 ───────────────
//   archive/<SID>.zip exists         → CLEAN_LOGICAL_END
//   aborted/session_<SID>/ exists    → SESSION_ABORTED
//   allmight.session missing         → SESSION_IDENTITY_LOST
//   allmight.session != attachedSID  → SESSION_SUPERSEDED
//   BOTH archive and aborted exist   → LIFECYCLE_CONFLICT (fail-closed, precedence)
function evaluateLifecycleState(attachedSid, sessionFileRel, archiveDirRel, abortedDirRel, repoRoot) {
  const archiveAbs = path.resolve(repoRoot, archiveDirRel, `session_${attachedSid}.zip`);
  const abortedAbs = path.resolve(repoRoot, abortedDirRel, `session_${attachedSid}`);
  const hasArchive = fs.existsSync(archiveAbs);
  const hasAborted = fs.existsSync(abortedAbs);
  if (hasArchive && hasAborted)
    return { terminal: true, signal: 'LIFECYCLE_CONFLICT',
             detail: 'archive and aborted both exist for the attached SID' };
  if (hasArchive) return { terminal: true, signal: 'CLEAN_LOGICAL_END', detail: archiveAbs };
  if (hasAborted) return { terminal: true, signal: 'SESSION_ABORTED', detail: abortedAbs };
  const ptrAbs = path.resolve(repoRoot, sessionFileRel);
  if (!fs.existsSync(ptrAbs))
    return { terminal: true, signal: 'SESSION_IDENTITY_LOST', detail: ptrAbs };
  let ptr = '';
  try { ptr = fs.readFileSync(ptrAbs, 'utf8').trim(); } catch { ptr = ''; }
  if (ptr !== attachedSid)
    return { terminal: true, signal: 'SESSION_SUPERSEDED', detail: `pointer=${ptr} attached=${attachedSid}` };
  return { terminal: false, signal: null, detail: null };
}

// ── attach-time provenance (mirrors live_observer v1-v5) ───────────────────
function validateAttach(sourceRelPath, sessionFileRel, archiveDirRel, abortedDirRel, repoRoot) {
  const prov = validateSourceProvenance(sourceRelPath);
  if (!prov.ok) return { ok: false, reasons: prov.reasons, sourceSid: prov.sid };
  const sid = prov.sid;
  const reasons = [];
  const ptrAbs = path.resolve(repoRoot, sessionFileRel);
  if (!fs.existsSync(ptrAbs)) reasons.push('session pointer missing at attach');
  else {
    const ptr = fs.readFileSync(ptrAbs, 'utf8').trim();
    if (ptr !== sid) reasons.push(`session pointer ${ptr} != source sid ${sid}`);
  }
  if (fs.existsSync(path.resolve(repoRoot, archiveDirRel, `session_${sid}.zip`)))
    reasons.push('archive already exists for SID at attach');
  if (fs.existsSync(path.resolve(repoRoot, abortedDirRel, `session_${sid}`)))
    reasons.push('aborted session already exists for SID at attach');
  return { ok: reasons.length === 0, reasons, sourceSid: sid };
}

// ── byte-offset tail with lifecycle polling (no idle timeout) ───────────────
async function tailWithLifecycle(filePath, attachedSid, args, repoRoot, onLine, onTerminal) {
  let position = 0, buffer = '';
  for (;;) {
    let stat;
    try { stat = fs.statSync(filePath); }
    catch {
      const life = evaluateLifecycleState(attachedSid, args.sessionFile, args.archiveDir, args.abortedDir, repoRoot);
      if (life.terminal) { onTerminal(life.signal, life.detail); return; }
      console.error(`✗ source disappeared without a lifecycle terminal: ${filePath}`);
      process.exit(3);
    }
    if (stat.size < position) position = 0;      // truncation
    if (stat.size > position) {
      const fd = fs.openSync(filePath, 'r');
      const len = stat.size - position;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, position);
      fs.closeSync(fd);
      position = stat.size;
      buffer += buf.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) onLine(line);
    }
    const life = evaluateLifecycleState(attachedSid, args.sessionFile, args.archiveDir, args.abortedDir, repoRoot);
    if (life.terminal) { onTerminal(life.signal, life.detail); return; }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

function parseArgs(argv) {
  const args = { source: null, observerRunId: null, sessionFile: null,
                 archiveDir: null, abortedDir: null, repoRoot: REPO_ROOT, stagingRoot: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && i + 1 < argv.length) args.source = argv[++i];
    else if (a === '--observer-run-id' && i + 1 < argv.length) args.observerRunId = argv[++i];
    else if (a === '--session-file' && i + 1 < argv.length) args.sessionFile = argv[++i];
    else if (a === '--archive-dir' && i + 1 < argv.length) args.archiveDir = argv[++i];
    else if (a === '--aborted-dir' && i + 1 < argv.length) args.abortedDir = argv[++i];
    else if (a === '--repo-root' && i + 1 < argv.length) args.repoRoot = path.resolve(argv[++i]);
    // --staging-root: where data/telemetry_sessions/<runId>/ is written. Defaults
    // to repoRoot. Exists so an offline test can point staging at the tree whose
    // session_promoter.js will read it (the promoter resolves REPO_ROOT from
    // __dirname), while session fixtures live in a throwaway --repo-root.
    else if (a === '--staging-root' && i + 1 < argv.length) args.stagingRoot = path.resolve(argv[++i]);
  }
  if (!args.observerRunId) args.observerRunId = newObserverRunId();
  if (!args.sessionFile) args.sessionFile = path.join('logs', 'allmight.session');
  if (!args.archiveDir)  args.archiveDir  = path.join('logs', 'archive');
  if (!args.abortedDir)  args.abortedDir  = path.join('logs', 'aborted');
  if (!args.stagingRoot) args.stagingRoot = args.repoRoot;
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const repoRoot = args.repoRoot;
  if (!args.source) { console.error('--source required'); process.exit(1); }

  const attach = validateAttach(args.source, args.sessionFile, args.archiveDir, args.abortedDir, repoRoot);
  if (!attach.ok) {
    console.error('✗ provenance validation failed:\n  - ' + attach.reasons.join('\n  - '));
    process.exit(2);                                   // fail-closed
  }
  const sid = attach.sourceSid;
  const sourceAbs = path.resolve(repoRoot, args.source);

  // observer namespace guard — fail closed, never merge (mirrors live_observer:347)
  const observerDir = path.resolve(args.stagingRoot, 'data', 'telemetry_sessions', args.observerRunId);
  if (fs.existsSync(observerDir)) {
    console.error(`✗ observer-run-id already exists: ${observerDir}`);
    process.exit(1);
  }
  fs.mkdirSync(observerDir, { recursive: true });

  const sourceShaAtOpen = crypto.createHash('sha256')
    .update(fs.readFileSync(sourceAbs)).digest('hex');
  const stagedPath = path.join(observerDir, 'observations_staged.jsonl');
  const stagedStream = fs.createWriteStream(stagedPath, { flags: 'a' });

  const manifest = {
    observerRunId: args.observerRunId,
    observerSchemaVersion: OBSERVER_SCHEMA_VERSION,
    telemetrySource: 'LIVE',
    sourceProcess: 'arb_window_activator',
    sourceSchemaVersion: 'activator_signal_v1',
    sourcePath: args.source,
    sourceSha256AtOpen: sourceShaAtOpen,
    attachedSessionId: sid,
    attachedAtUnixTime: Math.floor(Date.now() / 1000),
  };
  fs.writeFileSync(path.join(observerDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.error(`✓ manifest written: ${path.join(observerDir, 'manifest.json')}`);

  const ctx = { sourceRelPath: args.source, sourceShaAtOpen, observerRunId: args.observerRunId };
  let staged = 0, rejected = 0, skipped = 0;

  await tailWithLifecycle(sourceAbs, sid, args, repoRoot,
    (line) => {
      const r = classifyLine(line, ctx);
      if (r.action === 'stage')      { stagedStream.write(JSON.stringify(r.payload) + '\n'); staged++; }
      else if (r.action === 'reject'){ stagedStream.write(JSON.stringify(r.payload) + '\n'); rejected++; }
      else skipped++;
    },
    (signal, detail) => {
      // session_promoter.js REFUSES to promote a manifest lacking stoppedAtIso
      // ("session incomplete ... Observer never recorded clean stop"). The
      // manifest must therefore be REWRITTEN on detach, not only appended to a
      // sidecar. Found by running the real promoter, not by reading source.
      const closed = { ...manifest,
        terminalSignal: signal, terminalDetail: detail,
        staged, rejected, skipped,
        stoppedAtIso: new Date().toISOString(),
        detachedAtUnixTime: Math.floor(Date.now() / 1000) };
      fs.writeFileSync(path.join(observerDir, 'manifest.json'), JSON.stringify(closed, null, 2));
      fs.writeFileSync(path.join(observerDir, 'lifecycle.json'), JSON.stringify(closed, null, 2));
      console.error(`✓ detached: ${signal} (staged=${staged} rejected=${rejected} skipped=${skipped})`);
    });
  stagedStream.end();
}

module.exports = {
  LIVE_SOURCE_PATH_RE, SESSION_DIR_RE, COMPACT_SID_RE,
  OBSERVER_SCHEMA_VERSION, POLL_INTERVAL_MS,
  deriveSameBlockVerified, isSignalRecord, validateSourceProvenance,
  wrapRecord, buildRejection, classifyLine, newObserverRunId,
  evaluateLifecycleState, validateAttach, tailWithLifecycle, parseArgs, main,
};

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
