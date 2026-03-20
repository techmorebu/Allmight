'use strict';
/**
 * scripts/tools/arb_joe_v2_scanner.js
 *
 * Purpose:
 *   Discover Trader Joe V2 Liquidity Book ARB/native-USDC pairs on Arbitrum.
 *   Answers one question: does Joe V2 provide a REAL, usable ARB/USDC surface?
 *
 * Usage:
 *   node -r dotenv/config scripts/tools/arb_joe_v2_scanner.js
 *   node -r dotenv/config scripts/tools/arb_joe_v2_scanner.js --json
 *
 * Hard rules:
 *   - No breakeven logic
 *   - No Redis writes
 *   - No fetcher integration
 *   - No classification
 *   - No routing logic
 *   - No TVL / external API data
 *   - On-chain confirm every candidate
 *   - provider_factory.js ONLY
 *   - Partial failure per binStep — never collapse whole run
 *
 * Repo path note:
 *   Lives at scripts/tools/ → provider_factory is at ../../utils/provider_factory
 *
 * Joe V2 vs CL math note:
 *   CL:   liquidity = L × sqrt(P)  (continuous tick depth)
 *   Joe:  liquidity = sum across active bins (discrete bin depth)
 *   For this scanner we only validate:
 *     - price sanity (reserve ratio)
 *     - non-zero reserves near active bin
 *   Full bin-depth measurement comes in arb_joe_v2_probe.js (next step).
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// TOKEN ANCHORS (canonical — do not change)
// ─────────────────────────────────────────────────────────────────────────────
const ARB_ADDR    = '0x912CE59144191C1204E64559FE8253a0e49E6548';
const USDC_NATIVE = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDCE_ADDR  = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8';

const ARB_L   = ARB_ADDR.toLowerCase();
const USDC_L  = USDC_NATIVE.toLowerCase();
const USDCE_L = USDCE_ADDR.toLowerCase();

// Price sanity: USDC per ARB
const ARB_PRICE_MIN = 0.05;
const ARB_PRICE_MAX = 10.0;

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY ADDRESSES — Arbitrum mainnet
// V2.0 (legacy): 0x1886D09C9Ade0c5DB822D85D21678Db67B6c2982
// V2.1 (active): 0x8e42f2F4101563bF679975178e880FD87d3eFd4e
// Scanning both: ensures no pair is missed across deployment versions
// ─────────────────────────────────────────────────────────────────────────────
const FACTORIES = [
  { version: 'v2.1', address: '0x8e42f2F4101563bF679975178e880FD87d3eFd4e' },
  { version: 'v2.0', address: '0x1886D09C9Ade0c5DB822D85D21678Db67B6c2982' },
];

// binSteps to probe (Boss-approved set)
// binStep is the fee proxy: binStep=5 ≈ 0.05% base fee per bin crossed
const BIN_STEPS = [1, 5, 10, 20, 25, 30];

// Anti-stampede delays (ms)
const SLEEP_BETWEEN_BINSTEPS   = 300;
const SLEEP_BETWEEN_FACTORIES  = 400;

// ─────────────────────────────────────────────────────────────────────────────
// ABIs
// ─────────────────────────────────────────────────────────────────────────────
// LB Factory — getLBPairInformation returns a struct; ethers v6 decodes tuples.
// The struct fields: (uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting)
const LB_FACTORY_ABI = [
  'function getLBPairInformation(address tokenA, address tokenB, uint256 binStep) external view returns (uint16, address, bool, bool)',
];

// LB Pair — same ABI covers both V2.0 and V2.1 for our read-only needs
// getReserves() returns (uint128 reservesX, uint128 reservesY) in V2.1
// In V2.0 it may return (uint256, uint256) — we handle both via BigInt
const LB_PAIR_ABI = [
  'function tokenX() external view returns (address)',
  'function tokenY() external view returns (address)',
  'function getReserves() external view returns (uint128 reservesX, uint128 reservesY)',
  'function getActiveId() external view returns (uint24 activeId)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
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

function classifyQuote(addr) {
  const a = (addr || '').toLowerCase();
  if (a === USDC_L)  return 'native_usdc';
  if (a === USDCE_L) return 'usdce';
  return 'other';
}

/**
 * Approximate price in USDC-per-ARB from reserves.
 * Boss spec: price ≈ reserveY / reserveX (adjusted for decimals)
 *
 * If tokenX = ARB (decX=18), tokenY = USDC (decY=6):
 *   price = (reserveY / 1e6) / (reserveX / 1e18)
 *         = reserveY * 1e12 / reserveX
 *
 * If tokenX = USDC (decX=6), tokenY = ARB (decY=18): invert
 *   priceARBperUSDC = (reserveY / 1e18) / (reserveX / 1e6) → invert → USDC per ARB
 */
