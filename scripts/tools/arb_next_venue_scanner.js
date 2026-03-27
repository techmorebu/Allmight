'use strict';
/**
 * scripts/tools/arb_next_venue_scanner.js
 *
 * Purpose:
 *   Discover the next non-UniV3 ARB/native-USDC venue candidates on Arbitrum
 *   for blocker-guided surface discovery. Outputs a ranked list ready to feed
 *   into arb_pool_smoke_test_p2.js.
 *
 * Usage:
 *   node -r dotenv/config scripts/tools/arb_next_venue_scanner.js
 *   node -r dotenv/config scripts/tools/arb_next_venue_scanner.js --venue=ramses
 *   node -r dotenv/config scripts/tools/arb_next_venue_scanner.js --venue=sushiv3
 *   node -r dotenv/config scripts/tools/arb_next_venue_scanner.js --native-only
 *   node -r dotenv/config scripts/tools/arb_next_venue_scanner.js --json
 *
 * Hard rules:
 *   - No execution logic
 *   - No fetcher mutation
 *   - No breakeven classification
 *   - No TVL assumptions — active-tick depth (L×sqrtP) is NOT computed here
 *   - On-chain confirm every candidate before reporting
 *   - Partial success per venue — one bad venue does not collapse the run
 *   - provider_factory.js ONLY — no raw provider construction
 *
 * Repo path note:
 *   This file lives at scripts/tools/, so provider_factory is at:
 *   ../../utils/provider_factory
 */

require('dotenv').config();

const { ethers }        = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN ANCHORS — canonical from handoff, do not change
// ─────────────────────────────────────────────────────────────────────────────
const ARB_ADDR    = '0x912CE59144191C1204E64559FE8253a0e49E6548';
const USDC_NATIVE = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDCE_ADDR  = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';

const ARB_L   = ARB_ADDR.toLowerCase();
const USDC_L  = USDC_NATIVE.toLowerCase();
const USDCE_L = USDCE_ADDR.toLowerCase();

// Sanity price range: USDC per ARB
const ARB_PRICE_MIN = 0.05;
const ARB_PRICE_MAX = 10.0;

// Anti-stampede delays (ms)
const SLEEP_BETWEEN_FEE_TIERS = 300;
const SLEEP_BETWEEN_POOLS     = 250;
const SLEEP_BETWEEN_VENUES    = 500;

// ─────────────────────────────────────────────────────────────────────────────
// ABIs
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const ALGEBRA_FACTORY_ABI = [
  'function poolByPair(address tokenA, address tokenB) external view returns (address pool)',
];

// All calls below use Promise.all ONLY within a single rpc.callDetailed() on
// the SAME contract — this is the project-approved pattern.
const UNIV3_POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

const ALGEBRA_POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function globalState() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 fee, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

const GMX_VAULT_ABI = [
  'function whitelistedTokens(address token) external view returns (bool)',
];

