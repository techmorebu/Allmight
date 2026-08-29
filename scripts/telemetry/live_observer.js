#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1.2 — live_observer.js
 *
 * c1 baseline: tails activator's LIVE price_replay.jsonl, wraps records in
 * a provenance envelope, stages to JSONL. Content-neutral: unfavorable
 * outcomes still pass.
 *
 * c1.2 additions (Boss C9 ruling 2026-08-28):
 *   - Attach-time validation strengthens provenance (5 required checks)
 *   - Terminal-precedence lifecycle poll REPLACES the 10s idle timeout
 *   - Four terminal signals (unambiguous filesystem observables):
 *       archive/<SID>.zip exists         → CLEAN_LOGICAL_END
 *       aborted/session_<SID>/ exists    → SESSION_ABORTED
 *       allmight.session missing         → SESSION_IDENTITY_LOST
 *       allmight.session != attachedSID  → SESSION_SUPERSEDED
 *   - Additional integrity guard:
 *       archive AND aborted both exist   → LIFECYCLE_CONFLICT (fail-closed)
 *   - Poll interval: lifecycle check every 10s (INSPECTION cadence,
 *     NOT termination proof)
 *   - Source idle, PID absence, supervisor cooldown are NON-terminal
 *
 * DOES NOT:
 *   - Modify the source file
 *   - Modify any activator behavior
 *   - Modify start_all.sh, remote_ctl.sh, or the supervisor
 *   - Introduce a scheduler/daemon
 *   - Send anything to Discord / RPC / broadcast
 *   - Change the observation envelope schema
 *
 * Boss C9 provenance contract (LIVE_TAIL for c1):
 *   telemetrySource="LIVE" is emitted ONLY when ALL of:
 *     (a) source path matches ^logs/sessions/session_<compact>/price_replay.jsonl$
 *     (b) parent dir exists AND matches session_YYYYMMDD_HHMM format
 *     (c) activator.jsonl sibling exists (activator write-lock evidence)
 *     (d) record decodes as JSON with expected activator field shape
 *   Otherwise: telemetrySource="UNKNOWN" + rejection_reason, and record
 *   is NOT staged. Fail-closed.
 *
 * c1.2 attach-time validation (Boss C9 required, additive):
 *     (v1) logs/allmight.session file readable
 *     (v2) content is a valid compact SID (YYYYMMDD_HHMM)
 *     (v3) attached SID == SID encoded in source path
 *     (v4) logs/archive/session_<SID>.zip absent
 *     (v5) logs/aborted/session_<SID>/ absent
 *   Any of v1-v5 failing → refuse attachment (exit 5)
 *
 * Usage:
 *   node scripts/telemetry/live_observer.js \
 *        --source logs/sessions/session_20260828_0443/price_replay.jsonl \
 *        [--observer-run-id <id>] \
 *        [--session-file logs/allmight.session]   (default; testable override)
 *
 * Exit codes:
 *   0 = observer stopped cleanly (SIGINT/SIGTERM or a terminal lifecycle signal)
 *   1 = invalid arguments
 *   2 = source path failed provenance validation (fail-closed)
 *   3 = source file inaccessible or session dir malformed
 *   4 = staged output path collision (observer-run-id already exists)
 *   5 = attach-time validation failed (c1.2 fail-closed)
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OBSERVER_SCHEMA_VERSION = '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Boss C9 provenance regex (LIVE_TAIL only for c1) ────────────────────────
// c1.1 patch (Boss C9 2026-08-28): compact activator format
//   session_YYYYMMDD_HHMM   NOT ISO   NOT with seconds
const LIVE_SOURCE_PATH_RE =
  /^logs\/sessions\/session_(\d{8})_(\d{4})\/price_replay\.jsonl$/;
const SESSION_DIR_RE =
  /^session_(\d{8})_(\d{4})$/;

// c1.2: compact SID validator
const COMPACT_SID_RE = /^(\d{8})_(\d{4})$/;

// ── minimum required activator-record shape ─────────────────────────────────
const REQUIRED_ACTIVATOR_FIELDS = ['blockNumber', 'ts', 'sourceType'];
const RECOMMENDED_ACTIVATOR_FIELDS = ['venue', 'price', 'chain', 'pair'];
const EXPECTED_ACTIVATOR_SOURCE_TYPE = 'activator_tick';

