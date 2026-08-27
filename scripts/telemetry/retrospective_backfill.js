#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * Wave 11 c1 — retrospective_backfill.js
 *
 * Ships in c1 v1 but is DISABLED by default. Emits a banner explaining
 * that it will not execute until a separate future bundle enables it.
 *
 * Boss C9 ruling (Q1→C):
 *   "Ship retrospective_backfill.js in c1 v1 alongside live_observer.js
 *    but with a hard disabled flag / dry-run mode by default. It doesn't
 *    actually process the historical 17 sessions until a separate future
 *    bundle explicitly enables it, but its existence gives us a documented
 *    intention to backfill later without pretending we don't know those
 *    sessions exist."
 *
 * The disabled state is enforced by an internal constant that this
 * script alone cannot flip. A future c1.5 bundle will patch this
 * constant, add a --enable flag, and ship acceptance tests for the
 * retrospective path. Until then, invoking this script prints the
 * banner and exits.
 *
 * DOES NOT (in c1 v1):
 *   - Read any historical session dir
 *   - Write any observation
 *   - Modify the canonical dataset
 *   - Do anything but print the banner
 *
 * When enabled (future bundle):
 *   - Will process logs/sessions/session_*Z/price_replay.jsonl for each
 *     historical session
 *   - Will emit records with:
 *       telemetrySource       = "LIVE"
 *       observationMode       = "RETROSPECTIVE"
 *       observerRunId         = "RETRO_<uuid>"
 *   - Will apply IDENTICAL provenance and validation as live_observer.js
 *   - Will produce a distinct manifest per historical session, all
 *     tagged retrospectively
 *
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── HARD DISABLE — do not remove without a full c1.5 bundle authorization ──
const RETROSPECTIVE_BACKFILL_ENABLED = false;
// ────────────────────────────────────────────────────────────────────────────

function printBanner() {
  const banner = `
═══════════════════════════════════════════════════════════════════
 Wave 11 c1 — retrospective_backfill.js — DISABLED
═══════════════════════════════════════════════════════════════════

This script is shipped as part of c1 v1 but is intentionally disabled.

Boss C9 ruling (Q1→C): "ship alongside live_observer.js but with a hard
disabled flag by default. It doesn't actually process the historical
17 sessions until a separate future bundle explicitly enables it."

To enable retrospective backfill:
  1. Wait for c1 v1 to accumulate empirical LIVE_TAIL evidence
  2. Boss C9 issues a ruling on whether backfill is warranted
  3. A separate c1.5 bundle patches RETROSPECTIVE_BACKFILL_ENABLED,
     adds a --enable flag, and ships acceptance tests

Until then, this script prints this banner and exits 0.

═══════════════════════════════════════════════════════════════════
`;
  console.log(banner);
}

function main() {
  printBanner();

  if (!RETROSPECTIVE_BACKFILL_ENABLED) {
    // Exit 0 — this is not an error, it's the intended state
    process.exit(0);
  }

  // If we get here, someone has manually patched the constant without
  // authorizing a c1.5 bundle. Refuse to proceed.
  console.error('✗ RETROSPECTIVE_BACKFILL_ENABLED was flipped WITHOUT bundle authorization');
  console.error('  This script refuses to run under manual patching.');
  console.error('  If backfill is authorized, ship it as c1.5 with proper preflight+deploy.');
  process.exit(2);
}

main();
