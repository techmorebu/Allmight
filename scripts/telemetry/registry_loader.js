'use strict';
/**
 * M1A-R1 — registry loader / normalizer. Closes the production chain:
 *
 *   disk registry → validated → normalized health contract → evaluator
 *
 * The frozen M0 registry was authored to be accurate about `current.*` — what
 * the system IS. Its `target.*` fields were declarations of intent, not health
 * contracts: `heartbeat: true` says a heartbeat is wanted, not where it lives;
 * `outputRecord: "activator.jsonl"` names a file, not a freshness contract.
 *
 * This loader makes that distinction ENFORCED rather than implicit. It
 * normalizes what is fully specified and REJECTS what is underspecified, with a
 * reason. A loader that silently invented defaults would reintroduce exactly the
 * failure this redesign exists to remove: a component reported healthy on
 * evidence nobody actually defined.
 */
const fs = require('fs');
const path = require('path');
const providers = require('./providers');

const CONTRACT_VERSION = 'health.contract.v1';
const DEFAULTS = { heartbeatStaleSec: 120, outputStaleSec: 300, outputFailedSec: 600, maxAttempts: 5, cooldownSec: 120 };
const CLASSES = ['RESTARTABLE', 'NOT_RECOVERABLE_BY_SELF', 'SESSION_BOUND'];
// M1A-R2. A DECLARED signal is a target; only an ACTIVE one may fail a component.
const ACTIVATIONS = ['ACTIVE', 'PENDING_MIGRATION'];

function normalizeHeartbeat(c, issues) {
  const t = c.target || {};
  if (t.heartbeatPath) {
    const act = t.heartbeatActivation || 'PENDING_MIGRATION';
    if (!ACTIVATIONS.includes(act)) issues.push({ level: 'INVALID', componentId: c.id,
      field: 'target.heartbeatActivation', msg: `unknown activation '${act}' (expected ${ACTIVATIONS.join('|')})` });
    if (act === 'PENDING_MIGRATION') issues.push({ level: 'PENDING_MIGRATION', componentId: c.id,
      field: 'target.heartbeatPath',
      msg: `heartbeat declared at ${t.heartbeatPath} but its producer is not deployed this epoch — NOT an admissible failure authority` });
    // M2-D: carry the expected producer build through normalization. Dropping
    // it would silently disable payload identity validation while the contract
    // declares it — the evaluator would fall back to mtime-only and PASS a
    // foreign or previous-generation heartbeat.
    // M2-D-R1 — IDENTITY PRESERVATION INVARIANT.
    // An ACTIVE authority must not silently lose a declared identity constraint
    // during normalization. Dropping heartbeatProducerBuild would leave the
    // CONTRACT looking stricter than the EVALUATOR actually is: the contract
    // names an expected build while the evaluator falls back to mtime-only and
    // passes a foreign or previous-generation heartbeat. That is false
    // assurance, so a lost constraint FAILS LOUD rather than degrading to
    // optional behaviour.
    // M2E-004: session/schema/pid-binding join the identity set. An ACTIVE
    // authority losing ANY of these silently would leave the contract stricter
    // than the evaluator — the false-assurance class GOV-CHK closed for build.
    const IDENTITY_FIELDS = ['heartbeatProducerBuild', 'heartbeatSchemaVersion',
                             'heartbeatSessionBound', 'heartbeatPidBound',
                             'heartbeatStartupGraceSec', 'heartbeatCycle',
                             'heartbeatRequireTs'];
    // M2E-016A: the causal contract's identity. Losing processingDeadlineSec or
    // a coverage leg silently would leave the contract stricter than the
    // evaluator — the false-assurance class GOV-CHK closed for producerBuild.
    const OUTPUT_IDENTITY_FIELDS = ['processingDeadlineSec', 'coverage',
                                    'reReadDelayMs', 'reReadAttempts'];
    const out = { heartbeatPath: t.heartbeatPath,
                  heartbeatStaleSec: t.heartbeatStaleSec || DEFAULTS.heartbeatStaleSec,
                  heartbeatActivation: act };
    for (const f of IDENTITY_FIELDS) if (t[f] !== undefined) out[f] = t[f];
    for (const f of IDENTITY_FIELDS) {
      const declared = t[f] !== undefined, preserved = out[f] !== undefined;
      if (declared && !preserved) issues.push({ level: 'INVALID', componentId: c.id, field: `target.${f}`,
        msg: `declared identity constraint '${f}' was LOST during normalization — an ACTIVE authority must not silently weaken` });
      if (act === 'ACTIVE' && declared && !preserved) throw Object.assign(
        new Error(`component '${c.id}': ACTIVE heartbeat lost declared identity '${f}'`), { code: 'IDENTITY_LOST' });
    }
    return out;
  }
  if (t.heartbeat === true) {
    issues.push({ level: 'INCOMPLETE', componentId: c.id, field: 'target.heartbeat',
      msg: 'heartbeat declared true but no heartbeatPath — contract incomplete, signal NOT_APPLICABLE until specified' });
    return {};
  }
  return {};
}

