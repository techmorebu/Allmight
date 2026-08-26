#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Opportunity Router — v1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * AllMight Wave 10B, commit 6.  Implements Boss C9 ruling.
 *
 * PURPOSE
 *   Consume canonical outputs from Class B, C, D scanners and c5 persistence
 *   telemetry.  Produce a unified, deterministic routing decision per
 *   opportunity with an explicit reasoning trail.
 *
 * WHAT THE ROUTER DOES
 *   - Normalizes surface identifiers into a single canonical routerId
 *     that matches identically across scanners and telemetry.
 *   - Classifies capture profile from OBSERVED ECONOMIC RUN LENGTH
 *     (never from raw latency probabilities per Boss C9).
 *   - Distinguishes atomicity dimensions (captureProfile) from financing
 *     dimensions (inventoryCapable / flashEligible / flashBeneficial).
 *   - Emits Class A explicitly in opportunity composition:
 *     ["A"], ["A","B"], ["C"], ["C","B"], ["D"], ["D","B"].
 *   - Derives priority by lexicographic funnel — no pseudo-EV math,
 *     no arbitrary dollar cutoffs.
 *   - Marks fixture-derived decisions with telemetryConfidence: TEST_ONLY
 *     so synthetic assumptions never become production facts.
 *   - Flags sizeRevalidationRequired when binding-constraint transitions
 *     were observed during the telemetry window.
 *   - Records reasoning trail (routeReason, priorityBasis) for auditability.
 *
 * WHAT THE ROUTER DOES NOT DO
 *   - No live scanner invocation.  Reads pre-generated JSON.
 *   - No transaction construction.  No broadcast.  No capital movement.
 *   - No execution instructions ("wait 1 block", "trade now").
 *   - No calibrated EV score.  Deferred until live telemetry exists.
 *
 * INPUTS (JSON files)
 *   --class-b   <path>   class_b_flash_loan_scan_v1
 *   --class-c   <path>   class_c_triangular_scan_v1
 *   --class-d   <path>   class_d_stablecoin_basis_scan_v1
 *   --telemetry <path>   persistence_telemetry_v1
 *   --telemetry-source FIXTURE|REPLAY|LIVE  (default FIXTURE)
 *
 * OUTPUTS
 *   stdout: canonical JSON (schema opportunity_router_v1)
 *   stderr: human-readable decision summary
 *
 * CAPITAL LOCKED. EXECUTION LOCKED. BROADCAST LOCKED.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// Constants (per Boss C9 — all router-taxonomy, none constitutional)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_VERSION           = 'opportunity_router_v1';
const CAPTURE_PROFILE_POLICY   = 'ROUTER_V1_DESCRIPTIVE';
const CAPTURE_PROFILE_BASIS    = 'OBSERVED_ECONOMIC_RUN_LENGTH';
const PRIORITY_POLICY_VERSION  = 'router_priority_v1';

// captureProfile boundary (nonconstitutional — Boss C9 explicitly named)
const PERSISTENT_WINDOW_THRESHOLD_BLOCKS = 5;

// Hit-rate bands (provisional, nonconstitutional — Boss C9 explicitly named)
const LOW_SIGNAL_MAX  = 0.05;   // < 5%
const HIGH_SIGNAL_MIN = 0.20;   // > 20%

// V4.1 Surface Tier thresholds (from Discovery Constitution V4.1)
const TIER_THRESHOLDS_USD = [
  { name: 'TIER_4', minUsd: 5000000 },
  { name: 'TIER_3', minUsd: 1000000 },
  { name: 'TIER_2', minUsd:  100000 },
  { name: 'TIER_1', minUsd:    1000 },
  { name: 'TIER_0', minUsd:       0 },
];

// Default paths (fixture demo)
const DEFAULT_PATHS = {
  classB:    path.join(__dirname, 'fixtures', 'class_b.json'),
  classC:    path.join(__dirname, 'fixtures', 'class_c.json'),
  classD:    path.join(__dirname, 'fixtures', 'class_d.json'),
  telemetry: path.join(__dirname, 'fixtures', 'telemetry.json'),
};

// Default telemetry source (safe: assumes fixture unless caller says otherwise)
const DEFAULT_TELEMETRY_SOURCE = 'FIXTURE';

// ─────────────────────────────────────────────────────────────────────────────
// Venue canonicalization table (v1 hardcoded — future work: registry)
// ─────────────────────────────────────────────────────────────────────────────
//
// Maps scanner-specific and telemetry-specific venue names to a common
// short canonical form.  Fee tiers preserved only when they distinguish
// two pools of the same protocol (e.g., USDC/USDC.e case).
// ─────────────────────────────────────────────────────────────────────────────

