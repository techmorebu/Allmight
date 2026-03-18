// scripts/tools/arb_pool_smoke_test.js
// BOSS DIRECTIVE — PRE-ADD ON-CHAIN VALIDATION
//
// Smoke tests 3 candidate Arbitrum UniV3 pools before config re-entry.
// For each pool, proves:
//   - slot0() responds (no CALL_EXCEPTION)
//   - liquidity() responds
//   - token0/token1 addresses are readable
//   - decimals and symbol resolve for both tokens
//   - derived price is sane
//   - actual token0/token1 order vs configured label
//
// Usage:
//   node -r dotenv/config scripts/tools/arb_pool_smoke_test.js

'use strict';
require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

const rpc = createProvider('arbitrum');

// ── ABIs ─────────────────────────────────────────────────────────────────────

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

// ── Known Arbitrum token addresses (for label cross-check) ────────────────────
// Source: canonical Arbitrum One token list
const KNOWN_TOKENS = {
  // Native USDC (Circle-issued, post-2023)
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': { symbol: 'USDC',  decimals: 6  },
  // Bridged USDC (legacy USDCe — being deprecated)
  '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8': { symbol: 'USDCe', decimals: 6  },
  // USDT on Arbitrum
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': { symbol: 'USDT',  decimals: 6  },
  // WETH on Arbitrum
  '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': { symbol: 'WETH',  decimals: 18 },
  // WBTC on Arbitrum
  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': { symbol: 'WBTC',  decimals: 8  },
  // ARB
  '0x912CE59144191C1204E64559FE8253a0e49E6548': { symbol: 'ARB',   decimals: 18 },
};

// ── Candidate pools ───────────────────────────────────────────────────────────

