'use strict';
/**
 * M1B-A — production-intended READ-ONLY runtime adapter (SENSOR BRIDGE).
 *
 * Resolves the real runtime facts the evaluator needs and hands them over as a
 * ctx. It is built and proven OFFLINE first: every I/O dependency is injected,
 * so the same code path the live system will use is exercised here against a
 * virtual filesystem.
 *
 * READ-ONLY BY CONSTRUCTION. This module contains no write, spawn, or signal
 * surface. The liveness probe uses process.kill(pid, 0) — signal 0 performs a
 * permission/existence check and delivers nothing. That is the ONLY use of
 * `kill` here, and the tests assert no nonzero signal can be emitted.
 *
 * NOTHING IS GUESSED. Every resolution step either succeeds with evidence or
 * fails with a reason. A silently-invented default is the failure class this
 * whole redesign exists to remove.
 */
const nodeFs = require('fs');
const path = require('path');
const providers = require('./providers');

const ADAPTER_VERSION = 'runtime_adapter.v1-m1ba';
const SID_RE = /^(\d{8})_(\d{4})$/;          // compact session id — the enforced contract
// R1-R1: filesystem clock granularity / measurement skew tolerance. A pointer
// mtime beyond this is not skew — it is a corrupt or touched pointer, and a
// session start later than reality would classify LIVE records as prior-session.
const FUTURE_TOLERANCE_MS = 5000;
const CANONICAL_IDS = ['fetcher','activator','volatility','heat','monitor',
                       'watchdog','notification_router','shadow_engine'];

class ResolutionError extends Error {
  constructor(code, msg, evidence) { super(msg); this.code = code; this.evidence = evidence || {}; }
}

/** F. Liveness probe. signal 0 only: an existence/permission check, no delivery. */
function makeProcessProbe(pidMap) {
  return {
    isAlive(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return false;
      try { process.kill(pid, 0); return true; }        // signal 0 — probe, never delivered
      catch (e) { return e.code === 'EPERM'; }          // EPERM: exists, not ours
    },
    pidOf(id) { const e = pidMap[id]; return e && e.ok ? e.pid : null; },
  };
}

/**
 * B/C/D. Session identity and start time.
 *
 * M1B-A-R1. The compact SID is IDENTITY ONLY. It is produced by
 * `date +%Y%m%d_%H%M`, which is LOCAL time with no offset recorded, so deriving
 * an absolute instant from it requires assuming a timezone. The previous
 * implementation parsed it as UTC: for 20260903_0315 created at 03:15 CDT the
 * true instant is 08:15Z, a five-hour error that would have let prior-session
 * records pass the contamination check.
 *
 * The START-TIME AUTHORITY is therefore the mtime of the session pointer file.
 * start_all.sh writes that pointer at the moment the session id is claimed
 * (after the atomic mkdir and the advisory checks), so its mtime is an
 * absolute, timezone-free record of the claim. The SID is never converted.
 */
