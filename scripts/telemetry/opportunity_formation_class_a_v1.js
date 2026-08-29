#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * opportunity_formation_class_a_v1  (module v1.1 — Boss C9 patches applied)
 *
 * AllMight Wave 11, c1.5 — Class A Opportunity Formation v1
 *
 * v1.1 PATCHES (Boss C9 2026-08-29):
 *   1. Canonical persistence: naive fs.writeFileSync REPLACED with deterministic
 *      idempotent append (SHA-indexed by structural key). Rerun = 0 duplicates.
 *   2. Class-A scope gate: validate chain=arbitrum + pair='ETH/USDC-RAMSES' +
 *      venue in {ramses_v2, uniswap_v3} BEFORE grouping. Out-of-scope records
 *      IGNORED for emission, counted in run manifest diagnostics.
 *   3. Test suite renamed/expanded: c5 contract vs actual c5 integration
 *      separated. New tests for A17-A23.
 *
 * Boss C9 authorization (2026-08-29):
 *   Structural formation of Class A cross-DEX opportunities from paired c1
 *   observation records. v1 is deliberately structural + fail-closed on
 *   economics.
 *
 * PURPOSE
 *   Read c1's canonical observation stream (data/observations.jsonl).
 *   Group records by blockNumber. For each valid paired block, emit ONE
 *   Class A formation record with the winning direction and full provenance.
 *   For malformed cardinality, emit a rejection record to the run-scoped
 *   rejection channel.
 *
 * INPUT
 *   append-only JSONL (default: data/observations.jsonl)
 *
 * OUTPUT
 *   Canonical stream:  data/formation_class_a_v1.jsonl   (append-only)
 *   Run manifest:      data/formation_sessions/<runId>/manifest.json
 *   Rejections:        data/formation_sessions/<runId>/formation_rejected.json
 *
 * DESIGN LOCKS (Boss C9, cumulative)
 *   NO RPC. NO scheduler. NO gas measurement. NO fixture threshold promotion.
 *   NO sameBlockVerified=true. NO execution. NO broadcast. NO capital path.
 *   NO c1/c1.1/c1.2 changes. NO c5/c6 changes. NO activator changes.
 *
 * v1 STRUCTURAL FAIL-CLOSED (by design):
 *   economic = false                (always in v1)
 *   netEdgeBps = null               (no canonical gas exists yet)
 *   thresholdNetEdgeBps = null      (no canonical threshold exists yet)
 *   sameBlockVerified = false       (S1 rule)
 *
 * Determinism:
 *   Canonical opportunity records are BYTE-IDENTICAL for identical input.
 *   Run-scoped metadata (formationRunId, formedAt wall-clock) lives in the
 *   run manifest, NOT in canonical records.
 *
 * CAPITAL LOCKED. EXECUTION LOCKED. BROADCAST LOCKED.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION       = 'opportunity_formation_class_a_v1';
const REGISTRY_SURFACE_ID  = 'eth_usdc_ramses';
const OPPORTUNITY_CLASS_A  = 'A';

// ─────────────────────────────────────────────────────────────────────────────
// Class-A scope gate (v1.1 patch — Boss C9 Blocker 2)
// Bounded to the sanctioned Ramses × Uniswap ETH/USDC surface on Arbitrum.
// Records outside this scope are IGNORED for emission, counted in diagnostics.
// ─────────────────────────────────────────────────────────────────────────────
const CLASS_A_SCOPE = {
  chain: 'arbitrum',
  pair:  'ETH/USDC-RAMSES',           // observed sanctioned pair value in c1 corpus
  venues: new Set(['ramses_v2', 'uniswap_v3']),
};

function inClassAScope(observation) {
  const inner = observation.recordFromSource;
  if (!inner || typeof inner !== 'object') return false;
  if (inner.chain !== CLASS_A_SCOPE.chain) return false;
  if (inner.pair !== CLASS_A_SCOPE.pair) return false;
  if (!CLASS_A_SCOPE.venues.has(inner.venue)) return false;
  return true;
}