// ── c1.2 lifecycle constants (Boss C9 ruling 2026-08-28) ─────────────────────
// Poll intervals — INSPECTION cadence, NOT termination proof
const POLL_INTERVAL_MS = 500;                // source tail cadence (unchanged)
const LIFECYCLE_CHECK_EVERY_TICKS = 20;      // 20 * 500ms = 10s lifecycle check
// (Boss C9: "10 seconds = how often lifecycle state is inspected,
//  NOT 10 seconds = evidence that the session ended")

// ── argument parsing (minimal, no dependencies) ─────────────────────────────
function parseArgs(argv) {
  const args = {
    source: null,
    observerRunId: null,
    // c1.2: testable override for lifecycle file paths (default = logs/allmight.session)
    sessionFile: null,        // default resolved below
    archiveDir: null,         // default logs/archive
    abortedDir: null          // default logs/aborted
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && i + 1 < argv.length) { args.source = argv[++i]; }
    else if (a === '--observer-run-id' && i + 1 < argv.length) { args.observerRunId = argv[++i]; }
    else if (a === '--session-file' && i + 1 < argv.length) { args.sessionFile = argv[++i]; }
    else if (a === '--archive-dir' && i + 1 < argv.length) { args.archiveDir = argv[++i]; }
    else if (a === '--aborted-dir' && i + 1 < argv.length) { args.abortedDir = argv[++i]; }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('unknown arg:', a); process.exit(1); }
  }
  if (!args.source) { console.error('--source required'); process.exit(1); }
  if (!args.observerRunId) {
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const rand = crypto.randomBytes(2).toString('hex');
    args.observerRunId = `OBS_${now}_${rand}`;
  }
  // Resolve default lifecycle paths (relative to repo root)
  if (!args.sessionFile) args.sessionFile = path.join('logs', 'allmight.session');
  if (!args.archiveDir)  args.archiveDir  = path.join('logs', 'archive');
  if (!args.abortedDir)  args.abortedDir  = path.join('logs', 'aborted');
  return args;
}

function printHelp() {
  console.log(`Wave 11 c1.2 — live_observer.js
Usage:
  node scripts/telemetry/live_observer.js --source <path> [--observer-run-id <id>]
                                          [--session-file <path>]
                                          [--archive-dir <path>]
                                          [--aborted-dir <path>]
Provenance:
  --source MUST match logs/sessions/session_<compact>/price_replay.jsonl
  Otherwise LIVE cannot be established and observer refuses to proceed.
Lifecycle:
  --session-file default: logs/allmight.session   (Boss C9 authoritative pointer)
  --archive-dir  default: logs/archive            (CLEAN_LOGICAL_END artifact loc)
  --aborted-dir  default: logs/aborted            (SESSION_ABORTED artifact loc)
`);
}

// ── SHA of file contents at read time ──────────────────────────────────────
function sha256OfFile(fullPath) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(fullPath);
  h.update(buf);
  return h.digest('hex');
}

// ── extract compact SID from source path ────────────────────────────────────
function extractSidFromSourcePath(sourceRelPath) {
  const m = sourceRelPath.match(LIVE_SOURCE_PATH_RE);
  if (!m) return null;
  return `${m[1]}_${m[2]}`;   // e.g. "20260828_0443"
}

// ── provenance validation (LIVE_TAIL — 4 conditions from c1) ────────────────
function validateLiveProvenance(sourceRelPath, repoRoot) {
  const reasons = [];

  if (!LIVE_SOURCE_PATH_RE.test(sourceRelPath)) {
    reasons.push(`path does not match LIVE regex: ${sourceRelPath}`);
  }

  const absSource = path.resolve(repoRoot, sourceRelPath);
  const parentDir = path.dirname(absSource);
  const parentBase = path.basename(parentDir);
  if (!SESSION_DIR_RE.test(parentBase)) {
    reasons.push(`parent dir name is not a session dir: ${parentBase}`);
  }
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    reasons.push(`parent dir missing or not a directory: ${parentDir}`);
  }

  const activatorSibling = path.join(parentDir, 'activator.jsonl');
  if (!fs.existsSync(activatorSibling)) {
    reasons.push(`activator.jsonl sibling missing: ${activatorSibling}`);
  }

  if (!fs.existsSync(absSource)) {
    reasons.push(`source file missing: ${absSource}`);
  }

  return { ok: reasons.length === 0, reasons, absSource, parentDir };
}