function resolveSession(repoRoot, fs, opts, now) {
  const o = opts || {};
  const pointerRel = o.sessionPointer || path.join('logs', 'allmight.session');
  const pointerAbs = path.join(repoRoot, pointerRel);
  let raw;
  try { raw = fs.readFileSync(pointerAbs, 'utf8'); }
  catch { throw new ResolutionError('SESSION_POINTER_MISSING',
    `session pointer not readable at ${pointerRel} — the adapter does not guess a session`, { pointerRel }); }
  const sid = String(raw).trim();
  if (!sid) throw new ResolutionError('SESSION_POINTER_EMPTY', 'session pointer is empty', { pointerRel });
  if (!SID_RE.test(sid)) throw new ResolutionError('SESSION_ID_MALFORMED',
    `session id '${sid}' does not match the compact YYYYMMDD_HHMM contract`, { sid });

  const dirRel = path.join('logs', 'sessions', `session_${sid}`);
  const dirAbs = path.join(repoRoot, dirRel);
  let dirSt;
  try { dirSt = fs.statSync(dirAbs); }
  catch { throw new ResolutionError('SESSION_DIR_MISSING',
    `pointer names '${sid}' but ${dirRel} does not exist — STALE POINTER, not a valid session`, { sid, dirRel }); }
  if (dirSt.isDirectory && !dirSt.isDirectory()) throw new ResolutionError('SESSION_DIR_NOT_DIR', `${dirRel} is not a directory`, { sid });

  // START-TIME AUTHORITY: the pointer's mtime — absolute, no timezone assumed.
  let ptrSt;
  try { ptrSt = fs.statSync(pointerAbs); }
  catch { throw new ResolutionError('SESSION_START_UNRESOLVABLE',
    `cannot stat the session pointer, so no absolute start time exists — the SID is identity only and must NOT be converted`, { pointerRel }); }
  const startMs = ptrSt.mtimeMs;
  if (!Number.isFinite(startMs)) throw new ResolutionError('SESSION_START_UNRESOLVABLE',
    'session pointer has no usable mtime', { pointerRel });

  // R1-R1: the guard. A pointer mtime materially ahead of now cannot be a real
  // claim instant. Do NOT clamp to now, do NOT substitute the SID — either would
  // manufacture a start time, and a start later than reality makes LIVE records
  // read as prior-session. Fail loud with a dedicated code.
  if (startMs > now + FUTURE_TOLERANCE_MS)
    throw new ResolutionError('SESSION_START_IN_FUTURE',
      `session pointer mtime is ${Math.round((startMs - now) / 1000)}s in the future (tolerance ${FUTURE_TOLERANCE_MS}ms) — refusing to clamp or substitute`,
      { pointerRel, pointerMtimeMs: startMs, nowMs: now, toleranceMs: FUTURE_TOLERANCE_MS });

  const archived = safeExists(fs, path.join(repoRoot, 'logs', 'archive', `session_${sid}.zip`));
  const aborted  = safeExists(fs, path.join(repoRoot, 'logs', 'aborted', `session_${sid}`));
  const lifecycle = archived && aborted ? 'LIFECYCLE_CONFLICT'
                  : archived ? 'ARCHIVED' : aborted ? 'ABORTED' : 'LIVE';

  // M1B-A-R1: a terminal-marked session must FAIL ATTACHMENT, not carry a label.
  // Continuing to build a context for an archived or aborted session would let
  // the supervisor observe a session that has already ended and report its
  // stale artifacts as current evidence.
  if (lifecycle !== 'LIVE') throw new ResolutionError('SESSION_TERMINAL',
    `session ${sid} is ${lifecycle} — attachment refused; a terminal session is not observable as current`,
    { sid, lifecycle, archived, aborted });

  return { sessionId: sid, sessionDirRel: dirRel, sessionDirAbs: dirAbs,
           sessionStartMs: startMs,
           startTimeAuthority: 'session_pointer_mtime',
           startTimeSource: pointerRel,
           sidIsIdentityOnly: true,
           futureToleranceMs: FUTURE_TOLERANCE_MS,
           terminalMarkers: { archived, aborted }, lifecycle };
}

function safeExists(fs, p) { try { fs.statSync(p); return true; } catch { return false; } }

/** E. PID namespace. Every condition becomes explicit evidence, never silence. */
function resolvePids(repoRoot, fs, opts) {
  const o = opts || {};
  const rel = o.pidFile || path.join('logs', 'allmight.pid');
  const abs = path.join(repoRoot, rel);
  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); }
  catch { throw new ResolutionError('PID_FILE_MISSING', `pid file not readable at ${rel}`, { rel }); }
  const map = {}; const unknownKeys = []; const seen = new Set();
  for (const line of String(raw).split('\n')) {
    const s = line.trim(); if (!s) continue;
    const i = s.indexOf('=');
    if (i < 0) { unknownKeys.push({ line: s, why: 'no = separator' }); continue; }
    const key = s.slice(0, i).trim(), val = s.slice(i + 1).trim();
    if (key === 'notifier') { unknownKeys.push({ line: s, why: 'legacy alias — no alias layer is permitted' }); continue; }
    if (!CANONICAL_IDS.includes(key)) { unknownKeys.push({ line: s, why: 'not a canonical registry id' }); continue; }
    seen.add(key);
    const pid = Number(val);
    map[key] = Number.isInteger(pid) && pid > 0
      ? { ok: true, pid, evidence: { source: rel } }
      : { ok: false, pid: null, condition: 'PID_MALFORMED', evidence: { source: rel, raw: val } };
  }
  for (const id of CANONICAL_IDS)
    if (!seen.has(id)) map[id] = { ok: false, pid: null, condition: 'PID_ENTRY_MISSING', evidence: { source: rel } };
  return { pidFileRel: rel, map, unknownKeys };
}

/**
 * H. PROVIDER-AWARE SOURCE RESOLUTION.
 *
 * Dispatches on the provider's declared sourceKind. A filesystem source is
 * expanded ($SESSION_DIR) and anchored at repoRoot; a redis source is passed
 * through untouched; `none` resolves nothing. An unknown provider/source
 * combination FAILS LOUD rather than defaulting to filesystem semantics —
 * defaulting is how the redis URI got a repo prefix in the first place.
 */
