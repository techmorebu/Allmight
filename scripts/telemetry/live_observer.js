#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1 — live_observer.js
 *
 * Tails the activator's LIVE price_replay.jsonl output and emits
 * provenance-wrapped observations to a staged JSONL file.
 *
 * DOES NOT:
 *   - Modify the source file
 *   - Modify any activator behavior
 *   - Run as a daemon (must be invoked explicitly)
 *   - Spawn cron/systemd/scheduler entries
 *   - Send anything to Discord / RPC / broadcast
 *   - Read from any file that isn't a validated LIVE source path
 *
 * Boss C9 provenance contract (LIVE_TAIL only for c1):
 *   telemetrySource="LIVE" is emitted ONLY when ALL of:
 *     (a) source path matches ^logs/sessions/session_<UTC-ISO>/price_replay.jsonl$
 *     (b) parent dir exists AND matches session_YYYY-MM-DDTHH-MM-SSZ format
 *     (c) activator.jsonl sibling exists (activator write-lock evidence)
 *     (d) record decodes as JSON with expected activator field shape
 *   Otherwise: telemetrySource="UNKNOWN" + rejection_reason, and record
 *   is NOT staged. Fail-closed.
 *
 * Usage:
 *   node scripts/telemetry/live_observer.js \
 *        --source logs/sessions/session_2026-05-31T21-01-14Z/price_replay.jsonl \
 *        --observer-run-id <uuid or auto>
 *
 * Exit codes:
 *   0 = observer stopped cleanly (SIGINT/SIGTERM after processing)
 *   1 = invalid arguments
 *   2 = source path failed provenance validation (fail-closed)
 *   3 = source file inaccessible or session dir malformed
 *   4 = staged output path collision (observer-run-id already exists)
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const OBSERVER_SCHEMA_VERSION = '1';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ── Boss C9 provenance regex (LIVE_TAIL only for c1) ────────────────────────
const LIVE_SOURCE_PATH_RE =
  /^logs\/sessions\/session_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\/price_replay\.jsonl$/;
const SESSION_DIR_RE =
  /^session_(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z$/;

// ── minimum required activator-record shape ─────────────────────────────────
// Content-neutral: we check FIELD PRESENCE, not value acceptability.
// Records with unfavorable outcomes still pass and are staged.
const REQUIRED_ACTIVATOR_FIELDS = ['blockNumber', 'timestamp'];
const RECOMMENDED_ACTIVATOR_FIELDS = ['uniswap_v3', 'ramses_v2', 'venue', 'sqrtPriceX96'];

// ── argument parsing (minimal, no dependencies) ─────────────────────────────
function parseArgs(argv) {
  const args = { source: null, observerRunId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source' && i + 1 < argv.length) { args.source = argv[++i]; }
    else if (a === '--observer-run-id' && i + 1 < argv.length) { args.observerRunId = argv[++i]; }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('unknown arg:', a); process.exit(1); }
  }
  if (!args.source) { console.error('--source required'); process.exit(1); }
  if (!args.observerRunId) {
    // Auto-generate: OBS_<yyyymmddThhmmssZ>_<rand4>
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const rand = crypto.randomBytes(2).toString('hex');
    args.observerRunId = `OBS_${now}_${rand}`;
  }
  return args;
}

function printHelp() {
  console.log(`Wave 11 c1 — live_observer.js
Usage:
  node scripts/telemetry/live_observer.js --source <path> [--observer-run-id <id>]
Provenance:
  --source MUST match logs/sessions/session_<UTC-ISO>/price_replay.jsonl
  Otherwise LIVE cannot be established and observer refuses to proceed.
`);
}

// ── SHA of file contents at read time ──────────────────────────────────────
function sha256OfFile(fullPath) {
  const h = crypto.createHash('sha256');
  const buf = fs.readFileSync(fullPath);
  h.update(buf);
  return h.digest('hex');
}