const VENUE_CANONICAL = {
  // Class B fixture
  'univ3-3000':                                   'univ3',
  'ramses-v2':                                    'ramses',
  // Class C fixture
  'uniswap_v3_arbitrum_weth_usdc_30bps':          'univ3',
  'camelot_v3_arbitrum_arb_usdc':                 'camelot',
  'uniswap_v3_arbitrum_arb_weth_30bps':           'univ3',
  // Class D USDC/USDT fixture
  'univ3_100bp_usdc_usdt':                        'univ3',
  'curve_stables_usdc_usdt':                      'curve',
  // Class D USDC/USDCE fixture (fee tier matters — sole differentiator)
  'univ3_100bp_usdc_usdce':                       'univ3_100bp',
  'univ3_500bp_usdc_usdce':                       'univ3_500bp',
  // Telemetry venue tokens
  'ramses_v2':                                    'ramses',
  'uniswap_v3':                                   'univ3',
  'univ3':                                        'univ3',
  'camelot':                                      'camelot',
  'curve':                                        'curve',
  'univ3_100bp':                                  'univ3_100bp',
  'univ3_500bp':                                  'univ3_500bp',
};

function canonicalizeVenue(raw) {
  if (VENUE_CANONICAL[raw] !== undefined) return VENUE_CANONICAL[raw];
  return raw;  // fall back to raw — mismatch will be visible
}

function canonicalizeAsset(raw) {
  return raw.toUpperCase().replace(/\./g, '');  // USDC.e → USDCE
}

// ─────────────────────────────────────────────────────────────────────────────
// routerId construction — canonical form matched across scanners + telemetry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build canonical routerId from a set of assets + venues.
 * @param chain      e.g. 'arbitrum'
 * @param assets     e.g. ['WETH','USDC'] for pair, ['WETH','USDC','ARB','WETH'] for route
 * @param venues     e.g. ['univ3-3000','ramses-v2']
 * @param isRoute    true = ordered cycle (venues preserved order),
 *                   false = pair (venues alphabetical)
 */
function buildRouterId(chain, assets, venues, isRoute) {
  const canonAssets = assets.map(canonicalizeAsset);
  const canonVenues = venues.map(canonicalizeVenue);

  const assetSep = isRoute ? '>' : '-';
  const assetPath = canonAssets.join(assetSep);

  const orderedVenues = isRoute ? canonVenues : [...canonVenues].sort();
  const venuePath = orderedVenues.join('>');

  return `${chain}:${assetPath}:${venuePath}`;
}

/**
 * Parse a telemetry surfaceId or routeId back into components, then rebuild
 * as canonical routerId.  Handles both forms:
 *   pair:  arbitrum:WETH-USDC:ramses_v2>uniswap_v3
 *   route: arbitrum:WETH>USDC>ARB>WETH:univ3>camelot>univ3
 */
function canonicalizeTelemetryId(rawId, isRoute) {
  const parts = rawId.split(':');
  if (parts.length !== 3) return rawId;  // unparseable; return as-is
  const [chain, assetsRaw, venuesRaw] = parts;

  const assetSep = isRoute ? '>' : '-';
  const assets = assetsRaw.split(assetSep);
  const venues = venuesRaw.split('>');

  return buildRouterId(chain, assets, venues, isRoute);
}

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────

