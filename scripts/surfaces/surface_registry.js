#!/usr/bin/env node
'use strict';
// surface_registry.js
// Surface config loader + validator for Phase 2 multi-surface architecture.
// Analytics/config only — no execution behavior changes.
//
// Usage:
//   const { loadSurfaces, getEnabledSurfaces } = require('./surface_registry');
//   node scripts/surfaces/surface_registry.js --self-test

const fs   = require('fs');
const path = require('path');

// ─── PATHS ────────────────────────────────────────────────────────────────────
const REPO = (() => {
  try { return require('child_process')
    .execSync('git rev-parse --show-toplevel',{encoding:'utf8'}).trim(); }
  catch { return path.resolve(__dirname,'../..'); }
})();
const SURFACES_DIR   = path.join(REPO, 'surfaces');
const REGISTRY_FILE  = path.join(SURFACES_DIR, 'registry.json');

// ─── PROMOTION LADDER ─────────────────────────────────────────────────────────
const PROMOTION_LADDER = [
  'WATCHLIST',
  'SHADOW_ONLY',
  'V2_VALIDATED',
  'DRY_RUN_ELIGIBLE',
  'EXECUTOR_REQUIRED',
  'MICRO_ELIGIBLE',
];

// ─── VALIDATION ───────────────────────────────────────────────────────────────
function validateSurface(surface) {
  const errors = [];
  if (!surface.surfaceId)       errors.push('missing surfaceId');
  if (!surface.chain)           errors.push('missing chain');
  if (!surface.base)            errors.push('missing base token');
  if (!surface.quote)           errors.push('missing quote token');
  if (typeof surface.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (!PROMOTION_LADDER.includes(surface.promotionStatus))
    errors.push(`invalid promotionStatus: ${surface.promotionStatus}`);
  if (!['shadow_only','dry_run','live'].includes(surface.executionMode))
    errors.push(`invalid executionMode: ${surface.executionMode}`);
  if (surface.enabled && surface.venues && surface.venues.length === 0)
    errors.push('enabled surface must have at least one venue');
  return errors;
}

// ─── LOADERS ──────────────────────────────────────────────────────────────────
function loadRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    throw new Error(`Registry not found: ${REGISTRY_FILE}`);
  }
  return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
}

function loadSurface(surfaceId) {
  const registry = loadRegistry();
  const entry = registry.surfaces.find(s => s.surfaceId === surfaceId);
  if (!entry) throw new Error(`Surface not found in registry: ${surfaceId}`);
  const filePath = path.join(SURFACES_DIR, entry.file);
  if (!fs.existsSync(filePath)) throw new Error(`Surface file not found: ${filePath}`);
  const surface = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const errors = validateSurface(surface);
  if (errors.length) throw new Error(`Surface ${surfaceId} invalid: ${errors.join(', ')}`);
  return surface;
}

function loadSurfaces() {
  const registry = loadRegistry();
  const surfaces = [];
  const errors   = [];
  for (const entry of registry.surfaces) {
    try {
      surfaces.push(loadSurface(entry.surfaceId));
    } catch (e) {
      errors.push({ surfaceId: entry.surfaceId, error: e.message });
    }
  }
  return { surfaces, errors, registry };
}

function getEnabledSurfaces() {
  const { surfaces, errors } = loadSurfaces();
  return { surfaces: surfaces.filter(s => s.enabled), errors };
}

function getSurface(surfaceId) {
  return loadSurface(surfaceId);
}