// ── provenance validation (all 4 conditions must pass) ──────────────────────
function validateLiveProvenance(sourceRelPath, repoRoot) {
  const reasons = [];

  // (a) Path regex
  if (!LIVE_SOURCE_PATH_RE.test(sourceRelPath)) {
    reasons.push(`path does not match LIVE regex: ${sourceRelPath}`);
  }

  const absSource = path.resolve(repoRoot, sourceRelPath);

  // (b) Parent dir exists AND matches session format
  const parentDir = path.dirname(absSource);
  const parentBase = path.basename(parentDir);
  if (!SESSION_DIR_RE.test(parentBase)) {
    reasons.push(`parent dir name is not a session dir: ${parentBase}`);
  }
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    reasons.push(`parent dir missing or not a directory: ${parentDir}`);
  }

  // (c) activator.jsonl sibling must exist (activator write-lock evidence)
  const activatorSibling = path.join(parentDir, 'activator.jsonl');
  if (!fs.existsSync(activatorSibling)) {
    reasons.push(`activator.jsonl sibling missing: ${activatorSibling}`);
  }

  // (d) Source file must exist and be readable
  if (!fs.existsSync(absSource)) {
    reasons.push(`source file missing: ${absSource}`);
  }

  return { ok: reasons.length === 0, reasons, absSource, parentDir };
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
  // Recommended fields: presence NOT enforced; noted in observationNotes
  return { ok: reasons.length === 0, reasons };
}

// ── main entrypoint ─────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const sourceRelPath = args.source.replace(/\\/g, '/'); // normalize
  const observerRunId = args.observerRunId;

  console.error(`─── Wave 11 c1 live_observer starting ───`);
  console.error(`observerRunId: ${observerRunId}`);
  console.error(`source (rel):  ${sourceRelPath}`);

  const prov = validateLiveProvenance(sourceRelPath, REPO_ROOT);
  if (!prov.ok) {
    console.error('✗ LIVE provenance validation failed:');
    for (const r of prov.reasons) console.error(`    - ${r}`);
    console.error('  Refusing to proceed. telemetrySource=LIVE cannot be established.');
    process.exit(2);
  }
  console.error('✓ LIVE provenance validated');

  const sourceShaAtOpen = sha256OfFile(prov.absSource);

  // Prepare staged output path — under data/telemetry_sessions/ per Boss C9
  const observerDir = path.resolve(REPO_ROOT, 'data', 'telemetry_sessions', observerRunId);
  if (fs.existsSync(observerDir)) {
    console.error(`✗ observer-run-id already exists: ${observerDir}`);
    console.error('  Refusing to overwrite. Choose a different --observer-run-id.');
    process.exit(4);
  }
  fs.mkdirSync(observerDir, { recursive: true });
  const stagedPath = path.join(observerDir, 'observations_staged.jsonl');
  const stagedStream = fs.createWriteStream(stagedPath, { flags: 'wx' });

  // Emit session manifest (metadata, not per-observation)
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
    gitHead: readGitHead()
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

  // Stop cleanly on signal
  let stopping = false;
  const stop = (sig) => {
    if (stopping) return;
    stopping = true;
    console.error(`\n─── signal ${sig} — closing after in-flight write ───`);
    stagedStream.end(() => {
      writeStopManifest();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

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
      })()
    };
    fs.writeFileSync(
      path.join(observerDir, 'manifest.json'),
      JSON.stringify(stopManifest, null, 2)
    );
  }

  // Tail the source file (poll-based; no external deps)
  await tailFile(prov.absSource, async (line) => {
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
    // Emit provenance-wrapped observation (LIVE)
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
  });

  // Reached EOF and source is not being appended to — clean exit
  stop('EOF');
}

function writeRejection(stream, observerRunId, sourceRelPath, sha, line, reason) {
  stream.write(JSON.stringify({
    telemetrySource: 'UNKNOWN',
    rejection: true,
    rejection_reason: reason,
    observerRunId,
    sourcePath: sourceRelPath,
    sourceSha256AtOpen: sha,
    rawLine: line.slice(0, 500) // truncate to avoid manifest bloat
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

// ── poll-based tail ─────────────────────────────────────────────────────────
async function tailFile(filePath, onLine) {
  let position = 0;
  let buffer = '';
  let idleTicks = 0;
  const IDLE_EXIT_TICKS = 20; // ~10s of no growth → we consider source dead
  const POLL_INTERVAL_MS = 500;

  while (true) {
    let stat;
    try { stat = fs.statSync(filePath); }
    catch (e) {
      console.error(`✗ source file disappeared: ${filePath}`);
      process.exit(3);
    }
    if (stat.size < position) {
      // File truncated or rotated. For c1 v1 we treat this as a hard stop.
      console.error(`✗ source file shrank (rotate/truncate detected) — stopping`);
      return;
    }
    if (stat.size > position) {
      idleTicks = 0;
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
    } else {
      idleTicks++;
      if (idleTicks >= IDLE_EXIT_TICKS) {
        // Long-idle: treat as source completed, exit clean.
        console.error(`(source idle ~${(POLL_INTERVAL_MS * IDLE_EXIT_TICKS) / 1000}s — exiting)`);
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
