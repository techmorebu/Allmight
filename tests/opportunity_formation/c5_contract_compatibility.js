#!/usr/bin/env node
/*
 * c5_contract_compatibility.js  (v1.1 — renamed from c5_unchanged_consumption.js)
 *
 * FAST UNIT TEST that replicates c5's loadCorpus() + groupBySurface() logic
 * against c1.5 output. This is a SCHEMA CONTRACT test — NOT an actual c5
 * integration test. Per Boss C9 v1.1 clarification, the real integration
 * proof is in c5_integration.js (executes actual opportunity_persistence.js).
 *
 * This test verifies c1.5 output satisfies c5's contract without needing
 * a running repo. Useful for quick unit-testing.
 *
 * c5's validation logic (from opportunity_persistence.js:64-88):
 *   if (typeof rec.block !== 'number')       throw new Error("missing 'block' field");
 *   if (typeof rec.surfaceId !== 'string')   throw new Error("missing 'surfaceId' field");
 *   if (typeof rec.candidate !== 'boolean')  throw new Error("missing 'candidate' boolean field");
 *   if (typeof rec.economic !== 'boolean')   throw new Error("missing 'economic' boolean field");
 *
 * This test replicates that exact validation against c1.5 output.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(__dirname, '..', '..', 'scripts', 'telemetry', 'opportunity_formation_class_a_v1.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'c15_c5_'));

function replicateC5LoadCorpus(inputPath) {
  if (!fs.existsSync(inputPath)) throw new Error(`corpus not found at ${inputPath}`);
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
    // EXACT c5 validation logic
    if (typeof rec.block !== 'number')      throw new Error(`line ${i+1}: missing 'block' field`);
    if (typeof rec.surfaceId !== 'string')  throw new Error(`line ${i+1}: missing 'surfaceId' field`);
    if (typeof rec.candidate !== 'boolean') throw new Error(`line ${i+1}: missing 'candidate' boolean field`);
    if (typeof rec.economic !== 'boolean')  throw new Error(`line ${i+1}: missing 'economic' boolean field`);
    records.push(rec);
  }
  return records;
}

function replicateC5GroupBySurface(records) {
  const groups = new Map();
  for (const rec of records) {
    const key = rec.routeId || rec.surfaceId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }
  return groups;
}

const FIXTURES = [
  'positive_spread_paired.jsonl',
  'reverse_spread_paired.jsonl',
  'zero_spread_paired.jsonl',
  'one_sided_missing_partner.jsonl',
  'depth_null_ramses_side.jsonl',
  'provenance_conflict_fatal.jsonl',
  'provenance_conflict_nonfatal.jsonl',
];

let PASSED = 0;
let FAILED = 0;

console.log('══════════════════════════════════════════════════════════════════════');
console.log(' c5 CONTRACT COMPATIBILITY (schema unit test, not integration proof)');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('');
console.log(' Replicates c5 loadCorpus() validation on c1.5 output.');
console.log(' NO modification to c5. Just verifies output passes c5\'s contract.');
console.log('');

for (const fixture of FIXTURES) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `out_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `sessions_${suffix}`);

  const args = ['node', MODULE_PATH, '--input', path.join(FIXTURES_DIR, fixture), '--output', outFile, '--sessions-dir', sessionsDir];
  try {
    execSync(args.join(' '), { stdio: 'pipe' });
    const validated = replicateC5LoadCorpus(outFile);
    const grouped = replicateC5GroupBySurface(validated);
    console.log(`  ✓ ${fixture}: c5 accepts ${validated.length} records, grouped into ${grouped.size} surface(s)`);
    PASSED++;
  } catch (e) {
    console.log(`  ✗ ${fixture}: c5 rejected: ${e.message}`);
    FAILED++;
  }
}

console.log('');
console.log(`  ${PASSED}/${PASSED + FAILED} fixtures pass c5's exact validation contract`);
console.log('');
console.log('  ADDITIONAL DIAGNOSTIC — fields c5 accesses beyond throw-validation:');
{
  // Load one example to verify field accessibility
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `out_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `sessions_${suffix}`);
  execSync(['node', MODULE_PATH, '--input', path.join(FIXTURES_DIR, 'positive_spread_paired.jsonl'),
           '--output', outFile, '--sessions-dir', sessionsDir].join(' '), { stdio: 'pipe' });
  const rec = JSON.parse(fs.readFileSync(outFile, 'utf8').trim());
  const accessed = ['netEdgeBps', 'observedAt', 'opportunityClass', 'bindingConstraint', 'routeId'];
  for (const f of accessed) {
    const status = f === 'routeId' ? (f in rec ? 'PRESENT (should be absent)' : 'ABSENT (correct for Class A pair)') : (f in rec ? 'PRESENT' : 'ABSENT');
    const icon = (f === 'routeId') ? (f in rec ? '✗' : '✓') : (f in rec ? '✓' : '✗');
    console.log(`    ${icon} ${f}: ${status}`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
console.log(FAILED === 0 ? ' ✓ c5 CONTRACT COMPATIBILITY VERIFIED (schema-level unit test)' : ` ✗ ${FAILED} c5 rejection(s)`);
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(FAILED === 0 ? 0 : 1);