// ── c1.2: attach-time validation (5 checks, Boss C9 required) ───────────────
function validateAttachTime(sourceRelPath, sessionFileRel, archiveDirRel, abortedDirRel, repoRoot) {
  const reasons = [];

  // Extract the SID from source path (should always succeed if LIVE provenance passed)
  const sourceSid = extractSidFromSourcePath(sourceRelPath);
  if (!sourceSid) {
    reasons.push(`cannot extract SID from source path: ${sourceRelPath}`);
    return { ok: false, reasons };
  }

  // v1: session pointer readable
  const sessionFileAbs = path.resolve(repoRoot, sessionFileRel);
  let pointerContent = null;
  if (!fs.existsSync(sessionFileAbs)) {
    reasons.push(`session pointer missing at attach: ${sessionFileRel}`);
    return { ok: false, reasons, sourceSid };
  }
  try {
    pointerContent = fs.readFileSync(sessionFileAbs, 'utf8').trim();
  } catch (e) {
    reasons.push(`session pointer unreadable: ${e.message}`);
    return { ok: false, reasons, sourceSid };
  }

  // v2: content is a valid compact SID
  if (!COMPACT_SID_RE.test(pointerContent)) {
    reasons.push(`session pointer content not a valid compact SID: '${pointerContent}'`);
    return { ok: false, reasons, sourceSid, pointerContent };
  }

  // v3: attached SID matches source-path SID
  if (pointerContent !== sourceSid) {
    reasons.push(`session pointer SID '${pointerContent}' != source-path SID '${sourceSid}'`);
    return { ok: false, reasons, sourceSid, pointerContent };
  }

  // v4: archive/<SID>.zip must not already exist
  const archiveZipAbs = path.resolve(repoRoot, archiveDirRel, `session_${sourceSid}.zip`);
  if (fs.existsSync(archiveZipAbs)) {
    reasons.push(`archive already exists for SID at attach: ${archiveDirRel}/session_${sourceSid}.zip`);
    return { ok: false, reasons, sourceSid, pointerContent };
  }

  // v5: aborted/session_<SID>/ must not already exist
  const abortedDirAbs = path.resolve(repoRoot, abortedDirRel, `session_${sourceSid}`);
  if (fs.existsSync(abortedDirAbs)) {
    reasons.push(`aborted session already exists for SID at attach: ${abortedDirRel}/session_${sourceSid}`);
    return { ok: false, reasons, sourceSid, pointerContent };
  }

  return { ok: true, reasons: [], sourceSid, attachedSessionId: pointerContent };
}

// ── validate a record has the expected activator shape ──────────────────────
function validateActivatorRecord(record) {
  const reasons = [];
  if (typeof record !== 'object' || record === null) {
    reasons.push('record is not an object');
    return { ok: false, reasons };
  }
  for (const f of REQUIRED_ACTIVATOR_FIELDS) {
    if (!(f in record)) {
      reasons.push(`missing required field: ${f}`);
    }
  }
  if ('sourceType' in record && record.sourceType !== EXPECTED_ACTIVATOR_SOURCE_TYPE) {
    reasons.push(`sourceType mismatch: expected '${EXPECTED_ACTIVATOR_SOURCE_TYPE}', got '${record.sourceType}'`);
  }
  return { ok: reasons.length === 0, reasons };
}

