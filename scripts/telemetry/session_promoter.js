#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1 — session_promoter.js
 *
 * Reads an observer's staged JSONL file and promotes valid records to the
 * canonical data/observations.jsonl file. Validation is CONTENT-NEUTRAL —
 * only schema and integrity are enforced. Records with unfavorable
 * economic outcomes still pass and are promoted (Boss C9: "the validator
 * has no view of what makes an observation 'good' or 'bad'").
 *
 * DOES NOT:
 *   - Modify staged file
 *   - Modify activator or source data
 *   - Broadcast, execute, or touch RPC
 *   - Emit anything about content quality (spread, netEdge, profitability)
 *
 * Boss C9 explicit rules:
 *   - Fails closed on schema/integrity ONLY (never on content)
 *   - Batch either fully promotes or fully rejects (no partial promotion
 *     without rejection of the rest)
 *   - The observer must record its own start/stop; if manifest lacks
 *     stoppedAtIso, promoter refuses (session incomplete)
 *   - Once promoted, staged file is preserved (audit trail)
 *
 * Usage:
 *   node scripts/telemetry/session_promoter.js \
 *        --observer-run-id <id> \
 *        [--canonical-path data/observations.jsonl]
 *
 * Exit codes:
 *   0 = promotion successful, all records promoted
 *   1 = invalid arguments
 *   2 = observer run dir or manifest missing
 *   3 = session incomplete (observer never wrote stoppedAtIso)
 *   4 = schema/integrity failure — batch rejected atomically
 *   5 = canonical path write failure
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROMOTER_SCHEMA_VERSION = '1';

// Required top-level fields for a promotable wrapped observation
const REQUIRED_WRAPPER_FIELDS = [
  'telemetrySource',
  'sourceProcess',
  'sourceSchemaVersion',
  'chain',
  'sourcePath',
  'sourceSha256AtOpen',
  'observerRunId',
  'observerSchemaVersion',
  'readAtUnixTime',
  'recordFromSource'
];

function parseArgs(argv) {
  const args = { observerRunId: null, canonicalPath: 'data/observations.jsonl' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--observer-run-id' && i + 1 < argv.length) args.observerRunId = argv[++i];
    else if (a === '--canonical-path' && i + 1 < argv.length) args.canonicalPath = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('unknown arg:', a); process.exit(1); }
  }
  if (!args.observerRunId) { console.error('--observer-run-id required'); process.exit(1); }
  return args;
}

function printHelp() {
  console.log(`Wave 11 c1 — session_promoter.js
Usage:
  node scripts/telemetry/session_promoter.js --observer-run-id <id> \\
       [--canonical-path data/observations.jsonl]

Validation is content-neutral. Records are accepted or rejected based on
schema/integrity only, never on economic outcome.
`);
}

function validateWrappedRecord(record) {
  const reasons = [];
  if (typeof record !== 'object' || record === null) {
    reasons.push('record is not an object');
    return { ok: false, reasons };
  }
  // Rejection records (from observer) are NOT promoted, but their presence
  // is not an error either — they are staging noise, filtered out here.
  if (record.rejection === true) return { ok: false, filterReason: 'observer_rejection' };

  for (const f of REQUIRED_WRAPPER_FIELDS) {
    if (!(f in record)) reasons.push(`missing field: ${f}`);
  }
  if (record.telemetrySource !== 'LIVE' && record.telemetrySource !== 'FIXTURE') {
    reasons.push(`unexpected telemetrySource: ${record.telemetrySource}`);
  }
  if (typeof record.recordFromSource !== 'object' || record.recordFromSource === null) {
    reasons.push('recordFromSource must be an object');
  }
  return { ok: reasons.length === 0, reasons };
}

