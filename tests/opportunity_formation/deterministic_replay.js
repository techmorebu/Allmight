#!/usr/bin/env node
/*
 * deterministic_replay.js
 *
 * Boss C9 Criterion 15: byte-identical replay excluding run-scoped metadata.
 *
 * Runs formation TWICE against identical input with DIFFERENT run metadata
 * (formationRunId + formedAt). Canonical opportunity records MUST be
 * byte-identical. Run manifest is EXPECTED to differ.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(__dirname, '..', '..', 'scripts', 'telemetry', 'opportunity_formation_class_a_v1.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'c15_det_'));

console.log('══════════════════════════════════════════════════════════════════════');
console.log(' DETERMINISTIC REPLAY TEST (Boss C9 Criterion 15)');
console.log('══════════════════════════════════════════════════════════════════════');
console.log('');
console.log(' Runs formation twice with DIFFERENT run metadata.');
console.log(' Canonical records MUST be byte-identical.');
console.log(' Run manifest is expected to differ (contains run-scoped metadata).');
console.log('');

function runOnce(fixture, runIdSeed, formedAtSeed) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `out_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `sessions_${suffix}`);
  execSync(['node', MODULE_PATH,
           '--input', path.join(FIXTURES_DIR, fixture),
           '--output', outFile,
           '--sessions-dir', sessionsDir,
           '--run-id-seed', runIdSeed,
           '--formed-at-seed', formedAtSeed].join(' '), { stdio: 'pipe' });
  const canonical = fs.readFileSync(outFile, 'utf8');
  const sessionDirs = fs.readdirSync(sessionsDir);
  const manifest = fs.readFileSync(path.join(sessionsDir, sessionDirs[0], 'manifest.json'), 'utf8');
  return { canonical, manifest };
}

const FIXTURES = [
  'positive_spread_paired.jsonl',
  'reverse_spread_paired.jsonl',
  'zero_spread_paired.jsonl',
  'one_sided_missing_partner.jsonl',
  'depth_null_ramses_side.jsonl',
];

let PASSED = 0;
let FAILED = 0;

for (const fixture of FIXTURES) {
  const run1 = runOnce(fixture, 'SEED_A', '2026-01-01T00:00:00.000Z');
  const run2 = runOnce(fixture, 'SEED_B', '2026-06-06T06:06:06.006Z');

  // Canonical MUST be byte-identical
  if (run1.canonical === run2.canonical) {
    const sha = crypto.createHash('sha256').update(run1.canonical).digest('hex').substring(0, 16);
    console.log(`  ✓ ${fixture}: canonical byte-identical (SHA=${sha}..., ${run1.canonical.length} bytes)`);
    PASSED++;
  } else {
    console.log(`  ✗ ${fixture}: canonical DIFFERS between runs`);
    FAILED++;
    // Show diff for debugging
    const min = Math.min(run1.canonical.length, run2.canonical.length);
    for (let i = 0; i < min; i++) {
      if (run1.canonical[i] !== run2.canonical[i]) {
        console.log(`      first diff at byte ${i}: '${run1.canonical[i]}' vs '${run2.canonical[i]}'`);
        console.log(`      context: '${run1.canonical.substring(Math.max(0, i-20), i+20)}'`);
        break;
      }
    }
  }

  // Manifest MUST differ (contains run-scoped metadata)
  if (run1.manifest !== run2.manifest) {
    console.log(`      manifest correctly differs (contains formationRunId + formedAt)`);
  } else {
    console.log(`  ⚠ ${fixture}: manifest identical — expected to differ`);
  }
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
if (FAILED === 0) {
  console.log(` ✓ ${PASSED}/${PASSED} fixtures produce byte-identical canonical output`);
  console.log(` Run-scoped metadata correctly segregated to manifest.`);
} else {
  console.log(` ✗ ${FAILED} fixtures failed byte-identical replay`);
}
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(FAILED === 0 ? 0 : 1);