function scopeExclusionReason(observation) {
  const inner = observation.recordFromSource;
  if (!inner || typeof inner !== 'object') return 'no_recordFromSource';
  if (inner.chain !== CLASS_A_SCOPE.chain) return `wrong_chain:${inner.chain}`;
  if (inner.pair !== CLASS_A_SCOPE.pair) return `wrong_pair:${inner.pair}`;
  if (!CLASS_A_SCOPE.venues.has(inner.venue)) return `unrelated_venue:${inner.venue}`;
  return 'unknown';
}

// Router-canonical surfaceId construction — matches buildRouterId() semantics
// for pair opportunities: chain:asset1-asset2:venue-sorted>venue-sorted
function buildRouterCanonicalSurfaceId(chain, assets, venues) {
  const sortedVenues = [...venues].sort();
  return `${chain}:${assets.join('-')}:${sortedVenues.join('>')}`;
}

// Class A canonical surfaceId for Ramses × Uniswap ETH/USDC on Arbitrum
const CANONICAL_SURFACE_ID = buildRouterCanonicalSurfaceId(
  'arbitrum', ['WETH', 'USDC'], ['ramses_v2', 'uniswap_v3']
);
// → 'arbitrum:WETH-USDC:ramses_v2>uniswap_v3'

// ─────────────────────────────────────────────────────────────────────────────
// Corpus loader — reads c1 observations (envelope wrapper + recordFromSource)
// ─────────────────────────────────────────────────────────────────────────────

function loadObservations(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`observations corpus not found: ${inputPath}`);
  }
  const raw = fs.readFileSync(inputPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch (e) {
      throw new Error(`invalid JSON at line ${i + 1}: ${e.message}`);
    }
    if (!rec.recordFromSource || typeof rec.recordFromSource !== 'object') {
      throw new Error(`line ${i + 1}: missing recordFromSource envelope`);
    }
    if (typeof rec.recordFromSource.blockNumber !== 'number') {
      throw new Error(`line ${i + 1}: missing blockNumber in recordFromSource`);
    }
    if (typeof rec.recordFromSource.venue !== 'string') {
      throw new Error(`line ${i + 1}: missing venue in recordFromSource`);
    }
    records.push(rec);
  }
  return records;
}

// ─────────────────────────────────────────────────────────────────────────────
// Group observations by blockNumber (each block gets an array of records)
// ─────────────────────────────────────────────────────────────────────────────