// ── c1.2: terminal-precedence lifecycle evaluation (Boss C9 ordered) ────────
// Returns { terminal: bool, signal: 'CLEAN_LOGICAL_END' | 'SESSION_ABORTED' |
//                                    'SESSION_IDENTITY_LOST' | 'SESSION_SUPERSEDED' |
//                                    'LIFECYCLE_CONFLICT' | null }
function evaluateLifecycleState(attachedSid, sessionFileRel, archiveDirRel, abortedDirRel, repoRoot) {
  const archiveZipAbs = path.resolve(repoRoot, archiveDirRel, `session_${attachedSid}.zip`);
  const abortedDirAbs = path.resolve(repoRoot, abortedDirRel, `session_${attachedSid}`);
  const sessionFileAbs = path.resolve(repoRoot, sessionFileRel);

  const archiveExists = fs.existsSync(archiveZipAbs);
  const abortedExists = fs.existsSync(abortedDirAbs);

  // BOSS-ORDERED PRECEDENCE:
  //   1. archive AND aborted both exist → LIFECYCLE_CONFLICT (fail-closed)
  if (archiveExists && abortedExists) {
    return { terminal: true, signal: 'LIFECYCLE_CONFLICT',
             detail: `both archive and aborted exist for SID ${attachedSid}` };
  }
  //   2. aborted exists → SESSION_ABORTED
  if (abortedExists) {
    return { terminal: true, signal: 'SESSION_ABORTED',
             detail: `aborted dir present: ${abortedDirRel}/session_${attachedSid}` };
  }
  //   3. archive exists → CLEAN_LOGICAL_END
  if (archiveExists) {
    return { terminal: true, signal: 'CLEAN_LOGICAL_END',
             detail: `archive zip present: ${archiveDirRel}/session_${attachedSid}.zip` };
  }
  //   4. session pointer missing → SESSION_IDENTITY_LOST
  if (!fs.existsSync(sessionFileAbs)) {
    return { terminal: true, signal: 'SESSION_IDENTITY_LOST',
             detail: `session pointer missing: ${sessionFileRel}` };
  }
  //   5. session pointer content changed → SESSION_SUPERSEDED
  let currentSid = null;
  try {
    currentSid = fs.readFileSync(sessionFileAbs, 'utf8').trim();
  } catch (e) {
    // Treat unreadable-mid-attachment as IDENTITY_LOST
    return { terminal: true, signal: 'SESSION_IDENTITY_LOST',
             detail: `session pointer unreadable: ${e.message}` };
  }
  if (currentSid !== attachedSid) {
    return { terminal: true, signal: 'SESSION_SUPERSEDED',
             detail: `session pointer changed: was '${attachedSid}', now '${currentSid}'` };
  }
  //   6. otherwise → remain attached
  return { terminal: false, signal: null };
}

