'use strict';
/**
 * M2E-008A — FETCHER WORKER-OWNED CYCLE-COMPLETION HEARTBEAT.
 *
 * A SEPARATE MODULE, deliberately. scripts/analysis/cycle_heartbeat.js is
 * committed and volatility is DEPLOY-SEM AUTO_ON_NEXT_CYCLE (PROVEN), so any
 * edit there would go live on volatility's next ~30s cycle. Fetcher's own
 * DEPLOY-SEM is UNKNOWN and fails closed; isolating the modules means a change
 * to one cannot deploy itself into the other.
 *
 * WHAT THE HEARTBEAT ASSERTS (Boss ruling Q1):
 *   "the fetcher's normal orchestration cycle COMPLETED."
 * NOT "every sub-fetcher succeeded." The fetcher runs N sub-fetchers and any
 * subset may fail while the cycle completes normally — the live Redis payload
 * already models this with {status, partial}. A success-only heartbeat would
 * make "3 of 5 surfaces failed" indistinguishable from "the worker is dead",
 * which is the exact conflation this architecture exists to remove.
 *
 * Emitted ONLY from the top-level .then() success path. The fatal .catch path
 * MUST NOT emit: a cycle that died is not a cycle that completed.
 *
 * DIAGNOSTIC ONLY (Boss ruling Q2): fetchersAttempted / fetchersOk /
 * fetchersFailed / anyPartial are context for a human reading the record. They
 * do NOT determine heartbeat authority, and the evaluator must not gate on
 * them. Whether partial failure should degrade health is an OUTPUT-authority
 * question, and output is PENDING.
 *
 * TIME-001: UTC only. INVARIANT: emission must NEVER cause an exit.
 */
const fs = require('fs');
const path = require('path');

const HEARTBEAT_SCHEMA_VERSION = 1;
// Derived from the pre-patch master-fetcher.js SHA — stable, and not
// self-referential (a file cannot contain its own hash).
const PRODUCER_BUILD = 'fetcher-hb-build-928a76e6';

function defaultPath(component) {
  return process.env.ALLMIGHT_HEARTBEAT_PATH
    || path.join(process.cwd(), 'logs', 'hb', `${component}.hb`);
}

/**
 * SESSION AUTHORITY. Read FRESH on every emit: the session can advance under a
 * long-lived wrapper, and a cached id would silently outlive its epoch.
 * pidBound is false for this component because the pid file records the
 * WRAPPER (Incident 023) and each one-shot worker is a new process — a pid
 * comparison could never pass. Returns null on failure; never throws.
 */
function readSessionId(sessionFilePath) {
  try {
    const p = sessionFilePath
      || process.env.ALLMIGHT_SESSION_FILE
      || path.join(process.cwd(), 'logs', 'allmight.session');
    const v = fs.readFileSync(p, 'utf8').trim();
    return v || null;
  } catch { return null; }
}

/** Coerce a diagnostic count to a number or null. Never throws. */
function num(v) { return Number.isFinite(v) ? v : null; }

/**
 * Emit one cycle-completion heartbeat. Returns {ok, path} | {ok:false, error}.
 * NEVER throws — a heartbeat failure must not become the cause of a failed cycle.
 */
function emitCycleHeartbeat(opts) {
  const o = opts || {};
  const component = o.component || 'fetcher';
  const hbPath = o.hbPath || defaultPath(component);
  try {
    const dir = path.dirname(hbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const rec = {
      heartbeatSchemaVersion: HEARTBEAT_SCHEMA_VERSION,
      component,
      cycle: 'complete',
      // The guarantee is NOT that these are unforgeable — a wrapper could write
      // anything. It is that the only AUTHORIZED emitter call site is inside
      // the worker-owned completion path, and no wrapper has one.
      workerPid: process.pid,
      sessionId: readSessionId(o.sessionFilePath),
      producerBuild: PRODUCER_BUILD,
      ts: new Date().toISOString(),                // TIME-001: UTC
      intervalSec: Number.isFinite(o.intervalSec) ? o.intervalSec : null,
      // ── DIAGNOSTIC ONLY — never authority ──
      fetchersAttempted: num(o.fetchersAttempted),
      fetchersOk: num(o.fetchersOk),
      fetchersFailed: num(o.fetchersFailed),
      anyPartial: typeof o.anyPartial === 'boolean' ? o.anyPartial : null,
    };
    fs.writeFileSync(hbPath, JSON.stringify(rec) + '\n');
    return { ok: true, path: hbPath };
  } catch (e) {
    try { process.stderr.write(`[MASTER-FETCHER] CYCLE HEARTBEAT WRITE FAILED ${hbPath}: ${e.message}\n`); } catch {}
    return { ok: false, path: hbPath, error: e.message };
  }
}
module.exports = { emitCycleHeartbeat, readSessionId, HEARTBEAT_SCHEMA_VERSION, PRODUCER_BUILD, defaultPath };
