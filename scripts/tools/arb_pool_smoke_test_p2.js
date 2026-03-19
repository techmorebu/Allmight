// scripts/tools/arb_pool_smoke_test_p2.js
// BOSS DIRECTIVE — PHASE 2 PRE-ADD ON-CHAIN VALIDATION
//
// Unlike Phase 1 smoke test, this makes NO assumptions about token0/token1 ordering.
// For each candidate pool it:
//   1. Reads token0/token1 addresses directly from chain
//   2. Resolves decimals and symbols (registry-first, ERC20 fallback)
//   3. Tries BOTH priceMode='direct' AND priceMode='invert'
//   4. Reports which mode yields a sane price — this IS the config to use
//   5. Flags any discrepancy vs mainnet token ordering
//
// Usage:
//   node -r dotenv/config scripts/tools/arb_pool_smoke_test_p2.js

'use strict';
require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

const rpc = createProvider('arbitrum');

// ── ABIs ──────────────────────────────────────────────────────────────────────

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// ── Known Arbitrum token registry (no RPC cost for known tokens) ──────────────

const KNOWN_TOKENS = {
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': { symbol: 'USDC', decimals: 6  },
  '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8': { symbol: 'USDCe', decimals: 6 },
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': { symbol: 'USDT', decimals: 6  },
  '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': { symbol: 'WETH', decimals: 18 },
  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': { symbol: 'WBTC', decimals: 8  },
  '0x912CE59144191C1204E64559FE8253a0e49E6548': { symbol: 'ARB',  decimals: 18 },
};

// ── Known Ethereum mainnet ordering for cross-chain comparison ─────────────────
// If Arbitrum token order differs from mainnet, we flag it explicitly.
// This is the exact bug that killed the Phase 1 pools — documented here.
const MAINNET_TOKEN_ORDER = {
  'ARB/USDC':  { note: 'ARB does not exist on Ethereum mainnet — no mainnet comparison' },
  'ARB/WETH':  { note: 'ARB does not exist on Ethereum mainnet — no mainnet comparison' },
  'WBTC/USDT': {
    note: 'On Ethereum mainnet: WBTC (0x2260..) < USDT (0xdAC1..) → token0=WBTC, token1=USDT → priceMode=direct → USDT per WBTC ≈ $90k',
    mainnetToken0: 'WBTC',
    mainnetToken1: 'USDT',
    mainnetPriceMode: 'direct',
  },
};

// ── Sanity ranges per pair (both direct and invert) ───────────────────────────
// Used to auto-detect which priceMode is correct.
// If direct is sane, priceMode='direct'. If invert is sane, priceMode='invert'.
// If both are sane or neither is sane, flag as AMBIGUOUS.

const SANITY_RANGES = {
  // ARB price in USDC: ~$0.05–$5 range (volatile governance token)
  'ARB/USDC_direct':  { min: 0.01,  max: 20    },   // USDC per ARB ≈ $0.10–$0.50
  'ARB/USDC_invert':  { min: 0.001, max: 0.01  },   // would be ARB per USDC — wrong direction

  // ARB price in WETH: ~0.00003–0.001 range
  'ARB/WETH_direct':  { min: 0.00001, max: 0.001 }, // WETH per ARB ≈ very small
  'ARB/WETH_invert':  { min: 500,   max: 20000  },  // would be ETH price — wrong direction

  // WBTC price in USDT: ~$20k–$200k
  'WBTC/USDT_direct': { min: 20000, max: 200000 },  // USDT per WBTC
  'WBTC/USDT_invert': { min: 0.000001, max: 0.0001 }, // would be WBTC per USDT — wrong direction
};

// ── Phase 2 candidates (no priceMode assumption — derived from on-chain data) ─