// ── main entrypoint ─────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const sourceRelPath = args.source.replace(/\\/g, '/');
  const observerRunId = args.observerRunId;

  console.error(`─── Wave 11 c1.2 live_observer starting ───`);
  console.error(`observerRunId: ${observerRunId}`);
  console.error(`source (rel):  ${sourceRelPath}`);
  console.error(`session file:  ${args.sessionFile}`);

  // ── c1 provenance validation (unchanged) ──
  const prov = validateLiveProvenance(sourceRelPath, REPO_ROOT);
  if (!prov.ok) {
    console.error('✗ LIVE provenance validation failed:');
    for (const r of prov.reasons) console.error(`    - ${r}`);
    console.error('  Refusing to proceed. telemetrySource=LIVE cannot be established.');
    process.exit(2);
  }
  console.error('✓ LIVE provenance validated');

  // ── c1.2 attach-time validation (Boss C9 required) ──
  const attach = validateAttachTime(
    sourceRelPath, args.sessionFile, args.archiveDir, args.abortedDir, REPO_ROOT
  );
  if (!attach.ok) {
    console.error('✗ c1.2 attach-time validation failed:');
    for (const r of attach.reasons) console.error(`    - ${r}`);
    console.error('  Refusing to attach. Session identity/state incompatible with tail.');
    process.exit(5);
  }
  console.error(`✓ c1.2 attach validated: attachedSessionId=${attach.attachedSessionId}`);

  const sourceShaAtOpen = sha256OfFile(prov.absSource);

  const observerDir = path.resolve(REPO_ROOT, 'data', 'telemetry_sessions', observerRunId);
  if (fs.existsSync(observerDir)) {
    console.error(`✗ observer-run-id already exists: ${observerDir}`);
    console.error('  Refusing to overwrite. Choose a different --observer-run-id.');
    process.exit(4);
  }
  fs.mkdirSync(observerDir, { recursive: true });
  const stagedPath = path.join(observerDir, 'observations_staged.jsonl');
  const stagedStream = fs.createWriteStream(stagedPath, { flags: 'wx' });

  // Baseline manifest (c1 fields + c1.2 additions)
  const manifest = {
    observerRunId,
    observerSchemaVersion: OBSERVER_SCHEMA_VERSION,
    startedAtUnixTime: Math.floor(Date.now() / 1000),
    startedAtIso: new Date().toISOString(),
    sourceRelPath,
    sourceAbsPath: prov.absSource,
    sourceShaAtOpen,
    sessionDirBase: path.basename(prov.parentDir),
    chain: 'arbitrum',
    sourceProcess: 'arb_window_activator',
    nodeVersion: process.version,
    platform: process.platform,
    gitHead: readGitHead(),
    // c1.2 additions (Boss C9 approved manifest scope):
    attachedSessionId: attach.attachedSessionId
    // detachReason / terminalSignal / terminalDetectedAt written on close
  };
  fs.writeFileSync(
    path.join(observerDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );
  console.error(`✓ manifest written: ${path.join(observerDir, 'manifest.json')}`);
  console.error(`✓ staged output:    ${stagedPath}`);

  // Counter state
  let recordsSeen = 0;
  let recordsStaged = 0;
  let recordsRejected = 0;

  // c1.2 termination state
  let stopping = false;
  let detachReason = null;
  let terminalSignal = null;
  let terminalDetectedAt = null;

  const stop = (reason, signal, detail) => {
    if (stopping) return;
    stopping = true;
    detachReason = reason;
    terminalSignal = signal || null;
    terminalDetectedAt = new Date().toISOString();
    console.error(`\n─── detach (${reason}${signal ? ' / ' + signal : ''}${detail ? ' — ' + detail : ''}) ───`);
    stagedStream.end(() => {
      writeStopManifest();
      // Terminal lifecycle signals still exit 0 (clean, expected end)
      // Only fatal errors escape via other exit codes.
      process.exit(0);
    });
  };
  process.on('SIGINT',  () => stop('sigint'));
  process.on('SIGTERM', () => stop('sigterm'));

  function writeStopManifest() {
    const stopManifest = {
      ...manifest,
      stoppedAtUnixTime: Math.floor(Date.now() / 1000),
      stoppedAtIso: new Date().toISOString(),
      recordsSeen,
      recordsStaged,
      recordsRejected,
      sourceShaAtClose: (() => {
        try { return sha256OfFile(prov.absSource); } catch { return null; }
      })(),
      // c1.2 additions
      detachReason,
      terminalSignal,
      terminalDetectedAt
    };
    fs.writeFileSync(
      path.join(observerDir, 'manifest.json'),
      JSON.stringify(stopManifest, null, 2)
    );
  }

  // ── Tail with c1.2 lifecycle polling (idle timeout REMOVED) ──
  await tailFileWithLifecycle(prov.absSource, attach.attachedSessionId, args, REPO_ROOT,
    async (line) => {
      if (stopping) return;
      recordsSeen++;
      let record;
      try {
        record = JSON.parse(line);
      } catch (e) {
        recordsRejected++;
        writeRejection(stagedStream, observerRunId, sourceRelPath, sourceShaAtOpen,
                       line, `json_parse_error: ${e.message}`);
        return;
      }
      const rec = validateActivatorRecord(record);
      if (!rec.ok) {
        recordsRejected++;
        writeRejection(stagedStream, observerRunId, sourceRelPath, sourceShaAtOpen,
                       line, `schema: ${rec.reasons.join('; ')}`);
        return;
      }
      const wrapped = {
        telemetrySource: 'LIVE',
        sourceProcess: 'arb_window_activator',
        sourceSchemaVersion: 'activator_v1',
        chain: 'arbitrum',
        sourcePath: sourceRelPath,
        sourceSha256AtOpen: sourceShaAtOpen,
        observerRunId,
        observerSchemaVersion: OBSERVER_SCHEMA_VERSION,
        readAtUnixTime: Math.floor(Date.now() / 1000),
        recordFromSource: record
      };
      stagedStream.write(JSON.stringify(wrapped) + '\n');
      recordsStaged++;
      if (recordsStaged % 1000 === 0) {
        console.error(`... staged ${recordsStaged} observations`);
      }
    },
    // Terminal callback — invoked when evaluateLifecycleState returns terminal
    (signal, detail) => stop('lifecycle_terminal', signal, detail)
  );

  // Reached end (tailFileWithLifecycle returned) — clean exit if not already stopping
  if (!stopping) stop('tail_returned');
}

