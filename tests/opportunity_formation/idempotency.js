#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * idempotency.js  (v1.1 — Boss C9 Blocker 1 acceptance)
 *
 * Proves canonical stream data/formation_class_a_v1.jsonl is APPEND-ONLY +
 * IDEMPOTENT + never overwrites previously canonical valid observations.
 *
 * A17  identical rerun → zero new canonical rows
 * A18  extended source corpus → only new rows appended
 * A19  existing canonical rows never overwritten
 *
 * Also verifies:
 *   - existing rows preserved byte-identically across reruns
 *   - malformed/rejected groups do not disturb existing canonical data
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(__dirname, '..', '..', 'scripts', 'telemetry', 'opportunity_formation_class_a_v1.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'c15_idem_'));

let PASSED = 0, FAILED = 0;
const check = (label, cond, det) => { if (cond) { console.log(`  ✓ ${label}`); PASSED++; } else { console.log(`  ✗ ${label}${det ? ' — ' + det : ''}`); FAILED++; } };

function runFormation(fixture, outputFile, sessionsDir, runIdSeed) {
  const args = ['node', MODULE_PATH,
                '--input', path.join(FIXTURES_DIR, fixture),
                '--output', outputFile,
                '--sessions-dir', sessionsDir];
  if (runIdSeed) args.push('--run-id-seed', runIdSeed);
  execSync(args.join(' '), { stdio: 'pipe' });
}

function readCanonicalLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim().length > 0);
}

function fileSha(file) {
  if (!fs.existsSync(file)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').substring(0, 16);
}

function readAppendStatForSession(sessionsDir, runIdSeed) {
  // Session dir name = FORM_<runIdSeed> when seed provided
  const sessDir = path.join(sessionsDir, `FORM_${runIdSeed}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(sessDir, 'manifest.json'), 'utf8'));
  return manifest.canonicalAppend;
}

console.log('══════════════════════════════════════════════════════════════════════');
console.log(' IDEMPOTENCY TEST (v1.1 — A17/A18/A19)');
console.log('══════════════════════════════════════════════════════════════════════');

// ── A17: identical rerun → zero new canonical rows ──
console.log('\n[A17 — identical rerun → zero new canonical rows]');
{
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `a17_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `a17_sessions_${suffix}`);

  // First run
  runFormation('idempotency_base.jsonl', outFile, sessionsDir, 'A17_R1');
  const linesAfterFirst = readCanonicalLines(outFile);
  const shaAfterFirst = fileSha(outFile);
  const firstAppend = readAppendStatForSession(sessionsDir, 'A17_R1');
  check(`first run produced ${linesAfterFirst.length} record(s)`, linesAfterFirst.length === 1);
  check(`first run appended ${firstAppend.appended} record(s)`, firstAppend.appended === 1);
  check(`first run alreadyPresent === 0`, firstAppend.alreadyPresent === 0);

  // Second run (identical input)
  runFormation('idempotency_base.jsonl', outFile, sessionsDir, 'A17_R2');
  const linesAfterSecond = readCanonicalLines(outFile);
  const shaAfterSecond = fileSha(outFile);
  const secondAppend = readAppendStatForSession(sessionsDir, 'A17_R2');
  check(`rerun produced 0 NEW records (line count unchanged: ${linesAfterSecond.length})`,
        linesAfterSecond.length === linesAfterFirst.length,
        `first: ${linesAfterFirst.length}, second: ${linesAfterSecond.length}`);
  check(`rerun appended 0 records`, secondAppend.appended === 0, `got ${secondAppend.appended}`);
  check(`rerun alreadyPresent === 1 (skip counted)`, secondAppend.alreadyPresent === 1, `got ${secondAppend.alreadyPresent}`);
  check(`canonical file SHA unchanged across rerun (${shaAfterSecond})`, shaAfterFirst === shaAfterSecond);
}

// ── A18: extended source corpus → only new rows appended ──
console.log('\n[A18 — extended source corpus → only NEW rows appended]');
{
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `a18_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `a18_sessions_${suffix}`);

  // First run with base (1 block worth)
  runFormation('idempotency_base.jsonl', outFile, sessionsDir, 'A18_R1');
  const baseLines = readCanonicalLines(outFile);
  check(`base run produced ${baseLines.length} record(s)`, baseLines.length === 1);
  const baseSha = fileSha(outFile);

  // Second run with extended (2 blocks worth, includes the first)
  runFormation('idempotency_extended.jsonl', outFile, sessionsDir, 'A18_R2');
  const extendedLines = readCanonicalLines(outFile);
  const extendedAppend = readAppendStatForSession(sessionsDir, 'A18_R2');
  check(`extended run produced ${extendedLines.length} record(s) total`, extendedLines.length === 2, `got ${extendedLines.length}`);
  check(`extended run appended 1 NEW record`, extendedAppend.appended === 1, `got ${extendedAppend.appended}`);
  check(`extended run alreadyPresent === 1`, extendedAppend.alreadyPresent === 1);

  // First base line still present + unmodified
  const currentLines = readCanonicalLines(outFile);
  check(`original base record preserved byte-identically as first line`,
        currentLines[0] === baseLines[0],
        'first line differs after extend');
}

// ── A19: existing canonical rows never overwritten ──
console.log('\n[A19 — existing canonical rows never overwritten]');
{
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `a19_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `a19_sessions_${suffix}`);

  // Run with positive_spread → produces 1 record
  runFormation('positive_spread_paired.jsonl', outFile, sessionsDir, 'A19_R1');
  const firstLines = readCanonicalLines(outFile);
  const firstSha = fileSha(outFile);

  // Run with idempotency_base (DIFFERENT block, DIFFERENT prices) → should just append
  runFormation('idempotency_base.jsonl', outFile, sessionsDir, 'A19_R2');
  const secondLines = readCanonicalLines(outFile);
  check(`both records present after second run (${secondLines.length} total)`,
        secondLines.length === 2, `got ${secondLines.length}`);
  check(`first record preserved byte-identically (not overwritten)`,
        secondLines[0] === firstLines[0]);

  // Run with a fixture that has ONLY malformed/rejected input
  // duplicate_venue_rejection: no canonical records emitted; existing must be undisturbed
  runFormation('duplicate_venue_rejection.jsonl', outFile, sessionsDir, 'A19_R3');
  const thirdLines = readCanonicalLines(outFile);
  const thirdSha = fileSha(outFile);
  check(`existing canonical undisturbed by rejection-only run`,
        thirdLines.length === secondLines.length,
        `${secondLines.length} → ${thirdLines.length}`);
  check(`both preserved records still byte-identical`,
        thirdLines[0] === firstLines[0] && thirdLines[1] === secondLines[1]);
  // append stat should show 0 appended (no canonical records produced from rejection-only input)
  const rejectionAppend = readAppendStatForSession(sessionsDir, 'A19_R3');
  check(`rejection-only run appended 0 canonical records`, rejectionAppend.appended === 0);
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
if (FAILED === 0) {
  console.log(` ✓ ${PASSED}/${PASSED} idempotency assertions passed`);
  console.log(` Canonical stream is APPEND-ONLY + DETERMINISTIC IDEMPOTENT`);
} else {
  console.log(` ✗ ${FAILED} idempotency assertions failed`);
}
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(FAILED === 0 ? 0 : 1);