// ─── SELF-TEST ────────────────────────────────────────────────────────────────
function selfTest() {
  const W = 65;
  const line = '─'.repeat(W);
  console.log('═'.repeat(W));
  console.log('  Surface Registry — Self Test');
  console.log('  ' + new Date().toISOString());
  console.log('═'.repeat(W));

  let pass = 0; let fail = 0;
  const chk = (label, ok, detail='') => {
    console.log(`  ${ok ? '✅' : '❌'}  ${label}${detail ? ' — '+detail : ''}`);
    ok ? pass++ : fail++;
  };

  // Registry file exists
  chk('Registry file exists', fs.existsSync(REGISTRY_FILE));

  // Load all surfaces
  let loaded;
  try {
    loaded = loadSurfaces();
    chk('loadSurfaces() succeeds', true);
    chk('No load errors', loaded.errors.length === 0,
      loaded.errors.length > 0 ? loaded.errors.map(e=>e.surfaceId).join(', ') : '');
    chk('At least one surface in registry', loaded.surfaces.length > 0,
      `${loaded.surfaces.length} loaded`);
  } catch(e) {
    chk('loadSurfaces() succeeds', false, e.message);
  }

  // Primary surface
  try {
    const primary = getSurface('eth_usdc_ramses');
    chk('Primary surface loads', true);
    chk('Primary surface enabled', primary.enabled === true);
    chk('Primary has venues', primary.venues && primary.venues.length > 0,
      `${primary.venues?.length} venues`);
    chk('Primary executionMode = shadow_only', primary.executionMode === 'shadow_only');
    chk('Primary promotionStatus = DRY_RUN_ELIGIBLE',
      primary.promotionStatus === 'DRY_RUN_ELIGIBLE');
  } catch(e) {
    chk('Primary surface loads', false, e.message);
  }

  // Enabled surface count
  try {
    const { surfaces: enabled } = getEnabledSurfaces();
    chk('getEnabledSurfaces() returns enabled only',
      enabled.every(s => s.enabled), `${enabled.length} enabled`);
    chk('Only 1 enabled surface (Phase 1 lock)', enabled.length === 1,
      `found: ${enabled.map(s=>s.surfaceId).join(', ')}`);
  } catch(e) {
    chk('getEnabledSurfaces() works', false, e.message);
  }

  // Watchlist surfaces all disabled
  try {
    const { surfaces: all } = loadSurfaces();
    const watchlist = all.filter(s => s.promotionStatus === 'WATCHLIST');
    chk('Watchlist surfaces all disabled',
      watchlist.every(s => !s.enabled),
      `${watchlist.length} watchlist surfaces`);
  } catch(e) {
    chk('Watchlist check', false, e.message);
  }

  // Validation rejects bad config
  const badSurface = { surfaceId: 'test', enabled: 'yes', executionMode: 'live' };
  const errs = validateSurface(badSurface);
  chk('Validation catches bad config', errs.length > 0, `${errs.length} errors caught`);

  console.log('');
  console.log(line);
  console.log(`  ${pass} passed  ${fail} failed`);
  if (fail === 0) {
    console.log('  ✅ Registry self-test PASSED');
  } else {
    console.log('  ❌ Registry self-test FAILED — fix errors before proceeding');
  }
  console.log('═'.repeat(W));
  return fail === 0;
}

// ─── SURFACE SUMMARY (for portfolio report) ───────────────────────────────────
function surfaceSummary() {
  const { surfaces, errors, registry } = loadSurfaces();
  return {
    total     : surfaces.length,
    enabled   : surfaces.filter(s => s.enabled).length,
    byStatus  : Object.fromEntries(
      PROMOTION_LADDER.map(s => [s, surfaces.filter(x => x.promotionStatus===s).length])
    ),
    surfaces  : surfaces.map(s => ({
      surfaceId     : s.surfaceId,
      displayName   : s.displayName,
      enabled       : s.enabled,
      promotionStatus: s.promotionStatus,
      chain         : s.chain,
      executionMode : s.executionMode,
      venueCount    : (s.venues||[]).length,
    })),
    errors,
  };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  if (process.argv.includes('--self-test')) {
    const ok = selfTest();
    process.exit(ok ? 0 : 1);
  }
  if (process.argv.includes('--list')) {
    const { surfaces } = loadSurfaces();
    for (const s of surfaces) {
      const flag = s.enabled ? '✅' : '⏸ ';
      console.log(`  ${flag}  ${s.surfaceId.padEnd(30)} [${s.promotionStatus}]  ${s.chain}`);
    }
    process.exit(0);
  }
  console.log('Usage: node surface_registry.js --self-test | --list');
  process.exit(0);
}

module.exports = { loadSurfaces, getEnabledSurfaces, getSurface, validateSurface, surfaceSummary, PROMOTION_LADDER };