function writeRejection(stream, observerRunId, sourceRelPath, sha, line, reason) {
  stream.write(JSON.stringify({
    telemetrySource: 'UNKNOWN',
    rejection: true,
    rejection_reason: reason,
    observerRunId,
    sourcePath: sourceRelPath,
    sourceSha256AtOpen: sha,
    rawLine: line.slice(0, 500)
  }) + '\n');
}

function readGitHead() {
  try {
    const headPath = path.resolve(REPO_ROOT, '.git', 'HEAD');
    const headRef = fs.readFileSync(headPath, 'utf8').trim();
    if (headRef.startsWith('ref: ')) {
      const ref = headRef.slice(5).trim();
      const refPath = path.resolve(REPO_ROOT, '.git', ref);
      return fs.readFileSync(refPath, 'utf8').trim();
    }
    return headRef;
  } catch { return null; }
}

// ── c1.2 poll-based tail with lifecycle polling (idle timeout REMOVED) ──────
// Source-idle no longer authorizes exit. Only the four Boss C9 terminal
// signals (or LIFECYCLE_CONFLICT) do.
async function tailFileWithLifecycle(filePath, attachedSid, args, repoRoot, onLine, onTerminal) {
  let position = 0;
  let buffer = '';
  let ticksSinceLastLifecycleCheck = 0;

  while (true) {
    let stat;
    try { stat = fs.statSync(filePath); }
    catch (e) {
      // File disappeared. Check lifecycle to categorize before exiting.
      const life = evaluateLifecycleState(
        attachedSid, args.sessionFile, args.archiveDir, args.abortedDir, repoRoot
      );
      if (life.terminal) {
        onTerminal(life.signal, life.detail);
        return;
      }
      // Source disappeared but no terminal artifact — genuine failure
      console.error(`✗ source file disappeared without lifecycle terminal signal: ${filePath}`);
      process.exit(3);
    }
    if (stat.size < position) {
      // File shrank (rare with append-only, but possible on non-standard cleanup).
      // Check lifecycle first — the shrink might coincide with a terminal signal.
      const life = evaluateLifecycleState(
        attachedSid, args.sessionFile, args.archiveDir, args.abortedDir, repoRoot
      );
      if (life.terminal) {
        onTerminal(life.signal, life.detail);
        return;
      }
      console.error(`✗ source file shrank without lifecycle terminal signal — stopping`);
      return;
    }
    if (stat.size > position) {
      const fd = fs.openSync(filePath, 'r');
      const bytes = stat.size - position;
      const buf = Buffer.alloc(bytes);
      fs.readSync(fd, buf, 0, bytes, position);
      fs.closeSync(fd);
      position = stat.size;
      buffer += buf.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) await onLine(line);
      }
    }
    // NOTE: source-idle NO LONGER triggers exit. Source silence is not terminal.

    // c1.2 lifecycle check (every LIFECYCLE_CHECK_EVERY_TICKS ticks, ~10s)
    ticksSinceLastLifecycleCheck++;
    if (ticksSinceLastLifecycleCheck >= LIFECYCLE_CHECK_EVERY_TICKS) {
      ticksSinceLastLifecycleCheck = 0;
      const life = evaluateLifecycleState(
        attachedSid, args.sessionFile, args.archiveDir, args.abortedDir, repoRoot
      );
      if (life.terminal) {
        onTerminal(life.signal, life.detail);
        return;
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

// ── run ─────────────────────────────────────────────────────────────────────
main().catch((e) => {
  console.error('fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