function computePriceFromReserves(reserveX, reserveY, tokenXAddr, decX, decY) {
  const rxNum = Number(reserveX);
  const ryNum = Number(reserveY);

  if (rxNum === 0 || ryNum === 0) return null;

  const tXL = (tokenXAddr || '').toLowerCase();

  if (tXL === ARB_L) {
    // tokenX=ARB, tokenY=USDC → USDC per ARB
    return (ryNum / Math.pow(10, decY)) / (rxNum / Math.pow(10, decX));
  } else {
    // tokenX=USDC, tokenY=ARB → invert → USDC per ARB
    const arbPerUsdc = (ryNum / Math.pow(10, decY)) / (rxNum / Math.pow(10, decX));
    return arbPerUsdc > 0 ? 1 / arbPerUsdc : null;
  }
}

/**
 * Bin price formula (informational — not used for classification here).
 * P(i) = (1 + binStep/10000)^(i - 8388608)
 * Gives raw tokenY per tokenX exchange rate.
 * Adjusted for decimals:
 *   price_human = P(i) * 10^(decX) / 10^(decY)
 */
function computeBinPrice(activeId, binStep, tokenXAddr, decX, decY) {
  const ORIGIN = 8388608; // 2^23
  const raw = Math.pow(1 + binStep / 10000, activeId - ORIGIN);

  const tXL = (tokenXAddr || '').toLowerCase();
  const humanRaw = raw * Math.pow(10, decX - decY);

  if (tXL === ARB_L) {
    // tokenX=ARB, tokenY=USDC: humanRaw = USDC per ARB
    return humanRaw;
  } else {
    // tokenX=USDC, tokenY=ARB: invert
    return humanRaw > 0 ? 1 / humanRaw : null;
  }
}

function isPriceSane(price) {
  return price !== null && isFinite(price) && price > ARB_PRICE_MIN && price < ARB_PRICE_MAX;
}

