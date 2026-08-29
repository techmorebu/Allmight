#!/usr/bin/env node
/*
 * c6_unchanged_consumption.js
 *
 * BOUNDED INTERFACE FINDING per Boss C9 ruling on Criterion 13:
 *
 *   "For criterion 13 — 'c6 consumes resulting c5 output unchanged' —
 *    do not distort the c1.5 schema just to make an invocation pass."
 *
 * This test proves what CAN be proven about c6-compatibility of c1.5 output,
 * and REPORTS what cannot be proven without patching c6 or adding scanner-
 * registration wiring outside c1.5 v1's scope.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE_PATH = path.join(__dirname, '..', '..', 'scripts', 'telemetry', 'opportunity_formation_class_a_v1.js');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'c15_c6_'));

console.log('══════════════════════════════════════════════════════════════════════');
console.log(' c6 BOUNDED INTERFACE FINDING (per Boss C9 Criterion 13)');
console.log('══════════════════════════════════════════════════════════════════════');

// Run formation on a paired fixture
const suffix = crypto.randomBytes(4).toString('hex');
const outFile = path.join(TMP, `out_${suffix}.jsonl`);
const sessionsDir = path.join(TMP, `sessions_${suffix}`);

execSync(['node', MODULE_PATH, '--input', path.join(FIXTURES_DIR, 'positive_spread_paired.jsonl'),
         '--output', outFile, '--sessions-dir', sessionsDir].join(' '), { stdio: 'pipe' });

const record = JSON.parse(fs.readFileSync(outFile, 'utf8').trim());

let PASSED = 0;
let FAILED = 0;
const findings = [];

console.log('');
console.log(' PROVABLE:');

// 1. surfaceId is parseable by c6's canonicalizeTelemetryId (splits on ':', 3 parts)
const parts = record.surfaceId.split(':');
if (parts.length === 3) { console.log(`  ✓ surfaceId parseable by c6 canonicalizeTelemetryId (3 parts: chain / assets / venues)`); PASSED++; }
else { console.log(`  ✗ surfaceId parseable (${parts.length} parts)`); FAILED++; }

// 2. Pair form uses '-' asset separator per buildRouterId
if (parts[1] && parts[1].includes('-')) { console.log(`  ✓ pair asset separator '-' present (per buildRouterId pair convention)`); PASSED++; }
else { console.log(`  ✗ pair asset separator`); FAILED++; }

// 3. Pair form uses '>' venue separator per buildRouterId
if (parts[2] && parts[2].includes('>')) { console.log(`  ✓ pair venue separator '>' present`); PASSED++; }
else { console.log(`  ✗ pair venue separator`); FAILED++; }

// 4. Venues are sorted alphabetically for pair (buildRouterId isRoute=false)
const venues = parts[2].split('>');
const sorted = [...venues].sort();
if (JSON.stringify(venues) === JSON.stringify(sorted)) {
  console.log(`  ✓ venues alphabetically sorted (${venues.join(', ')}) — matches buildRouterId pair rule`);
  PASSED++;
} else {
  console.log(`  ✗ venues not sorted`);
  FAILED++;
}

// 5. opportunityClass includes 'A' — c6 aggregates by class
if (Array.isArray(record.opportunityClass) && record.opportunityClass.includes('A')) {
  console.log(`  ✓ opportunityClass includes 'A' (c6 aggregation key)`);
  PASSED++;
} else {
  console.log(`  ✗ opportunityClass=[A]`);
  FAILED++;
}

// 6. No routeId (c6 uses routeId ONLY for ordered routes; Class A pair does not have one)
if (!('routeId' in record)) {
  console.log(`  ✓ routeId absent (correct for Class A pair per Boss C9 ruling)`);
  PASSED++;
} else {
  console.log(`  ✗ routeId absent`);
  FAILED++;
}

console.log('');
console.log(' BOUNDED INTERFACE FINDINGS (reported, not patched):');

findings.push({
  finding: 'c6 scanner-registration wiring',
  status: 'OUT OF v1 SCOPE',
  detail: 'c6 (opportunity_router.js) aggregates opportunities produced by existing scanners ' +
          '(class_b, class_c, class_d). c1.5 v1 is the FIRST Class A producer per Boss ruling. ' +
          'Wiring c1.5 output into c6\'s scanner-registration path is a SEPARATE bounded track ' +
          'outside c1.5 v1\'s authorization. The surfaceId format is c6-parseable; the routing ' +
          'integration itself is future work.'
});

findings.push({
  finding: 'c6 gas-adjusted economics fields',
  status: 'NOT APPLICABLE v1',
  detail: 'c6 has fields for netEdgeBps, gasCostBps, etc. c1.5 v1 emits netEdgeBps=null ' +
          '(Boss G-Now: no canonical gas). This is by design; c6 will compute nothing from ' +
          'null values, consistent with fail-closed doctrine. Not a c6 incompatibility.'
});

findings.push({
  finding: 'c6 executable capacity + binding constraint sizing',
  status: 'DOWNSTREAM v1',
  detail: 'c6 fields like bestProfitSizeUsd, executableCapacityUsd, bindingConstraint ' +
          'are populated by downstream sizing scanners (per Step 7A crosswalk), not by ' +
          'formation. c1.5 v1 sets bindingConstraint=null which c6 will treat as unknown. ' +
          'Not a c6 incompatibility.'
});

for (const f of findings) {
  console.log(`  • ${f.finding}: ${f.status}`);
  console.log(`      ${f.detail}`);
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
if (FAILED === 0) {
  console.log(` ✓ ${PASSED}/${PASSED} provable c6-compatibility checks passed`);
  console.log(` ${findings.length} bounded interface findings reported (not patched, per Boss C9)`);
} else {
  console.log(` ✗ ${FAILED} c6-compatibility checks failed`);
}
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(FAILED === 0 ? 0 : 1);
