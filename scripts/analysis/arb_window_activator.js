'use strict';
/**
 * scripts/analysis/arb_window_activator.js
 *
 * Purpose:
 *   Automate transitions between PASSIVE → ARMED → EXECUTABLE states.
 *   Connects tick map thresholds → price monitoring → depth gate → simulator → signal.
 *
 * Key distinction from arb_opportunity_watcher.js:
 *   The watcher uses hardcoded price thresholds ($0.1000).
 *   This activator derives thresholds DYNAMICALLY from a live tick map query.
 *   If liquidity moves (LP repositions), the activator adapts automatically.
 *   It also emits structured EXECUTION_READY signals — the clean output layer
 *   that future execution logic will consume.
 *
 * Architecture (Boss ruling 2026-03-23):
 *   [tick map]  → nearest HIGH zone price  → ARMED threshold
 *   [price]     → crosses ARMED threshold  → switch to high-freq
 *   [depth]     → crosses $15k             → run simulator
 *   [simulator] → passes Boss gate          → emit EXECUTION_READY
 *
 * Signal format (EXECUTION_READY):
 *   {
 *     "signal":      "EXECUTION_READY",
 *     "ts":          "ISO timestamp",
 *     "block":       444810000,
 *     "uniPrice":    0.101200,
 *     "camPrice":    0.100900,
 *     "uniDepth":    17650.00,
 *     "spread":      0.22600,
 *     "bestSize":    25,
 *     "bestDelay":   0,
 *     "finalEdge":   0.07990,
 *     "gasSource":   "live",
 *     "gasPriceGwei": 0.008000,
 *     "armedThreshold":  0.1000,       ← derived from tick map
 *     "nearestHighTick": -299250,
 *     "nearestHighPrice": 0.101015,
 *     "nearestHighDepth": 17650.97
 *   }
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_window_activator.js
 *   node -r dotenv/config scripts/analysis/arb_window_activator.js --duration=28800
 *   node -r dotenv/config scripts/analysis/arb_window_activator.js --gas=manual
 *   node -r dotenv/config scripts/analysis/arb_window_activator.js --log=./logs/activator.jsonl
 *   node -r dotenv/config scripts/analysis/arb_window_activator.js --remap-ticks
 *     (force a fresh tick map scan on startup instead of using cached thresholds)
 *
 * Hard rules:
 *   - NO execution logic
 *   - NO contract deployment or calls beyond pool reads + getFeeData
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *   - Serial loops with sleep for multi-tick/delay reads
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// PAIR CONFIG MAP — one entry per supported surface.
// Swaps pool addresses, fees, decimals, and tick spacing by --pair flag.
// All depth/arm/ready thresholds are universal — unchanged per pair.
// ─────────────────────────────────────────────────────────────────────────────
const PAIR_CONFIGS = {
  'ARB/USDC': {
    univ3Pool:          '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8',
    univ3FeeFrac:       0.0005,
    camelotPool:        '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1',
    camelotFeeFrac:     0.000249,
    tickSpacing:        10,      // UniV3 0.05% pool spacing
    dec0:               18,      // ARB
    dec1:               6,       // USDC
    staticArmedPrice:   0.1000,
    // Static fallback thresholds from last confirmed tick-map scan (2026-03-23).
    // Used when --remap-ticks is NOT passed. ARB/USDC only.
    staticHighTick:     -299250,
    staticHighPrice:    0.101015,
    staticHighDepth:    17650.97,
    staticCurrentTick:  -300177,
    staticCurrentPrice: 0.092079,
  },
  'ETH/USDC': {
    univ3Pool:          '0x6f38e884725a116C9C7fBF208e79FE8828a2595F',
    univ3FeeFrac:       0.0001,
    camelotPool:        '0xB1026b8e7276e7AC75410F1fcbbe21796e8f7526',
    camelotFeeFrac:     0.0001,  // fallback only — feeZto read live from globalState()
    tickSpacing:        1,       // UniV3 0.01% pool spacing
    dec0:               18,      // WETH
    dec1:               6,       // USDC
    staticArmedPrice:   1800.00, // informational fallback — always use --remap-ticks
    // No valid static thresholds — tick-map scan required.
    // Without --remap-ticks: isProximate=false, activator stays PASSIVE (safe).
    staticHighTick:     null,
    staticHighPrice:    null,
    staticHighDepth:    null,
    staticCurrentTick:  null,
    staticCurrentPrice: null,
  },

  // ── ETH/USDT (Boss ruling 2026-04-03) ─────────────────────────────────────
  // First valid surface with sustained cross-venue edge.
  // UniV3 0.01% (thin leg $36.5k) vs Camelot V3 ($121.2k).
  // Timeseries: 80% positive rate, 16 consecutive scans, mean net +0.0299%.
  // Classification: MONITOR (PROMOTABLE) — depth-constrained, not spread-constrained.
  // Depth promotion target: $36.5k → $50k+ on thin leg.
  // tick spacing=1 on UniV3 0.01% — remap-ticks is slower than ARB/USDC, expected.
  'ETH/USDT': {
    univ3Pool:          '0x42161084d0672e1d3F26a9B53E653bE2084ff19C',  // UniV3 0.01%
    univ3FeeFrac:       0.0001,
    camelotPool:        '0x7CcCBA38E2D959fe135e79AEBB57CCb27B128358',  // Camelot V3
    camelotFeeFrac:     0.0001,  // fallback — feeZto read live from globalState()
    tickSpacing:        1,       // UniV3 0.01% pool spacing
    dec0:               18,      // WETH
    dec1:               6,       // USDT
    staticArmedPrice:   1800.00, // informational fallback — always use --remap-ticks
    // No valid static thresholds — tick-map scan required.
    // Without --remap-ticks: isProximate=false, activator stays PASSIVE (safe).
    staticHighTick:     null,
    staticHighPrice:    null,
    staticHighDepth:    null,
    staticCurrentTick:  null,
    staticCurrentPrice: null,
  },

  // ── ETH/USDC-RAMSES (Boss ruling 2026-04-04) ──────────────────────────────
  // VENUE INERTIA surface — Ramses V2 reprices slower than UniV3/Camelot.
  // Timeseries: CONFIRMED promotion scan #3, net +0.0169% after compression.
  // Peak spread at dislocation: +0.097% (Ramses frozen, market converged upward).
  // Mechanism: LP range imbalance causes Ramses to lag market repricing.
  // Classification: CANDIDATE (STRUCTURAL, UNDER VALIDATION)
  //
  // KEY: Ramses V2 uses slot0() like UniV3, NOT globalState() like Algebra.
  // camelotType:'univ3' instructs readBothPools() to call slot0() on pool B.
  // camelotFeeFrac = 0.0005 (Ramses 0.05% fixed fee — no dynamic read needed).
  // tickSpacing = 1 (UniV3 0.01% pool is the tick-map source).
  'ETH/USDC-RAMSES': {
    univ3Pool:          '0x6f38e884725a116C9C7fBF208e79FE8828a2595F',  // UniV3 0.01% ETH/USDC
    univ3FeeFrac:       0.0001,
    camelotPool:        '0x30AFBcF9458c3131A6d051C621E307E6278E4110',  // Ramses V2 0.05%
    camelotFeeFrac:     0.0005,  // fixed — Ramses fee confirmed 0.05%, no globalState() needed
    camelotType:        'univ3', // DISPATCH FLAG: use slot0() not globalState() for pool B
    tickSpacing:        1,       // UniV3 0.01% tick spacing (tick-map source)
    dec0:               18,      // WETH
    dec1:               6,       // USDC
    staticArmedPrice:   1800.00, // informational fallback — always use --remap-ticks
    staticHighTick:     null,
    staticHighPrice:    null,
    staticHighDepth:    null,
    staticCurrentTick:  null,
    staticCurrentPrice: null,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS — populated from PAIR_CONFIGS in main() via --pair flag.
// Declared as let so main() can assign before activatorLoop() runs.
// ─────────────────────────────────────────────────────────────────────────────
let UNIV3_POOL       = '';
let UNIV3_FEE_FRAC   = 0;
let CAMELOT_POOL     = '';
let CAMELOT_FEE_FRAC = 0;
let CAMELOT_TYPE     = 'algebra';  // 'algebra' → globalState() | 'univ3' → slot0()
let TICK_SPACING     = 10;
let DEC0 = 18;
let DEC1 = 6;

// ─────────────────────────────────────────────────────────────────────────────
// THRESHOLDS — static fallbacks, overridden by live tick map
// ─────────────────────────────────────────────────────────────────────────────
const STATIC_ARMED_PRICE    = 0.1000;   // confirmed_default: Boss-approved static pre-alert price   // Boss-approved static fallback
const DEPTH_EXECUTION       = 15_000;   // confirmed_default: Boss-approved execution gate
const TICK_MAP_SCAN_RANGE   = 5_000;    // confirmed_default: ±ticks for threshold derivation    // ±5000 ticks for threshold derivation
const ARMED_BUFFER_TICKS    = 80;       // confirmed_default: ticks below HIGH zone to arm early       // ticks below HIGH zone to arm early

// ─────────────────────────────────────────────────────────────────────────────
// POLLING
// ─────────────────────────────────────────────────────────────────────────────
const POLL_PASSIVE_MS       = 1_500;
const POLL_ARMED_MS         =   500;
const COOLDOWN_AFTER_SIM_MS = 10_000;
const TICK_MAP_REFRESH_MS   = 30 * 60 * 1000;  // confirmed_default: 30-min refresh interval  // re-run tick map every 30 min

// ─────────────────────────────────────────────────────────────────────────────
// PROXIMITY ARM THRESHOLDS (Boss ruling 2026-03-27)
// Replaces fixed absolute armedPrice trigger with relative market geometry.
// ARM when price approaches nearestHighTick zone — not when it crosses a static level.
// ─────────────────────────────────────────────────────────────────────────────
const ARM_TICK_DISTANCE      = 150;    // ticks from nearestHighTick → arm
const ARM_PRICE_DISTANCE_BPS = 120;    // bps from nearestHighPrice  → arm
const ARM_MIN_DEPTH_USD      = 7_000;  // active-tick depth floor to arm
const READY_MIN_DEPTH_USD    = 10_000; // candidate floor for READY_CHECK (hard — do not lower)
const READY_CONFIRM_SCANS    = 3;      // consecutive scans above READY floor to confirm

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH THRESHOLDS — stale-state detection (Boss ruling 2026-03-24)
// ─────────────────────────────────────────────────────────────────────────────
const HEALTH_POOL_STALE_MS     =  30_000;   // pool read silent for > 30s → unhealthy
const HEALTH_BLOCK_FROZEN_MS   =  60_000;   // block number unchanged for > 60s → frozen
const HEALTH_TICKMAP_STALE_MS  =  35 * 60 * 1000;  // tick map not refreshed in > 35 min
const HEALTH_CHECK_INTERVAL_MS =  60_000;   // run health check every 60s
const HEARTBEAT_TICKS           =  200;        // confirmed_default: emit heartbeat every N ticks

// ─────────────────────────────────────────────────────────────────────────────
// SELF-RECOVERY LADDER (Boss ruling 2026-03-25)
//   Level 1 — single read timeout     → log + continue
//   Level 2 — N consecutive timeouts  → STATE_UNHEALTHY + rebuild provider
//   Level 3 — provider rebuild fails M times → exit non-zero (clean crash)
//
//   A clean crash is better than a zombie.
// ─────────────────────────────────────────────────────────────────────────────
const READ_TIMEOUT_MS           =  8_000;   // confirmed_default: outer hard timeout per loop read
const CONSECUTIVE_FAIL_WARN     =  3;       // confirmed_default: log warning at this many consecutive failures
const CONSECUTIVE_FAIL_REBUILD  =  5;       // confirmed_default: rebuild provider after this many
const MAX_PROVIDER_REBUILDS     =  5;       // Boss ruling 2026-04-06: increased from 3 → 5 for longer runs
// Exponential backoff between rebuild attempts (Boss ruling 2026-04-06)
// 1st: 2s, 2nd: 4s, 3rd: 8s, 4th: 16s, 5th: 30s (capped)
const REBUILD_BACKOFF_BASE_MS   = 2_000;
const REBUILD_BACKOFF_CAP_MS    = 30_000;
// After this many rebuilds, force SAFE profile (degraded mode — Boss ruling 2026-04-06)
const REBUILD_DEGRADED_AFTER    = 3;

// ─────────────────────────────────────────────────────────────────────────────
// SIM CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const TRIGGER_BUFFER_PCT = 0.02;
const TRIGGER_SIZE_USD   = 25;
const SIM_SIZE_RANGE     = [25, 50, 100, 200, 500];   // full sweep — reveals size-efficiency cliff
const SIM_DELAY_RANGE    = [0, 1, 2];

// ─────────────────────────────────────────────────────────────────────────────
// REGIME CLASSIFICATION THRESHOLD (Boss ruling 2026-04-03)
// Separates base-depth regime ($18k) from LP-surge regime ($1M+).
// Label added to all state_transition, heartbeat, and signal records.
// ─────────────────────────────────────────────────────────────────────────────
const REGIME_SURGE_THRESHOLD = 100_000;  // depth above this = 'surge', below = 'base'

// ─────────────────────────────────────────────────────────────────────────────
// GAS MODEL
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// GAS MODEL (Boss ruling 2026-04-04)
// Canonical model = 1 atomic on-chain transaction (flash-loan-style multicall).
// Three profiles for sensitivity analysis — baseline used at runtime.
// Previous model (500k) was a single light read; understated real execution cost.
// ─────────────────────────────────────────────────────────────────────────────
const GAS_PROFILES = {
  atomic_optimistic: 700_000,   // optimistic atomic multicall
  atomic_baseline  : 900_000,   // canonical baseline for signal classification
  atomic_stressed  : 1_200_000, // stressed / complex routing
};
// --gas-profile flag selects profile. Default = atomic_baseline (conservative).
// Use --gas-profile atomic_optimistic for 700k comparison runs (Boss ruling 2026-04-05).
const GAS_PROFILE_ARG = (() => {
  const i = process.argv.indexOf('--gas-profile');
  if (i !== -1 && process.argv[i+1]) return process.argv[i+1];
  const eq = process.argv.find(a => a.startsWith('--gas-profile='));
  return eq ? eq.split('=')[1] : 'atomic_baseline';
})();
const GAS_UNITS_ACTIVE = GAS_PROFILES[GAS_PROFILE_ARG] ?? GAS_PROFILES.atomic_baseline;

const GAS_MANUAL = {
  gasPriceGwei: 0.01, estimatedUnits: GAS_UNITS_ACTIVE, ethPriceUSD: 2000, source: 'manual',
};

// ─────────────────────────────────────────────────────────────────────────────
// REGIME-BASED PROFILE SELECTOR v4 (Boss directive 2026-04-07)
// ─────────────────────────────────────────────────────────────────────────────
// v3 → v4 change: data from three runs proved 0.13% is the hard viability
// boundary for ETH/USDC-Ramses. Below 0.13%: 0/56 viable signals.
// Above 0.13%: 145/232 viable (62%).
//
// NEW RULE: spread floor is a SURFACE LAW, not a profile preference.
// All profiles now share the same minimum viable spread.
// Profiles differ ONLY by timing, stability, and eco requirements.
//
// Profile intent:
//   SAFE       → precision mode. Fail-closed default. Post-rebuild / startup / degraded.
//   BALANCED   → bridge mode. Reduce missed signals inside proven viable regime.
//   AGGRESSIVE → event-capture mode. Fast response, same hard floor.
// ─────────────────────────────────────────────────────────────────────────────

// SURFACE LAW — do not move this inside profiles or make it configurable at runtime.
// Data-proven: 0/56 signals viable below this threshold (v2+v3 runs, 2026-04-07).
// UNITS: pct form (0.13 = 0.13%) — matches signal.spread field which is also pct form.
// DO NOT use fraction form (0.0013) — the gate comparison will always pass (bug found v4).
const MIN_VIABLE_SPREAD_PCT  = 0.13;   // 0.13% — hard viability floor, pct form for gate comparison
const MIN_VIABLE_SPREAD_FRAC = 0.0013; // 0.13% — fraction form for logging/audit fields only

const ENTRY_PROFILES = {
  // SAFE — highest precision, most confirmation required.
  // Default on: startup, post-rebuild, RPC degraded, regime uncertain.
  SAFE: {
    minStableSamples:   5,       // most confirmation
    maxSpreadStdDev:    0.006,   // tightest variance
    minEntrySpread:     MIN_VIABLE_SPREAD_PCT,   // hard floor pct-form — surface law
    minDepthUsd:        200_000, // $200k depth floor (recommender-proven)
    minEcoViableRate:   0,
    label:              'SAFE',
  },
  // BALANCED — bridge mode. Same spread floor, more permissive timing/stability.
  // No longer explores sub-viable spread zones (v4 change — data-proven useless).
  BALANCED: {
    minStableSamples:   3,       // moderate confirmation
    maxSpreadStdDev:    0.012,   // moderate variance tolerance
    minEntrySpread:     MIN_VIABLE_SPREAD_PCT,   // same hard floor pct-form — v4 change (was 0.11)
    minDepthUsd:        150_000, // $150k depth floor
    minEcoViableRate:   0,
    label:              'BALANCED',
  },
  // AGGRESSIVE — event-capture mode. Fast response inside proven viable regime.
  // Still bounded by hard spread floor — "aggressive" = timing, not recklessness.
  AGGRESSIVE: {
    minStableSamples:   2,       // fastest confirmation
    maxSpreadStdDev:    0.015,   // loosest variance (still bounded)
    minEntrySpread:     MIN_VIABLE_SPREAD_PCT,   // same hard floor pct-form
    minDepthUsd:        100_000, // $100k depth floor
    minEcoViableRate:   0,
    label:              'AGGRESSIVE',
  },
};

// Hysteresis rules (Boss mandate — prevents thrashing)
// Upgrade requires conditions to hold for MIN_UPGRADE_TICKS
// Downgrade requires MIN_DOWNGRADE_TICKS of degraded conditions (except safety)
const PROFILE_HYSTERESIS = {
  upgradeMinTicks:   20,   // ~10s at 500ms poll — must hold before upgrading
  downgradeMinTicks:  6,   // ~3s degraded before downgrading (safety bypasses)
  safetyDowngradeTicks: 1, // immediate downgrade if depth below ARM_MIN_DEPTH_USD
};

// ─────────────────────────────────────────────────────────────────────────────
// JSONL BASE ENVELOPE (Pass B1)
// ─────────────────────────────────────────────────────────────────────────────
const LOG_SOURCE = 'arb_window_activator';
const LOG_CHAIN  = 'arbitrum';
let   LOG_PAIR   = 'ARB/USDC';  // overridden by --pair flag in main()

async function fetchLiveGasModel(rpc) {
  try {
    const res = await rpc.callDetailed('act.gas', async (p) => p.getFeeData(), { timeoutMs: 3000, hedge: true });
    const fd  = res.result;
    const wei = fd.gasPrice ?? fd.maxFeePerGas ?? fd.lastBaseFeePerGas;
    if (!wei) throw new Error('no gasPrice');
    return { gasPriceGwei: Number(wei) / 1e9, estimatedUnits: GAS_UNITS_ACTIVE, ethPriceUSD: 2000, source: 'live' };
  } catch (e) {
    process.stderr.write(`  [gas] ${e.message} — manual fallback\n`);
    return { ...GAS_MANUAL, source: 'manual_fallback' };
  }
}
function calcGasUSD(gm)       { return gm.estimatedUnits * gm.gasPriceGwei * 1e-9 * gm.ethPriceUSD; }
function calcGasPct(size, gm) { return (calcGasUSD(gm) / size) * 100; }

// ─────────────────────────────────────────────────────────────────────────────
// MATH
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToUSDC(sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}
function activeTickDepthUSD(liq, sqrtP96) {
  const sqrtP = Number(sqrtP96) / Number(2n ** 96n);
  return (Number(liq) * sqrtP) / Math.pow(10, DEC1);
}
function slippagePct(size, depth) { return depth <= 0 ? Infinity : (size / (2 * depth)) * 100; }
function spreadPct(a, b)          { return Math.abs(a - b) / Math.min(a, b) * 100; }
function tickToPrice(tick)        { return Math.pow(1.0001, tick) * Math.pow(10, DEC0 - DEC1); }

// ─────────────────────────────────────────────────────────────────────────────
// ABIs
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
  'function tickBitmap(int16 wordPosition) external view returns (uint256)',
  'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256, uint256, int56, uint160, uint32, bool initialized)',
];
const ALGEBRA_ABI = [
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// ─────────────────────────────────────────────────────────────────────────────
// POOL READ (both pools)
// ─────────────────────────────────────────────────────────────────────────────
async function readBothPools(blockNumber, rpc) {
  const [uniRes, camRes] = await Promise.all([
    rpc.callDetailed(`act.univ3.${blockNumber}`, async (p) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, p);
      const [s0, liq] = await Promise.all([pool.slot0({ blockTag: blockNumber }), pool.liquidity({ blockTag: blockNumber })]);
      return { s0, liq };
    }, { timeoutMs: 2000, hedge: true }),
    // Pool B dispatch: Algebra venues use globalState(), UniV3-compatible venues (Ramses) use slot0().
    // CAMELOT_TYPE is set from pairCfg.camelotType in main() — default 'algebra'.
    CAMELOT_TYPE === 'univ3'
      ? rpc.callDetailed(`act.camuniv3.${blockNumber}`, async (p) => {
          const pool = new ethers.Contract(CAMELOT_POOL, UNIV3_ABI, p);
          const [s0, liq] = await Promise.all([pool.slot0({ blockTag: blockNumber }), pool.liquidity({ blockTag: blockNumber })]);
          // Map slot0 result to gs shape: [sqrtPriceX96, tick, fee=0 (use static), ...]
          return { gs: s0, liq };
        }, { timeoutMs: 2000, hedge: true })
      : rpc.callDetailed(`act.camelot.${blockNumber}`, async (p) => {
          const pool = new ethers.Contract(CAMELOT_POOL, ALGEBRA_ABI, p);
          const [gs, liq] = await Promise.all([pool.globalState({ blockTag: blockNumber }), pool.liquidity({ blockTag: blockNumber })]);
          return { gs, liq };
        }, { timeoutMs: 2000, hedge: true }),
  ]);
  const uniSqrtP  = uniRes.result.s0[0];
  const camSqrtP  = camRes.result.gs[0];
  // For Algebra: gs[2] = dynamic fee. For UniV3-type (Ramses): fee is static — use CAMELOT_FEE_FRAC.
  const camFeeRaw = CAMELOT_TYPE === 'univ3' ? 0 : Number(camRes.result.gs[2]);
  return {
    uniPrice   : sqrtPriceToUSDC(uniSqrtP),
    camPrice   : sqrtPriceToUSDC(camSqrtP),
    uniDepth   : activeTickDepthUSD(uniRes.result.liq, uniSqrtP),
    camFee     : camFeeRaw > 0 ? camFeeRaw / 10000 / 100 : CAMELOT_FEE_FRAC,
    currentTick: Number(uniRes.result.s0[1]),   // needed for proximity arm check
    blockNumber,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TICK MAP — derive ARMED threshold from nearest HIGH zone above current price
// ─────────────────────────────────────────────────────────────────────────────
async function deriveThresholdsFromTickMap(rpc) {
  console.log('\n  [tick-map] Running threshold derivation...');

  // Get current state
  const stateRes = await rpc.callDetailed('act.tickmap.slot0', async (p) => {
    const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, p);
    const [s0, liq] = await Promise.all([pool.slot0(), pool.liquidity()]);
    return { s0, liq };
  }, { timeoutMs: 5000, hedge: true });

  const sqrtP96    = stateRes.result.s0[0];
  const currentTick = Number(stateRes.result.s0[1]);
  const currentLiq  = stateRes.result.liq;
  const currentPrice = sqrtPriceToUSDC(sqrtP96);

  // Scan bitmap for initialized ticks
  const minTick  = currentTick - TICK_MAP_SCAN_RANGE;
  const maxTick  = currentTick + TICK_MAP_SCAN_RANGE;
  const minWord  = Math.floor(currentTick / TICK_SPACING / 256) - Math.ceil(TICK_MAP_SCAN_RANGE / TICK_SPACING / 256) - 1;
  const maxWord  = Math.floor(currentTick / TICK_SPACING / 256) + Math.ceil(TICK_MAP_SCAN_RANGE / TICK_SPACING / 256) + 1;

  const initTicks = [];
  for (let w = minWord; w <= maxWord; w++) {
    try {
      const res = await rpc.callDetailed(`act.bitmap.${w}`, async (p) => {
        const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, p);
        return pool.tickBitmap(w);
      }, { timeoutMs: 3000, hedge: true });
      const bm = BigInt(res.result.toString());
      if (bm === 0n) { await sleep(50); continue; }
      for (let bit = 0; bit < 256; bit++) {
        if ((bm >> BigInt(bit)) & 1n) {
          const tick = (w * 256 + bit) * TICK_SPACING;
          if (tick >= minTick && tick <= maxTick) initTicks.push(tick);
        }
      }
    } catch { /* skip */ }
    await sleep(80);
  }

  // Read tick data serially
  const tickData = {};
  for (const tick of initTicks) {
    try {
      const res = await rpc.callDetailed(`act.tickdata.${tick}`, async (p) => {
        const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, p);
        return pool.ticks(tick);
      }, { timeoutMs: 3000, hedge: true });
      const d = res.result;
      if (d[7]) tickData[tick] = { liquidityNet: BigInt(d[1].toString()), liquidityGross: BigInt(d[0].toString()) };
    } catch { /* skip */ }
    await sleep(60);
  }

  // Walk upward from current tick to find nearest HIGH zone
  const sortedAbove = Object.keys(tickData).map(Number).filter(t => t > currentTick).sort((a, b) => a - b);
  let liq = BigInt(currentLiq.toString());
  let nearestHighTick = null;
  let nearestHighDepth = 0;
  let nearestHighPrice = 0;

  for (const tick of sortedAbove) {
    liq = liq + tickData[tick].liquidityNet;
    if (liq < 0n) liq = 0n;
    const depth = activeTickDepthUSD(liq, sqrtP96);
    if (depth >= DEPTH_EXECUTION) {
      nearestHighTick  = tick;
      nearestHighDepth = depth;
      nearestHighPrice = tickToPrice(tick);
      break;
    }
  }

  // Derive ARMED threshold: nearest HIGH zone price minus buffer ticks
  // NOTE: armedPrice is now informational only — arm trigger uses proximity geometry.
  // Kept for signal emission context and legacy log fields.
  let armedPrice = STATIC_ARMED_PRICE;
  if (nearestHighTick !== null) {
    const bufferTick = nearestHighTick - ARMED_BUFFER_TICKS;
    armedPrice = tickToPrice(bufferTick);
    // Floor removed (Boss ruling 2026-03-27) — was blocking arm when market lived below 0.098
  }

  console.log(`  [tick-map] currentTick=${currentTick}  price=$${currentPrice.toFixed(6)}`);
  if (nearestHighTick !== null) {
    console.log(`  [tick-map] Nearest HIGH zone: tick ${nearestHighTick}  price=$${nearestHighPrice.toFixed(6)}  depth=$${nearestHighDepth.toFixed(0)}`);
    console.log(`  [tick-map] ARMED threshold set to: $${armedPrice.toFixed(6)}  (${ARMED_BUFFER_TICKS} ticks below HIGH zone)`);
  } else {
    console.log(`  [tick-map] No HIGH zone found within ±${TICK_MAP_SCAN_RANGE} ticks — using static fallback $${STATIC_ARMED_PRICE}`);
  }

  return { armedPrice, nearestHighTick, nearestHighPrice, nearestHighDepth, currentTick, currentPrice, derivedAt: Date.now() };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATE ONE POINT