function normalizeOutput(c, issues) {
  const t = c.target || {};
  const o = t.outputRecord;
  if (o === null || o === undefined) return {};
  if (typeof o === 'object') {
    // TYPED PROVIDER (M1A-R2). R1 allowed a contract to CLAIM semantics the
    // evaluator did not implement — the heat contract said "recordType null
    // falls back to line presence" while evalOutput JSON.parsed every line.
    // A format with no provider is now INVALID at load time.
    const fmt = o.format;
    if (!fmt) { issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord.format',
      msg: `no format declared (expected one of ${providers.FORMATS.join('|')}) — the evaluator must not guess a reading strategy` }); return {}; }
    if (!providers.get(fmt)) { issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord.format',
      msg: `format '${fmt}' has NO implemented provider (have ${providers.FORMATS.join('|')}) — a contract may not describe behaviour that does not exist` }); return {}; }
    // M1B-B-R1: required source field is determined by the provider's declared
    // sourceKind, not assumed to be `path`. A redis source has a keyPattern and
    // no path; demanding a path is what let a redis URI be treated as a file.
    const kind = providers.sourceKind(fmt);
    // M2E-016A: a MULTI-PATH format declares its sources through the provider,
    // so the single-`path` requirement does not apply. The paths are still
    // CHECKED — via pathsFrom — so a contract cannot omit them silently. The
    // M1A-R1 guard is unweakened: an unregistered format is still INVALID.
    const provDef = providers.get(fmt);
    if (provDef && provDef.multiPath) {
      const paths = provDef.pathsFrom(o);
      if (!paths.length) {
        issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord',
          msg: `format '${fmt}' is multi-path but declares NO paths` }); return {}; }
      if (o.path) {
        issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord.path',
          msg: `format '${fmt}' is multi-path and must NOT declare a single path` }); return {}; }
      // the early return must NOT skip the activation gate: an implicit
      // undefined would leave the epoch unstated, and PENDING_MIGRATION is a
      // required, EXPLICIT declaration.
      const mact = t.outputActivation || 'PENDING_MIGRATION';
      if (!ACTIVATIONS.includes(mact)) { issues.push({ level: 'INVALID', componentId: c.id,
        field: 'target.outputActivation', msg: `unknown activation '${mact}'` }); return {}; }
      // SAME SHAPE as the single-path return: the causal contract nests under
      // outputRecord, with outputActivation as a sibling. A flat spread would
      // have made `target.outputRecord` undefined, and every downstream check
      // that tests for its presence would silently read the component as
      // having no output contract at all.
      return { outputRecord: { format: fmt, sourceKind: kind, multiPath: true, paths,
                 requiredWork: o.requiredWork, coverageLegs: o.coverageLegs,
                 coverage: o.coverage,
                 processingDeadlineSec: o.processingDeadlineSec,
                 reReadDelayMs: o.reReadDelayMs, reReadAttempts: o.reReadAttempts },
               outputActivation: mact };
    }
    if (kind === 'filesystem' && !o.path) {
      issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord.path',
        msg: `format '${fmt}' is a filesystem source but no path is declared` }); return {}; }
    if (kind === 'redis' && !o.keyPattern) {
      issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord.keyPattern',
        msg: `format '${fmt}' is a redis source but no keyPattern is declared` }); return {}; }
    if (kind === 'redis' && o.path) {
      issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord.path',
        msg: `format '${fmt}' is a redis source and must NOT declare a filesystem path` }); return {}; }
    if (fmt === 'jsonl_record' && o.recordType === undefined)
      issues.push({ level: 'INCOMPLETE', componentId: c.id, field: 'target.outputRecord.recordType',
        msg: 'jsonl_record without an explicit recordType (use null to accept any record type)' });
    const act = t.outputActivation || 'PENDING_MIGRATION';
    if (!ACTIVATIONS.includes(act)) issues.push({ level: 'INVALID', componentId: c.id,
      field: 'target.outputActivation', msg: `unknown activation '${act}'` });
    // M1B-B-R1-R1: the diagnostic must be SOURCE-KIND AWARE. It previously
    // interpolated o.path unconditionally, so a redis source — which correctly
    // has no path — rendered as "output declared at undefined". Provider-aware
    // resolution has to be matched by provider-aware diagnostics: "no path"
    // means no path in the contract, the resolver, the evidence AND the message.
    if (act === 'PENDING_MIGRATION') {
      const sourceValue = kind === 'redis' ? o.keyPattern : o.path;
      issues.push({ level: 'PENDING_MIGRATION', componentId: c.id,
        field: 'target.outputRecord', sourceKind: kind, sourceValue,
        msg: `output ${kind} source '${sourceValue}' is PENDING_MIGRATION — not an admissible authority this epoch` });
    }
    // M2-D-R4: emptyGraceSec bounds how long "no records yet" stays UNKNOWN.
    // Declared per contract because burstiness is a property of the producer.
    const src = kind === 'redis'
      ? { keyPattern: o.keyPattern, ttlSec: o.ttlSec }
      : { path: o.path };
    if (o.emptyGraceSec !== undefined) src.emptyGraceSec = o.emptyGraceSec;
    return { outputRecord: { ...src, format: fmt, sourceKind: kind,
      recordType: o.recordType === undefined ? null : o.recordType,
      staleSec: o.staleSec || DEFAULTS.outputStaleSec, failedSec: o.failedSec || DEFAULTS.outputFailedSec },
      outputActivation: act };
  }
  if (typeof o === 'string') {
    issues.push({ level: 'INCOMPLETE', componentId: c.id, field: 'target.outputRecord',
      msg: `output declared as the bare string '${o}' — no format, recordType or thresholds; contract incomplete` });
    return {};
  }
  issues.push({ level: 'INVALID', componentId: c.id, field: 'target.outputRecord',
    msg: `unsupported outputRecord type '${typeof o}'` });
  return {};
}

