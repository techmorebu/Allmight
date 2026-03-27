// scripts/validators/arb_slippage_model.js
// BOSS DIRECTIVE — ARB/USDC SLIPPAGE MODELING
//
// Purpose: determine what trade size keeps the ARB/USDC candidate edge alive.
//
// Method: UniV3/Algebra concentrated liquidity price impact formula.
// For a trade Δ in a pool with active-tick liquidity L and sqrtPriceX96:
//
//   sqrtP = sqrtPriceX96 / 2^96
//
//   Buying ARB on Camelot V3 (token1=USDC in, token0=ARB out):
//     price_impact ≈ 2 × Δtoken1_raw / (L_cam × sqrtP_cam)
//
//   Selling ARB on UniV3 (token0=ARB in, token1=USDC out):
//     price_impact ≈ 2 × Δtoken1_raw / (L_uni × sqrtP_uni)
//
//   Both expressions are dollar-equivalent (verified by symmetry).
//   Total impact = sum of both legs.
//
// This approximation holds within the active tick (single-tick model).
// It understates impact for very large trades that cross multiple ticks.
//
// IMPORTANT: This is an estimation tool only. No execution, no contract calls.
// Same-block anchoring: both pools read at same block.
//
// Usage:
//   node -r dotenv/config scripts/validators/arb_slippage_model.js
//   node -r dotenv/config scripts/validators/arb_slippage_model.js --runs 3

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

const rpc = createProvider('arbitrum');

// ── Pool constants ─────────────────────────────────────────────────────────────

const UNIV3_POOL   = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8'; // ARB/USDC UniV3 0.05%
const CAMV3_POOL   = '0xfae2ae0a9f87fd35b5b0e24b47bac796a7eefea1'; // ARB/USDC Camelot V3 ~0.0249%

// token0=ARB (18 dec), token1=nativeUSDC (6 dec) — confirmed both pools
const DEC0 = 18; // ARB
const DEC1 = 6;  // USDC

// Fees (fractional)
const FEE_UNIV3   = 0.0005;    // 0.05%
const FEE_CAM_V3  = 0.000249;  // 0.0249% — observed on-chain 2026-03-19
const ROUND_TRIP  = FEE_UNIV3 + FEE_CAM_V3;  // 0.0749%

// Trade notionals to test (USD)
const NOTIONALS = [100, 250, 500, 1_000, 2_500, 5_000];

// Number of independent same-block readings to average
const args = process.argv.slice(2);
const RUNS = Number(args[args.indexOf('--runs') >= 0 ? args.indexOf('--runs') + 1 : -1] || 3);

// ── ABIs (minimal — only what we need) ────────────────────────────────────────

const ABI_UNIV3 = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];
const ABI_ALGEBRA = [
  'function globalState() external view returns (uint160 price, int24 tick, uint16 feeZto, uint16 feeOtz, uint16, uint8, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// ── Math helpers ───────────────────────────────────────────────────────────────

// sqrtP in floating point (dimensionless, in sqrt(raw_token1/raw_token0) units)
function toSqrtP(sqrtPriceX96) {
  return Number(sqrtPriceX96) / Number(2n ** 96n);
}

// Human price from sqrtPriceX96 (token1 per token0, adjusted for decimals)
// priceMode='direct' → token1/token0 in human terms
function humanPrice(sqrtPriceX96, dec0, dec1) {
  const sqrtP = toSqrtP(sqrtPriceX96);
  return sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
}

// Concentrated liquidity price impact (active-tick single-tick model)
// Returns fractional impact (e.g. 0.003 = 0.3%)
//
// Formula derivation:
//   Virtual reserve of token1: y_v = L × sqrtP (in raw token1 units)
//   For a trade of Δy_raw token1: ΔsqrtP/sqrtP = Δy_raw / (L × sqrtP)
//   Price impact = 2 × ΔsqrtP/sqrtP (since P = sqrtP^2 → ΔP/P ≈ 2×ΔsqrtP/sqrtP)
//
//   For token0-in trade, by dollar-symmetry at current price, same formula applies
//   when Δy is expressed as the dollar-equivalent in token1 raw units.
//
// direction:
//   'buy_token0'  → buying ARB with USDC (token1 in, token0 out)
//   'sell_token0' → selling ARB for USDC (token0 in, token1 out)
//
function priceImpact(notional_usd, sqrtPriceX96, L, direction) {
  const sqrtP   = toSqrtP(sqrtPriceX96);
  const price_h = sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1); // human USD per ARB

  let delta_raw;
  if (direction === 'buy_token0') {
    // Sending USDC (token1) in
    delta_raw = notional_usd * Math.pow(10, DEC1);
    return 2 * delta_raw / (Number(L) * sqrtP);
  } else {
    // Sending ARB (token0) in — dollar-equivalent in USDC raw units
    delta_raw = (notional_usd / price_h) * Math.pow(10, DEC0);
    return 2 * delta_raw * sqrtP / Number(L);
  }
}