// ─────────────────────────────────────────────────────────────────────────────
function simulateOne(detected, delayed, size, gm) {
  const detSpread  = spreadPct(detected.uniPrice, detected.camPrice);
  const execSpread = spreadPct(delayed.uniPrice, delayed.camPrice);
  const slip       = slippagePct(size, delayed.uniDepth);
  const feeBurden  = (UNIV3_FEE_FRAC + delayed.camFee) * 100;
  const gasPct     = calcGasPct(size, gm);
  const finalEdge  = execSpread - feeBurden - slip - gasPct;
  return {
    size, delayBlocks: delayed.blockNumber - detected.blockNumber,
    detectedEdge: +detSpread.toFixed(5), executedSpread: +execSpread.toFixed(5),
    slippage: +slip.toFixed(5), feeBurden: +feeBurden.toFixed(5),
    gasUsd: +calcGasUSD(gm).toFixed(6), gasPct: +gasPct.toFixed(5),
    finalEdge: +finalEdge.toFixed(5),
    uniDepth: +delayed.uniDepth.toFixed(2),
    uniPrice: +delayed.uniPrice.toFixed(6), camPrice: +delayed.camPrice.toFixed(6),
    direction: delayed.uniPrice > delayed.camPrice ? 'sell_uni_buy_camelot' : 'buy_uni_sell_camelot',
    status: finalEdge > 0.05 ? 'PROFITABLE' : finalEdge > 0 ? 'MARGINAL' : 'LOST',
    economicStatus: economicStatus(+finalEdge.toFixed(5)),
  };
}

