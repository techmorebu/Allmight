'use strict';
/**
 * M1A — health evaluator. THE core of the redesign.
 *
 * Three INDEPENDENT signals. A component is HEALTHY only if every APPLICABLE
 * signal passes. The old system had only `process`, which is why "alive but not
 * producing" had no representation and five defects this session were invisible.
 *
 *   process    is the pid alive?          crash, kill, OOM
 *   heartbeat  is the loop turning?       hang, deadlock, crash-loop
 *   output     is useful work landing?    silent no-op, misrouted path
 *
 * Every evaluator returns a VERDICT OBJECT carrying its own evidence, never a
 * bare boolean — an unexplained false is indistinguishable from an unevaluated
 * one, and that ambiguity is what made the old failures silent.
 */
const fs = require('fs');
const providers = require('./providers');

const V = (signal, state, reason, evidence) => ({ signal, state, reason, evidence: evidence || {} });

// ── 1. PROCESS ───────────────────────────────────────────────────────────────
// `alive` is supplied by the caller (an injected probe) so this module never
// signals or spawns. In OBSERVE_ONLY the probe is `kill -0`-equivalent, read-only.
function evalProcess(comp, probe) {
  const pid = probe.pidOf(comp.id);
  if (pid === null || pid === undefined) return V('process', 'UNKNOWN', 'no pid recorded', { pid: null });
  const alive = probe.isAlive(pid);
  // A wrapper pid says the SUPERVISION UNIT is alive — not the worker.
  // Recording that distinction is what Incident 023 was about.
  const refers = (comp.current && comp.current.pidRefers) || 'worker';
  return V('process', alive ? 'PASS' : 'FAIL',
    alive ? `pid ${pid} alive (${refers})` : `pid ${pid} not alive`,
    { pid, refers, authoritativeForWorker: refers === 'worker' });
}

