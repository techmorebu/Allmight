#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * scope_gate.js  (v1.1 — Boss C9 Blocker 2 acceptance)
 *
 * Proves c1.5 v1.1 does NOT mislabel out-of-scope observations as Class-A
 * Ramses × Uniswap ETH/USDC records.
 *
 * A20  Unrelated surface (e.g., uniswap_v3 + curve) → not mislabeled/emitted
 * A21  Mixed surface at same block → no cross-surface pairing
 * A22  Wrong chain / wrong pair → excluded deterministically
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'c15_scope_'));

let PASSED = 0, FAILED = 0;
const check = (label, cond, det) => { if (cond) { console.log(`  ✓ ${label}`); PASSED++; } else { console.log(`  ✗ ${label}${det ? ' — ' + det : ''}`); FAILED++; } };

function runFormation(fixture) {
  const suffix = crypto.randomBytes(4).toString('hex');
  const outFile = path.join(TMP, `out_${suffix}.jsonl`);
  const sessionsDir = path.join(TMP, `sessions_${suffix}`);
  execSync(['node', MODULE_PATH, '--input', path.join(FIXTURES_DIR, fixture),
           '--output', outFile, '--sessions-dir', sessionsDir].join(' '), { stdio: 'pipe' });
  const raw = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  const records = raw.split('\n').filter(l => l.trim().length > 0).map(l => JSON.parse(l));
  const sessDirs = fs.readdirSync(sessionsDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(sessionsDir, sessDirs[0], 'manifest.json'), 'utf8'));
  return { records, manifest };
}

console.log('══════════════════════════════════════════════════════════════════════');
console.log(' SCOPE GATE TEST (v1.1 — A20/A21/A22)');
console.log('══════════════════════════════════════════════════════════════════════');

// ── A20: unrelated_venue.jsonl — uniswap_v3 + curve for a hypothetical UNI-CURVE surface
// Both records have pair="ETH/USDC-CURVE" (not the sanctioned ETH/USDC-RAMSES).
// Both should be excluded. The FIRST exclusion reason to fire is pair mismatch
// (chain checked first, then pair, then venue) — that's fine, both are legit reasons.
console.log('\n[A20 — unrelated venue (uniswap_v3 + curve): should NOT be mislabeled]');
{
  const { records, manifest } = runFormation('unrelated_venue.jsonl');
  check('zero canonical records emitted for out-of-scope venue pair', records.length === 0, `got ${records.length}`);
  check('scopeExclusions.total === 2 (both records excluded)',
        manifest.scopeExclusions.total === 2, `got ${manifest.scopeExclusions.total}`);
  const reasons = Object.keys(manifest.scopeExclusions.byReason);
  check('exclusion reason present (wrong_pair OR unrelated_venue — both legitimate)',
        reasons.some(r => r.startsWith('wrong_pair') || r.startsWith('unrelated_venue')),
        `got ${JSON.stringify(reasons)}`);
}

// ── A21: mixed_surface_same_block.jsonl
// Block contains BOTH in-scope pair AND out-of-scope records.
// c1.5 must form ONLY the in-scope pair, not cross-pair with out-of-scope records.
console.log('\n[A21 — mixed surface at same block: no cross-surface pairing]');
{
  const { records, manifest } = runFormation('mixed_surface_same_block.jsonl');
  check('exactly 1 canonical record emitted (in-scope pair only)',
        records.length === 1, `got ${records.length}`);
  if (records.length >= 1) {
    check('emitted record is the in-scope pair (buyVenue/sellVenue ∈ {ramses_v2, uniswap_v3})',
          records[0].buyVenue !== null && records[0].sellVenue !== null
          && ['ramses_v2', 'uniswap_v3'].includes(records[0].buyVenue)
          && ['ramses_v2', 'uniswap_v3'].includes(records[0].sellVenue),
          `buyVenue=${records[0].buyVenue}, sellVenue=${records[0].sellVenue}`);
    check('emitted surfaceId is sanctioned Class-A form',
          records[0].surfaceId === 'arbitrum:WETH-USDC:ramses_v2>uniswap_v3',
          records[0].surfaceId);
  }
  check('scopeExclusions.total === 2 (out-of-scope records excluded)',
        manifest.scopeExclusions.total === 2, `got ${manifest.scopeExclusions.total}`);
}

// ── A22a: wrong_chain.jsonl — venues OK, pair OK, but chain=polygon
console.log('\n[A22a — wrong chain (polygon instead of arbitrum): excluded]');
{
  const { records, manifest } = runFormation('wrong_chain.jsonl');
  check('zero canonical records for wrong-chain input',
        records.length === 0, `got ${records.length}`);
  check('scopeExclusions.total === 2',
        manifest.scopeExclusions.total === 2, `got ${manifest.scopeExclusions.total}`);
  const reasons = Object.keys(manifest.scopeExclusions.byReason);
  check('exclusion reason cites wrong_chain:polygon',
        reasons.some(r => r === 'wrong_chain:polygon'),
        `got ${JSON.stringify(reasons)}`);
}

// ── A22b: wrong_pair.jsonl — chain OK, venues OK, but pair=ARB/USDC-OTHER
console.log('\n[A22b — wrong pair (ARB/USDC-OTHER): excluded]');
{
  const { records, manifest } = runFormation('wrong_pair.jsonl');
  check('zero canonical records for wrong-pair input',
        records.length === 0, `got ${records.length}`);
  check('scopeExclusions.total === 2',
        manifest.scopeExclusions.total === 2, `got ${manifest.scopeExclusions.total}`);
  const reasons = Object.keys(manifest.scopeExclusions.byReason);
  check('exclusion reason cites wrong_pair:ARB/USDC-OTHER',
        reasons.some(r => r === 'wrong_pair:ARB/USDC-OTHER'),
        `got ${JSON.stringify(reasons)}`);
}

// ── Regression check: in-scope fixtures still produce records
console.log('\n[Regression — in-scope fixtures unaffected by scope gate]');
{
  const { records: r1 } = runFormation('positive_spread_paired.jsonl');
  check('positive_spread still produces 1 canonical record', r1.length === 1);
  const { records: r2 } = runFormation('one_sided_missing_partner.jsonl');
  check('one_sided still produces 1 canonical record', r2.length === 1);
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log('══════════════════════════════════════════════════════════════════════');
if (FAILED === 0) {
  console.log(` ✓ ${PASSED}/${PASSED} scope gate assertions passed`);
  console.log(` Out-of-scope observations correctly excluded and diagnostically counted`);
} else {
  console.log(` ✗ ${FAILED} scope gate assertions failed`);
}
console.log('══════════════════════════════════════════════════════════════════════');

process.exit(FAILED === 0 ? 0 : 1);