// ─────────────────────────────────────────────────────────────────────────────
// VENUE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────
// protocol:
//   'univ3_fork'  → slot0() + fee(), factory uses getPool(tokenA, tokenB, feeTier)
//   'algebra'     → globalState() [fee at index 2], factory uses poolByPair(tokenA, tokenB)
//   'gmx_vault'   → reference only, not a standard AMM pool
//
// feeTiers: UniV3-style uint24 values (100=0.01%, 500=0.05%, 3000=0.3%, 10000=1%)
//           null for Algebra (dynamic fee, one pool per pair) and GMX
//
// Factory addresses are on Arbitrum mainnet.
const VENUE_DEFS = [
  {
    name:          'ramses',
    displayName:   'Ramses V2 (CL)',
    protocol:      'univ3_fork',
    factory:       '0xAA2cd7477c451E703f3B9Ba5663334914763edF8',
    feeTiers:      [100, 500, 3000, 10000],
    referenceOnly: false,
  },
  {
    name:          'sushiv3',
    displayName:   'SushiSwap V3',
    protocol:      'univ3_fork',
    factory:       '0x1af415a1EbA07a4986a52B6f2e7dE7003D82231e',
    feeTiers:      [100, 500, 3000, 10000],
    referenceOnly: false,
  },
  {
    name:          'zyber',
    displayName:   'Zyber V3',
    protocol:      'algebra',
    factory:       '0x9C2ABD632771b433E5E7507BcaA41cA3b25D8544',
    feeTiers:      null,
    referenceOnly: false,
  },
  {
    name:          'gmx',
    displayName:   'GMX V1',
    protocol:      'gmx_vault',
    vault:         '0x489ee077994B6658eAfA855C308275EAd8097C4A',
    feeTiers:      null,
    referenceOnly: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Classify a token address as native_usdc | usdce | other
 */
function classifyQuoteToken(addr) {
  const a = (addr || '').toLowerCase();
  if (a === USDC_L)  return 'native_usdc';
  if (a === USDCE_L) return 'usdce';
  return 'other';
}

/**
 * Compute price in USDC-per-ARB, regardless of which token is token0.
 * Uses the same formula as arbitrumFetcher.js for consistency.
 *
 * On Arbitrum:
 *   ARB  (0x912C...) first byte 0x91 — sorts LOWER → is token0 in ARB/USDC pools
 *   USDC (0xaf88...) first byte 0xaf — sorts HIGHER → is token1
 *
 * If token0 = ARB, dec0 = 18, dec1 = 6:
 *   raw = sqrtP^2 × 10^(18-6) = USDC per ARB ✓
 * If token0 = USDC (unusual but possible on other venues):
 *   raw = sqrtP^2 × 10^(6-18) = ARB per USDC → invert
 */
function computeUSDCPerARB(sqrtPriceX96, token0addr) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96) / Number(Q96);

  if (token0addr.toLowerCase() === ARB_L) {
    // token0=ARB (18 dec), token1=USDC (6 dec)
    return sqrtP * sqrtP * Math.pow(10, 18 - 6);
  } else {
    // token0=USDC (6 dec), token1=ARB (18 dec) — invert
    const raw = sqrtP * sqrtP * Math.pow(10, 6 - 18);
    return raw > 0 ? 1 / raw : 0;
  }
}

function isPriceSane(price) {
  return isFinite(price) && price > ARB_PRICE_MIN && price < ARB_PRICE_MAX;
}

/**
 * Convert raw fee (UniV3 hundredths-of-bips OR Algebra ppm equivalent)
 * to basis points.
 *   UniV3:   fee=500  → 500/100 = 5 bps = 0.05%   ✓
 *   Algebra: fee=249  → 249/100 = 2.49 bps = 0.0249%  ✓
 */