const CANDIDATES = [
  {
    configLabel: 'ARB/USDC',
    pool:        '0xcda53b1f66614552f834ceef361a8d12a0b8dad8',
    expectedFee: 500,
  },
  {
    configLabel: 'ARB/WETH',
    pool:        '0xc6f780497a95e246eb9449f5e4770916dcd6396a',
    expectedFee: 500,
  },
  {
    configLabel: 'WBTC/USDT',
    pool:        '0x5969efdde3cf5c0d9a88ae51e47d721096a97203',
    expectedFee: 500,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sqrtPriceToRaw(sqrtPriceX96BigInt, dec0, dec1) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96BigInt) / Number(Q96);
  return sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
}

function resolveToken(address) {
  const key = Object.keys(KNOWN_TOKENS).find(
    k => k.toLowerCase() === address.toLowerCase()
  );
  return key ? KNOWN_TOKENS[key] : null;
}

function inRange(val, min, max) {
  return isFinite(val) && val > 0 && val >= min && val <= max;
}

function bar(n = 96) { return '─'.repeat(n); }

// ── Per-pool probe ────────────────────────────────────────────────────────────

async function probePool(cfg, blockNumber) {
  const r = {
    configLabel:     cfg.configLabel,
    pool:            cfg.pool,
    slot0OK:         false,
    liquidityOK:     false,
    token0Addr:      null,
    token1Addr:      null,
    token0Symbol:    null,
    token1Symbol:    null,
    token0Dec:       null,
    token1Dec:       null,
    feeOnChain:      null,
    sqrtPriceX96:    null,
    liquidity:       null,
    rawPrice:        null,
    directPrice:     null,
    invertPrice:     null,
    detectedMode:    null,   // 'direct' | 'invert' | 'ambiguous' | 'neither'
    detectedPrice:   null,
    priceSane:       false,
    pass:            false,
    failures:        [],
    recommendation:  null,
    safeConfig:      null,   // exact config block to use if safe
    mainnetDiff:     null,   // cross-chain ordering comparison
  };

  // ── Step 1: slot0 + liquidity + token addresses ───────────────────────────
  try {
    const { result: cr } = await rpc.callDetailed(
      `smoke2.slot0liq.${cfg.pool.slice(0, 10)}`,
      async (provider) => {
        const c = new ethers.Contract(cfg.pool, POOL_ABI, provider);
        const [slot0, liq, t0, t1, fee] = await Promise.all([
          c.slot0({ blockTag: blockNumber }),
          c.liquidity({ blockTag: blockNumber }),
          c.token0(),
          c.token1(),
          c.fee(),
        ]);
        return { slot0, liq, t0, t1, fee };
      },
      { timeoutMs: 3000, hedge: true }
    );

    r.slot0OK      = true;
    r.liquidityOK  = true;
    r.sqrtPriceX96 = cr.slot0[0].toString();
    r.liquidity    = cr.liq.toString();
    r.token0Addr   = cr.t0;
    r.token1Addr   = cr.t1;
    r.feeOnChain   = Number(cr.fee);

  } catch (e) {
    r.failures.push(`CALL_EXCEPTION: ${String(e.message).slice(0, 120)}`);
    r.recommendation = 'DO NOT ADD — slot0/liquidity call failed';
    return r;
  }

  // ── Step 2: Token metadata (registry-first) ───────────────────────────────
  for (const [key, addr] of [['token0', r.token0Addr], ['token1', r.token1Addr]]) {
    const known = resolveToken(addr);
    if (known) {
      r[`${key}Symbol`] = known.symbol;
      r[`${key}Dec`]    = known.decimals;
    } else {
      try {
        const { result: meta } = await rpc.callDetailed(
          `smoke2.meta.${key}.${addr.slice(0, 10)}`,
          async (provider) => {
            const token = new ethers.Contract(addr, ERC20_ABI, provider);
            const [dec, sym] = await Promise.all([token.decimals(), token.symbol()]);
            return { dec, sym };
          },
          { timeoutMs: 2000, hedge: false }
        );
        r[`${key}Symbol`] = meta.sym;
        r[`${key}Dec`]    = Number(meta.dec);
      } catch (e) {
        r.failures.push(`${key} metadata failed (${addr.slice(0, 10)}): ${e.message.slice(0, 80)}`);
        r[`${key}Symbol`] = 'UNKNOWN';
        r[`${key}Dec`]    = null;
      }
    }
  }

  // ── Step 3: Auto-detect priceMode ─────────────────────────────────────────
  // Try both directions. Use sanity ranges to determine which is correct.
  const dec0 = r.token0Dec;
  const dec1 = r.token1Dec;

  if (dec0 !== null && dec1 !== null) {
    const raw   = sqrtPriceToRaw(BigInt(r.sqrtPriceX96), dec0, dec1);
    r.rawPrice  = raw;

    r.directPrice = raw;
    r.invertPrice = 1 / raw;

    const directRange = SANITY_RANGES[`${cfg.configLabel}_direct`];
    const invertRange = SANITY_RANGES[`${cfg.configLabel}_invert`];

    const directSane = directRange ? inRange(r.directPrice, directRange.min, directRange.max) : false;
    const invertSane = invertRange ? inRange(r.invertPrice, invertRange.min, invertRange.max) : false;

    if (directSane && !invertSane) {
      r.detectedMode  = 'direct';
      r.detectedPrice = r.directPrice;
      r.priceSane     = true;
    } else if (invertSane && !directSane) {
      r.detectedMode  = 'invert';
      r.detectedPrice = r.invertPrice;
      r.priceSane     = true;
    } else if (directSane && invertSane) {
      r.detectedMode  = 'ambiguous';
      r.detectedPrice = r.directPrice;
      r.failures.push('AMBIGUOUS: both direct and invert prices fall in sane ranges — widen or narrow sanity bounds, then re-test');
    } else {
      r.detectedMode  = 'neither';
      r.detectedPrice = r.directPrice;
      r.failures.push(
        `neither direct (${r.directPrice?.toFixed(6)}) nor invert (${r.invertPrice?.toFixed(6)}) ` +
        `falls in expected sanity range — check config label or sanity bounds`
      );
    }
  } else {
    r.failures.push('cannot compute price — token decimals unresolved');
  }

  // ── Step 4: Mainnet token-order comparison ────────────────────────────────
  const mainnetRef = MAINNET_TOKEN_ORDER[cfg.configLabel];
  if (mainnetRef) {
    if (mainnetRef.mainnetToken0) {
      const arbMatches =
        r.token0Symbol === mainnetRef.mainnetToken0 &&
        r.token1Symbol === mainnetRef.mainnetToken1;
      r.mainnetDiff = arbMatches
        ? `SAME as mainnet (token0=${r.token0Symbol}, token1=${r.token1Symbol})`
        : `DIFFERENT from mainnet: Arbitrum token0=${r.token0Symbol}, token1=${r.token1Symbol} ` +
          `vs mainnet token0=${mainnetRef.mainnetToken0}, token1=${mainnetRef.mainnetToken1}`;
    } else {
      r.mainnetDiff = mainnetRef.note;
    }
  }

  // ── Step 5: Build safe config if passing ─────────────────────────────────
  r.pass = r.slot0OK && r.liquidityOK && r.priceSane && r.failures.length === 0;

  if (r.pass) {
    r.recommendation = 'SAFE TO ADD';
    r.safeConfig = {
      outputPair: cfg.configLabel,
      pool:       cfg.pool,
      decimals0:  dec0,
      decimals1:  dec1,
      fee:        r.feeOnChain,
      priceMode:  r.detectedMode,
      sanityMin:  SANITY_RANGES[`${cfg.configLabel}_${r.detectedMode}`]?.min,
      sanityMax:  SANITY_RANGES[`${cfg.configLabel}_${r.detectedMode}`]?.max,
    };
  } else if (r.slot0OK && !r.priceSane) {
    r.recommendation = 'REVIEW — pool responds but price direction unclear';
  } else {
    r.recommendation = 'DO NOT ADD — see failures';
  }

  return r;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('ARBITRUM PHASE 2 — PRE-ADD ON-CHAIN VALIDATION (NO ORDERING ASSUMPTIONS)');
  console.log('Pools: ARB/USDC  |  ARB/WETH  |  WBTC/USDT');
  console.log(bar());

  let blockNumber;
  try {
    const br = await rpc.getBlockNumber('smoke2.block', { timeoutMs: 2000, hedge: true });
    blockNumber = br.blockNumber;
    console.log(`\nBlock anchor: ${blockNumber}\n`);
  } catch (e) {
    console.error(`FATAL: block fetch failed — ${e.message}`);
    process.exit(1);
  }

  const results = [];
  for (const cfg of CANDIDATES) {
    process.stdout.write(`Probing ${cfg.configLabel} (${cfg.pool.slice(0, 12)}...)  `);
    const r = await probePool(cfg, blockNumber);
    results.push(r);
    console.log(r.pass ? '✅ PASS' : r.slot0OK ? '⚠️  REVIEW' : '❌ FAIL');
  }

  // ── Detailed results ───────────────────────────────────────────────────────
  console.log('\n' + bar());
  console.log('DETAILED RESULTS');
  console.log(bar());

  for (const r of results) {
    const icon = r.pass ? '✅' : r.slot0OK ? '⚠️ ' : '❌';
    console.log(`\n${icon} ${r.configLabel.padEnd(12)} | ${r.pool}`);
    console.log(`   slot0:         ${r.slot0OK    ? 'OK' : 'FAIL'}`);
    console.log(`   liquidity:     ${r.liquidityOK ? 'OK' : 'FAIL'}  (${r.liquidity ?? 'n/a'})`);
    console.log(`   fee on-chain:  ${r.feeOnChain != null ? (r.feeOnChain / 10000) + '%' : 'n/a'}`);
    console.log(`   token0:        ${r.token0Addr}`);
    console.log(`                  → ${r.token0Symbol ?? 'UNKNOWN'} (${r.token0Dec ?? '?'} dec)`);
    console.log(`   token1:        ${r.token1Addr}`);
    console.log(`                  → ${r.token1Symbol ?? 'UNKNOWN'} (${r.token1Dec ?? '?'} dec)`);
    if (r.rawPrice !== null) {
      console.log(`   raw price:     ${r.rawPrice?.toFixed(8)}  (before mode)`);
      console.log(`   direct price:  ${r.directPrice?.toFixed(6)}  (${r.token1Symbol} per ${r.token0Symbol})`);
      console.log(`   invert price:  ${r.invertPrice?.toFixed(6)}  (${r.token0Symbol} per ${r.token1Symbol})`);
    }
    console.log(`   detected mode: ${r.detectedMode ?? 'n/a'}`);
    console.log(`   price:         ${r.detectedPrice?.toFixed(6) ?? 'n/a'}  sane=${r.priceSane}`);
    if (r.mainnetDiff) {
      console.log(`   vs mainnet:    ${r.mainnetDiff}`);
    }
    if (r.failures.length > 0) {
      console.log(`   FAILURES:`);
      r.failures.forEach(f => console.log(`     ⚠️  ${f}`));
    }
    console.log(`   VERDICT:       ${r.recommendation}`);
    if (r.safeConfig) {
      console.log(`   SAFE CONFIG:`);
      console.log(`     { outputPair: '${r.safeConfig.outputPair}',`);
      console.log(`       pool:       '${r.safeConfig.pool}',`);
      console.log(`       decimals0:  ${r.safeConfig.decimals0},`);
      console.log(`       decimals1:  ${r.safeConfig.decimals1},`);
      console.log(`       fee:        ${r.safeConfig.fee},`);
      console.log(`       priceMode:  '${r.safeConfig.priceMode}',`);
      console.log(`       sanityMin:  ${r.safeConfig.sanityMin},`);
      console.log(`       sanityMax:  ${r.safeConfig.sanityMax}, }`);
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  console.log('\n' + bar());
  console.log(`SUMMARY: ${passed}/${results.length} pools passed`);
  console.log(bar());
  results.forEach(r => {
    const icon = r.pass ? '✅' : r.slot0OK ? '⚠️ ' : '❌';
    console.log(`  ${icon} ${r.configLabel.padEnd(14)} ${r.recommendation}`);
  });
  console.log(bar() + '\n');

  process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