function resolveSources(registry, session, repoRoot) {
  const expandFs = (p) => typeof p === 'string'
    ? path.join(repoRoot, p.replace('$SESSION_DIR', session.sessionDirRel))
    : p;
  return {
    ...registry,
    components: registry.components.map(c => {
      const t = c.target;
      // heartbeat is always a filesystem artifact by contract
      const heartbeatPath = expandFs(t.heartbeatPath);
      let outputRecord = t.outputRecord;
      if (outputRecord) {
        const kind = providers.sourceKind(outputRecord.format);
        if (kind === null) {
          const e = new Error(`component '${c.id}': format '${outputRecord.format}' declares no sourceKind — refusing to guess a resolution`);
          e.code = 'UNKNOWN_SOURCE_KIND'; throw e;
        }
        if (outputRecord.multiPath) {
          // M2E-016B: a multi-path source resolves EVERY declared path, not a
          // single `path`. Left unresolved, paths[] kept literal $SESSION_DIR
          // strings and the authority would have read a directory that does
          // not exist — a defect, not epoch drift.
          //
          // The nested requiredWork/coverageLegs paths are resolved TOO: the
          // provider reads from those, and resolving only the flat paths[]
          // summary would leave the operative ones literal.
          if (!Array.isArray(outputRecord.paths) || !outputRecord.paths.length) {
            const e = new Error(`component '${c.id}': multi-path source declares no paths`);
            e.code = 'SOURCE_PATHS_MISSING'; throw e;
          }
          const rw = outputRecord.requiredWork
            ? { ...outputRecord.requiredWork, path: expandFs(outputRecord.requiredWork.path) }
            : outputRecord.requiredWork;
          const legs = Array.isArray(outputRecord.coverageLegs)
            ? outputRecord.coverageLegs.map(l => ({ ...l, path: expandFs(l.path) }))
            : outputRecord.coverageLegs;
          outputRecord = { ...outputRecord, sourceKind: kind,
                           paths: outputRecord.paths.map(expandFs),
                           requiredWork: rw, coverageLegs: legs };
        } else if (kind === 'filesystem') {
          if (!outputRecord.path) { const e = new Error(`component '${c.id}': filesystem source has no path`); e.code = 'SOURCE_PATH_MISSING'; throw e; }
          outputRecord = { ...outputRecord, sourceKind: kind, path: expandFs(outputRecord.path) };
        } else if (kind === 'redis') {
          if (!outputRecord.keyPattern) { const e = new Error(`component '${c.id}': redis source has no keyPattern`); e.code = 'SOURCE_KEYPATTERN_MISSING'; throw e; }
          // NEVER path-joined. The key pattern is carried verbatim, and `path`
          // is dropped so nothing downstream can mistake it for a file.
          const { path: _drop, ...rest } = outputRecord;
          outputRecord = { ...rest, sourceKind: kind };
        } else {                                   // 'none'
          outputRecord = { ...outputRecord, sourceKind: kind };
        }
      }
      return { ...c, target: { ...t, heartbeatPath, outputRecord } };
    }),
  };
}
// Retained name for callers; resolution is provider-aware.
const expandPaths = resolveSources;

/** G. Read-only filesystem view. Only the two methods the evaluator uses. */
function makeReadOnlyFs(fs) {
  return { readFileSync: (p, e) => fs.readFileSync(p, e || 'utf8'), statSync: (p) => fs.statSync(p) };
}

/**
 * Build the evaluator ctx from real runtime state.
 * K. The Redis probe is DISABLED in this slice: no read-only Redis adapter has
 * been implemented or proven, so it is absent rather than stubbed. An absent
 * probe makes redis_ttl fail loudly, which is the intended behaviour while
 * fetcher's output contract is PENDING_MIGRATION.
 */
function buildContext(opts) {
  const o = opts || {};
  const fs = o.fs || nodeFs;
  const repoRoot = o.repoRoot || process.cwd();
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const session = resolveSession(repoRoot, fs, o, now);
  const pids = resolvePids(repoRoot, fs, o);
  const probe = o.probe || makeProcessProbe(pids.map);
  return {
    adapterVersion: ADAPTER_VERSION,
    now, repoRoot,
    sessionId: session.sessionId,
    sessionStartMs: session.sessionStartMs,
    session, pids,
    fs: makeReadOnlyFs(fs),
    probe,
    previous: o.previous || {},
    redis: null,                       // K — DISABLED, not stubbed
    redisStatus: 'DISABLED_NO_READONLY_ADAPTER_PROVEN',
  };
}
module.exports = { buildContext, resolveSession, resolveSources, FUTURE_TOLERANCE_MS, resolvePids, expandPaths,
                   makeProcessProbe, makeReadOnlyFs, ResolutionError,
                   ADAPTER_VERSION, CANONICAL_IDS, SID_RE };
