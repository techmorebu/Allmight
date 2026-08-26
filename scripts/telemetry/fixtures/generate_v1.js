#!/usr/bin/env node
/*
 * ═══════════════════════════════════════════════════════════════════════════
 * Fixture corpus generator for Class Persistence Telemetry v1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Generates a deterministic adversarial JSONL corpus that exercises every
 * capability of the persistence aggregator.  Boss C9 required four distinct
 * behavioral shapes:
 *
 *   Shape A — clean 3–5 block profitable burst (surface appears, is economic
 *             for a short run, then dies).  Tests capture-window detection
 *             and short-latency survival buckets.
 *
 *   Shape B — oscillating in/out opportunity (candidate flickers on/off).
 *             Tests that max-consecutive stays low even when candidate rate
 *             is high, and that many onsets aggregate correctly.
 *
 *   Shape C — candidate that never becomes net-economic (candidate rate > 0
 *             but economic rate = 0).  The critical diagnostic Boss called
 *             out: "surface may show discrepancies constantly but almost
 *             never produce net-positive execution."
 *
 *   Shape D — longer-lived opportunity whose binding constraint changes
 *             during the event.  Tests bindingConstraint transitions and
 *             longer-latency survival buckets.
 *
 * All observations are per-block; block spacing 0.25s (Arbitrum), starting
 * at block 100 through block 159 = 60 blocks = 15 seconds fixture window.
 * That gives us 4 surfaces × 60 blocks = 240 observation records.
 *
 * candidate=false records are MANDATORY per Boss C9 (frequency math needs
 * "nothing here" observations).
 *
 * Output: NDJSON to stdout.  Deploy captures to fixtures/observations_v1.jsonl.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const BASE_BLOCK       = 100;
const BASE_TIME_MS     = Date.parse('2026-06-05T14:00:00.000Z');
const BLOCK_SPACING_MS = 250;   // Arbitrum ~0.25s blocks
const TOTAL_BLOCKS     = 60;
const THRESHOLD_NET_BPS = 5;    // canonical minimum net edge to be "economic"

// ─────────────────────────────────────────────────────────────────────────────
// Surface definitions
// ─────────────────────────────────────────────────────────────────────────────

const SURFACES = [
  {
    surfaceId: 'arbitrum:WETH-USDC:ramses_v2>uniswap_v3',
    routeId:   null,
    opportunityClass: ['A'],
    sourceScanner: 'class_a_cross_venue',        // fixture: no real scanner yet
    sourceSchema:  'class_a_cross_venue_scan_v1',
    shape: 'A_clean_burst',
  },
  {
    surfaceId: 'arbitrum:USDC-USDT:univ3>curve',
    routeId:   null,
    opportunityClass: ['D'],
    sourceScanner: 'class_d_stablecoin_basis',
    sourceSchema:  'class_d_stablecoin_basis_scan_v1',
    shape: 'B_oscillating',
  },
  {
    surfaceId: 'arbitrum:USDC-USDCE:univ3_100bp>univ3_500bp',
    routeId:   null,
    opportunityClass: ['D'],
    sourceScanner: 'class_d_stablecoin_basis',
    sourceSchema:  'class_d_stablecoin_basis_scan_v1',
    shape: 'C_never_economic',
  },
  {
    surfaceId: 'arbitrum:WETH-USDC-ARB-WETH:univ3>camelot>univ3',
    routeId:   'arbitrum:WETH>USDC>ARB>WETH:univ3>camelot>univ3',
    opportunityClass: ['C'],
    sourceScanner: 'class_c_triangular',
    sourceSchema:  'class_c_triangular_scan_v1',
    shape: 'D_long_lived_transition',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Shape encoders — return { candidate, economic, grossEdgeBps, netEdgeBps,
//                           bestProfitSizeUsd, executableCapacityUsd,
//                           bindingConstraint } per block offset
// ─────────────────────────────────────────────────────────────────────────────

function observationForShape(shape, blockOffset) {
  switch (shape) {
    case 'A_clean_burst':
      // Blocks 16-19: economic burst.  Peak at block 17.
      if (blockOffset >= 16 && blockOffset <= 19) {
        const netEdges  = [24, 32, 28, 15];
        const grossEdges = [45, 55, 50, 30];
        const idx = blockOffset - 16;
        return {
          candidate: true,
          economic: netEdges[idx] >= THRESHOLD_NET_BPS,
          grossEdgeBps: grossEdges[idx],
          netEdgeBps: netEdges[idx],
          bestProfitSizeUsd: 3000,
          executableCapacityUsd: 7000000,   // deep Ramses-class surface
          bindingConstraint: 'SPREAD',
        };
      }
      return { candidate: false, economic: false };

    case 'B_oscillating': {
      // Onsets at blocks 5, 7, 9, 12, 15, 18, 21, 25, 28 (each 1-block only)
      // Some are economic, some are not.  Between onsets: no candidate.
      const onsetTable = {
        5:  { net: 18, gross: 26, cap: 8000 },
        7:  { net: 22, gross: 30, cap: 9000 },
        9:  { net: 15, gross: 24, cap: 7000 },
        12: { net: 3,  gross: 12, cap: 5000 },  // sub-threshold: not economic
        15: { net: 20, gross: 28, cap: 8500 },
        18: { net: 4,  gross: 11, cap: 4500 },  // sub-threshold
        21: { net: 26, gross: 34, cap: 9500 },
        25: { net: 17, gross: 25, cap: 8000 },
        28: { net: 8,  gross: 16, cap: 6000 },
      };
      const hit = onsetTable[blockOffset];
      if (hit) {
        return {
          candidate: true,
          economic: hit.net >= THRESHOLD_NET_BPS,
          grossEdgeBps: hit.gross,
          netEdgeBps: hit.net,
          bestProfitSizeUsd: 5000,
          executableCapacityUsd: hit.cap,
          bindingConstraint: 'VENUE_SLIPPAGE',
        };
      }
      return { candidate: false, economic: false };
    }

    case 'C_never_economic': {
      // Regular candidate presence (blocks 3, 8, 13, 18, 23, 28, 33, 38)
      // but netEdge always below THRESHOLD_NET_BPS.
      const onsetBlocks = [3, 8, 13, 18, 23, 28, 33, 38];
      if (onsetBlocks.includes(blockOffset)) {
        // Deterministic sub-threshold values
        const netEdges = [1.2, 2.4, 0.8, 3.1, 2.7, 1.5, 3.8, 2.2];
        const idx = onsetBlocks.indexOf(blockOffset);
        return {
          candidate: true,
          economic: false,  // always false — key diagnostic per Boss C9
          grossEdgeBps: 8.0 + netEdges[idx],  // gross exists but fees eat it
          netEdgeBps: netEdges[idx],
          bestProfitSizeUsd: null,
          executableCapacityUsd: 3000000,
          bindingConstraint: 'SWAP_FEES',
        };
      }
      return { candidate: false, economic: false };
    }

    case 'D_long_lived_transition':
      // Blocks 30-45: 16-block continuous economic run.
      // Binding constraint transitions:
      //   30-34  LEG_SLIPPAGE (leg 2 dominates)
      //   35-39  LEG_DEPTH   (depth erodes on venue)
      //   40-45  SWAP_FEES   (spread narrows, fees dominate)
      if (blockOffset >= 30 && blockOffset <= 45) {
        let binding, netEdge, grossEdge;
        if (blockOffset <= 34) {
          binding = 'LEG_SLIPPAGE';
          netEdge = 40 - (blockOffset - 30) * 2;   // 40, 38, 36, 34, 32
          grossEdge = netEdge + 15;
        } else if (blockOffset <= 39) {
          binding = 'LEG_DEPTH';
          netEdge = 28 - (blockOffset - 35) * 1;   // 28, 27, 26, 25, 24
          grossEdge = netEdge + 12;
        } else {
          binding = 'SWAP_FEES';
          netEdge = 20 - (blockOffset - 40) * 2;   // 20, 18, 16, 14, 12, 10
          grossEdge = netEdge + 10;
        }
        return {
          candidate: true,
          economic: netEdge >= THRESHOLD_NET_BPS,
          grossEdgeBps: grossEdge,
          netEdgeBps: netEdge,
          bestProfitSizeUsd: 1000,
          executableCapacityUsd: 52000,   // Camelot leg 2 dominates
          bindingConstraint: binding,
        };
      }
      return { candidate: false, economic: false };

    default:
      throw new Error(`unknown shape: ${shape}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Emit corpus
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const records = [];

  // Interleaved by (surface, block) — that's what a live observer would produce
  for (let blockOffset = 0; blockOffset < TOTAL_BLOCKS; blockOffset++) {
    const block = BASE_BLOCK + blockOffset;
    const timestampMs = BASE_TIME_MS + blockOffset * BLOCK_SPACING_MS;
    const observedAt = new Date(timestampMs).toISOString();

    for (const surface of SURFACES) {
      const obs = observationForShape(surface.shape, blockOffset);

      const record = {
        observedAt,
        block,
        surfaceId: surface.surfaceId,
        routeId: surface.routeId,
        opportunityClass: surface.opportunityClass,
        candidate: obs.candidate,
        economic: obs.economic,
        thresholdNetEdgeBps: THRESHOLD_NET_BPS,
        grossEdgeBps: obs.candidate ? obs.grossEdgeBps : null,
        netEdgeBps: obs.candidate ? obs.netEdgeBps : null,
        bestProfitSizeUsd: obs.candidate ? (obs.bestProfitSizeUsd ?? null) : null,
        executableCapacityUsd: obs.candidate ? obs.executableCapacityUsd : null,
        bindingConstraint: obs.candidate ? obs.bindingConstraint : null,
        sourceScanner: surface.sourceScanner,
        sourceSchema: surface.sourceSchema,
        extensions: {},
      };

      records.push(record);
    }
  }

  for (const r of records) {
    process.stdout.write(JSON.stringify(r) + '\n');
  }

  process.stderr.write(`generated ${records.length} observation records ` +
    `(${SURFACES.length} surfaces × ${TOTAL_BLOCKS} blocks)\n`);
}

main();