const CANDIDATES = [
  {
    configLabel:  'ETH/USDC',
    pool:         '0xC6962004f452bE9203591991D15f6b388e09E8D0',
    fee:          500,   // 0.05%
    // On-chain assumption: token0=USDC (6 dec), token1=WETH (18 dec)
    // price = 1/raw → USDC per WETH → ETH price in USD
    expectedPriceMode: 'invert',
    sanityMin:    500,
    sanityMax:    20000,
    priceDesc:    'ETH price in USDC',
  },
  {
    configLabel:  'ETH/USDT',
    pool:         '0x641C00A822e8b671738d32a431a4Fb6074E5c79d',
    fee:          500,   // 0.05%
    // On-chain assumption: token0=USDT (6 dec), token1=WETH (18 dec)
    // price = 1/raw → USDT per WETH → ETH price in USD
    expectedPriceMode: 'invert',
    sanityMin:    500,
    sanityMax:    20000,
    priceDesc:    'ETH price in USDT',
  },
  {
    configLabel:  'USDC/USDT',
    pool:         '0xbE3aD6a5669Dc0B8b12FeBC03608860C31E2eef6',
    fee:          100,   // 0.01%
    // On-chain assumption: token0=USDC (6 dec), token1=USDT (6 dec)
    // price = raw → USDT per USDC ≈ 1.0
    expectedPriceMode: 'direct',
    sanityMin:    0.9,
    sanityMax:    1.1,
    priceDesc:    'USDT per USDC (≈1.0)',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sqrtPriceToRaw(sqrtPriceX96Raw, dec0, dec1) {
  const Q96   = 2n ** 96n;
  const sqrtP = Number(sqrtPriceX96Raw) / Number(Q96);
  return sqrtP * sqrtP * Math.pow(10, dec0 - dec1);
}

function resolveToken(address) {
  const key = Object.keys(KNOWN_TOKENS).find(
    k => k.toLowerCase() === address.toLowerCase()
  );
  return key ? KNOWN_TOKENS[key] : null;
}

function bar(len = 96) { return '─'.repeat(len); }

// ── Per-pool probe ────────────────────────────────────────────────────────────

async function probePool(cfg, blockNumber) {
  const result = {
    configLabel:   cfg.configLabel,
    pool:          cfg.pool,
    pass:          false,
    failures:      [],
    slot0OK:       false,
    liquidityOK:   false,
    token0Addr:    null,
    token1Addr:    null,
    token0Symbol:  null,
    token1Symbol:  null,
    token0Dec:     null,
    token1Dec:     null,
    sqrtPriceX96:  null,
    rawPrice:      null,
    derivedPrice:  null,
    priceMode:     cfg.expectedPriceMode,
    priceSane:     false,
    tokenOrderOK:  false,
    recommendation: null,
    rootCause:     null,
  };

  // ── Step 1: slot0 + liquidity (same contract, same call) ──────────────────
  try {
    const { result: callResult } = await rpc.callDetailed(
      `smoke.slot0liq.${cfg.pool.slice(0, 10)}`,
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

    result.slot0OK      = true;
    result.liquidityOK  = true;
    result.sqrtPriceX96 = callResult.slot0[0].toString();
    result.liquidity    = callResult.liq.toString();
    result.token0Addr   = callResult.t0;
    result.token1Addr   = callResult.t1;
    result.feeOnChain   = Number(callResult.fee);

  } catch (e) {
    result.failures.push(`slot0/liquidity CALL_EXCEPTION: ${String(e.message).slice(0, 120)}`);
    result.rootCause = 'CALL_EXCEPTION on slot0 — pool address invalid, wrong ABI, or contract does not exist at this address on Arbitrum';
    result.recommendation = 'DO NOT ADD — on-chain call fails';
    return result;
  }

  // ── Step 2: Token metadata ─────────────────────────────────────────────────
  for (const [key, addr] of [['token0', result.token0Addr], ['token1', result.token1Addr]]) {
    // First try known-token lookup (zero RPC calls)
    const known = resolveToken(addr);
    if (known) {
      result[`${key}Symbol`]  = known.symbol;
      result[`${key}Dec`]     = known.decimals;
    } else {
      // Fallback: live ERC20 call
      try {
        const { result: meta } = await rpc.callDetailed(
          `smoke.meta.${key}.${addr.slice(0, 10)}`,
          async (provider) => {
            const token = new ethers.Contract(addr, ERC20_ABI, provider);
            const [dec, sym] = await Promise.all([token.decimals(), token.symbol()]);
            return { dec, sym };
          },
          { timeoutMs: 2000, hedge: false }
        );
        result[`${key}Symbol`] = meta.sym;
        result[`${key}Dec`]    = Number(meta.dec);
      } catch (e) {
        result.failures.push(`${key} metadata FAIL (${addr.slice(0, 10)}): ${e.message.slice(0, 80)}`);
        result[`${key}Symbol`] = 'UNKNOWN';
        result[`${key}Dec`]    = null;
      }
    }
  }

  // ── Step 3: Price derivation ───────────────────────────────────────────────
  const dec0 = result.token0Dec;
  const dec1 = result.token1Dec;

  if (dec0 !== null && dec1 !== null) {
    const raw = sqrtPriceToRaw(BigInt(result.sqrtPriceX96), dec0, dec1);
    result.rawPrice     = raw;
    result.derivedPrice = cfg.expectedPriceMode === 'invert' ? 1 / raw : raw;

    if (
      isFinite(result.derivedPrice) &&
      result.derivedPrice >= cfg.sanityMin &&
      result.derivedPrice <= cfg.sanityMax
    ) {
      result.priceSane = true;
    } else {
      result.failures.push(
        `price out of sanity range [${cfg.sanityMin}, ${cfg.sanityMax}]: got ${result.derivedPrice?.toFixed(6)}`
      );
    }
  } else {
    result.failures.push('cannot derive price — one or both decimals unknown');
  }

  // ── Step 4: Token order cross-check ───────────────────────────────────────
  // For each configLabel, define what we expect token0 and token1 to be
  const ORDER_EXPECTATIONS = {
    'ETH/USDC': {
      // Uniswap sorts by address. USDC (0xaf88...) < WETH (0x82aF...) on Arbitrum
      // → token0=USDC, token1=WETH
      expectedToken0Symbols: ['USDC', 'USDCe'],
      expectedToken1Symbols: ['WETH'],
    },
    'ETH/USDT': {
      // USDT (0xFd08...) vs WETH (0x82aF...) — need to check address sort
      // 0x82aF < 0xFd08 → token0=WETH, token1=USDT OR reversed — we'll detect from actual
      // Accept either ordering and report what we find
      expectedToken0Symbols: ['WETH', 'USDT'],
      expectedToken1Symbols: ['WETH', 'USDT'],
    },
    'USDC/USDT': {
      // USDC (0xaf88...) vs USDT (0xFd08...) — 0xaf < 0xFd → token0=USDC, token1=USDT
      expectedToken0Symbols: ['USDC', 'USDCe'],
      expectedToken1Symbols: ['USDT'],
    },
  };

  const exp = ORDER_EXPECTATIONS[cfg.configLabel];
  if (exp) {
    const t0ok = exp.expectedToken0Symbols.includes(result.token0Symbol);
    const t1ok = exp.expectedToken1Symbols.includes(result.token1Symbol);
    result.tokenOrderOK = t0ok && t1ok;
    if (!result.tokenOrderOK) {
      result.failures.push(
        `token order mismatch: got token0=${result.token0Symbol} token1=${result.token1Symbol}, ` +
        `expected token0 in [${exp.expectedToken0Symbols}], token1 in [${exp.expectedToken1Symbols}]`
      );
    }
  }

  // ── Final verdict ──────────────────────────────────────────────────────────
  result.pass = result.slot0OK &&
                result.liquidityOK &&
                result.priceSane &&
                result.failures.length === 0;

  if (result.pass) {
    result.recommendation = 'SAFE TO ADD';
    result.rootCause = result.tokenOrderOK
      ? 'No issues found. Prior removal was likely a transient RPC failure or wrong pool address at time of test.'
      : 'Pool reads clean but token ordering differs from config label — review decimals/priceMode before adding.';
  } else if (result.slot0OK && !result.priceSane) {
    result.recommendation = 'REVIEW BEFORE ADDING — pool responds but price is out of range';
    result.rootCause = 'slot0 succeeds but price derivation is wrong — likely wrong token ordering in config (dec0/dec1 swapped) or wrong priceMode';
  } else {
    result.recommendation = 'DO NOT ADD — investigate failure';
    result.rootCause = result.rootCause || 'Unknown — see failures array';
  }

  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + bar());
  console.log('ARBITRUM UNIV3 PRE-ADD SMOKE TEST');
  console.log('Boss directive: prove each pool before config re-entry');
  console.log(bar());

  // Block anchor
  let blockNumber;
  try {
    const blockResp = await rpc.getBlockNumber('smoke.block', { timeoutMs: 2000, hedge: true });
    blockNumber = blockResp.blockNumber;
    console.log(`\nBlock anchor: ${blockNumber}\n`);
  } catch (e) {
    console.error(`FATAL: Cannot fetch block number — ${e.message}`);
    process.exit(1);
  }

  const results = [];
  for (const cfg of CANDIDATES) {
    process.stdout.write(`Testing ${cfg.configLabel} (${cfg.pool.slice(0, 12)}...)  `);
    const r = await probePool(cfg, blockNumber);
    results.push(r);
    console.log(r.pass ? '✅ PASS' : '❌ FAIL');
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log('\n' + bar());
  console.log('RESULTS');
  console.log(bar());

  for (const r of results) {
    console.log(`\n${r.pass ? '✅' : '❌'} ${r.configLabel.padEnd(12)} | ${r.pool}`);
    console.log(`   slot0:      ${r.slot0OK     ? 'OK' : 'FAIL'}`);
    console.log(`   liquidity:  ${r.liquidityOK ? 'OK' : 'FAIL'}  (${r.liquidity || 'n/a'})`);
    console.log(`   token0:     ${r.token0Addr}`);
    console.log(`               → ${r.token0Symbol ?? 'UNKNOWN'} (${r.token0Dec ?? '?'} dec)`);
    console.log(`   token1:     ${r.token1Addr}`);
    console.log(`               → ${r.token1Symbol ?? 'UNKNOWN'} (${r.token1Dec ?? '?'} dec)`);
    console.log(`   fee tier:   ${r.feeOnChain ? r.feeOnChain / 10000 + '%' : 'n/a'}`);
    if (r.derivedPrice !== null) {
      console.log(`   price:      ${r.derivedPrice?.toFixed(4)} (${r.priceDesc || ''})  sane=${r.priceSane}`);
    }
    console.log(`   token order match: ${r.tokenOrderOK ? 'YES' : 'NO / MISMATCH'}`);
    if (r.failures.length > 0) {
      console.log(`   FAILURES:`);
      r.failures.forEach(f => console.log(`     ⚠️  ${f}`));
    }
    console.log(`   VERDICT:    ${r.recommendation}`);
    console.log(`   ROOT CAUSE: ${r.rootCause}`);
  }

  // ── Pass/fail summary ─────────────────────────────────────────────────────
  const passed = results.filter(r => r.pass).length;
  console.log('\n' + bar());
  console.log(`SUMMARY: ${passed}/${results.length} pools passed`);
  console.log(bar());

  results.forEach(r => {
    const icon = r.pass ? '✅' : '❌';
    console.log(`  ${icon} ${r.configLabel.padEnd(14)} ${r.recommendation}`);
  });

  console.log(bar() + '\n');
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(err => {
  console.error('\nFATAL ERROR:', err.message);
  process.exit(1);
});
