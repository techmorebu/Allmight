'use strict';
/**
 * M2-D-R1 — ACTIVATION-AWARE FIXTURE BUILDER.
 *
 * Builds evidence from the DECLARED AUTHORITY STATE, never from a component
 * name. The previous fixtures constructed files only for ACTIVE outputs and
 * hard-coded which components had them; when heat's heartbeat activated, every
 * one of them silently withheld required evidence and the components failed —
 * the evaluator working correctly on stale fixtures.
 *
 * Naming a component here would reproduce that debt at the next migration.
 *
 * RULES
 *   ACTIVE authority             → supply evidence unless a test deliberately
 *                                  withholds or corrupts it
 *   PENDING_MIGRATION authority  → supply NOTHING. Fabricating evidence for a
 *                                  pending authority would let a fixture imply
 *                                  a consultation that must not happen.
 */
function buildEvidence(reg, opts) {
  const o = opts || {};
  const now = o.now, files = o.files || {}, pids = o.pids || {}, prev = o.prev || {};
  const withhold = new Set(o.withhold || []);          // "id:authority"
  const corrupt = o.corrupt || {};                     // "id:authority" -> mutator
  for (const c of reg.components) {
    const t = c.target;
    if (!pids[c.id]) pids[c.id] = { pid: 1000 + reg.components.indexOf(c), alive: true };

    // ── heartbeat: ONLY when the contract declares it ACTIVE ──────────────
    if (t.heartbeatActivation === 'ACTIVE' && t.heartbeatPath) {
      const key = `${c.id}:heartbeat`;
      if (!withhold.has(key)) {
        // M2E-006: every field the CONTRACT declares must be supplied, derived
        // from the declaration — never from a component name. A contract that
        // requires cycle/sessionId/schema and receives none would fail, and the
        // fixture, not the evaluator, would be wrong.
        let payload = { component: c.id, pid: pids[c.id].pid,
                        ts: new Date(now - 10000).toISOString(), intervalSec: 30 };
        if (t.heartbeatProducerBuild) payload.producerBuild = t.heartbeatProducerBuild;
        if (t.heartbeatSchemaVersion !== undefined) payload.heartbeatSchemaVersion = t.heartbeatSchemaVersion;
        if (t.heartbeatCycle !== undefined) payload.cycle = t.heartbeatCycle;
        if (t.heartbeatSessionBound === true) payload.sessionId = o.sessionId || 'FIXTURE_SESSION';
        if (t.heartbeatPidBound === false) { payload.workerPid = payload.pid; delete payload.pid; }
        if (corrupt[key]) payload = corrupt[key](payload);
        files[t.heartbeatPath] = { data: JSON.stringify(payload) + '\n', mtimeMs: now - 10000 };
      }
    }
    // ── output: ONLY when ACTIVE, and shaped by the declared provider ─────
    if (t.outputRecord && t.outputActivation === 'ACTIVE') {
      const key = `${c.id}:output`;
      if (!withhold.has(key)) {
        const rec = t.outputRecord;
        if (rec.sourceKind === 'filesystem') {
          files[rec.path] = rec.format === 'jsonl_record'
            ? { data: JSON.stringify({ type: rec.recordType || 'x', ts: new Date(now - 10000).toISOString() }) + '\n', mtimeMs: now }
            : { data: 'a\nb\n', mtimeMs: now - 10000 };
          if (rec.format === 'text_append') prev[c.id] = { bytes: 1 };
        }
        // redis sources need an injected probe, not a file — supplying one here
        // would fabricate evidence for an authority the harness cannot serve
      }
    }
  }
  return { files, pids, prev };
}
/** Virtual fs over the built table, with real-file passthrough for temp paths. */
function vfs(files, realPaths) {
  const real = new Set(realPaths || []);
  const nodeFs = require('fs');
  return {
    statSync: (p) => real.has(p) ? nodeFs.statSync(p)
      : (() => { if (!(p in files)) throw new Error('ENOENT ' + p); return { mtimeMs: files[p].mtimeMs }; })(),
    readFileSync: (p) => real.has(p) ? nodeFs.readFileSync(p, 'utf8')
      : (() => { if (!(p in files)) throw new Error('ENOENT ' + p); return files[p].data; })(),
  };
}
function probe(pids) {
  return { pidOf: (id) => (pids[id] ? pids[id].pid : null),
           isAlive: (pid) => Object.values(pids).some(v => v.pid === pid && v.alive) };
}
module.exports = { buildEvidence, vfs, probe };