// ── 2. HEARTBEAT ─────────────────────────────────────────────────────────────
function evalHeartbeat(comp, now, fsx, expectedPid, currentSessionId, sessionStartMs) {
  const t = comp.target || {};
  const hb = t.heartbeatPath;
  if (!hb) return V('heartbeat', 'NOT_APPLICABLE', 'no heartbeat configured');
  // ACTIVATION GATE. A DECLARED signal whose producer is not yet deployed must
  // NOT act as a failure authority: an absent file would read as broken when
  // the truth is that nothing writes one yet.
  if (t.heartbeatActivation !== 'ACTIVE')
    return V('heartbeat', 'NOT_APPLICABLE',
      `heartbeat DECLARED but activation=${t.heartbeatActivation || 'PENDING_MIGRATION'} — not an admissible authority this epoch`,
      { path: hb, activation: t.heartbeatActivation || 'PENDING_MIGRATION' });
  // M2E-004 STARTUP GRACE. An absent heartbeat at session start is "not yet
  // observed", not a failure: the first cycle must complete first. Mirrors the
  // ratified M2-D-R4 empty-set rule — age the SESSION when the artifact cannot
  // be aged. Without a declared grace the old flat FAIL stands.
  let st; try { st = fsx.statSync(hb); }
  catch {
    const grace = t.heartbeatStartupGraceSec;
    const sessionAgeSec = sessionStartMs ? Math.floor((now - sessionStartMs) / 1000) : null;
    if (grace !== undefined && sessionAgeSec !== null && sessionAgeSec <= grace)
      return V('heartbeat', 'UNKNOWN',
        `heartbeat absent and the session is ${sessionAgeSec}s old, within the ${grace}s startup grace — NOT YET OBSERVED, not a failure`,
        { path: hb, activation: 'ACTIVE', sessionAgeSec, startupGraceSec: grace });
    return V('heartbeat', 'FAIL', 'heartbeat file absent',
      { path: hb, activation: 'ACTIVE', sessionAgeSec, startupGraceSec: grace === undefined ? null : grace });
  }
  const ageSec = Math.floor((now - st.mtimeMs) / 1000);
  const stale = (t.heartbeatStaleSec || 120);
  const base = { path: hb, ageSec, staleSec: stale, activation: 'ACTIVE' };

  // M2E-004A — FUTURE MTIME. A negative age satisfies `ageSec <= stale`, so a
  // file dated ahead of now would read as perpetually fresh. Same class as
  // SESSION_START_IN_FUTURE (M1B-A-R1-R1), not previously carried here.
  //
  // ZERO POSITIVE ALLOWANCE. An earlier draft imported a 5s tolerance from the
  // session-pointer guard, where filesystem granularity justified it. That was
  // never ratified for this evaluator: mtime > now is not fresh, it is wrong,
  // and any allowance is a window in which a touched artifact passes.
  if (st.mtimeMs > now)
    return V('heartbeat', 'FAIL',
      `heartbeat mtime is ${Math.max(1, Math.abs(ageSec))}s in the FUTURE — mtime > now is never fresh`,
      { ...base, futureByMs: st.mtimeMs - now });

  // M2-D — PRODUCER IDENTITY VALIDATION, extended by M2E-004.
  // Freshness alone cannot distinguish "the accepted worker is alive" from
  // "something else is touching this path". When the contract names an expected
  // producer build, the payload becomes part of the authority.
  //
  // M2E-004 adds three things the volatility contract requires:
  //   1. pid comparison is per-contract (heartbeatPidBound). Heat's pid file
  //      records its LONG-LIVED worker, so pid is a valid epoch binding there.
  //      Volatility's pid file records the WRAPPER (Incident 023) and each
  //      worker is a new one-shot, so a pid check could never pass.
  //   2. payload.workerPid OR payload.pid — one-shot producers name the field
  //      precisely; heat's deployed producer uses `pid`. Renaming either would
  //      mean redeploying a working component.
  //   3. sessionId ENFORCEMENT. The producer has emitted it since M2E-001-R2
  //      and nothing read it, so session binding was recorded, not enforced.
  const wantBuild = t.heartbeatProducerBuild;
  const wantSchema = t.heartbeatSchemaVersion;
  const sessionBound = t.heartbeatSessionBound === true;
  const pidBound = t.heartbeatPidBound !== false;   // default TRUE preserves heat
  if (wantBuild || wantSchema || sessionBound) {
    let raw, payload;
    try { raw = fsx.readFileSync(hb, 'utf8'); }
    catch { return V('heartbeat', 'FAIL', 'heartbeat unreadable', base); }
    try { payload = JSON.parse(raw); }
    catch { return V('heartbeat', 'FAIL', 'heartbeat payload is MALFORMED (not JSON)', { ...base, rawHead: String(raw).slice(0, 80) }); }
    if (!payload || typeof payload !== 'object')
      return V('heartbeat', 'FAIL', 'heartbeat payload is MALFORMED (not an object)', base);
    if (payload.component !== comp.id)
      return V('heartbeat', 'FAIL', `heartbeat component '${payload.component}' != '${comp.id}'`, { ...base, payloadComponent: payload.component });
    // M2E-004A — CYCLE STATE. A cycle-completion heartbeat asserts that a work
    // cycle FINISHED. Any other value (or none) is not that claim, and must not
    // satisfy the authority merely because the file is fresh.
    const wantCycle = t.heartbeatCycle;
    if (wantCycle !== undefined && payload.cycle !== wantCycle)
      return V('heartbeat', 'FAIL',
        `heartbeat cycle '${payload.cycle === undefined ? '<absent>' : payload.cycle}' != required '${wantCycle}' — this does not assert a completed cycle`,
        { ...base, payloadCycle: payload.cycle === undefined ? null : payload.cycle, expectedCycle: wantCycle });
    // M2E-004A — PAYLOAD TIMESTAMP INTEGRITY. mtime is the freshness authority,
    // but a record whose own ts is missing, unparsable or in the future is not
    // trustworthy evidence regardless of when the file was written.
    if (t.heartbeatRequireTs === true) {
      const tsMs = Date.parse(payload.ts);
      if (!Number.isFinite(tsMs))
        return V('heartbeat', 'FAIL',
          `heartbeat ts '${payload.ts === undefined ? '<absent>' : payload.ts}' is missing or unparsable`,
          { ...base, payloadTs: payload.ts === undefined ? null : payload.ts });
      if (tsMs > now)
        return V('heartbeat', 'FAIL',
          `heartbeat ts is ${Math.max(1, Math.floor((tsMs - now) / 1000))}s in the FUTURE — ts > now is never valid`,
          { ...base, payloadTs: payload.ts, tsAheadMs: tsMs - now });
      base.payloadTs = payload.ts;
    }
    if (wantSchema !== undefined && payload.heartbeatSchemaVersion !== wantSchema)
      return V('heartbeat', 'FAIL',
        `heartbeatSchemaVersion ${payload.heartbeatSchemaVersion} != accepted ${wantSchema} — refusing to interpret an unknown contract`,
        { ...base, payloadSchema: payload.heartbeatSchemaVersion, expectedSchema: wantSchema });
    if (wantBuild && payload.producerBuild !== wantBuild)
      return V('heartbeat', 'FAIL',
        `producerBuild '${payload.producerBuild}' != accepted '${wantBuild}' — this is not the deployed build`,
        { ...base, payloadBuild: payload.producerBuild, expectedBuild: wantBuild });
    if (sessionBound) {
      // A null id satisfies NO session. Absence is not identity: null === null
      // must never be read as "the same epoch".
      if (payload.sessionId === null || payload.sessionId === undefined)
        return V('heartbeat', 'FAIL',
          'heartbeat carries no sessionId — absence is not identity and satisfies no session',
          { ...base, payloadSession: payload.sessionId === undefined ? '<absent>' : null });
      if (!currentSessionId)
        return V('heartbeat', 'UNKNOWN',
          'contract is session-bound but the evaluator has no current session to compare against',
          { ...base, payloadSession: payload.sessionId });
      if (payload.sessionId !== currentSessionId)
        return V('heartbeat', 'FAIL',
          `heartbeat session '${payload.sessionId}' != current '${currentSessionId}' — prior-session carry-over`,
          { ...base, payloadSession: payload.sessionId, currentSession: currentSessionId });
      base.sessionId = payload.sessionId;
    }
    if (pidBound) {
      // accept either field name; workerPid is the precise one-shot form
      const pp = payload.workerPid !== undefined ? payload.workerPid : payload.pid;
      if (expectedPid !== null && expectedPid !== undefined && pp !== expectedPid)
        return V('heartbeat', 'FAIL',
          `heartbeat pid ${pp} != canonical ${comp.id} pid ${expectedPid} — a different generation or a foreign writer`,
          { ...base, payloadPid: pp, expectedPid });
      base.producerPid = pp;
    } else {
      base.producerPid = payload.workerPid !== undefined ? payload.workerPid : payload.pid;
      base.pidBound = false;   // recorded so evidence shows WHY pid was not enforced
    }
    if (payload.producerBuild) base.producerBuild = payload.producerBuild;
  }
  return V('heartbeat', ageSec <= stale ? 'PASS' : 'FAIL',
    `heartbeat ${ageSec}s old (limit ${stale}s)`, base);
}