// ── Data fetcher ───────────────────────────────────────────────────────────────

async function fetchPoolState() {
  const { result: bn } = await rpc.callDetailed('slippage.block', p => p.getBlockNumber());

  const { result: uni } = await rpc.callDetailed(
    `slippage.univ3.${UNIV3_POOL.slice(0, 10)}`,
    async (p) => {
      const c = new ethers.Contract(UNIV3_POOL, ABI_UNIV3, p);
      const [s0, liq] = await Promise.all([
        c.slot0({ blockTag: bn }),
        c.liquidity({ blockTag: bn }),
      ]);
      return { sqrtPriceX96: s0[0], tick: s0[1], liquidity: liq };
    },
    { timeoutMs: 2000, hedge: true }
  );

  const { result: cam } = await rpc.callDetailed(
    `slippage.camv3.${CAMV3_POOL.slice(0, 10)}`,
    async (p) => {
      const c = new ethers.Contract(CAMV3_POOL, ABI_ALGEBRA, p);
      const [gs, liq] = await Promise.all([
        c.globalState({ blockTag: bn }),
        c.liquidity({ blockTag: bn }),
      ]);
      return { sqrtPriceX96: gs[0], tick: gs[1], feeZto: Number(gs[2]), liquidity: liq };
    },
    { timeoutMs: 2000, hedge: true }
  );

  const uniPrice = humanPrice(uni.sqrtPriceX96, DEC0, DEC1);
  const camPrice = humanPrice(cam.sqrtPriceX96, DEC0, DEC1);
  const grossSpread = Math.abs(uniPrice - camPrice) / Math.min(uniPrice, camPrice);

  return {
    block: bn,
    uni: {
      address: UNIV3_POOL,
      sqrtPriceX96: uni.sqrtPriceX96,
      liquidity: uni.liquidity,
      price: uniPrice,
      tick: Number(uni.tick),
    },
    cam: {
      address: CAMV3_POOL,
      sqrtPriceX96: cam.sqrtPriceX96,
      liquidity: cam.liquidity,
      price: camPrice,
      tick: Number(cam.tick),
      feeZto: cam.feeZto,
    },
    grossSpreadPct: grossSpread,
    direction: uniPrice > camPrice ? 'buy_cam_sell_uni' : 'buy_uni_sell_cam',
  };
}

// ── Table formatting ───────────────────────────────────────────────────────────