function scoreCandidate(c) {
  let s = 0;
  if (c.quoteType === 'native_usdc')    s += 35;
  if (c.liquidityNonZero)               s += 25;
  if (c.priceSane)                      s += 20;
  if (c.stateReadable)                  s += 10;
  if (c.binStep <= 10)                  s += 10;  // fee-competitive
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY QUERY — discover pair address for a given binStep
// ─────────────────────────────────────────────────────────────────────────────
async function queryFactory(factoryAddr, factoryVersion, binStep, rpc) {
  try {
    const r = await rpc.callDetailed(
      `joe.factory.${factoryVersion}.bs${binStep}`,
      async (provider) => {
        const factory = new ethers.Contract(factoryAddr, LB_FACTORY_ABI, provider);
        // Factory accepts tokens in any order
        return factory.getLBPairInformation(ARB_ADDR, USDC_NATIVE, binStep);
      },
      { timeoutMs: 2500 }
    );

    // Return: (uint16 binStep, address LBPair, bool createdByOwner, bool ignoredForRouting)
    const pairAddr = r.result[1];

    if (!pairAddr || pairAddr === ethers.ZeroAddress) {
      return { found: false };
    }

    return {
      found:       true,
      pairAddress: pairAddr,
      binStep,
      factoryVersion,
    };

  } catch (e) {
    return {
      found:   false,
      failure: { step: `factory_${factoryVersion}_bs${binStep}`, error: String(e.message || e).slice(0, 130) },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAIR CONFIRMATION — read on-chain state for a discovered pair
// Promise.all ONLY within single rpc.callDetailed() on same contract — project rule
// ─────────────────────────────────────────────────────────────────────────────
async function confirmPair(pairAddress, binStep, factoryVersion, rpc) {
  try {
    // Step 1: Read pair identifiers + state
    const r = await rpc.callDetailed(
      `joe.pair.confirm.${pairAddress.slice(0, 10)}`,
      async (provider) => {
        const pair = new ethers.Contract(pairAddress, LB_PAIR_ABI, provider);
        const [tokenX, tokenY, reserves, activeId] = await Promise.all([
          pair.tokenX(),
          pair.tokenY(),
          pair.getReserves(),
          pair.getActiveId(),
        ]);
        return { tokenX, tokenY, reserves, activeId };
      },
      { timeoutMs: 3500 }
    );

    const { tokenX, tokenY, reserves, activeId } = r.result;

    // Step 2: Read token metadata (serial — two separate contracts)
    const tokXData = await rpc.callDetailed(
      `joe.token.x.${pairAddress.slice(0, 10)}`,
      async (provider) => {
        const t = new ethers.Contract(tokenX, ERC20_ABI, provider);
        const [sym, dec] = await Promise.all([t.symbol(), t.decimals()]);
        return { sym, dec: Number(dec) };
      },
      { timeoutMs: 2000 }
    );

    await sleep(150);

    const tokYData = await rpc.callDetailed(
      `joe.token.y.${pairAddress.slice(0, 10)}`,
      async (provider) => {
        const t = new ethers.Contract(tokenY, ERC20_ABI, provider);
        const [sym, dec] = await Promise.all([t.symbol(), t.decimals()]);
        return { sym, dec: Number(dec) };
      },
      { timeoutMs: 2000 }
    );

    const symX = tokXData.result.sym;
    const decX = tokXData.result.dec;
    const symY = tokYData.result.sym;
    const decY = tokYData.result.dec;

    const tXL = tokenX.toLowerCase();
    const tYL = tokenY.toLowerCase();

    // Must contain ARB
    if (tXL !== ARB_L && tYL !== ARB_L) {
      return { ok: false, reason: `pair does not contain ARB (X=${tokenX} Y=${tokenY})` };
    }

    // Identify quote token
    const quoteAddr = tXL === ARB_L ? tokenY : tokenX;
    const quoteType = classifyQuote(quoteAddr);

    // Reserves
    const reserveX = reserves[0];
    const reserveY = reserves[1];
    const liquidityNonZero = BigInt(reserveX) > 0n || BigInt(reserveY) > 0n;

    // Price from reserves (Boss-specified method)
    const priceApprox = computePriceFromReserves(reserveX, reserveY, tokenX, decX, decY);
    const priceSane   = isPriceSane(priceApprox);

    // Bin price (informational cross-check)
    const binPriceCheck = computeBinPrice(Number(activeId), binStep, tokenX, decX, decY);

    const notes = [];
    if (quoteType === 'usdce')     notes.push('REJECTED: USDCe quote, not native USDC');
    if (quoteType === 'other')     notes.push(`WARNING: unknown quote token ${quoteAddr}`);
    if (!liquidityNonZero)         notes.push('reserveX=0 AND reserveY=0 — pair is empty');
    if (!priceSane && priceApprox !== null)
      notes.push(`price ${priceApprox?.toFixed(6)} outside sanity bounds [${ARB_PRICE_MIN}, ${ARB_PRICE_MAX}]`);
    if (priceApprox === null)      notes.push('price undefined (zero reserves)');
    if (binPriceCheck !== null && priceSane) {
      const delta = Math.abs((binPriceCheck - priceApprox) / priceApprox);
      if (delta > 0.20) {
        notes.push(`bin-price diverges ${(delta*100).toFixed(1)}% from reserve-ratio price (may indicate unbalanced pool)`);
      }
    }

    const smokeTestReady = (
      quoteType === 'native_usdc' &&
      liquidityNonZero &&
      priceSane
    );

    const candidate = {
      venue:             'trader_joe_v2',
      pairLabel:         'ARB/USDC',
      pairAddress,
      factoryVersion,
      tokenX,
      tokenY,
      tokenXSymbol:      symX,
      tokenYSymbol:      symY,
      tokenXDecimals:    decX,
      tokenYDecimals:    decY,
      quoteType,
      binStep,
      activeId:          Number(activeId),
      reservesX:         reserveX.toString(),
      reservesY:         reserveY.toString(),
      priceApprox:       priceApprox !== null ? parseFloat(priceApprox.toFixed(6)) : null,
      binPriceCheck:     binPriceCheck !== null ? parseFloat(binPriceCheck.toFixed(6)) : null,
      stateReadable:     true,
      liquidityNonZero,
      priceSane,
      smokeTestReady,
      priorityScore:     0,  // filled by scoreCandidate()
      notes,
    };

    return { ok: true, candidate };

  } catch (e) {
    return { ok: false, reason: String(e.message || e).slice(0, 160) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
function printSummary(ranked, allFailures) {
  const LINE = '═'.repeat(110);
  const DASH = '─'.repeat(110);

  console.log('\n' + LINE);
  console.log('  TRADER JOE V2  —  ARB / USDC  LB PAIR SCANNER   (blocker-guided discovery)');
  console.log(LINE);

  if (ranked.length === 0) {
    console.log('\n  No candidates found.\n');
  } else {
    ranked.forEach((c, i) => {
      const rank    = String(i + 1).padStart(2);
      const ver     = c.factoryVersion.padEnd(5);
      const qt      = c.quoteType.padEnd(14);
      const bs      = `binStep=${c.binStep}`.padEnd(12);
      const price   = c.priceApprox !== null
        ? `price=$${String(c.priceApprox).padEnd(9)}`
        : 'price=n/a        ';
      const liq     = c.liquidityNonZero ? 'liq=OK  ' : 'liq=FAIL';
      const smoke   = c.smokeTestReady   ? 'smoke_ready=YES ★' : 'smoke_ready=NO   ';
      const score   = `score=${c.priorityScore}`.padStart(9);

      console.log(`[${rank}] ${ver} ARB/USDC  ${qt} ${bs} ${price} ${liq}  ${smoke} ${score}`);
      console.log(`      pair: ${c.pairAddress}   X=${c.tokenXSymbol}(${c.tokenXDecimals}) Y=${c.tokenYSymbol}(${c.tokenYDecimals})`);
      console.log(`      activeId=${c.activeId}  binPrice=${ c.binPriceCheck ?? 'n/a' }  reservesX=${c.reservesX}  reservesY=${c.reservesY}`);
      if (c.notes.length) {
        c.notes.forEach(n => console.log(`      ⚠  ${n}`));
      }
      console.log('');
    });
  }

  if (allFailures.length) {
    console.log(DASH);
    console.log('  FAILURES');
    console.log(DASH);
    allFailures.forEach(f => console.log(`  [✗] ${f.step.padEnd(35)} ${f.error}`));
    console.log('');
  }

  // Top candidate callout
  const top = ranked.find(c => c.smokeTestReady);

  console.log(LINE);
  if (top) {
    console.log('  ★  TOP CANDIDATE FOR  arb_joe_v2_probe.js');
    console.log('');
    console.log(`     Factory:   ${top.factoryVersion}`);
    console.log(`     Pair:      ${top.pairAddress}`);
    console.log(`     binStep:   ${top.binStep}`);
    console.log(`     QuoteType: ${top.quoteType}`);
    console.log(`     Price:     $${top.priceApprox} USDC/ARB (reserve-ratio)`);
    console.log(`     ActiveId:  ${top.activeId}`);
    console.log(`     Score:     ${top.priorityScore}/100`);
    console.log('');
    console.log('     Next command:');
    console.log(`     node -r dotenv/config scripts/tools/arb_joe_v2_probe.js --pair=${top.pairAddress}`);
    console.log('');
    console.log('     After probe: measure bin-depth → add to breakeven_report.js');
  } else {
    console.log('  ★  No smoke-test-ready candidates found.');
    console.log('     All pairs were empty, price-insane, or used USDCe.');
  }
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const jsonOutput = process.argv.includes('--json');

  console.log(`\n[arb_joe_v2_scanner] ${nowIso()}`);
  console.log(`  factories: ${FACTORIES.map(f => f.version).join(', ')}`);
  console.log(`  binSteps:  [${BIN_STEPS.join(', ')}]`);
  console.log(`  tokens:    ARB=${ARB_ADDR.slice(0,10)} / nativeUSDC=${USDC_NATIVE.slice(0,10)}`);

  const rpc        = createProvider('arbitrum');
  const allCandidates = [];
  const allFailures   = [];

  // Track already-confirmed pair addresses to avoid duplicate confirmation
  // (V2.0 and V2.1 could theoretically return the same pair)
  const seenPairs = new Set();

  for (const factory of FACTORIES) {
    console.log(`\n  → factory ${factory.version} (${factory.address})`);

    for (const binStep of BIN_STEPS) {
      await sleep(SLEEP_BETWEEN_BINSTEPS);

      // Step 1: query factory
      const discovery = await queryFactory(factory.address, factory.version, binStep, rpc);

      if (!discovery.found) {
        if (discovery.failure) {
          allFailures.push(discovery.failure);
          console.log(`    [✗] bs=${String(binStep).padEnd(3)}  ${discovery.failure.error.slice(0, 70)}`);
        } else {
          console.log(`    [ ] bs=${String(binStep).padEnd(3)}  no pair`);
        }
        continue;
      }

      if (seenPairs.has(discovery.pairAddress.toLowerCase())) {
        console.log(`    [~] bs=${String(binStep).padEnd(3)}  ${discovery.pairAddress} (already seen — skip)`);
        continue;
      }

      seenPairs.add(discovery.pairAddress.toLowerCase());
      console.log(`    [✓] bs=${String(binStep).padEnd(3)}  ${discovery.pairAddress} — confirming...`);

      // Step 2: on-chain confirm
      const confirm = await confirmPair(discovery.pairAddress, binStep, factory.version, rpc);

      if (!confirm.ok) {
        allFailures.push({ step: `confirm_bs${binStep}_${discovery.pairAddress.slice(0,10)}`, error: confirm.reason });
        console.log(`    [✗] confirm failed: ${confirm.reason.slice(0, 70)}`);
        continue;
      }

      const c = confirm.candidate;
      c.priorityScore = scoreCandidate(c);

      const icon = c.smokeTestReady ? '★' : c.liquidityNonZero ? '~' : '✗';
      console.log(
        `    [${icon}] bs=${String(binStep).padEnd(3)}  qt=${c.quoteType.padEnd(12)}  ` +
        `price=${ c.priceApprox ?? 'null'}  liq=${ c.liquidityNonZero ? 'OK' : 'EMPTY'}  ` +
        `score=${c.priorityScore}`
      );

      allCandidates.push(c);
    }

    await sleep(SLEEP_BETWEEN_FACTORIES);
  }

  // Rank: higher score first; within same score, prefer lower binStep
  const ranked = [...allCandidates].sort((a, b) =>
    b.priorityScore !== a.priorityScore
      ? b.priorityScore - a.priorityScore
      : a.binStep - b.binStep
  );

  printSummary(ranked, allFailures);

  if (jsonOutput) {
    const out = {
      scannedAt:   nowIso(),
      factories:   FACTORIES.map(f => f.address),
      binSteps:    BIN_STEPS,
      totalFound:  allCandidates.length,
      smokeReady:  ranked.filter(c => c.smokeTestReady).length,
      candidates:  ranked,
      failures:    allFailures,
    };
    console.log('── JSON ─────────────────────────────────────────────────────────────────────');
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