// ── 3. OUTPUT ────────────────────────────────────────────────────────────────
// Reads the newest RECORD'S OWN ts, never file mtime. After S15R7 the volatility
// process log is kept fresh by the wrapper's failure messages — mtime there is
// satisfied BY failure. A record timestamp cannot be.
// M2E-016D: the bounded re-read needs a synchronous pause. Injectable so tests
// never actually block, and so the 250ms cost is visible rather than hidden.
function sleepFn(ms) {
  if (!ms || ms <= 0) return;
  const end = Date.now() + ms;
  while (Date.now() < end) { /* deliberate synchronous wait */ }
}

function evalOutput(comp, now, fsx, sessionStartMs, previous) {
  const t = comp.target || {};
  const o = t.outputRecord;
  if (!o || typeof o !== 'object')
    return V('output', 'NOT_APPLICABLE', t.healthAuthority || 'no output contract');
  if (t.outputActivation !== 'ACTIVE')
    return V('output', 'NOT_APPLICABLE',
      `output DECLARED but activation=${t.outputActivation || 'PENDING_MIGRATION'} — not an admissible authority this epoch`,
      // R1: represent the source SEMANTICALLY. A redis source has no path.
      o.sourceKind === 'redis'
        ? { sourceKind: 'redis', keyPattern: o.keyPattern, activation: t.outputActivation || 'PENDING_MIGRATION' }
        : { sourceKind: o.sourceKind || 'filesystem', path: o.path, activation: t.outputActivation || 'PENDING_MIGRATION' });

  // M2E-016D — CAUSAL COVERAGE DISPATCH.
  // Routed here, AFTER the activation gate: a PENDING_MIGRATION contract still
  // returns NOT_APPLICABLE above and never reaches this code. The dispatch
  // exists so a future activation ruling has an end-to-end path; it does not
  // itself activate anything.
  //
  // Multi-artifact by nature — it correlates an upstream work source with one
  // coverage leg per producer — so it cannot use the single-artifact provider
  // signature. The registered provider deliberately throws if invoked directly,
  // which is why the format is intercepted here rather than falling through.
  if (o.format === 'causal_coverage') {
    const cc = require('./causal_coverage');
    const work = cc.requiredWork(o.requiredWork, fsx);
    const newestKey = (work.items && work.items.length)
      ? work.items[work.items.length - 1].workKey : undefined;
    const legs = (o.coverageLegs || []).map(spec =>
      cc.readLegWithStability(spec, fsx, sleepFn, {
        reReadDelayMs: o.reReadDelayMs === undefined ? 250 : o.reReadDelayMs,
        newestRequiredKey: newestKey }));
    const r = cc.allRequired(work, legs, { now, processingDeadlineSec: o.processingDeadlineSec });
    // ASYMMETRIC and PENDING are DISTINCT non-failing states, not PASS aliases:
    // 35/35 measured samples showed a 2.17-5.80s sequential-engine window, so
    // ASYMMETRIC is a normal condition and collapsing it would hide a real
    // property of the system.
    return V('output', r.state, r.reason,
      { ...r.evidence, format: 'causal_coverage', activation: 'ACTIVE' });
  }

  // TYPED PROVIDER (M1A-R2). The contract names its reading strategy; a format
  // with no implementation is rejected at LOAD time, so this cannot silently
  // fall back to a strategy the contract did not ask for.
  const provider = providers.get(o.format);
  if (!provider) return V('output', 'FAIL', `no provider implements format '${o.format}'`, { path: o.path, format: o.format });

  let raw = '', st = null;
  // R1: dispatch on the DECLARED sourceKind, not on the format name.
  if (o.sourceKind !== 'redis') {   // file-backed providers only
    try { raw = fsx.readFileSync(o.path, 'utf8'); } catch { return V('output', 'FAIL', 'output file absent', { path: o.path }); }
    try { st = fsx.statSync(o.path); } catch { st = null; }
  }

  const r = provider(raw, o, { mtimeMs: st ? st.mtimeMs : null, previous: previous || null, now, redis: (comp.__ctx && comp.__ctx.redis) || null });

  // ── M2-D-R4: EMPTY-SET SEMANTICS ───────────────────────────────────────
  // NO OBSERVATION YET != STALE OBSERVATION != FAILED PRODUCER.
  // A bursty producer legitimately emits nothing for a long stretch: session
  // 20260903_0255 produced its first EXECUTION_READY ~35 minutes in. Treating
  // an empty set as FAIL collapsed "nothing has happened yet" into "the
  // producer is broken", and reported a working activator as FAILED.
  //
  // This is NOT a threshold problem: with zero records there is no timestamp
  // to age. What CAN be aged is the SESSION, which has an absolute start. So
  // an empty set is UNKNOWN — uncertain, never healthy — until the session has
  // run longer than the contract's declared emptyGraceSec, after which silence
  // becomes a genuine producer failure.
  if (!r.ok && r.evidence && r.evidence.records === 0) {
    const grace = o.emptyGraceSec;
    const sessionAgeSec = sessionStartMs ? Math.floor((now - sessionStartMs) / 1000) : null;
    if (grace === undefined || grace === null)
      return V('output', 'UNKNOWN',
        `no ${o.recordType || 'record'} entries yet and no emptyGraceSec declared — cannot distinguish "not yet observed" from "producer failed"`,
        { path: o.path, format: o.format, records: 0, sessionAgeSec });
    if (sessionAgeSec === null)
      return V('output', 'UNKNOWN', 'empty set and no session start to age against',
        { path: o.path, format: o.format, records: 0 });
    if (sessionAgeSec <= grace)
      return V('output', 'UNKNOWN',
        `no ${o.recordType || 'record'} entries yet — session is ${sessionAgeSec}s old, within the ${grace}s empty-grace window; this is NOT YET OBSERVED, not a failure`,
        { path: o.path, format: o.format, records: 0, sessionAgeSec, emptyGraceSec: grace });
    return V('output', 'FAIL',
      `no ${o.recordType || 'record'} entries after ${sessionAgeSec}s — beyond the ${grace}s empty-grace window, silence is a producer failure`,
      { path: o.path, format: o.format, records: 0, sessionAgeSec, emptyGraceSec: grace });
  }
  if (!r.ok) return V('output', 'FAIL', r.reason, { path: o.path, format: o.format, ...r.evidence });

  // PRIOR-SESSION CONTAMINATION: a global output file keeps records across
  // sessions; a stale one must not read as fresh.
  if (sessionStartMs && r.tsMs < sessionStartMs)
    return V('output', 'FAIL', 'newest evidence predates this session (prior-session contamination)',
      { path: o.path, format: o.format, evidenceTs: new Date(r.tsMs).toISOString(),
        sessionStart: new Date(sessionStartMs).toISOString(), ...r.evidence });

  const ageSec = Math.floor((now - r.tsMs) / 1000);
  const stale = o.staleSec || 300, failed = o.failedSec || 600;
  const state = ageSec <= stale ? 'PASS' : (ageSec <= failed ? 'STALE' : 'FAIL');
  return V('output', state, `newest evidence ${ageSec}s old (stale ${stale}s, failed ${failed}s)`,
    { path: o.path, format: o.format, ageSec, activation: 'ACTIVE', ...r.evidence });
}

function evaluate(comp, ctx) {
  const now = ctx.now, fsx = ctx.fs || fs;
  return {
    componentId: comp.id,
    signals: [
      evalProcess(comp, ctx.probe),
      evalHeartbeat(comp, now, fsx, ctx.probe ? ctx.probe.pidOf(comp.id) : null, ctx.sessionId || null, ctx.sessionStartMs),
      evalOutput(Object.assign(Object.create(Object.getPrototypeOf(comp) || Object.prototype), comp, { __ctx: ctx }), now, fsx, ctx.sessionStartMs, (ctx.previous || {})[comp.id]),
    ],
  };
}
module.exports = { evaluate, evalProcess, evalHeartbeat, evalOutput };