// Boss gate
function bossGate(d0, d1) {
  if (!d0 || !d1) return { passed: false };
  const checks = {
    depth_above_15k:     d0.uniDepth >= DEPTH_EXECUTION,
    delay0_profitable:   d0.finalEdge > 0,
    delay1_non_negative: d1.finalEdge >= 0,
    spread_above_fees:   d0.executedSpread > d0.feeBurden + d0.gasPct,
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}

// Full simulation
async function runSimulation(snap, rpc, gm) {
  const base  = snap.blockNumber;
  const snaps = { 0: snap };
  for (const d of [1, 2]) {
    await sleep(400);
    try   { snaps[d] = await readBothPools(base + d, rpc); }
    catch { snaps[d] = { ...snap, blockNumber: base + d }; }
  }
  const matrix = {};
  const all    = [];
  for (const d of SIM_DELAY_RANGE) {
    matrix[d] = {};
    for (const s of SIM_SIZE_RANGE) {
      const r = simulateOne(snap, snaps[d], s, gm);
      matrix[d][s] = r;
      all.push(r);
    }
  }
  const gates = {};
  for (const s of SIM_SIZE_RANGE) gates[s] = bossGate(matrix[0][s], matrix[1][s]);
  return { matrix, all, gates };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTION_READY SIGNAL EMITTER
// ─────────────────────────────────────────────────────────────────────────────
function emitSignal(type, snap, simResult, gm, thresholds, regime) {
  const { all, matrix } = simResult;
  const prof = all.filter(r => r.status !== 'LOST' && r.delayBlocks === 0);
  const best = prof.length > 0 ? prof.reduce((a, b) => a.finalEdge > b.finalEdge ? a : b) : null;

  const signal = {
    signal:           type,   // EXECUTION_READY | SIMULATION_MARGINAL | SIMULATION_LOST
    ts:               new Date().toISOString(),
    block:            snap.blockNumber,
    uniPrice:         +snap.uniPrice.toFixed(6),
    camPrice:         +snap.camPrice.toFixed(6),
    uniDepth:         +snap.uniDepth.toFixed(2),
    regime:           regime || regimeLabel(snap.uniDepth),
    spread:           +spreadPct(snap.uniPrice, snap.camPrice).toFixed(5),
    bestSize:         best ? best.size : null,
    bestDelay:        best ? best.delayBlocks : null,
    finalEdge:        best ? best.finalEdge : null,
    economicStatus:   economicStatus(best ? best.finalEdge : null),  // Boss ruling 2026-04-04
    gasUnits:         GAS_UNITS_ACTIVE,
    gasSource:        gm.source,
    gasPriceGwei:     +gm.gasPriceGwei.toFixed(6),
    armedThreshold:   +thresholds.armedPrice.toFixed(6),
    nearestHighTick:  thresholds.nearestHighTick,
    nearestHighPrice: thresholds.nearestHighPrice ? +thresholds.nearestHighPrice.toFixed(6) : null,
    nearestHighDepth: thresholds.nearestHighDepth ? +thresholds.nearestHighDepth.toFixed(2) : null,
    // Full size-sweep at delay=0 for economic analysis (Boss ruling 2026-04-03)
    sizeSweep: SIM_SIZE_RANGE.map(sz => {
      const r = matrix[0]?.[sz];
      if (!r) return { size: sz, status: 'missing' };
      return {
        size:          sz,
        finalEdge:     r.finalEdge,
        economicStatus:r.economicStatus,
        slippage:      r.slippage,
        feeBurden:     r.feeBurden,
        gasPct:        r.gasPct,
        status:        r.status,
      };
    }),
  };

  // Print signal banner
  const STAR = type === 'EXECUTION_READY' ? '★' : '○';
  const BAR  = STAR.repeat(90);
  console.log('\n' + BAR);
  console.log(`  ${STAR}${STAR}${STAR}  SIGNAL: ${type}  ${STAR}${STAR}${STAR}`);
  console.log(`  ${signal.ts}   block=${signal.block}`);
  console.log(`  price=$${signal.uniPrice}   depth=$${signal.uniDepth}   spread=${signal.spread}%`);
  if (best) console.log(`  best: size=$${best.size}  delay=${best.delayBlocks}blk  edge=+${best.finalEdge}%`);
  console.log(BAR + '\n');

  return signal;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOG
// ─────────────────────────────────────────────────────────────────────────────
function appendLog(logPath, record) {
  if (!logPath) return;
  try {
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
  } catch (e) {
    process.stderr.write(`  [log] ${e.message}\n`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ACTIVATION LOOP
// ─────────────────────────────────────────────────────────────────────────────
async function activatorLoop(rpc, gm, durationS, logPath, forceRemap, pairCfg) {
  // rpc is reassignable for provider rebuild recovery
  rpc = rpc;
  const endMs = Date.now() + durationS * 1000;

  // Initial tick map scan
  let thresholds;
  if (!forceRemap) {
    // Use known static thresholds from last tick map run (pair-specific).
    // ETH/USDC: all null → isProximate=false → activator stays PASSIVE (safe).
    // ARB/USDC: Boss-confirmed values from 2026-03-23 tick-map scan.
    thresholds = {
      armedPrice:       pairCfg.staticArmedPrice,
      nearestHighTick:  pairCfg.staticHighTick,
      nearestHighPrice: pairCfg.staticHighPrice,
      nearestHighDepth: pairCfg.staticHighDepth,
      currentTick:      pairCfg.staticCurrentTick,
      currentPrice:     pairCfg.staticCurrentPrice,
      derivedAt:        Date.now(),
    };
    console.log(`\n  [thresholds] Static map  nearestHighTick=${thresholds.nearestHighTick}  nearestHighPrice=$${thresholds.nearestHighPrice}  ARM: tickDist<=${ARM_TICK_DISTANCE} OR bps<=${ARM_PRICE_DISTANCE_BPS}`);
  } else {
    // Tick-map derivation at startup — retry with backoff on RPC failure.
    // A single hedged failure should not kill the process before the loop even starts.
    // Boss ruling 2026-04-07: up to 3 startup retries, 5s/10s/20s backoff.
    let startupAttempt = 0;
    const STARTUP_RETRIES = 3;
    while (true) {
      startupAttempt++;
      try {
        thresholds = await deriveThresholdsFromTickMap(rpc);
        break;  // success
      } catch (e) {
        const backoffSec = Math.pow(2, startupAttempt) * 2.5;  // 5s, 10s, 20s
        process.stderr.write(
          `  ✗ [tick-map] startup attempt ${startupAttempt}/${STARTUP_RETRIES} failed: ${e.message.slice(0,80)}\n`
        );
        if (startupAttempt >= STARTUP_RETRIES) {
          process.stderr.write(`  ✗ [tick-map] all ${STARTUP_RETRIES} attempts exhausted — aborting startup\n`);
          process.exit(2);
        }
        process.stderr.write(`  ⏳ [tick-map] retrying in ${backoffSec.toFixed(0)}s...\n`);
        await sleep(backoffSec * 1000);
        // Rebuild provider before retry — RPC may have rotated
        const newRpc = createProvider('arbitrum');
        try {
          await withTimeout(
            newRpc.getBlockNumber('startup.retry.sanity', { timeoutMs: 5000, hedge: true }),
            10_000, 'startup.retry.sanity'
          );
          rpc = newRpc;
          process.stderr.write(`  ✓ [tick-map] provider rebuilt for retry ${startupAttempt + 1}\n`);
        } catch (_) {
          process.stderr.write(`  ✗ [tick-map] provider rebuild failed, using existing\n`);
        }
      }
    }
  }
  let tickMapRefreshAt = Date.now() + TICK_MAP_REFRESH_MS;

  // State
  let state         = 'PASSIVE';
  let lastBlock     = null;
  let lastPrintKey  = null;
  let cooldownUntil = 0;
  let readyCheckCount = 0;   // consecutive ARMED scans above READY_MIN_DEPTH_USD
  let readyCheckAt    = null; // ISO timestamp when readyCheckCount first hit 1
  let snap            = null; // last successful pool read — available to heartbeat

  // Window segmentation tracking (Boss ruling 2026-04-03)
  let windowId        = 0;    // monotonic window counter for log correlation
  let windowKey       = null; // restart-safe time-bucket key (Boss ruling 2026-04-05)
  let windowStartTs   = null; // ISO timestamp when current ARMED window opened
  let windowStartDepth= null; // depthMin at window open — regime classification anchor

  // Spread stability tracking (Boss ruling 2026-04-05: entry optimization)
  // Ring buffer of recent spread% values while ARMED — used for stability gate.
  const STABILITY_WINDOW_N   = 5;    // samples to track for stability check
  const STABILITY_MAX_STD    = 0.008; // max spread stddev (pct) to allow sim — tune via recommender
  const STABILITY_MIN_SAMPLES= 4;    // min samples before stability gate applies
  let spreadSamples = [];   // ring buffer of recent spread values while ARMED

  // ── REGIME-BASED PROFILE SELECTOR STATE ────────────────────────────────────
  // Boss directive 2026-04-05: runtime selects among SAFE/BALANCED/AGGRESSIVE.
  // Offline learning (recommender) populates ENTRY_PROFILES.
  // Runtime mutation of thresholds is FORBIDDEN.
  let activeProfile         = 'SAFE';   // current profile — starts conservative
  let profileCandidateLabel = 'SAFE';   // profile we want to upgrade/downgrade to
  let profileCandidateTicks = 0;        // consecutive ticks in candidate state
  let lastProfileSwitchTs   = null;     // ISO ts of last profile switch (audit)
  let lastProfileSwitchReason = null;

  // Economic mix tracker: ring buffer of recent sim signal classifications
  // Used by selector to assess signal quality trend
  const ECO_RING_SIZE = 50;
  const ecoRingBuffer = [];  // {ts, classification: 'GOOD'|'MID'|'BAD'}

  function recordEco(classification) {
    ecoRingBuffer.push({ ts: Date.now(), classification });
    if (ecoRingBuffer.length > ECO_RING_SIZE) ecoRingBuffer.shift();
  }

  function recentEcoMix() {
    const n = ecoRingBuffer.length;
    if (n === 0) return { good: 0, mid: 0, bad: 0, total: 0, viableRate: 0 };
    const good = ecoRingBuffer.filter(r => r.classification === 'GOOD').length;
    const mid  = ecoRingBuffer.filter(r => r.classification === 'MID').length;
    const bad  = ecoRingBuffer.filter(r => r.classification === 'BAD').length;
    return { good, mid, bad, total: n, viableRate: good / n };
  }

  // Profile selector: decides target profile from measurable conditions.
  // Uses ONLY regime label, spread stability, depth regime, and recent eco mix.
  // Returns { targetLabel, reason } — does NOT mutate activeProfile directly.
  function selectTargetProfile(regime, currentDepth, spreadStd, samplesArmed, ecoMix) {
    // Safety first — if depth below ARM floor, force SAFE regardless
    if (currentDepth < ARM_MIN_DEPTH_USD) {
      return { targetLabel: 'SAFE', reason: 'depth_below_arm_floor' };
    }

    const isPersistentDepth = (regime === 'persistent_depth_regime');
    const isStableSpread    = (spreadStd <= ENTRY_PROFILES.AGGRESSIVE.maxSpreadStdDev);
    const isDeepSurge       = (currentDepth >= ENTRY_PROFILES.SAFE.minDepthUsd);  // $200k
    const goodEco           = ecoMix.total >= 10 ? ecoMix.viableRate >= 0.35 : true; // relax if little history

    // AGGRESSIVE: all conditions must be strong
    if (isPersistentDepth && isStableSpread && isDeepSurge && goodEco) {
      return { targetLabel: 'AGGRESSIVE', reason: 'persistent_depth+stable+deep+goodEco' };
    }

    // BALANCED: persistent depth + basic stability
    if (isPersistentDepth && currentDepth >= ENTRY_PROFILES.BALANCED.minDepthUsd && isStableSpread) {
      return { targetLabel: 'BALANCED', reason: 'persistent_depth+stable' };
    }

    // SAFE: default
    const safeReason = !isPersistentDepth ? 'regime_not_persistent'
      : currentDepth < ENTRY_PROFILES.BALANCED.minDepthUsd ? 'depth_below_balanced_floor'
      : !isStableSpread ? 'spread_unstable'
      : 'default_safe';
    return { targetLabel: 'SAFE', reason: safeReason };
  }

  // Apply hysteresis: only switch profile if candidate has held for enough ticks.
  // Returns the active profile label after hysteresis logic.
  function applyHysteresis(targetLabel, currentDepth) {
    // Safety downgrade: bypass hysteresis — immediate
    if (currentDepth < ARM_MIN_DEPTH_USD && activeProfile !== 'SAFE') {
      const prev = activeProfile;
      activeProfile         = 'SAFE';
      profileCandidateTicks = 0;
      lastProfileSwitchTs   = new Date().toISOString();
      lastProfileSwitchReason = 'safety_depth_floor';
      return { switched: true, prev, reason: 'safety_depth_floor' };
    }

    const profileOrder = ['SAFE', 'BALANCED', 'AGGRESSIVE'];
    const currentIdx   = profileOrder.indexOf(activeProfile);
    const targetIdx    = profileOrder.indexOf(targetLabel);
    const isUpgrade    = targetIdx > currentIdx;
    const isDowngrade  = targetIdx < currentIdx;
    const minTicks     = isUpgrade ? PROFILE_HYSTERESIS.upgradeMinTicks : PROFILE_HYSTERESIS.downgradeMinTicks;

    if (targetLabel === activeProfile) {
      profileCandidateTicks = 0;  // reset when target matches current
      profileCandidateLabel = activeProfile;
      return { switched: false };
    }

    if (targetLabel !== profileCandidateLabel) {
      // New candidate — reset counter
      profileCandidateLabel = targetLabel;
      profileCandidateTicks = 1;
      return { switched: false };
    }

    profileCandidateTicks++;
    if (profileCandidateTicks >= minTicks) {
      const prev = activeProfile;
      activeProfile         = targetLabel;
      profileCandidateTicks = 0;
      profileCandidateLabel = targetLabel;
      lastProfileSwitchTs   = new Date().toISOString();
      lastProfileSwitchReason = isUpgrade ? `upgrade_after_${minTicks}_ticks` : `downgrade_after_${minTicks}_ticks`;
      return { switched: true, prev, reason: lastProfileSwitchReason };
    }

    return { switched: false };
  }

  // Persistent depth regime tracking (Boss ruling 2026-04-04)
  // Surge depth (>$100k) that holds for >2 hours = 'persistent_depth_regime'
  const PERSIST_SURGE_MS = 2 * 60 * 60 * 1000;  // 2 hours
  let surgeEnteredAt  = null;  // timestamp when depth first crossed REGIME_SURGE_THRESHOLD
  let persistentDepth = false; // true once surge has held for >2 hours

  // Self-recovery state (Boss ruling 2026-03-25)
  let providerRebuilds = 0;
  const blockFail = new ConsecutiveFailTracker('getBlockNumber');
  const poolFail  = new ConsecutiveFailTracker('readBothPools');

  async function rebuildProvider(logPath, state) {
    providerRebuilds++;
    const msg = `provider rebuild #${providerRebuilds}`;

    // Exponential backoff — 2s * 2^(attempt-1), capped at 30s (Boss ruling 2026-04-06)
    const backoffMs = Math.min(
      REBUILD_BACKOFF_BASE_MS * Math.pow(2, providerRebuilds - 1),
      REBUILD_BACKOFF_CAP_MS
    );
    process.stderr.write(`\n  ⚠ [recover] ${msg} — backoff ${backoffMs}ms then createProvider('arbitrum')\n`);
    await sleep(backoffMs);

    appendLog(logPath, {
      ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
      type: 'provider_rebuild', attempt: providerRebuilds, state, backoffMs,
    });

    if (providerRebuilds > MAX_PROVIDER_REBUILDS) {
      const fatal = `[FATAL] provider rebuild limit (${MAX_PROVIDER_REBUILDS}) exceeded — exiting`;
      process.stderr.write(`\n  ${fatal}\n`);
      appendLog(logPath, {
        ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
        type: 'fatal_exit', reason: fatal, providerRebuilds,
      });
      process.exit(2);  // non-zero so supervisor can restart
    }

    // Degraded mode: after REBUILD_DEGRADED_AFTER rebuilds, force SAFE profile (Boss ruling 2026-04-06)
    // SAFE profile is more tolerant of reduced data quality — avoids false positives under RPC instability.
    if (providerRebuilds >= REBUILD_DEGRADED_AFTER && activeProfile !== 'SAFE') {
      const prev = activeProfile;
      activeProfile = 'SAFE';
      profileCandidateTicks = 0;
      profileCandidateLabel = 'SAFE';
      lastProfileSwitchTs     = new Date().toISOString();
      lastProfileSwitchReason = 'rpc_degraded_mode';
      process.stderr.write(`  ⚠ [degraded] forcing SAFE profile (was ${prev}) — rebuild #${providerRebuilds} >= ${REBUILD_DEGRADED_AFTER}\n`);
      appendLog(logPath, {
        ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
        type: 'profile_switch',
        previousProfile: prev, selectedProfile: 'SAFE',
        selectorReason: 'rpc_degraded_mode', hysteresisReason: 'forced_degraded',
        providerRebuilds,
      });
    }

    try {
      const newRpc = createProvider('arbitrum');
      // Quick sanity check — if this hangs too, we catch it
      await withTimeout(
        newRpc.getBlockNumber('recover.sanity', { timeoutMs: 5000, hedge: true }),
        10_000, 'rebuild.sanity'
      );
      process.stderr.write(`  ✓ [recover] provider rebuild #${providerRebuilds} succeeded\n`);
      blockFail.success();
      poolFail.success();
      return newRpc;
    } catch (e) {
      process.stderr.write(`  ✗ [recover] provider rebuild #${providerRebuilds} failed: ${e.message}\n`);
      return null;  // caller will retry or escalate
    }
  }

  // Health tracking
  const health = {
    lastPoolReadMs:     Date.now(),
    lastBlockChangeMs:  Date.now(),
    lastTickMapMs:      Date.now(),
    lastHealthCheckMs:  Date.now(),
    currentlyUnhealthy: false,
    unhealthyReasons:   [],
  };

  function checkHealth() {
    const now = Date.now();
    const reasons = [];
    if (now - health.lastPoolReadMs    > HEALTH_POOL_STALE_MS)    reasons.push(`pool_read_stale:${Math.round((now - health.lastPoolReadMs)/1000)}s`);
    if (now - health.lastBlockChangeMs > HEALTH_BLOCK_FROZEN_MS)  reasons.push(`block_frozen:${Math.round((now - health.lastBlockChangeMs)/1000)}s`);
    if (now - health.lastTickMapMs     > HEALTH_TICKMAP_STALE_MS) reasons.push(`tickmap_stale:${Math.round((now - health.lastTickMapMs)/1000)}s`);

    const isUnhealthy = reasons.length > 0;

    if (isUnhealthy && !health.currentlyUnhealthy) {
      // Transition into unhealthy
      health.currentlyUnhealthy = true;
      health.unhealthyReasons   = reasons;
      const record = { ts: new Date().toISOString(), type: 'STATE_UNHEALTHY', reasons, state };
      process.stderr.write(`\n  ⚠ STATE_UNHEALTHY: ${reasons.join(', ')}\n`);
      appendLog(logPath, record);
    } else if (!isUnhealthy && health.currentlyUnhealthy) {
      // Recovered
      health.currentlyUnhealthy = false;
      health.unhealthyReasons   = [];
      const record = { ts: new Date().toISOString(), type: 'STATE_HEALTHY', state };
      console.log(`\n  ✓ STATE_HEALTHY — recovered\n`);
      appendLog(logPath, record);
    }

    health.lastHealthCheckMs = now;
    return !isUnhealthy;
  }

  const stats = {
    ticks: 0, errors: 0,
    armedCount: 0, disarmedCount: 0,
    simRuns: 0, readySignals: 0,
    tickMapRefreshes: 0, unhealthyEvents: 0, heartbeats: 0,
    startMs: Date.now(),
  };

  const W   = 100;
  const EQ  = '═'.repeat(W);
  const DIV = '─'.repeat(W);

  console.log('\n' + EQ);
  console.log(`  ${LOG_PAIR} — WINDOW ACTIVATOR   (tick-map-aware state machine)`);
  console.log(`  Gas: ${gm.source}  |  ${gm.gasPriceGwei.toFixed(6)} gwei  |  $${calcGasUSD(gm).toFixed(6)}/tx`);
  console.log(`  ARMED threshold:    $${thresholds.armedPrice.toFixed(6)}  (dynamic, from tick map)`);
  console.log(`  Nearest HIGH zone:  $${thresholds.nearestHighPrice?.toFixed(6) ?? 'none'}  depth=$${thresholds.nearestHighDepth?.toFixed(0) ?? '?'}`);
  console.log(`  EXECUTION gate:     depth >= $${DEPTH_EXECUTION.toLocaleString()} + spread + d0>0 + d1>=0`);
  console.log(`  Tick map refresh:   every ${TICK_MAP_REFRESH_MS / 60000} minutes`);
  if (logPath) console.log(`  Log: ${logPath}`);
  console.log(EQ);
  console.log(`  ${'time'.padEnd(10)} ${'block'.padEnd(12)} ${'price$'.padEnd(10)} ${'depth$'.padEnd(10)} ${'spread%'.padEnd(9)} state`);
  console.log('  ' + DIV);

  while (Date.now() < endMs) {
    const loopStart = Date.now();

    // Periodic tick map refresh
    if (Date.now() >= tickMapRefreshAt) {
      try {
        thresholds = await deriveThresholdsFromTickMap(rpc);
        tickMapRefreshAt = Date.now() + TICK_MAP_REFRESH_MS;
        health.lastTickMapMs = Date.now();
        stats.tickMapRefreshes++;
        appendLog(logPath, { ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR, type: 'tick_map_refresh', thresholds });
      } catch (e) {
        process.stderr.write(`  [tick-map refresh] ${e.message}\n`);
      }
    }

    // Periodic health check
    if (Date.now() - health.lastHealthCheckMs >= HEALTH_CHECK_INTERVAL_MS) {
      const healthy = checkHealth();
      if (!healthy) stats.unhealthyEvents++;
    }

    // Cooldown
    if (Date.now() < cooldownUntil) {
      await sleep(POLL_PASSIVE_MS);
      continue;
    }

    // ── BLOCK READ (Level 1/2/3 recovery) ────────────────────────────────────
    let blockNumber;
    try {
      const b = await withTimeout(
        rpc.getBlockNumber('act.block', { timeoutMs: 1200, hedge: true }),
        READ_TIMEOUT_MS, 'getBlockNumber'
      );
      blockNumber = b.blockNumber;
      blockFail.success();
    } catch (e) {
      stats.errors++;
      const { count, level } = blockFail.failure(e);
      if (level === 'rebuild') {
        process.stderr.write(`  ⚠ [recover] getBlockNumber: ${count} failures — rebuilding provider\n`);
        appendLog(logPath, {
          ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
          type: 'STATE_UNHEALTHY', reasons: [`block_read_failed_${count}x:${e.message.slice(0,60)}`], state,
        });
        health.currentlyUnhealthy = true;
        const newRpc = await rebuildProvider(logPath, state);
        if (newRpc) rpc = newRpc;
      }
      await sleep(POLL_PASSIVE_MS);
      continue;
    }

    if (blockNumber === lastBlock) {
      await sleep(state === 'ARMED' ? POLL_ARMED_MS : POLL_PASSIVE_MS);
      continue;
    }
    lastBlock = blockNumber;
    health.lastBlockChangeMs = Date.now();

    // ── POOL READ (Level 1/2/3 recovery) ─────────────────────────────────────
    let snapRead;
    try {
      snapRead = await withTimeout(
        readBothPools(blockNumber, rpc),
        READ_TIMEOUT_MS, 'readBothPools'
      );
      snap = snapRead;   // update outer-scoped snap for heartbeat access
      health.lastPoolReadMs = Date.now();
      poolFail.success();
    } catch (e) {
      stats.errors++;
      const { count, level } = poolFail.failure(e);
      if (level === 'rebuild') {
        process.stderr.write(`  ⚠ [recover] readBothPools: ${count} failures — rebuilding provider\n`);
        appendLog(logPath, {
          ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
          type: 'STATE_UNHEALTHY', reasons: [`pool_read_failed_${count}x:${e.message.slice(0,60)}`], state,
        });
        health.currentlyUnhealthy = true;
        const newRpc = await rebuildProvider(logPath, state);
        if (newRpc) rpc = newRpc;
      }
      await sleep(POLL_PASSIVE_MS);
      continue;
    }
    snap = snapRead;

    stats.ticks++;

    const spread        = spreadPct(snap.uniPrice, snap.camPrice);
    const feeBurden     = (UNIV3_FEE_FRAC + snap.camFee) * 100;
    const slip          = slippagePct(TRIGGER_SIZE_USD, snap.uniDepth);
    const threshold     = feeBurden + slip + TRIGGER_BUFFER_PCT;
    const isExecDepth   = snap.uniDepth >= DEPTH_EXECUTION;
    const isAboveSpread = spread > threshold;

    // ── LAYER 1: PROXIMITY TRIGGER (Boss ruling 2026-03-27) ──────────────────
    // Arm when market approaches the nearest high-depth zone — not when it
    // crosses a fixed absolute price level. Uses live tick geometry.
    const currentTick      = snap.currentTick ?? thresholds.currentTick;
    const tickDistance     = thresholds.nearestHighTick != null
      ? Math.abs(currentTick - thresholds.nearestHighTick)
      : Infinity;
    const priceDistanceBps = thresholds.nearestHighPrice > 0
      ? Math.abs(thresholds.nearestHighPrice - snap.uniPrice) / snap.uniPrice * 10_000
      : Infinity;
    const isProximate = tickDistance <= ARM_TICK_DISTANCE ||
                        priceDistanceBps <= ARM_PRICE_DISTANCE_BPS;

    // ── LAYER 2: QUALITY GATE ────────────────────────────────────────────────
    // Only arm if the live surface is worth watching.
    // Replicates scanner tier logic inline — no Redis read needed.
    const netSpreadFrac = (spread / 100) - (UNIV3_FEE_FRAC + snap.camFee);
    const depthMin      = snap.uniDepth;   // UniV3 is the confirmed thin leg
    const scannerTier   = depthMin >= READY_MIN_DEPTH_USD ? 'candidate'      // ≥$10k — matches scanner candidate floor
                        : depthMin >= ARM_MIN_DEPTH_USD   ? 'near_threshold'  // $7k–$10k — arm floor
                        : depthMin >= 5_000               ? 'thin_liquidity'
                        : 'blocked_liquidity';

    // ── PERSISTENT DEPTH REGIME TRACKER (Boss ruling 2026-04-04) ──────────────
    // Surge depth (>$100k) that holds for >2h = 'persistent_depth_regime'.
    // Fires once; resets if depth drops below threshold.
    if (depthMin >= REGIME_SURGE_THRESHOLD) {
      if (!surgeEnteredAt) surgeEnteredAt = Date.now();
      if (!persistentDepth && (Date.now() - surgeEnteredAt) >= PERSIST_SURGE_MS) {
        persistentDepth = true;
        const pdRecord = {
          ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
          type: 'persistent_depth_regime', depthUsd: +depthMin.toFixed(0),
          surgeEnteredAt: new Date(surgeEnteredAt).toISOString(),
          heldMs: Date.now() - surgeEnteredAt,
        };
        console.log(`\n  [REGIME] ★ persistent_depth_regime confirmed — surge depth held >2h  depth=$${depthMin.toFixed(0)}\n`);
        appendLog(logPath, pdRecord);
      }
    } else {
      // Depth dropped below surge threshold — reset tracker
      if (surgeEnteredAt) {
        surgeEnteredAt  = null;
        persistentDepth = false;
      }
    }
    const activeRegime = persistentDepth ? 'persistent_depth_regime' : regimeLabel(depthMin);
    const isQualified   = (
                            scannerTier === 'candidate'      ||
                            scannerTier === 'near_threshold' ||
                            scannerTier === 'thin_liquidity'
                          )
                       && netSpreadFrac > 0
                       && depthMin >= ARM_MIN_DEPTH_USD;

    const shouldArm = isProximate && isQualified;

    // ── STATE TRANSITIONS ────────────────────────────────────────────────────
    if (state === 'PASSIVE' && shouldArm) {
      state = 'ARMED';
      stats.armedCount++;
      windowId++;
      windowStartTs    = new Date().toISOString();
      // Restart-safe window key: time-bucketed to 5-min boundaries.
      // Survives process restarts — same window produces same key regardless of
      // how many times the activator was restarted during that window.
      // Format: "ETH/USDC-RAMSES:1743800400000" (pair + 5min epoch bucket)
      const windowKey = `${LOG_PAIR}:${Math.floor(Date.now() / 300_000) * 300_000}`;
      windowStartDepth = +depthMin.toFixed(0);
      const armedReason = tickDistance <= ARM_TICK_DISTANCE ? 'proximity_tick' : 'proximity_price';
      const regime = activeRegime;
      const msg = `○ PASSIVE → ◉ ARMED  tickDist=${tickDistance}  priceBps=${priceDistanceBps.toFixed(1)}  depthMin=$${depthMin.toFixed(0)}  net=+${(netSpreadFrac*100).toFixed(4)}%  reason=${armedReason}  regime=${regime}`;
      console.log(`\n  [STATE] ${msg}   ${fmtTime()}\n`);
      appendLog(logPath, {
        ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
        type: 'state_transition', from: 'PASSIVE', to: 'ARMED', block: blockNumber,
        windowId, windowKey, windowStartTs,
        uniPrice: +snap.uniPrice.toFixed(6), tickDistance, priceDistanceBps: +priceDistanceBps.toFixed(1),
        depthMin: +depthMin.toFixed(0), netSpreadFrac: +netSpreadFrac.toFixed(6),
        scannerTier, armedReason, regime,
      });
    }
    else if (state === 'ARMED' && !shouldArm) {
      state = 'PASSIVE';
      stats.disarmedCount++;
      readyCheckCount = 0;
      readyCheckAt    = null;
      spreadSamples   = [];  // clear on window close
      const blockedReason = !isProximate          ? 'too_far_from_liquidity_zone'
                          : netSpreadFrac <= 0    ? 'negative_net'
                          : depthMin < ARM_MIN_DEPTH_USD ? 'depth_below_arm_floor'
                          :                          'quality_gate_fail';
      const windowEndTs  = new Date().toISOString();
      const windowDurMs  = windowStartTs
        ? (new Date(windowEndTs) - new Date(windowStartTs))
        : null;
      const regime = persistentDepth ? 'persistent_depth_regime' : regimeLabel(windowStartDepth);
      console.log(`\n  [STATE] ◉ ARMED → ○ PASSIVE  ${blockedReason}  tickDist=${tickDistance}  priceBps=${priceDistanceBps.toFixed(1)}  depthMin=$${depthMin.toFixed(0)}  regime=${regime}  dur=${windowDurMs != null ? Math.round(windowDurMs/1000)+'s' : '?'}   ${fmtTime()}\n`);
      appendLog(logPath, {
        ts: windowEndTs, source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
        type: 'state_transition', from: 'ARMED', to: 'PASSIVE', block: blockNumber,
        windowId, windowKey, windowStartTs, windowEndTs, windowDurationMs: windowDurMs,
        uniPrice: +snap.uniPrice.toFixed(6), tickDistance, priceDistanceBps: +priceDistanceBps.toFixed(1),
        depthMin: +depthMin.toFixed(0), netSpreadFrac: +netSpreadFrac.toFixed(6),
        blockedReason, regime,
      });
      windowStartTs    = null;
      windowStartDepth = null;
    }

    // ── LAYER 3: READY_CHECK (within ARMED) ──────────────────────────────────
    // Track consecutive scans above READY_MIN_DEPTH_USD with net > 0.
    // Does NOT promote to execution — that still requires isExecDepth ($15k) + sim.
    // Provides persistence confirmation and explicit logging.
    if (state === 'ARMED') {
      if (depthMin >= READY_MIN_DEPTH_USD && netSpreadFrac > 0) {
        if (readyCheckCount === 0) readyCheckAt = new Date().toISOString();
        readyCheckCount++;
        if (readyCheckCount === READY_CONFIRM_SCANS) {
          console.log(`\n  [READY_CHECK] ✓ ${readyCheckCount} consecutive scans: depthMin=$${depthMin.toFixed(0)} >= $${READY_MIN_DEPTH_USD.toLocaleString()} net=+${(netSpreadFrac*100).toFixed(4)}%\n`);
          appendLog(logPath, {
            ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
            type: 'ready_check_confirmed', block: blockNumber, readyCheckCount,
            depthMin: +depthMin.toFixed(0), netSpreadFrac: +netSpreadFrac.toFixed(6), firstAboveAt: readyCheckAt,
          });
        }
      } else {
        if (readyCheckCount > 0) {
          appendLog(logPath, {
            ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
            type: 'ready_check_reset', block: blockNumber, wasCount: readyCheckCount,
            depthMin: +depthMin.toFixed(0), netSpreadFrac: +netSpreadFrac.toFixed(6),
          });
        }
        readyCheckCount = 0;
        readyCheckAt    = null;  // Boss fix 2026-03-27: prevent stale first-hit metadata in audit trail
      }
    }


    // Periodic heartbeat log
    if (stats.ticks > 0 && stats.ticks % HEARTBEAT_TICKS === 0) {
      const uptimeMin = +((Date.now() - stats.startMs) / 60000).toFixed(1);
      const hbRecord = {
        ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
        type: 'heartbeat', state, uptime_min: uptimeMin,
        ticks: stats.ticks, errors: stats.errors, armed: stats.armedCount,
        simRuns: stats.simRuns, readySignals: stats.readySignals,
        unhealthyEvents: stats.unhealthyEvents,
        // proximity geometry — live values at heartbeat time (Boss advisory 2026-03-27)
        nearestHighTick    : thresholds.nearestHighTick,
        nearestHighPrice   : thresholds.nearestHighPrice,
        tickDistance       : thresholds.nearestHighTick != null
          ? Math.abs((snap?.currentTick ?? thresholds.currentTick) - thresholds.nearestHighTick)
          : null,
        priceDistanceBps   : (thresholds.nearestHighPrice > 0 && snap)
          ? +((Math.abs(thresholds.nearestHighPrice - snap.uniPrice) / snap.uniPrice) * 10_000).toFixed(1)
          : null,
        depthMin           : snap ? +snap.uniDepth.toFixed(0) : null,
        netSpreadFrac      : snap ? +(((spreadPct(snap.uniPrice, snap.camPrice) / 100) - (UNIV3_FEE_FRAC + snap.camFee)).toFixed(6)) : null,
        scannerTier        : snap
          ? (snap.uniDepth >= READY_MIN_DEPTH_USD ? 'candidate'
            : snap.uniDepth >= ARM_MIN_DEPTH_USD  ? 'near_threshold'
            : snap.uniDepth >= 5_000              ? 'thin_liquidity'
            : 'blocked_liquidity')
          : null,
        regime             : activeRegime,
        persistentDepth    : persistentDepth,
        readyCheckCount,
        windowId           : state === 'ARMED' ? windowId : null,
        windowKey          : state === 'ARMED' ? windowKey : null,
        activeProfile,
        profileCandidate   : profileCandidateLabel !== activeProfile ? profileCandidateLabel : null,
        profileCandidateTicks: profileCandidateLabel !== activeProfile ? profileCandidateTicks : 0,
        recentEcoMix       : recentEcoMix(),
      };
      console.log(`  ── heartbeat  ${uptimeMin}min  ticks=${stats.ticks}  errors=${stats.errors}  state=${state}  armed=${stats.armedCount}  ready=${stats.readySignals} ──`);
      appendLog(logPath, hbRecord);
      stats.heartbeats++;
    }

    // ── PRINT TICK LINE ──────────────────────────────────────────────────────
    const stateTag = state === 'PASSIVE' ? '○ PASSIVE'
                   : state === 'ARMED'   ? '◉ ARMED  '
                   :                       '★ EXEC   ';
    const printKey = `${blockNumber}:${state}`;
    if (printKey !== lastPrintKey) {
      const line =
        `  ${fmtTime().padEnd(10)} ${String(blockNumber).padEnd(12)} ` +
        `$${String(snap.uniPrice.toFixed(6)).padEnd(9)} ` +
        `$${String(snap.uniDepth.toFixed(2)).padEnd(9)} ` +
        `${String(spread.toFixed(5)).padEnd(9)} ${stateTag}`;
      if (state === 'ARMED')   console.log('\x1b[33m' + line + '\x1b[0m');
      else if (isExecDepth)    console.log('\x1b[1m'  + line + '\x1b[0m');
      else                     console.log(line);
      lastPrintKey = printKey;
    }

    // ── ARMED: accumulate spread history + run profile selector ─────────────
    if (state === 'ARMED') {
      spreadSamples.push(spread);
      if (spreadSamples.length > STABILITY_WINDOW_N) spreadSamples.shift();

      // Run profile selector every tick while ARMED
      const spreadStdNow = spreadSamples.length >= 2 ? (() => {
        const n = spreadSamples.length;
        const m = spreadSamples.reduce((a,b)=>a+b,0)/n;
        return Math.sqrt(spreadSamples.map(s=>(s-m)**2).reduce((a,b)=>a+b,0)/n);
      })() : 0;

      const ecoMix = recentEcoMix();
      const { targetLabel, reason: selectorReason } = selectTargetProfile(
        activeRegime, depthMin, spreadStdNow, spreadSamples.length, ecoMix
      );
      const hysteresisResult = applyHysteresis(targetLabel, depthMin);

      if (hysteresisResult.switched) {
        const ecoRing = recentEcoMix();
        const profileRecord = {
          ts: new Date().toISOString(), source: LOG_SOURCE, chain: LOG_CHAIN, pair: LOG_PAIR,
          type: 'profile_switch',
          previousProfile: hysteresisResult.prev,
          selectedProfile: activeProfile,
          selectorReason, hysteresisReason: hysteresisResult.reason,
          regimeLabel: activeRegime,
          spreadStdDev: +spreadStdNow.toFixed(6),
          samplesAboveThreshold: spreadSamples.length,
          depthNow: +depthMin.toFixed(0),
          recentEcoMix: ecoRing,
          windowId, windowKey,
          // v4 audit fields (Boss directive 2026-04-07)
          viabilityFloorFrac: MIN_VIABLE_SPREAD_FRAC,
          rpcDegraded: providerRebuilds >= REBUILD_DEGRADED_AFTER,
          providerRebuilds,
          ecoBufferMean: ecoRing.total > 0 ? +(ecoRing.viableRate).toFixed(4) : null,
        };
        appendLog(logPath, profileRecord);
        console.log(`\n  [PROFILE] ${hysteresisResult.prev} → ${activeProfile}  reason=${hysteresisResult.reason}  regime=${activeRegime}  depth=$${depthMin.toFixed(0)}\n`);
      }
    }

    // Get active profile gates for this tick
    const profile     = ENTRY_PROFILES[activeProfile];
    const profileStdGate = profile.maxSpreadStdDev;
    const profileSpreadGate = profile.minEntrySpread;
    const profileDepthGate  = profile.minDepthUsd;
    const profileSampGate   = profile.minStableSamples;

    // Spread stability check using active profile thresholds
    function isSpreadStable() {
      if (spreadSamples.length < profileSampGate) return false;
      const n = spreadSamples.length;
      const mean = spreadSamples.reduce((a,b) => a+b, 0) / n;
      const variance = spreadSamples.map(s => (s-mean)**2).reduce((a,b) => a+b, 0) / n;
      return Math.sqrt(variance) <= profileStdGate;
    }

    // ── ARMED: check for executable conditions using active profile gates ────
    const profileSpreadPass = spread >= profileSpreadGate;
    const profileDepthPass  = depthMin >= profileDepthGate;
    if (state === 'ARMED' && isExecDepth && isAboveSpread && profileSpreadPass && profileDepthPass) {
      const stable = isSpreadStable();
      if (!stable && spreadSamples.length >= profileSampGate) {
        // Spread too volatile for current profile — log skip (throttled)
        const std = (() => {
          const n = spreadSamples.length;
          const mean = spreadSamples.reduce((a,b) => a+b, 0) / n;
          return Math.sqrt(spreadSamples.map(s => (s-mean)**2).reduce((a,b) => a+b, 0) / n);
        })();
        if (stats.ticks % 10 === 0) {
          process.stdout.write(`  [stability/${activeProfile}] spread unstable — std=${(std*100).toFixed(5)}% > max=${(profileStdGate*100).toFixed(5)}%  samples=${spreadSamples.length}\n`);
        }
      } else if (stable || spreadSamples.length < profileSampGate) {
        stats.simRuns++;
        console.log(`\n  → ★ ARMED + depth + spread + stable [${activeProfile}]. Running simulation  block=${blockNumber}  spreadSamples=${spreadSamples.length}`);

        try {
          const simResult  = await runSimulation(snap, rpc, gm);
          const anyGate    = Object.values(simResult.gates).some(g => g.passed);
          const profitable = simResult.all.filter(r => r.status !== 'LOST');

          const signalType = anyGate       ? 'EXECUTION_READY'
                           : profitable.length > 0 ? 'SIMULATION_MARGINAL'
                           :                          'SIMULATION_LOST';

          // Profile readiness class — appended for traceability
          // EXECUTION_READY_SAFE | EXECUTION_READY_BALANCED | EXECUTION_READY_AGGRESSIVE
          const readinessClass = signalType === 'EXECUTION_READY'
            ? `EXECUTION_READY_${activeProfile}`
            : signalType;

          const signal = emitSignal(signalType, snap, simResult, gm, thresholds, activeRegime);
          if (signalType === 'EXECUTION_READY') stats.readySignals++;

          // Record eco outcome into ring buffer for selector feedback
          const ecoClass = signal.economicStatus === 'economically_viable'   ? 'GOOD'
                         : signal.economicStatus === 'economically_marginal'  ? 'MID'
                         : 'BAD';
          recordEco(ecoClass);

          // Edge bucket — classified against surface law (MIN_VIABLE_SPREAD_FRAC = 0.13%)
          // All profiles now share this floor. Bucket labels reflect viability, not profile tier.
          const spreadPctNow = signal.spread ?? 0;  // already in pct form (e.g. 0.158 = 0.158%)
          const edgeBucket   = spreadPctNow >= 0.18  ? 'premium'         // ≥ 0.18% — clear premium signal
                             : spreadPctNow >= 0.13  ? 'viable_zone'     // 0.13–0.18% — above floor, viable
                             : spreadPctNow >= 0.10  ? 'sub_floor'       // 0.10–0.13% — below viability floor
                             :                         'dead_zone';      // < 0.10% — structural noise

          // Log signal with full sim detail, window correlation, v4 profile metadata
          // Boss directive 2026-04-07: add viability floor compliance + selector rationale
          const aboveViabilityFloor = spreadPctNow >= MIN_VIABLE_SPREAD_PCT;
          appendLog(logPath, {
            ...signal,
            windowId, windowKey,
            // v4 audit fields
            readinessClass, activeProfile, edgeBucket,
            viabilityFloorFrac: MIN_VIABLE_SPREAD_FRAC,
            aboveViabilityFloor,
            rpcDegraded: providerRebuilds >= REBUILD_DEGRADED_AFTER,
            providerRebuilds,
            // profile gate values applied at this signal
            profileSpreadGate, profileDepthGate, profileStdGate, profileSampGate,
            simResults: simResult.all, gates: simResult.gates,
          });

        } catch (e) {
          console.error(`  [sim] ERROR: ${e.message}`);
        }

        cooldownUntil = Date.now() + COOLDOWN_AFTER_SIM_MS;
        console.log(`  → Cooldown ${COOLDOWN_AFTER_SIM_MS / 1000}s\n`);
      }  // end stability gate
    }  // end ARMED + exec check

    const elapsed = Date.now() - loopStart;
    await sleep(Math.max(0, (state === 'ARMED' ? POLL_ARMED_MS : POLL_PASSIVE_MS) - elapsed));
  }

  // ── FINAL SUMMARY ────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - stats.startMs) / 1000).toFixed(0);
  console.log('\n' + EQ);
  console.log(`  ACTIVATOR SUMMARY   (${elapsed}s  |  ${stats.ticks} ticks  |  ${stats.errors} errors)`);
  console.log(`  PASSIVE→ARMED:      ${stats.armedCount}`);
  console.log(`  ARMED→PASSIVE:      ${stats.disarmedCount}`);
  console.log(`  Simulations run:    ${stats.simRuns}`);
  console.log(`  EXECUTION_READY:    ${stats.readySignals}`);
  console.log(`  Tick map refreshes: ${stats.tickMapRefreshes}`);
  console.log(`  Unhealthy events:   ${stats.unhealthyEvents}`);
  if (logPath) console.log(`  Log: ${logPath}`);
  console.log(EQ + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function fmtTime() { return new Date().toISOString().slice(11, 19); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Classify depth into regime for logging and analysis. */
function regimeLabel(depthUsd) {
  if (depthUsd == null) return 'unknown';
  return depthUsd >= REGIME_SURGE_THRESHOLD ? 'surge' : 'base';
}

/**
 * Economic status classification (Boss ruling 2026-04-04).
 * Separate from technical status — 'EXECUTION_READY' can still fire while
 * economicStatus is 'dust_positive'. Preserves signal history without
 * conflating technical viability with business viability.
 *
 * Thresholds (at $200 optimal size):
 *   economically_viable   > 0.05%  edge  → gross > $0.10
 *   economically_marginal 0.01–0.05%      → gross $0.02–$0.10
 *   dust_positive         0–0.01%         → gross < $0.02
 *   negative              ≤ 0%
 */
function economicStatus(finalEdgePct) {
  if (finalEdgePct == null)  return 'unknown';
  if (finalEdgePct <= 0)     return 'negative';
  if (finalEdgePct < 0.01)   return 'dust_positive';
  if (finalEdgePct < 0.05)   return 'economically_marginal';
  return 'economically_viable';
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-RECOVERY HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * withTimeout — wraps any promise with a hard deadline.
 * If the promise doesn't resolve within ms, rejects with TimeoutError.
 * This is the core fix for the "await never returns" failure mode.
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`TIMEOUT:${label}:${ms}ms`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

/**
 * ConsecutiveFailTracker — counts consecutive failures on a named operation.
 * Resets on success. Reports level (warn/rebuild/fatal) based on Boss ladder.
 */
class ConsecutiveFailTracker {
  constructor(label) {
    this.label   = label;
    this.count   = 0;
    this.lastErr = null;
  }
  success() { this.count = 0; this.lastErr = null; }
  failure(err) {
    this.count++;
    this.lastErr = err?.message ?? String(err);
    if (this.count === CONSECUTIVE_FAIL_WARN) {
      process.stderr.write(`  [recover] ${this.label}: ${this.count} consecutive failures — ${this.lastErr}\n`);
    }
    return {
      count:   this.count,
      level:   this.count >= CONSECUTIVE_FAIL_REBUILD ? 'rebuild'
             : this.count >= CONSECUTIVE_FAIL_WARN    ? 'warn'
             :                                          'ok',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────
// ─────────────────────────────────────────────────────────────────────────────
// HELP (Pass A1)
// ─────────────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log([
    '',
    '  arb_window_activator.js',
    '',
    '  PURPOSE: Tick-map-aware state machine: PASSIVE→ARMED→EXECUTABLE with EXECUTION_READY signal emission',
    '',
    '  USAGE:',
        '    node -r dotenv/config scripts/analysis/arb_window_activator.js',
    '    node -r dotenv/config scripts/analysis/arb_window_activator.js --remap-ticks --log=./logs/activator.jsonl',
    '    node -r dotenv/config scripts/analysis/arb_window_activator.js --duration=86400 --log=./logs/activator_$(date +%Y%m%d).jsonl',
    '',
    '  FLAGS:',
    '    --help          Show this message',
    '    --json          Machine-readable JSON output',
    '    --duration=N    Run duration in seconds (long-running scripts)',
    '    --log=PATH      Output JSONL log file path',
    '    --gas=live|manual  Gas price source (simulators)',
    '    --out=PATH      Write JSON summary to file (analyzers)',
    '    --pair=PAIR     Surface pair: ARB/USDC (default) | ETH/USDC | ETH/USDT',
    '    --remap-ticks   Force fresh tick-map scan on startup (required for ETH/USDC, ETH/USDT)',
    '',
  ].join('\n'));
}

// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { printHelp(); process.exit(0); }
  // Support both --flag=VALUE and --flag VALUE formats
  const getS = (f, d) => {
    const eq = args.find(a => a.startsWith(f + '='));
    if (eq) return eq.split('=')[1];
    const i = args.indexOf(f);
    return (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? args[i + 1] : d;
  };
  const getN = (f, d) => {
    const eq = args.find(a => a.startsWith(f + '='));
    if (eq) return Number(eq.split('=')[1]);
    const i = args.indexOf(f);
    return (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) ? Number(args[i + 1]) : d;
  };
  return {
    gasMode:    getS('--gas',      'live'),
    duration:   getN('--duration', 28800),   // default 8 hours
    logPath:    getS('--log',      null),
    remapTicks: args.includes('--remap-ticks'),
    pair:       getS('--pair',     'ARB/USDC'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { gasMode, duration, logPath, remapTicks, pair } = parseArgs();

  // ── Pair resolution ────────────────────────────────────────────────────────
  const pairCfg = PAIR_CONFIGS[pair];
  if (!pairCfg) {
    console.error(
      `[activator] Unknown --pair "${pair}". Supported: ${Object.keys(PAIR_CONFIGS).join(', ')}`
    );
    process.exit(1);
  }

  // Assign pair-specific constants. All let — logic is unchanged.
  UNIV3_POOL       = pairCfg.univ3Pool;
  UNIV3_FEE_FRAC   = pairCfg.univ3FeeFrac;
  CAMELOT_POOL     = pairCfg.camelotPool;
  CAMELOT_FEE_FRAC = pairCfg.camelotFeeFrac;
  CAMELOT_TYPE     = pairCfg.camelotType || 'algebra';  // default Algebra; 'univ3' for Ramses
  TICK_SPACING     = pairCfg.tickSpacing;
  DEC0             = pairCfg.dec0;
  DEC1             = pairCfg.dec1;
  LOG_PAIR         = pair;

  if (pairCfg.staticHighTick === null && !remapTicks) {
    console.warn(
      `  [activator] WARNING: --remap-ticks not passed for ${pair}.\n` +
      '  Static thresholds are null → activator will stay PASSIVE.\n' +
      '  Strongly recommended: add --remap-ticks to derive live thresholds.\n'
    );
  }

  const rpc = createProvider('arbitrum');

  console.log(`\n[arb_window_activator] ${new Date().toISOString()}  pair=${pair}`);

  let gm;
  if (gasMode === 'manual') {
    gm = { ...GAS_MANUAL };
    console.log(`  Gas: manual (${gm.gasPriceGwei} gwei)`);
  } else {
    process.stdout.write('  Fetching live Arbitrum gas price... ');
    gm = await fetchLiveGasModel(rpc);
    console.log(`${gm.gasPriceGwei.toFixed(6)} gwei | $${calcGasUSD(gm).toFixed(6)}/tx`);
  }

  await activatorLoop(rpc, gm, duration, logPath, remapTicks, pairCfg);
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