function loadJson(p) {
  if (!fs.existsSync(p)) throw new Error(`file not found: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Scanner adapters — normalize each class into a common opportunity shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common opportunity shape produced by adapters:
 * {
 *   sourceScanner, sourceSchema, sourceClass,       ← provenance
 *   routerId,                                        ← canonical id
 *   chain, chainId,
 *   assets: [ ... ],
 *   venues: [ ... ],
 *   isRoute: bool,
 *   underlyingEconomic: bool,                        ← from scanner
 *   bestProfitSizeUsd, bestRoiSizeUsd,
 *   netEdgeBps, grossEdgeBps,
 *   executableCapacityUsd,
 *   bindingConstraint, bindingLeg (if any),
 *   inventorySufficientFromScanner: bool | null,     ← from Class C/D hint
 *   flashHintFromScanner: { available, economic, ... },  ← from Class B
 * }
 */

function extractFromClassB(scan) {
  const opps = [];
  for (const s of (scan.surfaces || [])) {
    // Class B fixture surfaceId: 'arbitrum:WETH/USDC:univ3-3000:ramses-v2'
    // Extract chain, assets (from 'WETH/USDC'), venues (from tail).
    const sid = s.surfaceId || '';
    const parts = sid.split(':');
    // parts: [chain, 'WETH/USDC', 'univ3-3000', 'ramses-v2']
    if (parts.length < 4) continue;
    const chain = parts[0];
    const assets = parts[1].split('/');
    const venues = parts.slice(2);
    const routerId = buildRouterId(chain, assets, venues, false);

    opps.push({
      sourceScanner: 'class_b_flash_loan',
      sourceSchema:  scan.$schema,
      sourceClass:   'A',      // Boss C9: Class B underlying IS Class A
      routerId,
      rawSurfaceId:  sid,
      chain,
      chainId:       s.chainId || 42161,
      assets,
      venues,
      isRoute:       false,
      underlyingEconomic:  s.underlyingArbValid === true,
      bestProfitSizeUsd:   s.recommendedTestSize || null,
      bestRoiSizeUsd:      null,
      netEdgeBps:          s.observedSpreadBps ? (s.observedSpreadBps - (s.venueA?.feeBps || 0) - (s.venueB?.feeBps || 0)) : null,
      grossEdgeBps:        s.observedSpreadBps || null,
      executableCapacityUsd: s.executableCapacityUsd || 0,
      bindingConstraint:   s.bindingConstraint || null,
      bindingLeg:          null,
      bindingConstraintTransitionsFromScanner: null,
      inventorySufficientFromScanner: null,
      flashHintFromScanner: {
        available:            s.flashFinanceAvailable   === true,
        economic:             s.flashFinanceEconomic    === true,
        improvesCapacity:     s.flashFinanceImprovesCapacity === true,
        improvesProfit:       s.flashFinanceImprovesProfit   === true,
        source:               s.flashSource || null,
        asset:                s.flashAsset  || null,
        borrowCapacityUsd:    s.flashBorrowCapacityUsd  || 0,
        feeBps:               s.flashFeeBps || null,
      },
    });
  }
  return opps;
}

function extractFromClassC(scan) {
  const opps = [];
  for (const c of (scan.cycles || [])) {
    // Class C cycleId: 'arbitrum:WETH->USDC->ARB->WETH'
    // Assets come from cycleId; venues from legs.
    const cid = c.cycleId || '';
    const parts = cid.split(':');
    if (parts.length !== 2) continue;
    const chain = parts[0];
    const assets = parts[1].split('->');
    const venues = (c.sizeLadder?.[0]?.legTrace || []).map(l => l.venue);
    const routerId = buildRouterId(chain, assets, venues, true);

    const bestP = c.underlyingBestByProfit || null;
    const bestR = c.underlyingBestByRoi || null;

    opps.push({
      sourceScanner: 'class_c_triangular',
      sourceSchema:  scan.$schema,
      sourceClass:   'C',
      routerId,
      rawSurfaceId:  cid,
      chain,
      chainId:       c.chainId || 42161,
      assets,
      venues,
      isRoute:       true,
      underlyingEconomic:    c.underlyingCycleValid === true,
      bestProfitSizeUsd:     bestP ? bestP.sizeUsd     : null,
      bestRoiSizeUsd:        bestR ? bestR.sizeUsd     : null,
      netEdgeBps:            bestP ? ((bestP.grossReturn - 1) * 10000) : null,
      grossEdgeBps:          bestP ? ((bestP.grossReturn - 1) * 10000) : null,
      executableCapacityUsd: c.cycleCapacityUsd || 0,
      bindingConstraint:     c.bindingConstraint || null,
      bindingLeg:            c.bindingLeg || null,
      bindingConstraintTransitionsFromScanner: null,
      inventorySufficientFromScanner: c.classBHint?.inventorySufficientForBest ?? null,
      flashHintFromScanner:  null,   // Class C doesn't do financing math
    });
  }
  return opps;
}

function extractFromClassD(scan) {
  const opps = [];
  for (const p of (scan.pairs || [])) {
    // Class D pairId: 'arbitrum:USDC/USDT' — assets separated by '/'
    // Venues from p.venues array.
    const pid = p.pairId || '';
    const parts = pid.split(':');
    if (parts.length !== 2) continue;
    const chain = parts[0];
    const assets = parts[1].split('/');
    const venues = (p.venueSanities || []).map(v => v.venueId);
    const routerId = buildRouterId(chain, assets, venues, false);

    const bestP = p.underlyingBestByProfit || null;
    const bestR = p.underlyingBestByRoi || null;

    opps.push({
      sourceScanner: 'class_d_stablecoin_basis',
      sourceSchema:  scan.$schema,
      sourceClass:   'D',
      routerId,
      rawSurfaceId:  pid,
      chain,
      chainId:       p.chainId || 42161,
      assets,
      venues,
      isRoute:       false,
      underlyingEconomic:    p.instantaneousEconomic === true,
      bestProfitSizeUsd:     bestP ? bestP.sizeUsd     : null,
      bestRoiSizeUsd:        bestR ? bestR.sizeUsd     : null,
      netEdgeBps:            bestP ? ((bestP.grossReturn - 1) * 10000) : null,
      grossEdgeBps:          p.basisBps || null,
      executableCapacityUsd: p.weakestVenueDepthUsd || 0,
      bindingConstraint:     p.bindingConstraint || null,
      bindingLeg:            null,
      bindingConstraintTransitionsFromScanner: null,
      inventorySufficientFromScanner: p.classBHint?.inventorySufficientForBest ?? null,
      flashHintFromScanner:  null,
      // Class-D-specific extras (kept in extensions per Boss C9)
      extensionsFromScanner: {
        basisType: p.basisType,
        priceSanity: p.priceSanity,
        migrationSensitive: p.migrationSensitive,
      },
    });
  }
  return opps;
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry lookup + canonicalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a lookup map: routerId → telemetry entry.
 * Canonicalizes both surfaceId and routeId forms so scanner-derived routerIds
 * find their matching telemetry entry.
 */
function buildTelemetryIndex(telemetry) {
  const index = new Map();
  for (const entry of (telemetry.surfaces || [])) {
    // Prefer routeId when present (ordered cycle)
    if (entry.routeId) {
      const canon = canonicalizeTelemetryId(entry.routeId, true);
      index.set(canon, entry);
    } else if (entry.surfaceId) {
      const canon = canonicalizeTelemetryId(entry.surfaceId, false);
      index.set(canon, entry);
    }
  }
  return index;
}

function findTelemetry(opp, telemetryIndex) {
  return telemetryIndex.get(opp.routerId) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture profile classification (from OBSERVED ECONOMIC RUN LENGTH)
// ─────────────────────────────────────────────────────────────────────────────
//
// Boss C9: DO NOT use +1/+5 latency probabilities as the primary classifier.
// Instead, use max observed economic capture window length.
// ─────────────────────────────────────────────────────────────────────────────

function classifyCaptureProfile(telemetryEntry) {
  if (!telemetryEntry) return 'UNKNOWN_WINDOW';
  if (telemetryEntry.economicCount === 0) return 'UNKNOWN_WINDOW';
  const max = telemetryEntry.maxCaptureWindowBlocks || 0;
  if (max <= 0) return 'UNKNOWN_WINDOW';
  if (max === 1) return 'SAME_BLOCK_ONLY';
  if (max >= PERSISTENT_WINDOW_THRESHOLD_BLOCKS) return 'PERSISTENT_WINDOW';
  return 'SHORT_WINDOW';
}

// ─────────────────────────────────────────────────────────────────────────────
// Telemetry confidence
// ─────────────────────────────────────────────────────────────────────────────

function deriveTelemetryConfidence(telemetrySource, telemetryEntry) {
  // Per Boss C9: FIXTURE input ALWAYS caps at TEST_ONLY, regardless of data
  if (telemetrySource === 'FIXTURE') return 'TEST_ONLY';

  // If no telemetry entry, confidence is TEST_ONLY (we have nothing)
  if (!telemetryEntry) return 'TEST_ONLY';

  // For REPLAY/LIVE, scale confidence with observation count
  const n = telemetryEntry.observationCount || 0;
  if (telemetrySource === 'LIVE') {
    if (n >= 100) return 'HIGH';
    if (n >= 20)  return 'MEDIUM';
    return 'LOW';
  }
  if (telemetrySource === 'REPLAY') {
    if (n >= 100) return 'MEDIUM';
    if (n >= 20)  return 'LOW';
    return 'TEST_ONLY';
  }
  return 'TEST_ONLY';
}

// ─────────────────────────────────────────────────────────────────────────────
// Surface tier (V4.1)
// ─────────────────────────────────────────────────────────────────────────────

function classifyTier(executableCapacityUsd) {
  for (const t of TIER_THRESHOLDS_USD) {
    if (executableCapacityUsd >= t.minUsd) return t.name;
  }
  return 'TIER_0';
}

// ─────────────────────────────────────────────────────────────────────────────
// Financing dimensions (Class B composition)
// ─────────────────────────────────────────────────────────────────────────────

function computeFinancingDimensions(opp) {
  // For Class A (from Class B scanner), all financing info comes from Class B
  if (opp.sourceClass === 'A' && opp.flashHintFromScanner) {
    return {
      inventoryCapable: null,  // Class B scanner doesn't answer this for us
      flashEligible:    opp.flashHintFromScanner.available,
      flashBeneficial:  opp.flashHintFromScanner.improvesProfit
                     || opp.flashHintFromScanner.improvesCapacity,
      flashSource:      opp.flashHintFromScanner.source,
      flashAsset:       opp.flashHintFromScanner.asset,
    };
  }
  // For Class C/D, we have inventorySufficient from scanner hint but no
  // Class B integration in v1.  Router notes this as future composition.
  return {
    inventoryCapable: opp.inventorySufficientFromScanner,
    flashEligible:    null,   // c6 v1 does not chain Class B onto C/D
    flashBeneficial:  null,
    flashSource:      null,
    flashAsset:       null,
    _note: 'v1 does not chain Class B onto C/D; composition ["C","B"] or '
      + '["D","B"] will be materialized when live Class B integration lands.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunity class composition
// ─────────────────────────────────────────────────────────────────────────────

function composeOpportunityClass(opp, financing) {
  if (!opp.underlyingEconomic) return [];
  const base = [opp.sourceClass];
  // Only compose ["A","B"] when the flash overlay actually adds value
  if (opp.sourceClass === 'A' && financing.flashBeneficial === true) {
    return ['A', 'B'];
  }
  // For C/D, v1 does not chain B — see _note above
  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// Priority derivation (lexicographic, no pseudo-EV per Boss C9)
// ─────────────────────────────────────────────────────────────────────────────

function derivePriority({
  underlyingEconomic,
  telemetryEntry,
  telemetryConfidence,
  telemetrySource,
  captureProfile,
  surfaceTier,
}) {
  const basis = [];

  // SKIP — hard rejections
  if (!underlyingEconomic) {
    basis.push('!underlyingEconomic');
    return { priority: 'SKIP', basis };
  }
  if (telemetryEntry && telemetryEntry.economicCount === 0) {
    basis.push('telemetry.economicHitRate=0');
    return { priority: 'SKIP', basis };
  }

  // WATCH — fixture data or insufficient empirical confidence
  if (telemetryConfidence === 'TEST_ONLY') {
    basis.push(`telemetryConfidence=TEST_ONLY (source=${telemetrySource})`);
    return { priority: 'WATCH', basis };
  }
  if (!telemetryEntry) {
    basis.push('telemetryEntry=null (surface not in telemetry)');
    return { priority: 'WATCH', basis };
  }
  if (captureProfile === 'UNKNOWN_WINDOW') {
    basis.push('captureProfile=UNKNOWN_WINDOW');
    return { priority: 'WATCH', basis };
  }

  // LOW / MEDIUM / HIGH — real telemetry with sufficient confidence
  const rate = telemetryEntry.economicHitRate || 0;
  const usableCapture = captureProfile !== 'SAME_BLOCK_ONLY';
  const isPersistent = captureProfile === 'PERSISTENT_WINDOW';

  // HIGH: Tier 4, HIGH-confidence, recurrent economic, usable capture
  if (
    surfaceTier === 'TIER_4' &&
    telemetryConfidence === 'HIGH' &&
    rate >= HIGH_SIGNAL_MIN &&
    usableCapture
  ) {
    basis.push(`tier=${surfaceTier}`, `confidence=${telemetryConfidence}`, `rate=${rate.toFixed(3)}>=${HIGH_SIGNAL_MIN}`, `captureProfile=${captureProfile}`);
    return { priority: 'HIGH', basis };
  }

  // MEDIUM: Tier 3+, real telemetry, repeat econ observations, usable capture
  if (
    (surfaceTier === 'TIER_3' || surfaceTier === 'TIER_4') &&
    rate >= LOW_SIGNAL_MAX &&
    rate < HIGH_SIGNAL_MIN &&
    usableCapture
  ) {
    basis.push(`tier=${surfaceTier}`, `rate=${rate.toFixed(3)} in [${LOW_SIGNAL_MAX},${HIGH_SIGNAL_MIN})`, `captureProfile=${captureProfile}`);
    return { priority: 'MEDIUM', basis };
  }

  // LOW: Tier 2+, real telemetry, econ signal exists but weak
  if (
    ['TIER_2', 'TIER_3', 'TIER_4'].includes(surfaceTier) &&
    rate > 0
  ) {
    basis.push(`tier=${surfaceTier}`, `rate=${rate.toFixed(3)}`, `captureProfile=${captureProfile}`);
    return { priority: 'LOW', basis };
  }

  // Fallback — WATCH rather than skip
  basis.push('no LOW/MEDIUM/HIGH match; conservative default');
  return { priority: 'WATCH', basis };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route decision funnel (Boss C9 diagram)
// ─────────────────────────────────────────────────────────────────────────────

function decideRoute(opp, telemetryEntry, captureProfile, financing, priority, telemetryConfidence) {
  const reason = [];

  if (!opp.underlyingEconomic) {
    reason.push('UNDERLYING_NOT_ECONOMIC');
    return { routeDecision: 'SKIP', routeReason: reason };
  }
  reason.push('UNDERLYING_ECONOMIC');

  if (telemetryEntry && telemetryEntry.economicCount === 0) {
    reason.push('TELEMETRY_NEVER_ECONOMIC');
    return { routeDecision: 'SKIP', routeReason: reason };
  }

  if (!telemetryEntry) {
    reason.push('TELEMETRY_ABSENT');
  } else {
    reason.push(`CAPTURE_PROFILE=${captureProfile}`);
  }

  // Financing / inventory reasoning
  if (financing.inventoryCapable === true) {
    reason.push('INVENTORY_SUFFICIENT');
  } else if (financing.inventoryCapable === false) {
    reason.push('INVENTORY_INSUFFICIENT');
    if (financing.flashBeneficial === true) reason.push('FLASH_ADDS_VALUE');
    else if (financing.flashEligible === false) reason.push('FLASH_INELIGIBLE');
    else reason.push('FLASH_ADDS_NO_VALUE');
  } else if (financing.flashEligible === true && financing.flashBeneficial === false) {
    reason.push('FLASH_AVAILABLE_BUT_ADDS_NO_VALUE');
  }

  // Size revalidation
  if (telemetryEntry && (telemetryEntry.bindingConstraintTransitions || 0) > 0) {
    reason.push('SIZE_REVALIDATION_REQUIRED');
  }

  // Confidence gate
  if (telemetryConfidence === 'TEST_ONLY') {
    reason.push('TELEMETRY_TEST_ONLY_CAPS_AT_WATCH');
  }

  // Route decision maps directly from priority — the funnel already resolved it
  const routeDecision = priority === 'SKIP' ? 'SKIP' : priority;
  return { routeDecision, routeReason: reason };
}

// ─────────────────────────────────────────────────────────────────────────────
// Full per-opportunity processing
// ─────────────────────────────────────────────────────────────────────────────

function routeOpportunity(opp, telemetryIndex, telemetrySource) {
  const telemetryEntry = findTelemetry(opp, telemetryIndex);
  const telemetryConfidence = deriveTelemetryConfidence(telemetrySource, telemetryEntry);
  const telemetryLookupResult = telemetryEntry ? 'FOUND' : 'NOT_FOUND';

  const captureProfile = classifyCaptureProfile(telemetryEntry);
  const surfaceTier    = classifyTier(opp.executableCapacityUsd || 0);
  const financing      = computeFinancingDimensions(opp);
  const opportunityClass = composeOpportunityClass(opp, financing);

  const sizeRevalidationRequired = !!(
    telemetryEntry &&
    (telemetryEntry.bindingConstraintTransitions || 0) > 0
  );

  const { priority, basis: priorityBasis } = derivePriority({
    underlyingEconomic: opp.underlyingEconomic,
    telemetryEntry,
    telemetryConfidence,
    telemetrySource,
    captureProfile,
    surfaceTier,
  });

  const { routeDecision, routeReason } = decideRoute(
    opp, telemetryEntry, captureProfile, financing, priority, telemetryConfidence
  );

  return {
    routerId:                opp.routerId,
    rawSurfaceId:            opp.rawSurfaceId,
    sourceScanner:           opp.sourceScanner,
    sourceSchema:            opp.sourceSchema,
    sourceClass:             opp.sourceClass,
    opportunityClass,

    // Provenance
    telemetrySource,
    telemetryConfidence,
    telemetryLookupResult,

    // Sourced from scanner
    underlyingEconomic:      opp.underlyingEconomic,
    bestProfitSizeUsd:       opp.bestProfitSizeUsd,
    bestRoiSizeUsd:          opp.bestRoiSizeUsd,
    netEdgeBps:              opp.netEdgeBps,
    grossEdgeBps:            opp.grossEdgeBps,
    executableCapacityUsd:   opp.executableCapacityUsd,
    bindingConstraint:       opp.bindingConstraint,
    bindingLeg:              opp.bindingLeg,

    // Sourced from telemetry (or null when absent)
    candidateHitRate:        telemetryEntry ? telemetryEntry.candidateHitRate  : null,
    economicHitRate:         telemetryEntry ? telemetryEntry.economicHitRate   : null,
    maxCaptureWindowBlocks:  telemetryEntry ? telemetryEntry.maxCaptureWindowBlocks : null,
    bindingConstraintTransitions: telemetryEntry ? telemetryEntry.bindingConstraintTransitions : null,
    peakTimingKnown:         !!(telemetryEntry && telemetryEntry.captureWindows && telemetryEntry.captureWindows.length),
    typicalPeakOffsetBlocks: telemetryEntry && telemetryEntry.captureWindows && telemetryEntry.captureWindows.length
                              ? telemetryEntry.captureWindows[0].peakAtBlockOffset
                              : null,
    latencySurvival:         telemetryEntry ? telemetryEntry.captureProbabilityByLatency : null,

    // Router-derived classification
    captureProfile,
    captureProfileBasis:     CAPTURE_PROFILE_BASIS,
    captureProfilePolicy:    CAPTURE_PROFILE_POLICY,
    surfaceTier,
    sizeRevalidationRequired,

    // Financing dimensions (kept separate from atomicity per Boss C9)
    inventoryCapable:        financing.inventoryCapable,
    flashEligible:           financing.flashEligible,
    flashBeneficial:         financing.flashBeneficial,
    flashSource:             financing.flashSource,
    flashAsset:              financing.flashAsset,

    // Route decision
    routeDecision,
    routeReason,
    priority,
    priorityBasis,
    priorityPolicyVersion:   PRIORITY_POLICY_VERSION,

    // Class-specific passthrough
    extensions:              opp.extensionsFromScanner || {},

    // Constitutional
    executionAuthorized:     false,
    broadcastAuthorized:     false,
    capitalMovement:         false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output builders
// ─────────────────────────────────────────────────────────────────────────────

function buildRouterOutput(inputs, opportunities, telemetrySource) {
  const byRouteDecision = {};
  const byPriority = {};
  const byCaptureProfile = {};
  for (const o of opportunities) {
    byRouteDecision[o.routeDecision] = (byRouteDecision[o.routeDecision] || 0) + 1;
    byPriority[o.priority] = (byPriority[o.priority] || 0) + 1;
    byCaptureProfile[o.captureProfile] = (byCaptureProfile[o.captureProfile] || 0) + 1;
  }

  return {
    $schema: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    telemetrySource,
    captureProfilePolicy: CAPTURE_PROFILE_POLICY,
    priorityPolicyVersion: PRIORITY_POLICY_VERSION,
    inputSources: inputs,
    constitutional: {
      capitalLocked: true,
      broadcastLocked: true,
      executionLocked: true,
      analyticsOnly: true,
      note: 'c6 is an analytical opportunity router. Consumes B/C/D scanner '
        + 'outputs and c5 persistence telemetry. Produces routing decisions '
        + 'and reasoning trails. No execution, no broadcast, no capital '
        + 'movement. Per Boss C9 Wave 10B: analytics only.',
    },
    overall: {
      opportunityCount: opportunities.length,
      byRouteDecision,
      byPriority,
      byCaptureProfile,
    },
    opportunities,
  };
}

function fmt$(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  const n = Number(x);
  if (Math.abs(n) < 1)     return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1000)  return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtBps(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return 'n/a';
  return `${Number(x).toFixed(2)} bps`;
}

function fmtPct(x) {
  if (x === null || x === undefined) return 'n/a';
  return `${(Number(x) * 100).toFixed(1)}%`;
}

function renderHumanSummary(output) {
  const L = [];
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(' Opportunity Router — v1');
  L.push('═══════════════════════════════════════════════════════════════════');
  L.push(` Schema version:            ${output.$schema}`);
  L.push(` Generated at:              ${output.generatedAt}`);
  L.push(` Telemetry source:          ${output.telemetrySource}`);
  L.push(` Capture profile policy:    ${output.captureProfilePolicy}`);
  L.push(` Priority policy version:   ${output.priorityPolicyVersion}`);
  L.push(' Input sources:');
  L.push(`   Class B:                 ${output.inputSources.classB}`);
  L.push(`   Class C:                 ${output.inputSources.classC}`);
  L.push(`   Class D:                 ${output.inputSources.classD}`);
  L.push(`   Telemetry:               ${output.inputSources.telemetry}`);
  L.push(' Constitutional state:');
  L.push(`   Capital LOCKED:          ${output.constitutional.capitalLocked}`);
  L.push(`   Broadcast LOCKED:        ${output.constitutional.broadcastLocked}`);
  L.push(`   Execution LOCKED:        ${output.constitutional.executionLocked}`);
  L.push(`   Analytics only:          ${output.constitutional.analyticsOnly}`);
  L.push('');
  L.push(' ── OVERALL ──');
  const o = output.overall;
  L.push(`   Opportunities:           ${o.opportunityCount}`);
  L.push(`   By routeDecision:        ${JSON.stringify(o.byRouteDecision)}`);
  L.push(`   By priority:             ${JSON.stringify(o.byPriority)}`);
  L.push(`   By captureProfile:       ${JSON.stringify(o.byCaptureProfile)}`);

  for (const op of output.opportunities) {
    L.push('');
    L.push(` ── ${op.routerId} ──`);
    L.push(`   sourceScanner:           ${op.sourceScanner}`);
    L.push(`   opportunityClass:        [${op.opportunityClass.join(', ')}]`);
    L.push(`   underlyingEconomic:      ${op.underlyingEconomic}`);
    L.push(`   telemetryLookupResult:   ${op.telemetryLookupResult}`);
    L.push(`   telemetryConfidence:     ${op.telemetryConfidence}`);
    L.push('   Scanner-sourced:');
    L.push(`     bestProfitSizeUsd:     ${fmt$(op.bestProfitSizeUsd)}`);
    L.push(`     bestRoiSizeUsd:        ${fmt$(op.bestRoiSizeUsd)}`);
    L.push(`     netEdgeBps:            ${fmtBps(op.netEdgeBps)}`);
    L.push(`     executableCapacityUsd: ${fmt$(op.executableCapacityUsd)}`);
    L.push(`     surfaceTier (V4.1):    ${op.surfaceTier}`);
    L.push(`     bindingConstraint:     ${op.bindingConstraint || 'n/a'}`);
    if (op.bindingLeg !== null) L.push(`     bindingLeg:            ${op.bindingLeg}`);
    L.push('   Telemetry-sourced:');
    L.push(`     candidateHitRate:      ${fmtPct(op.candidateHitRate)}`);
    L.push(`     economicHitRate:       ${fmtPct(op.economicHitRate)}`);
    L.push(`     maxCaptureWindowBlks:  ${op.maxCaptureWindowBlocks === null ? 'n/a' : op.maxCaptureWindowBlocks}`);
    L.push(`     bindingTransitions:    ${op.bindingConstraintTransitions === null ? 'n/a' : op.bindingConstraintTransitions}`);
    L.push(`     peakTimingKnown:       ${op.peakTimingKnown}`);
    L.push(`     typicalPeakOffsetBlks: ${op.typicalPeakOffsetBlocks === null ? 'n/a' : op.typicalPeakOffsetBlocks}`);
    L.push('   Router-derived:');
    L.push(`     captureProfile:        ${op.captureProfile}`);
    L.push(`     sizeRevalidationReqd:  ${op.sizeRevalidationRequired}`);
    L.push(`     inventoryCapable:      ${op.inventoryCapable === null ? 'n/a' : op.inventoryCapable}`);
    L.push(`     flashEligible:         ${op.flashEligible === null ? 'n/a' : op.flashEligible}`);
    L.push(`     flashBeneficial:       ${op.flashBeneficial === null ? 'n/a' : op.flashBeneficial}`);
    L.push(`   ROUTE DECISION:          ${op.routeDecision}`);
    L.push(`   PRIORITY:                ${op.priority}`);
    L.push('   Reason trail:');
    for (const r of op.routeReason) L.push(`     - ${r}`);
    L.push('   Priority basis:');
    for (const b of op.priorityBasis) L.push(`     - ${b}`);
    L.push(`   executionAuthorized:     ${op.executionAuthorized}`);
  }

  L.push('');
  L.push(' ── Interpretation ──');
  L.push('   Router produces one deterministic decision per opportunity');
  L.push('   with a full reasoning trail. Fixture inputs cap all decisions');
  L.push('   at WATCH regardless of underlying economics — synthetic data');
  L.push('   must never become production policy (Boss C9 mandate 3).');
  L.push('   Atomicity (captureProfile) and financing (flash/inventory) are');
  L.push('   kept orthogonal (Boss C9 mandate 2).');
  L.push('');
  L.push(' Capital LOCKED. Proven winner UNTOUCHED. Broadcast LOCKED.');
  L.push(' c6 emits planning decisions, not execution instructions.');
  L.push('');

  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI arg parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { ...DEFAULT_PATHS, telemetrySource: DEFAULT_TELEMETRY_SOURCE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--class-b')          { args.classB = v;    i++; }
    else if (a === '--class-c')     { args.classC = v;    i++; }
    else if (a === '--class-d')     { args.classD = v;    i++; }
    else if (a === '--telemetry')   { args.telemetry = v; i++; }
    else if (a === '--telemetry-source') { args.telemetrySource = v; i++; }
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  const validSources = ['FIXTURE', 'REPLAY', 'LIVE'];
  if (!validSources.includes(args.telemetrySource)) {
    process.stderr.write(`error: --telemetry-source must be one of ${validSources.join(',')}\n`);
    process.exit(1);
  }

  let classB, classC, classD, telemetry;
  try {
    classB    = loadJson(args.classB);
    classC    = loadJson(args.classC);
    classD    = loadJson(args.classD);
    telemetry = loadJson(args.telemetry);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }

  // Extract opportunities from all three scanner outputs
  const rawOpps = [
    ...extractFromClassB(classB),
    ...extractFromClassC(classC),
    ...extractFromClassD(classD),
  ];

  // Build telemetry index
  const telemetryIndex = buildTelemetryIndex(telemetry);

  // Route each opportunity
  const decisions = rawOpps.map(o => routeOpportunity(o, telemetryIndex, args.telemetrySource));

  // Deterministic sort by routerId
  decisions.sort((a, b) => a.routerId.localeCompare(b.routerId));

  const output = buildRouterOutput(
    {
      classB: args.classB,
      classC: args.classC,
      classD: args.classD,
      telemetry: args.telemetry,
    },
    decisions,
    args.telemetrySource,
  );

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.stderr.write(renderHumanSummary(output) + '\n');
}

main();
