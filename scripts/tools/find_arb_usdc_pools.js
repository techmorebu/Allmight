// find_arb_usdc_pools.js
// Query UniV3 factory for all ARB/native-USDC and ARB/USDCe pools
// Runs against live Arbitrum — no assumptions, no GeckoTerminal labeling.
//
// Usage:
//   node -r dotenv/config find_arb_usdc_pools.js
//
// Place this file anywhere in ~/Allmight and run from there.

'use strict';
require('dotenv').config();

const { ethers } = require('ethers');
const { createProvider } = require('./utils/provider_factory');

const rpc = createProvider('arbitrum');

// ── Addresses ─────────────────────────────────────────────────────────────────
const FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // UniV3 Factory (Arbitrum)
const ARB     = '0x912CE59144191C1204E64559FE8253a0e49E6548'; // ARB token
const nUSDC   = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'; // Circle native USDC ← target
const USDCe   = '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8'; // Bridged USDC.e (check only)

// All valid UniV3 fee tiers
const FEES = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.30%, 1.00%

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const NULL = '0x0000000000000000000000000000000000000000';

function bar(n = 72) { return '─'.repeat(n); }

async function main() {
  console.log('\n' + bar());
  console.log('ARB / USDC POOL DISCOVERY — UniV3 Factory Query (Arbitrum)');
  console.log('Native USDC:  0xaf88d065e77c8cC2239327C5EDb3A432268e5831');
  console.log('Bridged USDCe: 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8');
  console.log(bar());

  // Block anchor
  let blockNumber;
  try {
    const br = await rpc.getBlockNumber('factory.block', { timeoutMs: 2000, hedge: true });
    blockNumber = br.blockNumber;
    console.log(`\nBlock anchor: ${blockNumber}\n`);
  } catch (e) {
    console.error(`FATAL: block fetch failed — ${e.message}`);
    process.exit(1);
  }

  const results = [];

  for (const [label, quoteAddr] of [
    ['native USDC (0xaf88...)', nUSDC],
    ['USDCe bridged (0xFF97...)', USDCe],
  ]) {
    console.log(`\nQuerying ARB / ${label}`);
    console.log('─'.repeat(50));

    for (const fee of FEES) {
      const feePct = (fee / 10000).toFixed(2) + '%';
      try {
        const { result: pool } = await rpc.callDetailed(
          `factory.getPool.${fee}.${quoteAddr.slice(0, 10)}`,
          async (provider) => {
            const f = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
            return f.getPool(ARB, quoteAddr, fee);
          },
          { timeoutMs: 2000, hedge: false }
        );

        const exists = pool !== NULL;
        const line = `  fee=${feePct.padStart(6)}  →  ${exists ? pool : '(no pool exists)'}`;
        console.log(line);
        if (exists) results.push({ label, quoteAddr, fee, feePct, pool });

      } catch (e) {
        console.log(`  fee=${feePct.padStart(6)}  →  ERROR: ${e.message.slice(0, 60)}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + bar());
  console.log('EXISTING POOLS FOUND');
  console.log(bar());

  if (results.length === 0) {
    console.log('  No ARB/USDC or ARB/USDCe pools found at any fee tier.');
  } else {
    results.forEach(r => {
      const tag = r.quoteAddr === nUSDC ? '✅ NATIVE USDC' : '⚠️  USDCe (bridged)';
      console.log(`  ${tag}  fee=${r.feePct}  pool=${r.pool}`);
    });
  }

  const nativeOnly = results.filter(r => r.quoteAddr === nUSDC);
  console.log('\n' + bar());
  console.log(`Native USDC pools found: ${nativeOnly.length}`);
  if (nativeOnly.length > 0) {
    console.log('→ Best candidate for smoke test (highest fee tier with most liquidity):');
    console.log(`  Recommend running arb_pool_smoke_test_p2.js on the 0.05% pool if it exists,`);
    console.log(`  otherwise the highest-liquidity tier from the list above.`);
  } else {
    console.log('→ No native USDC ARB pool found. USDCe pools exist only.');
    console.log('  Boss decision required before proceeding.');
  }
  console.log(bar() + '\n');
}

main().catch(err => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
