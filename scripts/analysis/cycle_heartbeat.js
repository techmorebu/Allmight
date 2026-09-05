'use strict';
/**
 * M2E-001 — WORKER-OWNED CYCLE-COMPLETION HEARTBEAT.
 *
 * CONSTITUTIONAL RULE (M2-A, reaffirmed by Boss Ruling A): a health heartbeat
 * must be emitted by the WORKER / work-cycle code whose progress it claims.
 * A wrapper-written completion record is auxiliary evidence, NOT heartbeat
 * authority — so this module is required and called from INSIDE the worker,
 * at the end of its own cycle, before it exits.
 *
 * WHY THE COUNTERFACTUAL HOLDS
 *   wrapper alive + worker stopped  ->  the worker never reaches its cycle end
 *                                   ->  nothing is written
 *                                   ->  the heartbeat goes STALE.
 * A `touch` in the wrapper loop would stay fresh under exactly that condition,
 * which is Incident 023 recreated as a false-green authority. The acceptance
 * suite builds that wrong implementation deliberately and requires it to FAIL.
 *
 * MEANING: "a work cycle COMPLETED." NOT "useful work landed" — output
 * authority answers that independently, and the two must never be blurred.
 *
 * TIME-001: UTC only. No local field in stored evidence.
 * INVARIANT: emission must NEVER become the cause of an exit. Every failure is
 * caught and reported on stderr; the caller continues regardless.
 */
const fs = require('fs');
const path = require('path');

// M2E-001-R3: canonical schema identity. A consumer must be able to tell WHICH
// payload contract it is reading before interpreting any field — otherwise a
// future field addition or rename is indistinguishable from a malformed record.
const HEARTBEAT_SCHEMA_VERSION = 1;

const PRODUCER_BUILD = 'volatility-hb-build-0455a658';   // derived from the
// pre-patch worker SHA 0455a658…, which is stable and not self-referential.
// The verification bundle proves the binding in both directions.

function defaultPath(component) {
  return process.env.ALLMIGHT_HEARTBEAT_PATH
    || path.join(process.cwd(), 'logs', 'hb', `${component}.hb`);
}

/**
 * SESSION AUTHORITY (M2E-001-R2).
 *
 * Heat binds a heartbeat to its epoch via the PID check: its pid file records
 * the LONG-LIVED worker, so a prior-session record fails on pid mismatch.
 * That mechanism is UNAVAILABLE here. Volatility's worker is a one-shot with a
 * new pid every cycle, and its pid file records the WRAPPER (Incident 023), so
 * importing heat's pid comparison would make a CORRECT heartbeat fail by
 * construction.
 *
 * The session id is therefore explicit, read from the canonical runtime source
 * — the same `logs/allmight.session` pointer the router's exit ledger uses.
 * A record carrying session A cannot satisfy an evaluator running session B.
 *
 * Read fresh on every emit: the session can advance under a long-lived process,
 * and a cached value would silently outlive its epoch.
 * Returns null on any failure — never throws.
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

/**
 * Emit one cycle-completion heartbeat. Returns {ok, path} | {ok:false, error}.
 * NEVER throws.
 */
function emitCycleHeartbeat(opts) {
  const o = opts || {};
  const component = o.component || 'volatility';
  const hbPath = o.hbPath || defaultPath(component);
  try {
    const dir = path.dirname(hbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(hbPath, JSON.stringify({
      heartbeatSchemaVersion: HEARTBEAT_SCHEMA_VERSION,
      component,
      cycle: 'complete',
      // The guarantee for these fields is NOT that they are unforgeable — a
      // wrapper could write any of them. It is that the only AUTHORIZED
      // emitter call site is inside the worker-owned completion path, and no
      // wrapper has an authorized heartbeat emitter at all.
      workerPid: process.pid,
      sessionId: readSessionId(o.sessionFilePath),
      cycleNumber: Number.isFinite(o.cycleNumber) ? o.cycleNumber : null,
      producerBuild: PRODUCER_BUILD,
      ts: new Date().toISOString(),    // TIME-001: UTC
      intervalSec: Number.isFinite(o.intervalSec) ? o.intervalSec : null,
    }) + '\n');
    return { ok: true, path: hbPath };
  } catch (e) {
    try { process.stderr.write(`[vol] CYCLE HEARTBEAT WRITE FAILED ${hbPath}: ${e.message}\n`); } catch {}
    return { ok: false, path: hbPath, error: e.message };
  }
}
module.exports = { emitCycleHeartbeat, readSessionId, HEARTBEAT_SCHEMA_VERSION, PRODUCER_BUILD, defaultPath };