function rawFeeToBps(rawFee) {
  return Number(rawFee) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERY — UniV3-style factory
// ─────────────────────────────────────────────────────────────────────────────
async function discoverUniV3Pools(venue, rpc) {
  const poolsFound = [];
  const failures   = [];

  for (const feeTier of venue.feeTiers) {
    await sleep(SLEEP_BETWEEN_FEE_TIERS);

    try {
      const r = await rpc.callDetailed(
        `scanner.${venue.name}.factory.fee${feeTier}`,
        async (provider) => {
          const factory = new ethers.Contract(venue.factory, UNIV3_FACTORY_ABI, provider);
          // Factory handles token ordering internally
          return factory.getPool(ARB_ADDR, USDC_NATIVE, feeTier);
        },
        { timeoutMs: 2500 }
      );

      const poolAddr = r.result;

      if (!poolAddr || poolAddr === ethers.ZeroAddress) {
        // No pool at this fee tier — normal, not a failure
        continue;
      }

      poolsFound.push({
        feeTier,
        poolAddress:     poolAddr,
        discoverySource: 'factory_query',
      });

    } catch (e) {
      failures.push({
        step:  `factory_fee${feeTier}`,
        error: String(e.message || e).slice(0, 130),
      });
    }
  }

  return { poolsFound, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERY — Algebra-style factory (one pool per pair)
// ─────────────────────────────────────────────────────────────────────────────
async function discoverAlgebraPool(venue, rpc) {
  try {
    const r = await rpc.callDetailed(
      `scanner.${venue.name}.factory`,
      async (provider) => {
        const factory = new ethers.Contract(venue.factory, ALGEBRA_FACTORY_ABI, provider);
        return factory.poolByPair(ARB_ADDR, USDC_NATIVE);
      },
      { timeoutMs: 2500 }
    );

    const poolAddr = r.result;

    if (!poolAddr || poolAddr === ethers.ZeroAddress) {
      return {
        poolsFound: [],
        failures: [{ step: 'factory_query', error: 'zero address returned — pool not deployed' }],
      };
    }

    return {
      poolsFound: [{ feeTier: null, poolAddress: poolAddr, discoverySource: 'factory_query' }],
      failures:   [],
    };

  } catch (e) {
    return {
      poolsFound: [],
      failures:   [{ step: 'factory_query', error: String(e.message || e).slice(0, 130) }],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ON-CHAIN CONFIRMATION — UniV3-style pool
// ─────────────────────────────────────────────────────────────────────────────
// Promise.all is used here ONLY within a single rpc.callDetailed() on the same
// contract (pool) — this is the project-approved pattern.
async function confirmUniV3Pool(poolAddress, venue, feeTier, discoverySource, rpc) {
  try {
    const r = await rpc.callDetailed(
      `scanner.${venue.name}.confirm.${poolAddress.slice(0, 10)}`,
      async (provider) => {
        const pool = new ethers.Contract(poolAddress, UNIV3_POOL_ABI, provider);
        const [token0, token1, feeRaw, slot0Res, liq] = await Promise.all([
          pool.token0(),
          pool.token1(),
          pool.fee(),
          pool.slot0(),
          pool.liquidity(),
        ]);
        return { token0, token1, feeRaw, slot0Res, liq };
      },
      { timeoutMs: 3500 }
    );

    const { token0, token1, feeRaw, slot0Res, liq } = r.result;
    return _buildCandidate({
      venue, poolAddress, discoverySource,
      token0, token1, sqrtPriceX96: slot0Res[0],
      feeRaw: Number(feeRaw), liq,
      protocol: 'univ3_fork',
      notes: [],
    });

  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 150) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ON-CHAIN CONFIRMATION — Algebra-style pool
// ─────────────────────────────────────────────────────────────────────────────
// Same rule: Promise.all only within single rpc.callDetailed() on same contract.
async function confirmAlgebraPool(poolAddress, venue, discoverySource, rpc) {
  try {
    const r = await rpc.callDetailed(
      `scanner.${venue.name}.confirm.${poolAddress.slice(0, 10)}`,
      async (provider) => {
        const pool = new ethers.Contract(poolAddress, ALGEBRA_POOL_ABI, provider);
        const [token0, token1, gs, liq] = await Promise.all([
          pool.token0(),
          pool.token1(),
          pool.globalState(),
          pool.liquidity(),
        ]);
        return { token0, token1, gs, liq };
      },
      { timeoutMs: 3500 }
    );

    const { token0, token1, gs, liq } = r.result;
    // globalState: index 0 = sqrtPriceX96, index 2 = fee (hundredths-of-bips)
    return _buildCandidate({
      venue, poolAddress, discoverySource,
      token0, token1, sqrtPriceX96: gs[0],
      feeRaw: Number(gs[2]), liq,
      protocol: 'algebra',
      notes: [],
    });

  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 150) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED CANDIDATE BUILDER
// ─────────────────────────────────────────────────────────────────────────────
function _buildCandidate({ venue, poolAddress, discoverySource, token0, token1,
                           sqrtPriceX96, feeRaw, liq, protocol, notes }) {
  const t0L = (token0 || '').toLowerCase();
  const t1L = (token1 || '').toLowerCase();

  // Must contain ARB on one side
  const hasARB = t0L === ARB_L || t1L === ARB_L;
  if (!hasARB) {
    return { ok: false, reason: `pool does not contain ARB (t0=${token0} t1=${token1})` };
  }

  // Identify quote token
  const quoteAddr  = t0L === ARB_L ? token1 : token0;
  const quoteType  = classifyQuoteToken(quoteAddr);

  // Determine human-readable symbols for the two tokens
  const token0Symbol = t0L === ARB_L ? 'ARB'
    : quoteType === 'native_usdc' ? 'USDC'
    : quoteType === 'usdce'       ? 'USDCe'
    : '?';
  const token1Symbol = t1L === ARB_L ? 'ARB'
    : quoteType === 'native_usdc' ? 'USDC'
    : quoteType === 'usdce'       ? 'USDCe'
    : '?';

  // Price
  const price     = computeUSDCPerARB(sqrtPriceX96, token0);
  const priceSane = isPriceSane(price);

  // Liquidity
  const liqNum      = Number(liq);
  const liqReadable = liqNum > 0;

  // Fee
  const feeBps = rawFeeToBps(feeRaw);

  // Notes
  const notesCopy = [...notes];
  if (quoteType === 'usdce') notesCopy.push('REJECTED by default: uses USDCe (not native USDC)');
  if (quoteType === 'other') notesCopy.push(`WARNING: unknown quote token ${quoteAddr}`);
  if (!liqReadable)          notesCopy.push('liquidity=0 (pool may be empty)');
  if (!priceSane)            notesCopy.push(`price out of sanity range: ${price?.toFixed ? price.toFixed(6) : price}`);
  if (feeBps > 10)           notesCopy.push(`fee ${feeBps.toFixed(2)} bps exceeds 10 bps target`);

  const smokeTestReady = (
    quoteType === 'native_usdc' &&
    priceSane &&
    liqReadable &&
    feeBps <= 100  // don't outright block high-fee pools from smoke test — let L×sqrtP decide
  );

  return {
    ok: true,
    candidate: {
      venue:             venue.name,
      pairLabel:         'ARB/USDC',
      poolAddress,
      token0,
      token1,
      token0Symbol,
      token1Symbol,
      quoteType,
      feeBps:            parseFloat(feeBps.toFixed(4)),
      poolKind:          'concentrated',
      discoverySource,
      protocol,
      onChainConfirmed:  true,
      stateReadable:     true,
      priceSane,
      priceUSD:          priceSane ? parseFloat(price.toFixed(6)) : null,
      liquidityReadable: liqReadable,
      liquidityRaw:      liq.toString(),
      smokeTestReady,
      priorityScore:     0,   // filled in by scoreCandidate()
      notes:             notesCopy,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GMX REFERENCE CHECK
// ─────────────────────────────────────────────────────────────────────────────
// GMX V1 is a multi-asset vault, NOT a standard AMM pool.
// It CANNOT be fed to arb_pool_smoke_test_p2.js.
// active-tick depth (L×sqrtP) is not measurable here.
// This is a reference-only surface check.
async function checkGMXReference(venue, rpc) {
  try {
    const r = await rpc.callDetailed(
      'scanner.gmx.vault_whitelist',
      async (provider) => {
        const vault = new ethers.Contract(venue.vault, GMX_VAULT_ABI, provider);
        const [arbOk, usdcOk] = await Promise.all([
          vault.whitelistedTokens(ARB_ADDR),
          vault.whitelistedTokens(USDC_NATIVE),
        ]);
        return { arbOk, usdcOk };
      },
      { timeoutMs: 3000 }
    );

    const { arbOk, usdcOk } = r.result;

    return {
      ok: true,
      candidate: {
        venue:             'gmx',
        pairLabel:         'ARB/USDC',
        poolAddress:       venue.vault,
        token0:            ARB_ADDR,
        token1:            USDC_NATIVE,
        token0Symbol:      'ARB',
        token1Symbol:      'USDC',
        quoteType:         'native_usdc',
        feeBps:            null,
        poolKind:          'vault',
        discoverySource:   'vault_whitelist',
        protocol:          'gmx_vault',
        onChainConfirmed:  arbOk && usdcOk,
        stateReadable:     false,
        priceSane:         null,
        priceUSD:          null,
        liquidityReadable: false,
        liquidityRaw:      null,
        smokeTestReady:    false,
        priorityScore:     0,
        notes: [
          'REFERENCE ONLY — GMX is a multi-asset vault, not an AMM pool',
          'Cannot measure active-tick depth (L×sqrtP)',
          'Cannot use arb_pool_smoke_test_p2.js on this address',
          `ARB whitelisted in vault: ${arbOk}`,
          `nativeUSDC whitelisted in vault: ${usdcOk}`,
        ],
      },
    };

  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 150) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORING
// ─────────────────────────────────────────────────────────────────────────────
// Ranking criteria (boss-specified order):
//   1. native USDC          +35
//   2. concentrated-liquidity +20
//   3. fee ≤ 10 bps         +20
//   4. on-chain confirmed   +10
//   5. state readable       +5
//   6. liquidity readable   +5
//   7. price sane           +5
//
// GMX vault always scores 0 — it is reference-only.
function scoreCandidate(c) {
  if (c.poolKind === 'vault') return 0;

  let score = 0;
  if (c.quoteType === 'native_usdc')              score += 35;
  if (c.poolKind === 'concentrated')              score += 20;
  if (c.feeBps !== null && c.feeBps <= 10)        score += 20;
  if (c.onChainConfirmed)                         score += 10;
  if (c.stateReadable)                            score +=  5;
  if (c.liquidityReadable)                        score +=  5;
  if (c.priceSane)                                score +=  5;
  return score;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN ONE VENUE
// ─────────────────────────────────────────────────────────────────────────────
async function scanVenue(venue, rpc, nativeOnly) {
  const venueResult = {
    venue:      venue.name,
    status:     'failed',
    candidates: [],
    failures:   [],
  };

  try {
    // ── GMX reference path ──────────────────────────────────────────────────
    if (venue.protocol === 'gmx_vault') {
      const check = await checkGMXReference(venue, rpc);
      if (check.ok) {
        check.candidate.priorityScore = 0;
        venueResult.candidates.push(check.candidate);
        venueResult.status = 'success';
      } else {
        venueResult.failures.push({ step: 'gmx_vault_check', error: check.reason });
        venueResult.status = 'failed';
      }
      return venueResult;
    }

    // ── Discovery phase ──────────────────────────────────────────────────────
    let rawPools = [];

    if (venue.protocol === 'univ3_fork') {
      const { poolsFound, failures } = await discoverUniV3Pools(venue, rpc);
      rawPools = poolsFound;
      venueResult.failures.push(...failures);

    } else if (venue.protocol === 'algebra') {
      const { poolsFound, failures } = await discoverAlgebraPool(venue, rpc);
      rawPools = poolsFound;
      venueResult.failures.push(...failures);
    }

    if (rawPools.length === 0) {
      // No pools found — status depends on whether we got errors or just empty results
      venueResult.status = venueResult.failures.length > 0 ? 'failed' : 'partial';
      return venueResult;
    }

    // ── On-chain confirmation phase ──────────────────────────────────────────
    for (const raw of rawPools) {
      await sleep(SLEEP_BETWEEN_POOLS);

      let confirmResult;

      if (venue.protocol === 'univ3_fork') {
        confirmResult = await confirmUniV3Pool(
          raw.poolAddress, venue, raw.feeTier, raw.discoverySource, rpc
        );
      } else if (venue.protocol === 'algebra') {
        confirmResult = await confirmAlgebraPool(
          raw.poolAddress, venue, raw.discoverySource, rpc
        );
      }

      if (!confirmResult || !confirmResult.ok) {
        venueResult.failures.push({
          step:  `confirm_${raw.poolAddress.slice(0, 10)}`,
          error: confirmResult?.reason || 'unknown',
        });
        continue;
      }

      const c = confirmResult.candidate;

      // Apply --native-only filter
      if (nativeOnly && c.quoteType !== 'native_usdc') continue;

      c.priorityScore = scoreCandidate(c);
      venueResult.candidates.push(c);
    }

    venueResult.status = venueResult.candidates.length > 0
      ? 'success'
      : venueResult.failures.length > 0 ? 'partial' : 'failed';

  } catch (e) {
    venueResult.failures.push({
      step:  'scan_venue_top',
      error: String(e.message || e).slice(0, 160),
    });
    venueResult.status = 'failed';
  }

  return venueResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
function printSummary(allCandidates, allResults) {
  const LINE = '═'.repeat(106);
  const DASH = '─'.repeat(106);

  const ranked = [...allCandidates].sort((a, b) => b.priorityScore - a.priorityScore);

  console.log('\n' + LINE);
  console.log('  ARB / USDC  —  NEXT VENUE SCANNER   (blocker-guided surface discovery)');
  console.log(LINE);

  if (ranked.length === 0) {
    console.log('\n  No candidates found. See per-venue failures below.\n');
  } else {
    ranked.forEach((c, i) => {
      const rank    = String(i + 1).padStart(2);
      const venue   = c.venue.padEnd(10);
      const pair    = c.pairLabel.padEnd(10);
      const qt      = c.quoteType.padEnd(14);
      const fee     = c.feeBps !== null
        ? `fee=${c.feeBps.toFixed(2)}bps`.padEnd(15)
        : 'fee=n/a        ';
      const state   = c.stateReadable     ? 'state=OK   ' : 'state=FAIL ';
      const liq     = c.liquidityReadable ? 'liq=OK  '   : 'liq=FAIL';
      const price   = c.priceSane
        ? `$${String(c.priceUSD).padEnd(8)}`
        : 'price=FAIL';
      const smoke   = c.smokeTestReady
        ? 'smoke_test_ready=YES ★'
        : 'smoke_test_ready=NO  ';
      const score   = `score=${c.priorityScore}`.padStart(9);

      console.log(`[${rank}] ${venue} ${pair} ${qt} ${fee} ${state} ${liq} ${price} ${smoke} ${score}`);
      console.log(`      pool: ${c.poolAddress}   protocol: ${c.protocol}`);
      if (c.notes.length) {
        c.notes.forEach(n => console.log(`      ⚠  ${n}`));
      }
      console.log('');
    });
  }

  console.log(DASH);
  console.log('  PER-VENUE STATUS');
  console.log(DASH);

  allResults.forEach(vr => {
    const icon = vr.status === 'success' ? '✓' : vr.status === 'partial' ? '~' : '✗';
    console.log(
      `  [${icon}] ${vr.venue.padEnd(12)} ` +
      `status=${vr.status.padEnd(8)} ` +
      `candidates=${vr.candidates.length}  ` +
      `failures=${vr.failures.length}`
    );
    if (vr.failures.length) {
      vr.failures.forEach(f =>
        console.log(`        FAIL [${f.step}] ${f.error}`)
      );
    }
  });

  // ── Top candidate callout ────────────────────────────────────────────────
  const top = ranked.find(c => c.smokeTestReady);

  console.log('\n' + LINE);
  if (top) {
    console.log('  ★  TOP CANDIDATE FOR  arb_pool_smoke_test_p2.js');
    console.log('');
    console.log(`     Venue:     ${top.venue}`);
    console.log(`     Pool:      ${top.poolAddress}`);
    console.log(`     Protocol:  ${top.protocol}`);
    console.log(`     Fee:       ${top.feeBps?.toFixed(2)} bps`);
    console.log(`     QuoteType: ${top.quoteType}`);
    console.log(`     Price:     $${top.priceUSD} USDC/ARB`);
    console.log(`     Score:     ${top.priorityScore}/100`);
    console.log('');
    console.log('     Next command:');
    console.log(`     node -r dotenv/config scripts/discovery/arb_pool_smoke_test_p2.js --pool=${top.poolAddress}`);
    console.log('');
    console.log('     After smoke test passes → measure L×sqrtP → add to breakeven_report.js');
  } else {
    console.log('  ★  No smoke-test-ready candidates found.');
    console.log('     All candidates were rejected or only GMX reference was available.');
    console.log('     Check per-venue failures above — factory addresses may need updating.');
  }
  console.log(LINE + '\n');

  return ranked;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI ARG PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const venueArg = args.find(a => a.startsWith('--venue='));
  return {
    venue:      venueArg ? venueArg.replace('--venue=', '') : null,
    nativeOnly: args.includes('--native-only'),
    jsonOutput: args.includes('--json'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { venue: venueFilter, nativeOnly, jsonOutput } = parseArgs();

  console.log(`\n[arb_next_venue_scanner] ${nowIso()}`);
  if (venueFilter)  console.log(`  filter: --venue=${venueFilter}`);
  if (nativeOnly)   console.log('  filter: --native-only  (USDCe pools will be excluded)');

  const rpc = createProvider('arbitrum');

  let venuesToScan = VENUE_DEFS;
  if (venueFilter) {
    venuesToScan = VENUE_DEFS.filter(v => v.name === venueFilter);
    if (!venuesToScan.length) {
      console.error(`\n[ERROR] Unknown venue: "${venueFilter}"`);
      console.error(`Valid venues: ${VENUE_DEFS.map(v => v.name).join(', ')}`);
      process.exit(1);
    }
  }

  const allResults    = [];
  const allCandidates = [];

  // Serial venue scanning — no stampede
  for (const venue of venuesToScan) {
    console.log(`\n  → scanning ${venue.displayName} (${venue.name})...`);
    const result = await scanVenue(venue, rpc, nativeOnly);
    allResults.push(result);
    allCandidates.push(...result.candidates);

    const icon = result.status === 'success' ? '✓'
               : result.status === 'partial' ? '~'
               : '✗';
    console.log(
      `    [${icon}] ${result.candidates.length} candidate(s)  ` +
      `${result.failures.length} failure(s)`
    );

    await sleep(SLEEP_BETWEEN_VENUES);
  }

  const ranked = printSummary(allCandidates, allResults);

  // ── JSON output ────────────────────────────────────────────────────────────
  if (jsonOutput) {
    const out = {
      scannedAt:    nowIso(),
      totalFound:   allCandidates.length,
      smokeReady:   ranked.filter(c => c.smokeTestReady).length,
      candidates:   ranked,
      venueStatus:  allResults.map(r => ({
        venue:    r.venue,
        status:   r.status,
        failures: r.failures,
      })),
    };
    console.log('\n── JSON ──────────────────────────────────────────────────────────────────────');
    console.log(JSON.stringify(out, null, 2));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