function pct(n, d = 4)  { return (n * 100).toFixed(d) + '%'; }
function bar(n = 120)   { return '─'.repeat(n); }
function usd(n)         { return '$' + n.toFixed(2); }
function f(n, w, d = 4) { return n.toFixed(d).padStart(w); }

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('ARB/USDC SLIPPAGE-AWARE CANDIDATE MODEL');
  console.log('Concentrated liquidity price impact — active-tick single-tick approximation');
  console.log(`Round-trip fee: ${pct(ROUND_TRIP)}  (UniV3 ${pct(FEE_UNIV3)} + Camelot V3 ${pct(FEE_CAM_V3)})`);
  console.log(`Averaging ${RUNS} independent same-block readings`);

  // ── Collect RUNS independent pool state snapshots ──────────────────────────
  const snapshots = [];
  for (let r = 0; r < RUNS; r++) {
    if (r > 0) await new Promise(res => setTimeout(res, 7000));
    process.stdout.write(`  Reading ${r+1}/${RUNS} from chain...`);
    const snap = await fetchPoolState();
    snapshots.push(snap);
    process.stdout.write(
      ` block=${snap.block}  uni=$${snap.uni.price.toFixed(6)}  cam=$${snap.cam.price.toFixed(6)}` +
      `  gross=${pct(snap.grossSpreadPct)}\n`
    );
  }

  // Average the key values
  const avgUniSqrt  = snapshots.reduce((s,x) => s + Number(x.uni.sqrtPriceX96), 0) / RUNS;
  const avgCamSqrt  = snapshots.reduce((s,x) => s + Number(x.cam.sqrtPriceX96), 0) / RUNS;
  const avgUniLiq   = BigInt(Math.round(snapshots.reduce((s,x) => s + Number(x.uni.liquidity), 0) / RUNS));
  const avgCamLiq   = BigInt(Math.round(snapshots.reduce((s,x) => s + Number(x.cam.liquidity), 0) / RUNS));
  const avgUniPrice = snapshots.reduce((s,x) => s + x.uni.price, 0) / RUNS;
  const avgCamPrice = snapshots.reduce((s,x) => s + x.cam.price, 0) / RUNS;
  const avgGross    = snapshots.reduce((s,x) => s + x.grossSpreadPct, 0) / RUNS;

  const lastSnap = snapshots[snapshots.length - 1];
  const direction = lastSnap.direction;  // 'buy_cam_sell_uni' (consistent from validation)

  // Direction determines which pool we buy on and which we sell on
  const buyPool    = direction === 'buy_cam_sell_uni' ? 'cam' : 'uni';
  const sellPool   = direction === 'buy_cam_sell_uni' ? 'uni' : 'cam';
  const buySqrt    = BigInt(Math.round(direction === 'buy_cam_sell_uni' ? avgCamSqrt : avgUniSqrt));
  const sellSqrt   = BigInt(Math.round(direction === 'buy_cam_sell_uni' ? avgUniSqrt : avgCamSqrt));
  const buyLiq     = direction === 'buy_cam_sell_uni' ? avgCamLiq : avgUniLiq;
  const sellLiq    = direction === 'buy_cam_sell_uni' ? avgUniLiq : avgCamLiq;

  console.log('\n' + bar());
  console.log('POOL STATE (averaged across readings)');
  console.log(bar());
  console.log(`UniV3   ARB/USDC  price=${usd(avgUniPrice).padStart(10)}  liquidity=${String(avgUniLiq).padStart(22)}  tick=${lastSnap.uni.tick}`);
  console.log(`Cam V3  ARB/USDC  price=${usd(avgCamPrice).padStart(10)}  liquidity=${String(avgCamLiq).padStart(22)}  tick=${lastSnap.cam.tick}`);
  console.log(`Avg gross spread:  ${pct(avgGross)}  (${direction})`);
  console.log(`Round-trip fee:    ${pct(ROUND_TRIP)}`);
  console.log(`Avg net (no slip): ${pct(avgGross - ROUND_TRIP)}`);

  // ── Per-notional slippage table ────────────────────────────────────────────
  console.log('\n' + bar());
  console.log('SLIPPAGE MODEL — PER NOTIONAL');
  console.log(`Direction: ${direction === 'buy_cam_sell_uni' ? 'BUY on Camelot V3, SELL on UniV3' : 'BUY on UniV3, SELL on Camelot V3'}`);
  console.log(bar());
  console.log(
    `${'Notional'.padStart(10)} ` +
    `${'GrossSpd'.padStart(9)} ` +
    `${'Fees'.padStart(8)} ` +
    `${'ImpactBuy'.padStart(10)} ` +
    `${'ImpactSell'.padStart(11)} ` +
    `${'TotalImpact'.padStart(12)} ` +
    `${'NetEdge'.padStart(9)} ` +
    `${'Result'.padStart(8)}`
  );
  console.log(bar());

  const results = [];
  for (const notional of NOTIONALS) {
    // Price impact on buy leg (buying token0=ARB with token1=USDC)
    const impactBuy  = priceImpact(notional, buySqrt, buyLiq, 'buy_token0');
    // Price impact on sell leg (selling token0=ARB for token1=USDC)
    const impactSell = priceImpact(notional, sellSqrt, sellLiq, 'sell_token0');
    const totalImpact = impactBuy + impactSell;

    const netEdge = avgGross - ROUND_TRIP - totalImpact;
    const pass    = netEdge > 0;
    const dollarNet = notional * netEdge;

    results.push({ notional, impactBuy, impactSell, totalImpact, netEdge, pass, dollarNet });

    console.log(
      `${usd(notional).padStart(10)} ` +
      `${pct(avgGross, 4).padStart(9)} ` +
      `${pct(ROUND_TRIP, 4).padStart(8)} ` +
      `${pct(impactBuy, 4).padStart(10)} ` +
      `${pct(impactSell, 4).padStart(11)} ` +
      `${pct(totalImpact, 4).padStart(12)} ` +
      `${(netEdge >= 0 ? '+' : '') + pct(netEdge, 4).padStart(8)} ` +
      `${(pass ? '✅ PASS' : '❌ FAIL').padStart(8)}` +
      `  (${pass ? '+' : ''}${usd(dollarNet)})`
    );
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const passing = results.filter(r => r.pass);
  const failing = results.filter(r => !r.pass);
  const maxPass = passing.length > 0 ? passing[passing.length - 1].notional : null;
  const minFail = failing.length > 0 ? failing[0].notional : null;

  // Breakeven notional (linear interpolation between last pass and first fail)
  let breakeven = null;
  if (maxPass !== null && minFail !== null) {
    const p = results.find(r => r.notional === maxPass);
    const f2 = results.find(r => r.notional === minFail);
    if (p && f2) {
      const ratio = p.netEdge / (p.netEdge - f2.netEdge);
      breakeven = p.notional + ratio * (f2.notional - p.notional);
    }
  } else if (maxPass !== null && !minFail) {
    breakeven = NOTIONALS[NOTIONALS.length - 1]; // all pass
  }

  // Classification
  let classification;
  if (passing.length === 0) {
    classification = 'MONITORED — no viable notional found at current spread; watch for spread widening';
  } else if (maxPass !== null && maxPass >= 500) {
    classification = 'CANDIDATE — viable at moderate size; slippage-aware execution design warranted';
  } else if (maxPass !== null && maxPass >= 100) {
    classification = 'CANDIDATE (thin) — viable only at small size; viable but execution cost-sensitive';
  } else {
    classification = 'MONITORED — viable notional too small for practical execution';
  }

  console.log('\n' + bar());
  console.log('SUMMARY');
  console.log(bar());
  console.log(`Avg gross spread:      ${pct(avgGross)}`);
  console.log(`Round-trip fee burden: ${pct(ROUND_TRIP)}`);
  console.log(`Net spread (no slip):  ${pct(avgGross - ROUND_TRIP)}`);
  console.log('');
  console.log(`Passing notionals:     ${passing.map(r => usd(r.notional)).join(', ') || 'none'}`);
  console.log(`Max passing notional:  ${maxPass !== null ? usd(maxPass) : 'none'}`);
  console.log(`First failing notional:${minFail !== null ? usd(minFail) : 'none (all pass)'}`);
  console.log(`Estimated breakeven:   ${breakeven !== null ? usd(breakeven) : 'n/a'}`);
  if (maxPass !== null) {
    const best = results.find(r => r.notional === maxPass);
    console.log(`Best net at $${maxPass}:      ${pct(best.netEdge)}  (${usd(best.dollarNet)} gross profit)`);
    console.log(`Recommended safe band: ${usd(maxPass * 0.5)} – ${usd(maxPass * 0.75)}`);
  }
  console.log('');

  // Liquidity depth context
  const uniDepthUsdc = Number(avgUniLiq) * (Number(BigInt(Math.round(avgUniSqrt))) / Number(2n**96n));
  const camDepthUsdc = Number(avgCamLiq) * (Number(BigInt(Math.round(avgCamSqrt))) / Number(2n**96n));
  console.log('ACTIVE-TICK LIQUIDITY DEPTH (virtual USDC reserves at current price):');
  console.log(`  UniV3   ARB/USDC: ${usd(uniDepthUsdc / 1e6).padStart(14)}  (L × sqrtP in $M approx)`);
  console.log(`  Cam V3  ARB/USDC: ${usd(camDepthUsdc / 1e6).padStart(14)}`);
  console.log('  Note: This is active-tick depth only. Full TVL is spread across all ticks.');
  console.log('');
  console.log(`Classification:  ${classification}`);
  console.log(bar() + '\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