function groupByBlock(observations) {
  const groups = new Map();
  for (const obs of observations) {
    const block = obs.recordFromSource.blockNumber;
    if (!groups.has(block)) groups.set(block, []);
    groups.get(block).push(obs);
  }
  // Deterministic block order: numeric ascending
  return new Map([...groups.entries()].sort((a, b) => a[0] - b[0]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Cardinality classification
// ─────────────────────────────────────────────────────────────────────────────

function classifyGroup(observations) {
  const venues = observations.map(o => o.recordFromSource.venue);
  const uniqueVenues = [...new Set(venues)];

  if (venues.length === uniqueVenues.length && venues.length === 2) {
    return { kind: 'paired', observations };
  }
  if (venues.length === 1) {
    return { kind: 'one_sided', observations };
  }
  if (venues.length !== uniqueVenues.length) {
    // Any duplicate venue → reject entire group (Boss R6/U1)
    const duplicates = venues.filter((v, i) => venues.indexOf(v) !== i);
    return {
      kind: 'duplicate_venue',
      observations,
      duplicateVenue: duplicates[0] || null,
      recordCount: venues.length,
    };
  }
  // Cardinality other than 1 or 2 with distinct venues (e.g. 3 different venues)
  // treated as unexpected structure; reject to preserve c5 denominator integrity
  return {
    kind: 'unexpected_cardinality',
    observations,
    recordCount: venues.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance array construction with field-specific conflict flagging (R7 P1 + Patch 6)
// ─────────────────────────────────────────────────────────────────────────────

// FATAL fields (per Boss ruling): mismatch fails-close at record level
const FATAL_PROVENANCE_FIELDS = ['sourceProcess', 'sourceSchemaVersion'];
// NON-FATAL fields: mismatch flagged but does not block economic determination
const NONFATAL_PROVENANCE_FIELDS = ['sourcePath', 'sourceSha256AtOpen'];
// LEGITIMATELY DIFFERENT: preserved but not counted as conflict
const ALLOWED_DIFF_FIELDS = ['observerRunId'];

function buildProvenance(observations) {
  const sources = observations.map(o => ({
    venue:               o.recordFromSource.venue,
    observerRunId:       o.observerRunId ?? null,
    sourceProcess:       o.sourceProcess ?? null,
    sourceSchemaVersion: o.sourceSchemaVersion ?? null,
    sourceSha256AtOpen:  o.sourceSha256AtOpen ?? null,
    sourcePath:          o.sourcePath ?? null,
    sourceRef:           o.recordFromSource.sourceRef ?? null,
    ts:                  o.recordFromSource.ts ?? null,
  }));

  const conflictReasons = [];
  let conflictFatal = false;

  if (sources.length >= 2) {
    for (const field of FATAL_PROVENANCE_FIELDS) {
      const values = [...new Set(sources.map(s => s[field]))];
      if (values.length > 1) {
        conflictReasons.push(`${field}_mismatch`);
        conflictFatal = true;
      }
    }
    for (const field of NONFATAL_PROVENANCE_FIELDS) {
      const values = [...new Set(sources.map(s => s[field]))];
      if (values.length > 1) {
        conflictReasons.push(`${field}_mismatch`);
        // does NOT set conflictFatal
      }
    }
    // ALLOWED_DIFF_FIELDS intentionally not checked (legitimate differences)
  }

  return {
    sources,
    provenanceConflict:         conflictReasons.length > 0,
    provenanceConflictReasons:  conflictReasons,
    provenanceConflictFatal:    conflictFatal,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reason accumulation (deterministic ordered array)
// ─────────────────────────────────────────────────────────────────────────────

// Canonical ordering per Boss ruling; formation reasons only (NOT execution enum)
const REASON_ORDER = [
  'partner_missing',
  'provenance_conflict',
  'depth_missing',
  'gas_unavailable',
  'threshold_unavailable',
  'spread_zero',
  'spread_negative',
];

function orderReasons(reasons) {
  const set = new Set(reasons);
  return REASON_ORDER.filter(r => set.has(r));
}

// ─────────────────────────────────────────────────────────────────────────────
// Formation: paired block → one winning-direction record
// ─────────────────────────────────────────────────────────────────────────────

function formPaired(observations) {
  // observations.length === 2, distinct venues
  const [a, b] = observations;
  const priceA = a.recordFromSource.price;
  const priceB = b.recordFromSource.price;

  const reasons = [];

  // Determine direction: buy at lower price venue, sell at higher price venue
  let buyObs, sellObs, grossSpreadBps;

  if (priceA === priceB) {
    // Zero spread — per Boss LOCK: venues null, spread_zero reason
    buyObs = null;
    sellObs = null;
    grossSpreadBps = 0;
    reasons.push('spread_zero');
  } else if (priceA < priceB) {
    buyObs = a;
    sellObs = b;
    const avg = (priceA + priceB) / 2;
    grossSpreadBps = ((priceB - priceA) / avg) * 10000;
  } else {
    // priceB < priceA
    buyObs = b;
    sellObs = a;
    const avg = (priceA + priceB) / 2;
    grossSpreadBps = ((priceA - priceB) / avg) * 10000;
  }

  // Sum fees (deterministic — sum of both venues' feeBps)
  const feeA = a.recordFromSource.feeBps;
  const feeB = b.recordFromSource.feeBps;
  const totalFeeBps = (typeof feeA === 'number' && typeof feeB === 'number')
    ? feeA + feeB
    : null;

  // Depth check — if EITHER venue has null depth, depth_missing (per R2)
  const depthA = a.recordFromSource.depthMinUsd;
  const depthB = b.recordFromSource.depthMinUsd;
  if (depthA === null || depthB === null || depthA === undefined || depthB === undefined) {
    reasons.push('depth_missing');
  }

  // Gas always unavailable in v1 (Boss G-Now, no canonical gas)
  reasons.push('gas_unavailable');

  // Threshold always unavailable in v1 (Boss THR-C, no canonical threshold)
  reasons.push('threshold_unavailable');

  // Provenance
  const prov = buildProvenance(observations);
  if (prov.provenanceConflictFatal) {
    reasons.push('provenance_conflict');
  }

  return {
    formationVariant: 'paired',
    block: a.recordFromSource.blockNumber,
    buyVenue:  buyObs ? buyObs.recordFromSource.venue : null,
    sellVenue: sellObs ? sellObs.recordFromSource.venue : null,
    buyPrice:  buyObs ? buyObs.recordFromSource.price : null,
    sellPrice: sellObs ? sellObs.recordFromSource.price : null,
    buyFeeBps:  buyObs ? buyObs.recordFromSource.feeBps : null,
    sellFeeBps: sellObs ? sellObs.recordFromSource.feeBps : null,
    grossSpreadBps,
    totalFeeBps,
    observedAt: a.recordFromSource.ts ?? null,
    provenance: prov,
    reasons,
    candidate: true,
    // NOTE: economic is always false in v1 (deterministic by design)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Formation: one_sided → non-candidate observation record
// ─────────────────────────────────────────────────────────────────────────────

function formOneSided(observations) {
  const [only] = observations;
  const prov = buildProvenance(observations);
  const reasons = ['partner_missing'];
  if (prov.provenanceConflictFatal) reasons.push('provenance_conflict');

  return {
    formationVariant: 'one_sided',
    block: only.recordFromSource.blockNumber,
    presentVenue:  only.recordFromSource.venue,
    presentPrice:  only.recordFromSource.price,
    presentFeeBps: only.recordFromSource.feeBps,
    presentDepthMinUsd: only.recordFromSource.depthMinUsd ?? null,
    observedAt:    only.recordFromSource.ts ?? null,
    provenance:    prov,
    reasons,
    candidate: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit canonical record (deterministic, no run-scoped fields)
// ─────────────────────────────────────────────────────────────────────────────

function emitCanonicalRecord(formation) {
  // Common fields for both paired + one_sided variants
  const base = {
    schemaVersion:      SCHEMA_VERSION,
    formationVariant:   formation.formationVariant,
    block:              formation.block,
    surfaceId:          CANONICAL_SURFACE_ID,
    registrySurfaceId:  REGISTRY_SURFACE_ID,
    candidate:          formation.candidate,
    economic:           false,
    netEdgeBps:         null,
    thresholdNetEdgeBps: null,
    observedAt:         formation.observedAt,
    opportunityClass:   [OPPORTUNITY_CLASS_A],
    bindingConstraint:  null,
    sameBlockVerified:  false,
    ineligibleReasons:  orderReasons(formation.reasons),
    sourceObservationRefs: formation.provenance.sources.map(s => ({
      venue: s.venue,
      ts:    s.ts,
    })),
    provenance:         formation.provenance,
    provenanceConflict: formation.provenance.provenanceConflict,
  };

  if (formation.formationVariant === 'paired') {
    base.buyVenue        = formation.buyVenue;
    base.sellVenue       = formation.sellVenue;
    base.buyPrice        = formation.buyPrice;
    base.sellPrice       = formation.sellPrice;
    base.buyFeeBps       = formation.buyFeeBps;
    base.sellFeeBps      = formation.sellFeeBps;
    base.grossSpreadBps  = formation.grossSpreadBps;
    base.feeBps          = formation.totalFeeBps;
  } else {
    // one_sided
    base.presentVenue        = formation.presentVenue;
    base.presentPrice        = formation.presentPrice;
    base.presentFeeBps       = formation.presentFeeBps;
    base.presentDepthMinUsd  = formation.presentDepthMinUsd;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rejection record (for duplicate_venue and unexpected_cardinality)
// ─────────────────────────────────────────────────────────────────────────────

function emitRejectionRecord(block, group) {
  return {
    channel:    'formation_rejection',
    block,
    reason:     group.kind === 'duplicate_venue' ? 'duplicate_venue' : 'unexpected_cardinality',
    recordCount: group.recordCount ?? group.observations.length,
    duplicateVenue: group.duplicateVenue ?? null,
    sourceObservationCount: group.observations.length,
    hint: group.kind === 'duplicate_venue'
      ? 'activator bug — venue observed twice for same block'
      : `unexpected cardinality (${group.observations.length} records with ${new Set(group.observations.map(o => o.recordFromSource.venue)).size} distinct venues)`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main formation pipeline (deterministic)
// ─────────────────────────────────────────────────────────────────────────────

function runFormation(observations) {
  // v1.1 scope gate — filter to Class-A eligible observations BEFORE grouping
  // Out-of-scope records are IGNORED for emission but counted in diagnostics
  const inScope = [];
  const scopeExclusions = {
    total: 0,
    byReason: {},
    exampleRecordsPerReason: {},
  };
  for (const obs of observations) {
    if (inClassAScope(obs)) {
      inScope.push(obs);
    } else {
      const reason = scopeExclusionReason(obs);
      scopeExclusions.total += 1;
      scopeExclusions.byReason[reason] = (scopeExclusions.byReason[reason] || 0) + 1;
      // Preserve up to 3 example excluded records per reason for diagnostics
      if (!scopeExclusions.exampleRecordsPerReason[reason]) {
        scopeExclusions.exampleRecordsPerReason[reason] = [];
      }
      if (scopeExclusions.exampleRecordsPerReason[reason].length < 3) {
        scopeExclusions.exampleRecordsPerReason[reason].push({
          blockNumber: obs.recordFromSource?.blockNumber ?? null,
          venue:       obs.recordFromSource?.venue ?? null,
          pair:        obs.recordFromSource?.pair ?? null,
          chain:       obs.recordFromSource?.chain ?? null,
        });
      }
    }
  }

  const groups = groupByBlock(inScope);
  const canonicalRecords = [];
  const rejections = [];

  for (const [block, observationsForBlock] of groups) {
    const classified = classifyGroup(observationsForBlock);
    if (classified.kind === 'paired') {
      const formation = formPaired(classified.observations);
      canonicalRecords.push(emitCanonicalRecord(formation));
    } else if (classified.kind === 'one_sided') {
      const formation = formOneSided(classified.observations);
      canonicalRecords.push(emitCanonicalRecord(formation));
    } else {
      // duplicate_venue or unexpected_cardinality → rejection channel only
      rejections.push(emitRejectionRecord(block, classified));
    }
  }

  return { canonicalRecords, rejections, scopeExclusions };
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization — deterministic JSON (stable key order via Object.keys default)
// ─────────────────────────────────────────────────────────────────────────────

function serializeRecord(rec) {
  // JSON.stringify preserves insertion order in Node; canonical records built
  // with identical key order → byte-identical output
  return JSON.stringify(rec);
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O — write canonical stream + run manifest + rejections
// ─────────────────────────────────────────────────────────────────────────────

function generateRunId(seed) {
  // Deterministic runId when seed provided (for replay tests); wall-clock otherwise
  if (seed) return `FORM_${seed}`;
  const now = new Date();
  const ts = now.toISOString().replace(/[-:.]/g, '').substring(0, 15);
  const rand = crypto.randomBytes(3).toString('hex');
  return `FORM_${ts}_${rand}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// I/O — idempotent append to canonical stream (v1.1 patch — Boss C9 Blocker 1)
//
// Semantics:
//   - Canonical stream data/formation_class_a_v1.jsonl is APPEND-ONLY.
//   - Rerunning identical source corpus appends ZERO duplicates.
//   - Extending source corpus appends only NEW records.
//   - Existing canonical rows are NEVER modified or overwritten.
//   - Malformed/rejected groups do not disturb existing canonical data.
//
// Idempotency key = (formationVariant, block, presentVenue|null, buyVenue|null,
//                    sellVenue|null, grossSpreadBps|null, ineligibleReasons.join)
// This tuple is deterministic across runs for the same input observations.
// ─────────────────────────────────────────────────────────────────────────────

function canonicalIdempotencyKey(record) {
  // Include only structurally-derived fields — these are deterministic given input
  return JSON.stringify([
    record.formationVariant,
    record.block,
    record.formationVariant === 'paired'
      ? [record.buyVenue, record.sellVenue, record.grossSpreadBps]
      : [record.presentVenue, record.presentPrice, record.presentFeeBps],
    record.ineligibleReasons.slice().sort(),
    record.provenanceConflict,
  ]);
}

function loadExistingCanonicalKeys(outputPath) {
  if (!fs.existsSync(outputPath)) return new Set();
  const raw = fs.readFileSync(outputPath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const keys = new Set();
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch (e) {
      throw new Error(`existing canonical stream corrupted at line ${i + 1}: ${e.message}. `
                    + `Refusing to modify. Investigate ${outputPath} manually.`);
    }
    keys.add(canonicalIdempotencyKey(rec));
  }
  return keys;
}

function appendCanonicalStreamIdempotent(records, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existingKeys = loadExistingCanonicalKeys(outputPath);
  const newRecords = records.filter(r => !existingKeys.has(canonicalIdempotencyKey(r)));

  if (newRecords.length === 0) {
    return { appended: 0, alreadyPresent: records.length };
  }

  const content = newRecords.map(serializeRecord).join('\n') + '\n';
  fs.appendFileSync(outputPath, content, 'utf8');

  return { appended: newRecords.length, alreadyPresent: records.length - newRecords.length };
}

function writeRunManifest(manifestPath, runId, inputPath, outputPath, records, rejections, formedAt, scopeExclusions, appendResult) {
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    schemaVersion:     'formation_run_manifest_v1',
    formationRunId:    runId,
    formedAt:          formedAt,
    inputPath,
    outputPath,
    recordsFormed:     records.length,
    rejectionsProduced: rejections.length,
    variants: {
      paired:    records.filter(r => r.formationVariant === 'paired').length,
      one_sided: records.filter(r => r.formationVariant === 'one_sided').length,
    },
    scopeExclusions:   scopeExclusions ?? { total: 0, byReason: {}, exampleRecordsPerReason: {} },
    canonicalAppend:   appendResult ?? { appended: 0, alreadyPresent: 0 },
    module:   SCHEMA_VERSION,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}

function writeRejections(rejPath, rejections) {
  const dir = path.dirname(rejPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(rejPath, JSON.stringify({
    schemaVersion: 'formation_rejections_v1',
    rejections,
  }, null, 2) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    input:  'data/observations.jsonl',
    output: 'data/formation_class_a_v1.jsonl',
    sessionsDir: 'data/formation_sessions',
    runIdSeed: null,       // deterministic runId for replay tests
    formedAtSeed: null,    // deterministic formedAt for replay tests
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input' && i + 1 < argv.length) args.input = argv[++i];
    else if (a === '--output' && i + 1 < argv.length) args.output = argv[++i];
    else if (a === '--sessions-dir' && i + 1 < argv.length) args.sessionsDir = argv[++i];
    else if (a === '--run-id-seed' && i + 1 < argv.length) args.runIdSeed = argv[++i];
    else if (a === '--formed-at-seed' && i + 1 < argv.length) args.formedAtSeed = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv.slice(2));

  let observations;
  try {
    observations = loadObservations(args.input);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }

  const { canonicalRecords, rejections, scopeExclusions } = runFormation(observations);

  const runId = generateRunId(args.runIdSeed);
  const formedAt = args.formedAtSeed || new Date().toISOString();
  const sessionDir = path.join(args.sessionsDir, runId);
  const manifestPath = path.join(sessionDir, 'manifest.json');
  const rejPath = path.join(sessionDir, 'formation_rejected.json');

  if (args.dryRun) {
    process.stdout.write(JSON.stringify({
      dryRun: true,
      wouldProduce: {
        canonicalRecords: canonicalRecords.length,
        rejections: rejections.length,
        scopeExclusions: scopeExclusions,
        outputPath: args.output,
        manifestPath,
        rejectionsPath: rejPath,
      }
    }, null, 2) + '\n');
    process.exit(0);
  }

  const appendResult = appendCanonicalStreamIdempotent(canonicalRecords, args.output);
  writeRunManifest(manifestPath, runId, args.input, args.output, canonicalRecords, rejections, formedAt, scopeExclusions, appendResult);
  writeRejections(rejPath, rejections);

  process.stderr.write(`c1.5 v1.1 formation complete\n`);
  process.stderr.write(`  input:                    ${args.input}\n`);
  process.stderr.write(`  observations read:        ${observations.length}\n`);
  process.stderr.write(`  in-scope observations:    ${observations.length - scopeExclusions.total}\n`);
  process.stderr.write(`  out-of-scope excluded:    ${scopeExclusions.total}\n`);
  if (scopeExclusions.total > 0) {
    for (const [reason, count] of Object.entries(scopeExclusions.byReason)) {
      process.stderr.write(`    ${reason}: ${count}\n`);
    }
  }
  process.stderr.write(`  canonical records formed: ${canonicalRecords.length}\n`);
  process.stderr.write(`    paired:                 ${canonicalRecords.filter(r => r.formationVariant === 'paired').length}\n`);
  process.stderr.write(`    one_sided:              ${canonicalRecords.filter(r => r.formationVariant === 'one_sided').length}\n`);
  process.stderr.write(`  rejections:               ${rejections.length}\n`);
  process.stderr.write(`  canonical stream: (idempotent append)\n`);
  process.stderr.write(`    new records appended:   ${appendResult.appended}\n`);
  process.stderr.write(`    already present (skipped): ${appendResult.alreadyPresent}\n`);
  process.stderr.write(`  output:                   ${args.output}\n`);
  process.stderr.write(`  manifest:                 ${manifestPath}\n`);
  process.stderr.write(`  rejections file:          ${rejPath}\n`);
  process.stderr.write(`  runId:                    ${runId}\n`);
  process.stderr.write(`\n`);
  process.stderr.write(` v1.1 STRUCTURAL FORMATION. Economics deliberately fail-closed.\n`);
  process.stderr.write(` Canonical stream is APPEND-ONLY. Deterministic idempotent.\n`);
  process.stderr.write(` Capital LOCKED. Execution LOCKED. Broadcast LOCKED.\n`);
}

// Exports for tests
module.exports = {
  SCHEMA_VERSION,
  CANONICAL_SURFACE_ID,
  REGISTRY_SURFACE_ID,
  REASON_ORDER,
  FATAL_PROVENANCE_FIELDS,
  NONFATAL_PROVENANCE_FIELDS,
  CLASS_A_SCOPE,
  inClassAScope,
  scopeExclusionReason,
  buildRouterCanonicalSurfaceId,
  loadObservations,
  groupByBlock,
  classifyGroup,
  buildProvenance,
  orderReasons,
  formPaired,
  formOneSided,
  emitCanonicalRecord,
  emitRejectionRecord,
  runFormation,
  serializeRecord,
  generateRunId,
  canonicalIdempotencyKey,
  loadExistingCanonicalKeys,
  appendCanonicalStreamIdempotent,
};

// Run CLI when invoked directly
if (require.main === module) {
  main(process.argv);
}