/** Produce the EXACT object shape health.js consumes. */
function normalizeComponent(c, issues) {
  const t = c.target || {};
  const cls = t.class || null;
  if (!cls) issues.push({ level: 'INCOMPLETE', componentId: c.id, field: 'target.class',
    msg: 'no restart class — decideAction will return NO_POLICY, loudly' });
  else if (!CLASSES.includes(cls)) issues.push({ level: 'INVALID', componentId: c.id, field: 'target.class',
    msg: `unknown class '${cls}' (expected ${CLASSES.join('|')})` });

  const hb = normalizeHeartbeat(c, issues);
  const out = normalizeOutput(c, issues);
  const norm = {
    id: c.id,
    exec: c.exec,
    current: c.current || {},
    target: { class: cls, ...hb, ...out,
      healthAuthority: t.healthAuthority || null,
      restart: { maxAttempts: (t.restart && t.restart.maxAttempts) || DEFAULTS.maxAttempts,
                 cooldownSec: (t.restart && t.restart.cooldownSec) || DEFAULTS.cooldownSec } },
    contractVersion: CONTRACT_VERSION,
  };
  // A component whose ONLY signal would be `process` cannot be meaningfully
  // healthy — that is the pre-redesign boundary. Surface it explicitly.
  // ACTIVE, not merely declared — this is what the evaluator will actually use.
  const hasHb = norm.target.heartbeatActivation === 'ACTIVE';
  const hasOut = !!norm.target.outputRecord && norm.target.outputActivation === 'ACTIVE';
  if (!hasHb && !hasOut) issues.push({ level: 'PROCESS_ONLY', componentId: c.id, field: 'target',
    msg: 'no ACTIVE heartbeat and no ACTIVE output — health would rest on PID liveness alone this epoch, the exact pre-redesign boundary' });
  norm.healthSignals = ['process', hasHb ? 'heartbeat' : null, hasOut ? 'output' : null].filter(Boolean);
  return norm;
}

