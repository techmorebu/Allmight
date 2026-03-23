'use strict';
/**
 * scripts/analysis/arb_tick_liquidity_map.js
 *
 * Purpose:
 *   Map liquidity distribution across ticks for UniV3 ARB/USDC.
 *   Answers: "if price moves to tick X, what depth becomes available?"
 *
 * Architecture context (Boss ruling 2026-03-23):
 *   This replaces Mint-event-only detection as the primary depth signal.
 *   Upgrades the system from reactive (wait for spike) to predictive
 *   (know where spikes will occur before price arrives).
 *
 *   Full pipeline:
 *     [tick map]  → where liquidity sits
 *     [price]     → where price is moving
 *     [watcher]   → capture spread when price enters liquidity zone
 *
 * How UniV3 tick liquidity works:
 *   - Liquidity lives in tick ranges, not at prices
 *   - Only liquidity whose range includes current tick is "active"
 *   - When price crosses a tick boundary, liquidityNet is added/subtracted
 *     from active liquidity — this is what causes depth spikes with no Mint
 *   - tickBitmap tells us which ticks are initialized (have liquidity)
 *   - ticks(tickIndex) gives liquidityGross (total) and liquidityNet (directional)
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_tick_liquidity_map.js
 *   node -r dotenv/config scripts/analysis/arb_tick_liquidity_map.js --range=5000
 *   node -r dotenv/config scripts/analysis/arb_tick_liquidity_map.js --json
 *   node -r dotenv/config scripts/analysis/arb_tick_liquidity_map.js --range=2000 --json > tick_map.json
 *
 * Hard rules:
 *   - No execution logic
 *   - No fetcher changes
 *   - No Redis required
 *   - provider_factory.js ONLY
 *   - Promise.all only within single rpc.callDetailed() on same contract
 *   - Serial loops with sleep for multi-tick reads (anti-stampede)
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_POOL    = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const TICK_SPACING  = 10;    // 0.05% fee tier → tickSpacing = 10
const DEC0          = 18;    // ARB
const DEC1          = 6;     // USDC

// ─────────────────────────────────────────────────────────────────────────────
// DEPTH ZONE THRESHOLDS (USD, matching Boss gate)
// ─────────────────────────────────────────────────────────────────────────────
const ZONE_HIGH   = 15_000;
const ZONE_MEDIUM =  5_000;

// ─────────────────────────────────────────────────────────────────────────────
// UNIV3 ABI — only what we need
// ─────────────────────────────────────────────────────────────────────────────
const UNIV3_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
  'function tickBitmap(int16 wordPosition) external view returns (uint256)',
  'function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)',
];

// ─────────────────────────────────────────────────────────────────────────────
// MATH
// ─────────────────────────────────────────────────────────────────────────────
function sqrtPriceToUSDC(sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}

function activeTickDepthUSD(liquidityRaw, sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return (Number(liquidityRaw) * sqrtP) / Math.pow(10, DEC1);
}

// Convert tick to approximate price (USDC per ARB)
function tickToPrice(tick) {
  return Math.pow(1.0001, tick) * Math.pow(10, DEC0 - DEC1);
}

// Which bitmap word contains this tick
function tickToWordPos(tick) {
  return Math.floor(tick / TICK_SPACING) >> 8;  // divide by 256
}

// Which bit within the word
function tickToBitPos(tick) {
  return (Math.floor(tick / TICK_SPACING)) & 0xFF;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// READ SLOT0 + CURRENT LIQUIDITY
// ─────────────────────────────────────────────────────────────────────────────
async function readPoolState(rpc) {
  const res = await rpc.callDetailed(
    'tickmap.slot0',
    async (provider) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
      const [s0, liq] = await Promise.all([
        pool.slot0(),
        pool.liquidity(),
      ]);
      return { s0, liq };
    },
    { timeoutMs: 5000, hedge: true }
  );
  const sqrtP = res.result.s0[0];
  return {
    sqrtPriceX96:  sqrtP,
    currentTick:   Number(res.result.s0[1]),
    currentLiqRaw: res.result.liq,
    currentPrice:  sqrtPriceToUSDC(sqrtP),
    currentDepth:  activeTickDepthUSD(res.result.liq, sqrtP),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// READ TICK BITMAP — find all initialized ticks in range
//   Each bitmap word covers 256 tick-spacing units = 256 × 10 = 2560 ticks
//   We scan word positions covering our range
// ─────────────────────────────────────────────────────────────────────────────
async function findInitializedTicks(currentTick, range, rpc) {
  const minTick = currentTick - range;
  const maxTick = currentTick + range;

  const minWord = tickToWordPos(minTick);
  const maxWord = tickToWordPos(maxTick);

  const initializedTicks = [];

  process.stdout.write(`  Reading tick bitmap words ${minWord}→${maxWord}...\n`);

  for (let wordPos = minWord; wordPos <= maxWord; wordPos++) {
    let bitmap;
    try {
      const res = await rpc.callDetailed(
        `tickmap.bitmap.${wordPos}`,
        async (provider) => {
          const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
          return pool.tickBitmap(wordPos);
        },
        { timeoutMs: 3000, hedge: true }
      );
      bitmap = BigInt(res.result.toString());
    } catch (e) {
      process.stderr.write(`  [bitmap] word ${wordPos}: ${e.message}\n`);
      await sleep(200);
      continue;
    }

    if (bitmap === 0n) {
      await sleep(50);
      continue;
    }

    // Decode which bits are set
    for (let bitPos = 0; bitPos < 256; bitPos++) {
      if ((bitmap >> BigInt(bitPos)) & 1n) {
        const tick = (wordPos * 256 + bitPos) * TICK_SPACING;
        if (tick >= minTick && tick <= maxTick) {
          initializedTicks.push(tick);
        }
      }
    }
    await sleep(80);
  }

  return initializedTicks.sort((a, b) => a - b);
}

// ─────────────────────────────────────────────────────────────────────────────
// READ TICK DATA — liquidityGross and liquidityNet per tick
//   Serial with sleep — anti-stampede rule
// ─────────────────────────────────────────────────────────────────────────────
async function readTickData(ticks, rpc) {
  const results = [];
  const total   = ticks.length;
  let   done    = 0;

  for (const tick of ticks) {
    try {
      const res = await rpc.callDetailed(
        `tickmap.tick.${tick}`,
        async (provider) => {
          const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
          return pool.ticks(tick);
        },
        { timeoutMs: 3000, hedge: true }
      );
      const d = res.result;
      results.push({
        tick,
        liquidityGross: BigInt(d[0].toString()),
        liquidityNet:   BigInt(d[1].toString()),
        initialized:    d[7],
      });
    } catch (e) {
      process.stderr.write(`  [ticks] ${tick}: ${e.message}\n`);
    }
    done++;
    if (done % 20 === 0) {
      process.stdout.write(`  Reading tick data... ${done}/${total}\r`);
    }
    await sleep(60);
  }
  process.stdout.write(`  Reading tick data... ${done}/${total} done\n`);
  return results.filter(r => r.initialized && r.liquidityGross > 0n);
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMULATE LIQUIDITY WALK
//   Starting from currentLiq at currentTick, walk up and down applying
//   liquidityNet at each initialized tick boundary.
//   This tells us: "if price crosses tick X, active liquidity becomes Y"
// ─────────────────────────────────────────────────────────────────────────────
function simulateLiquidityWalk(currentTick, currentLiqRaw, tickDataMap, sqrtPriceX96) {
  const currentLiq = BigInt(currentLiqRaw.toString());
  const zones      = [];

  // Sort ticks
  const allTicks = Object.keys(tickDataMap).map(Number).sort((a, b) => a - b);

  // Walk UPWARD (price increases → crosses upper ticks)
  let liqAbove = currentLiq;
  const aboveTicks = allTicks.filter(t => t > currentTick);
  for (const tick of aboveTicks) {
    const td = tickDataMap[tick];
    // When price crosses tick going up, add liquidityNet
    liqAbove = liqAbove + td.liquidityNet;
    if (liqAbove < 0n) liqAbove = 0n;

    const depthUSD = activeTickDepthUSD(liqAbove, sqrtPriceX96);
    const distance = tick - currentTick;
    const price    = tickToPrice(tick);
    const zone     = depthUSD >= ZONE_HIGH   ? 'HIGH'
                   : depthUSD >= ZONE_MEDIUM  ? 'MEDIUM'
                   :                            'LOW';

    zones.push({
      tick, distance, side: 'above',
      liquidityRaw: liqAbove.toString(),
      depthUSD:     +depthUSD.toFixed(2),
      priceAtTick:  +price.toFixed(6),
      zone,
    });
  }

  // Walk DOWNWARD (price decreases → crosses lower ticks)
  let liqBelow = currentLiq;
  const belowTicks = allTicks.filter(t => t <= currentTick).reverse();
  for (const tick of belowTicks) {
    const td = tickDataMap[tick];
    // When price crosses tick going down, subtract liquidityNet
    liqBelow = liqBelow - td.liquidityNet;
    if (liqBelow < 0n) liqBelow = 0n;

    const depthUSD = activeTickDepthUSD(liqBelow, sqrtPriceX96);
    const distance = tick - currentTick;
    const price    = tickToPrice(tick);
    const zone     = depthUSD >= ZONE_HIGH   ? 'HIGH'
                   : depthUSD >= ZONE_MEDIUM  ? 'MEDIUM'
                   :                            'LOW';

    zones.push({
      tick, distance, side: 'below',
      liquidityRaw: liqBelow.toString(),
      depthUSD:     +depthUSD.toFixed(2),
      priceAtTick:  +price.toFixed(6),
      zone,
    });
  }

  return zones.sort((a, b) => a.distance - b.distance);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT HUMAN-READABLE SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
function printSummary(state, tickData, zones, range) {
  const LINE = '═'.repeat(100);
  const DIV  = '─'.repeat(100);

  console.log('\n' + LINE);
  console.log('  UniV3 ARB/USDC — TICK LIQUIDITY MAP');
  console.log(`  Pool:          ${UNIV3_POOL}`);
  console.log(`  Current tick:  ${state.currentTick}`);
  console.log(`  Current price: $${state.currentPrice.toFixed(6)} USDC/ARB`);
  console.log(`  Current depth: $${state.currentDepth.toFixed(2)}`);
  console.log(`  Scan range:    ± ${range} ticks  (${range/TICK_SPACING} tick spacings)`);
  console.log(`  Initialized ticks found: ${tickData.length}`);
  console.log(LINE);

  // Above current tick
  const above = zones.filter(z => z.side === 'above').sort((a,b) => a.distance - b.distance);
  const below = zones.filter(z => z.side === 'below').sort((a,b) => b.distance - a.distance);

  const zoneIcon = z => z === 'HIGH' ? '★ HIGH  ' : z === 'MEDIUM' ? '~ MEDIUM' : '  LOW   ';

  console.log('\n  ABOVE CURRENT TICK (price rising into these ticks)');
  console.log('  ' + DIV);
  console.log(`  ${'tick'.padEnd(12)} ${'dist'.padEnd(8)} ${'price$'.padEnd(10)} ${'depth$'.padEnd(12)} zone`);
  console.log('  ' + DIV);

  let lastZone = null;
  for (const z of above.slice(0, 30)) {
    if (lastZone && z.zone !== lastZone) console.log('  ' + DIV);
    lastZone = z.zone;
    console.log(
      `  ${String(z.tick).padEnd(12)} +${String(z.distance).padEnd(7)} ` +
      `$${String(z.priceAtTick).padEnd(9)} $${String(z.depthUSD).padEnd(11)} ${zoneIcon(z.zone)}`
    );
  }

  console.log('\n  BELOW CURRENT TICK (price falling into these ticks)');
  console.log('  ' + DIV);
  console.log(`  ${'tick'.padEnd(12)} ${'dist'.padEnd(8)} ${'price$'.padEnd(10)} ${'depth$'.padEnd(12)} zone`);
  console.log('  ' + DIV);

  lastZone = null;
  for (const z of below.slice(0, 30)) {
    if (lastZone && z.zone !== lastZone) console.log('  ' + DIV);
    lastZone = z.zone;
    console.log(
      `  ${String(z.tick).padEnd(12)} ${String(z.distance).padEnd(8)} ` +
      `$${String(z.priceAtTick).padEnd(9)} $${String(z.depthUSD).padEnd(11)} ${zoneIcon(z.zone)}`
    );
  }

  // High-zone summary
  const highZones = zones.filter(z => z.zone === 'HIGH').sort((a,b) => Math.abs(a.distance) - Math.abs(b.distance));
  console.log('\n' + LINE);
  console.log('  EXECUTION-GRADE DEPTH ZONES  (depth >= $15,000)');
  console.log('  ' + DIV);

  if (highZones.length === 0) {
    console.log('  None found in scan range — no $15k+ depth zones within ± ' + range + ' ticks');
    console.log('  Try --range=10000 to scan wider');
  } else {
    console.log(`  ${'tick'.padEnd(12)} ${'dist'.padEnd(10)} ${'side'.padEnd(8)} ${'price$'.padEnd(10)} depth$`);
    console.log('  ' + DIV);
    for (const z of highZones.slice(0, 15)) {
      const dist = z.distance >= 0 ? `+${z.distance}` : `${z.distance}`;
      console.log(
        `  ${String(z.tick).padEnd(12)} ${dist.padEnd(10)} ${z.side.padEnd(8)} ` +
        `$${String(z.priceAtTick).padEnd(9)} $${z.depthUSD}`
      );
    }

    // Closest high zone
    const closest = highZones[0];
    const dist    = Math.abs(closest.distance);
    const ticksPerSec = 2;  // rough: Arbitrum ~250ms/block, price moves ~1-2 ticks/block at low vol
    const etaSec  = (dist / ticksPerSec).toFixed(0);
    console.log(`\n  ★ Nearest execution-grade zone: ${closest.side} at tick ${closest.tick}`);
    console.log(`    Distance: ${dist} ticks  |  Depth at boundary: $${closest.depthUSD}`);
    console.log(`    Price needs to move to: $${closest.priceAtTick.toFixed(6)}`);
    console.log(`    Current price:          $${state.currentPrice.toFixed(6)}`);
  }

  console.log('\n' + LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f,d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  return {
    range:   getN('--range', 2000),
    json:    args.includes('--json'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { range, json } = parseArgs();
  const rpc = createProvider('arbitrum');

  if (!json) {
    console.log(`\n[arb_tick_liquidity_map] ${new Date().toISOString()}`);
    console.log(`  Scan range: currentTick ± ${range} ticks\n`);
  }

  // Step 1 — current state
  if (!json) process.stdout.write('  Reading pool state...\n');
  const state = await readPoolState(rpc);
  if (!json) {
    console.log(`  currentTick=${state.currentTick}  price=$${state.currentPrice.toFixed(6)}  depth=$${state.currentDepth.toFixed(2)}`);
  }

  // Step 2 — initialized ticks via bitmap
  if (!json) process.stdout.write('  Scanning tick bitmap...\n');
  const initTicks = await findInitializedTicks(state.currentTick, range, rpc);
  if (!json) console.log(`  Found ${initTicks.length} initialized ticks\n`);

  if (initTicks.length === 0) {
    console.log('  No initialized ticks found. Try --range=10000');
    return;
  }

  // Step 3 — read tick data serially
  if (!json) console.log(`  Reading tick data (${initTicks.length} ticks, ~${Math.ceil(initTicks.length * 0.1)}s)...\n`);
  const tickDataArr = await readTickData(initTicks, rpc);

  // Build map
  const tickDataMap = {};
  for (const td of tickDataArr) tickDataMap[td.tick] = td;

  // Step 4 — simulate liquidity walk
  const zones = simulateLiquidityWalk(
    state.currentTick, state.currentLiqRaw, tickDataMap, state.sqrtPriceX96
  );

  // Output
  if (json) {
    console.log(JSON.stringify({
      ts:          new Date().toISOString(),
      pool:        UNIV3_POOL,
      currentTick: state.currentTick,
      currentPrice: +state.currentPrice.toFixed(6),
      currentDepth: +state.currentDepth.toFixed(2),
      scanRange:   range,
      initializedTicksFound: tickDataArr.length,
      zones,
      highZones:   zones.filter(z => z.zone === 'HIGH'),
    }, null, 2));
  } else {
    printSummary(state, tickDataArr, zones, range);
  }
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