async function main() {
  const args = parseArgs(process.argv);
  const observerDir = path.resolve(REPO_ROOT, 'data', 'telemetry_sessions', args.observerRunId);
  const manifestPath = path.join(observerDir, 'manifest.json');
  const stagedPath = path.join(observerDir, 'observations_staged.jsonl');
  const canonicalPath = path.resolve(REPO_ROOT, args.canonicalPath);

  console.error(`─── Wave 11 c1 session_promoter ───`);
  console.error(`observerRunId: ${args.observerRunId}`);
  console.error(`observer dir:  ${observerDir}`);
  console.error(`canonical:     ${canonicalPath}`);

  if (!fs.existsSync(observerDir)) {
    console.error(`✗ observer dir missing: ${observerDir}`);
    process.exit(2);
  }
  if (!fs.existsSync(manifestPath)) {
    console.error(`✗ manifest missing: ${manifestPath}`);
    process.exit(2);
  }
  if (!fs.existsSync(stagedPath)) {
    console.error(`✗ staged file missing: ${stagedPath}`);
    process.exit(2);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // Boss C9: session must be complete (observer wrote stoppedAtIso)
  if (!manifest.stoppedAtIso) {
    console.error(`✗ session incomplete: manifest lacks stoppedAtIso`);
    console.error(`  Observer never recorded clean stop. Refusing to promote.`);
    process.exit(3);
  }
  console.error(`✓ session complete (stopped ${manifest.stoppedAtIso})`);

  // First pass: read all records into memory, validate all before writing.
  // This gives us Boss's "batch fully promotes or fully rejects" semantics.
  const linesRaw = fs.readFileSync(stagedPath, 'utf8').split('\n').filter(Boolean);
  const validRecords = [];
  const rejections = [];
  const filtered = [];

  for (let i = 0; i < linesRaw.length; i++) {
    const line = linesRaw[i];
    let record;
    try { record = JSON.parse(line); }
    catch (e) {
      rejections.push({ line_no: i + 1, reason: `json_parse: ${e.message}` });
      continue;
    }
    const v = validateWrappedRecord(record);
    if (v.filterReason) { filtered.push({ line_no: i + 1, reason: v.filterReason }); continue; }
    if (!v.ok) {
      rejections.push({ line_no: i + 1, reason: v.reasons.join('; ') });
      continue;
    }
    validRecords.push(record);
  }

  console.error(`  lines read:       ${linesRaw.length}`);
  console.error(`  observer rejects: ${filtered.length}`);
  console.error(`  schema/integrity failures: ${rejections.length}`);
  console.error(`  valid records:    ${validRecords.length}`);

  if (rejections.length > 0) {
    console.error(`✗ schema/integrity failures found — batch rejected atomically`);
    console.error(`  First 5 failures:`);
    for (const r of rejections.slice(0, 5)) {
      console.error(`    line ${r.line_no}: ${r.reason}`);
    }
    // Write a rejection report for audit
    const rejReportPath = path.join(observerDir, 'promotion_rejected.json');
    fs.writeFileSync(rejReportPath, JSON.stringify({
      promoterSchemaVersion: PROMOTER_SCHEMA_VERSION,
      observerRunId: args.observerRunId,
      failedAtUnixTime: Math.floor(Date.now() / 1000),
      rejections,
      filteredCount: filtered.length,
      validRecordCount: validRecords.length,
      canonicalPath: args.canonicalPath
    }, null, 2));
    console.error(`  full rejection report: ${rejReportPath}`);
    process.exit(4);
  }

  // All valid — append to canonical, atomically (write to temp + rename)
  const canonicalDir = path.dirname(canonicalPath);
  fs.mkdirSync(canonicalDir, { recursive: true });

  const tmpPath = canonicalPath + `.promoting.${args.observerRunId}.tmp`;
  const existingContent = fs.existsSync(canonicalPath)
    ? fs.readFileSync(canonicalPath, 'utf8') : '';

  const newContent = existingContent +
    validRecords.map(r => JSON.stringify(r)).join('\n') +
    (validRecords.length > 0 ? '\n' : '');

  try {
    fs.writeFileSync(tmpPath, newContent);
    fs.renameSync(tmpPath, canonicalPath);
  } catch (e) {
    console.error(`✗ canonical write failed: ${e.message}`);
    try { fs.unlinkSync(tmpPath); } catch {}
    process.exit(5);
  }

  const canonicalSha = crypto.createHash('sha256')
    .update(fs.readFileSync(canonicalPath))
    .digest('hex');

  // Write promotion report for audit trail
  const promotionReportPath = path.join(observerDir, 'promotion_success.json');
  fs.writeFileSync(promotionReportPath, JSON.stringify({
    promoterSchemaVersion: PROMOTER_SCHEMA_VERSION,
    observerRunId: args.observerRunId,
    promotedAtUnixTime: Math.floor(Date.now() / 1000),
    canonicalPath: args.canonicalPath,
    canonicalShaAfterPromotion: canonicalSha,
    recordsPromoted: validRecords.length,
    observerFiltered: filtered.length,
    stagedLinesRead: linesRaw.length
  }, null, 2));

  console.error(`✓ promoted ${validRecords.length} records to ${args.canonicalPath}`);
  console.error(`✓ canonical SHA: ${canonicalSha}`);
  console.error(`✓ audit report:  ${promotionReportPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