/**
 * Merge health contracts over the frozen registry's target.*.
 * The registry stays the identity baseline; contracts supply health specifics.
 * Merge is EXPLICIT and per-component — a contract for an unknown id is an error,
 * not a silent addition.
 */
function mergeContracts(reg, contractsPath, issues) {
  if (!contractsPath || !fs.existsSync(contractsPath)) return reg;
  const cj = JSON.parse(fs.readFileSync(contractsPath, 'utf8'));
  const contracts = cj.contracts || {};
  const ids = new Set(reg.components.map(c => c.id));
  for (const id of Object.keys(contracts))
    if (!ids.has(id)) issues.push({ level: 'INVALID', componentId: id, field: 'contracts',
      msg: `health contract for '${id}' matches no registry component` });
  reg.components = reg.components.map(c => contracts[c.id]
    ? { ...c, target: { ...(c.target || {}), ...contracts[c.id] } } : c);
  return reg;
}

function load(registryPath, opts) {
  const o = opts || {};
  const raw = fs.readFileSync(registryPath, 'utf8');
  let reg; try { reg = JSON.parse(raw); }
  catch (e) { const err = new Error(`registry is not valid JSON: ${e.message}`); err.code = 'REGISTRY_UNPARSABLE'; throw err; }
  if (!Array.isArray(reg.components)) { const e = new Error('registry has no components array'); e.code = 'REGISTRY_SHAPE'; throw e; }
  const ids = reg.components.map(c => c.id);
  if (new Set(ids).size !== ids.length) { const e = new Error('duplicate component ids'); e.code = 'REGISTRY_DUP_ID'; throw e; }
  for (const c of reg.components) if (!c.id) { const e = new Error('component with no id'); e.code = 'REGISTRY_NO_ID'; throw e; }

  const issues = [];
  if (o.contracts) reg = mergeContracts(reg, o.contracts, issues);
  const components = reg.components.map(c => normalizeComponent(c, issues));
  const result = {
    contractVersion: CONTRACT_VERSION,
    source: path.resolve(registryPath),
    components,
    issues,
    counts: {
      total: components.length,
      withHeartbeat: components.filter(c => c.target.heartbeatPath).length,
      withOutput: components.filter(c => c.target.outputRecord).length,
      processOnly: issues.filter(i => i.level === 'PROCESS_ONLY').length,
      pendingMigration: issues.filter(i => i.level === 'PENDING_MIGRATION').length,
      activeHeartbeat: components.filter(c => c.target.heartbeatActivation === 'ACTIVE').length,
      activeOutput: components.filter(c => c.target.outputRecord && c.target.outputActivation === 'ACTIVE').length,
      incomplete: issues.filter(i => i.level === 'INCOMPLETE').length,
      invalid: issues.filter(i => i.level === 'INVALID').length,
    },
  };
  // strict: refuse to hand the evaluator a registry with INVALID entries.
  // INCOMPLETE is permitted and reported — it is the honest current state.
  if (o.strict && result.counts.invalid > 0) {
    const e = new Error(`registry has ${result.counts.invalid} INVALID contract(s)`); e.code = 'REGISTRY_INVALID'; e.issues = issues; throw e;
  }
  if (o.requireComplete && (result.counts.incomplete > 0 || result.counts.processOnly > 0)) {
    const e = new Error(`registry is not health-complete: ${result.counts.incomplete} incomplete, ${result.counts.processOnly} process-only`);
    e.code = 'REGISTRY_NOT_HEALTH_COMPLETE'; e.issues = issues; throw e;
  }
  return result;
}
module.exports = { load, normalizeComponent, mergeContracts, CONTRACT_VERSION, DEFAULTS, CLASSES };
