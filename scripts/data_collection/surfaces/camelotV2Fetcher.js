'use strict';
/**
 * scripts/data_collection/surfaces/camelotV2Fetcher.js
 *
 * PURPOSE:
 *   Fetch ARB/USDC price + liquidity from Camelot V2 (xy=k constant-product)
 *   on Arbitrum. Surface #1 in multi-surface expansion.
 *
 * INPUTS:
 *   - Arbitrum mainnet via createProvider('arbitrum')
 *   - Camelot V2 factory (0x6EcCab422D763aC031210895C81787E87B43A652)
 *   - ARB  (0x912CE59144191C1204E64559FE8253a0e49E6548, 18 dec)
 *   - USDC (0xaf88d065e77c8cC2239327C5EDb3A432268e5831,  6 dec)
 *
 * OUTPUTS:
 *   Structured JSON object (pipeline-compatible schema):
 *   {
 *     ts, source, chain, pair, protocol, pool, price,
 *     liquidityUsd, reserve0, reserve1, token0, token1,
 *     decimals0, decimals1, block, status
 *   }
 *   Optional JSONL log via --log=
 *
 * IN SCOPE:
 *   - getReserves() → price + liquidity
 *   - factory.getPair() to discover pair address (no hardcoded pair)
 *   - Correct decimal-aware price regardless of token0/token1 orientation
 *
 * OUT OF SCOPE:
 *   - No execution logic
 *   - No modification of existing fetchers
 *   - No Redis
 *   - No other pools or chains
 *   - No parallel pool calls
 *
 * USAGE:
 *   node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js
 *   node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js --log=./logs/camv2.jsonl
 *   node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js --watch --interval=5000
 *   node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js --json
 *   node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js --help
 */

require('dotenv').config();

const fs             = require('fs');
const path           = require('path');
const { ethers }     = require('ethers');
const { createProvider } = require('../../../utils/provider_factory');

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESSES — confirmed on Arbitrum mainnet
// ─────────────────────────────────────────────────────────────────────────────
const CAMELOT_V2_FACTORY = '0x6EcCab422D763aC031210895C81787E87B43A652';  // confirmed_default
const ARB_TOKEN          = '0x912CE59144191C1204E64559FE8253a0e49E6548';  // confirmed_default
const USDC_TOKEN         = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';  // confirmed_default: native USDC
const ARB_DECIMALS       = 18;   // confirmed_default
const USDC_DECIMALS      = 6;    // confirmed_default

// ─────────────────────────────────────────────────────────────────────────────
// FEES — Camelot V2 is a UniswapV2 fork with dynamic per-direction fees
//   Default: 0.3% per direction (token0FeePercent / token1FeePercent = 300/100000)
//   We store for reference; fee is not needed for price/liquidity reads
// ─────────────────────────────────────────────────────────────────────────────
const CAM_V2_FEE_DEFAULT = 0.003;  // confirmed_default: 0.3% default fee

// ─────────────────────────────────────────────────────────────────────────────
// LOG ENVELOPE
// ─────────────────────────────────────────────────────────────────────────────
const LOG_SOURCE   = 'camelot_v2_fetcher';
const LOG_CHAIN    = 'arbitrum';
const LOG_PAIR     = 'ARB/USDC';
const LOG_PROTOCOL = 'camelot_v2';

// ─────────────────────────────────────────────────────────────────────────────
// ABIs — minimal, read-only
// ─────────────────────────────────────────────────────────────────────────────
const FACTORY_ABI = [
  'function getPair(address tokenA, address tokenB) external view returns (address pair)',
];

const PAIR_ABI = [
  'function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  // Camelot V2 specific — per-direction fees, fallback to default if call fails
  'function token0FeePercent() external view returns (uint16)',
  'function token1FeePercent() external view returns (uint16)',
];

// ─────────────────────────────────────────────────────────────────────────────
// PAIR DISCOVERY — call factory.getPair() once and cache
// ─────────────────────────────────────────────────────────────────────────────
async function discoverPair(rpc) {
  const res = await rpc.callDetailed(
    'camv2.factory.getPair',
    async (provider) => {
      const factory = new ethers.Contract(CAMELOT_V2_FACTORY, FACTORY_ABI, provider);
      return factory.getPair(ARB_TOKEN, USDC_TOKEN);
    },
    { timeoutMs: 5000, hedge: true }
  );
  const pairAddr = res.result;
  if (!pairAddr || pairAddr === ethers.ZeroAddress) {
    throw new Error('Camelot V2 ARB/USDC pair not found on this factory');
  }
  return pairAddr;
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH — read reserves + orientation at a given block
// ─────────────────────────────────────────────────────────────────────────────
async function fetchOnce(pairAddr, rpc) {
  const res = await rpc.callDetailed(
    'camv2.pair.read',
    async (provider) => {
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
      // All reads on the same contract — Promise.all is permitted here
      const [reserves, token0Addr, token1Addr, blockNum] = await Promise.all([
        pair.getReserves(),
        pair.token0(),
        pair.token1(),
        provider.getBlockNumber(),
      ]);
      return { reserves, token0Addr, token1Addr, blockNum };
    },
    { timeoutMs: 5000, hedge: true }
  );

  const { reserves, token0Addr, token1Addr, blockNum } = res.result;

  const r0 = reserves[0];  // reserve0 (token0)
  const r1 = reserves[1];  // reserve1 (token1)

  // Determine orientation: which token is ARB, which is USDC
  const token0IsArb = token0Addr.toLowerCase() === ARB_TOKEN.toLowerCase();

  // Decimal-adjusted reserves
  const reserveArb  = token0IsArb
    ? Number(r0) / Math.pow(10, ARB_DECIMALS)
    : Number(r1) / Math.pow(10, ARB_DECIMALS);

  const reserveUsdc = token0IsArb
    ? Number(r1) / Math.pow(10, USDC_DECIMALS)
    : Number(r0) / Math.pow(10, USDC_DECIMALS);

  // Price = USDC per ARB  (constant-product: price = reserveUsdc / reserveArb)
  if (reserveArb <= 0) throw new Error('ARB reserve is zero — pool may be empty');
  const price = reserveUsdc / reserveArb;

  // Liquidity estimate = 2 × value of ARB side (both sides equal in xy=k at this price)
  const liquidityUsd = reserveArb * price * 2;

  return {
    ts:            new Date().toISOString(),
    source:        LOG_SOURCE,
    chain:         LOG_CHAIN,
    pair:          LOG_PAIR,
    protocol:      LOG_PROTOCOL,
    pool:          pairAddr,
    price:         +price.toFixed(8),
    liquidityUsd:  +liquidityUsd.toFixed(2),
    reserve0:      r0.toString(),
    reserve1:      r1.toString(),
    token0:        token0Addr,
    token1:        token1Addr,
    decimals0:     token0IsArb ? ARB_DECIMALS : USDC_DECIMALS,
    decimals1:     token0IsArb ? USDC_DECIMALS : ARB_DECIMALS,
    reserveArb:    +reserveArb.toFixed(4),
    reserveUsdc:   +reserveUsdc.toFixed(4),
    feeDefault:    CAM_V2_FEE_DEFAULT,
    block:         blockNum,
    status:        'success',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE FETCH — wraps fetchOnce with error handling, never crashes pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function safeFetch(pairAddr, rpc) {
  try {
    return await fetchOnce(pairAddr, rpc);
  } catch (e) {
    return {
      ts:       new Date().toISOString(),
      source:   LOG_SOURCE,
      chain:    LOG_CHAIN,
      pair:     LOG_PAIR,
      protocol: LOG_PROTOCOL,
      pool:     pairAddr ?? 'unknown',
      status:   'failed',
      failures: [e.message],
    };
  }
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
// DISPLAY
// ─────────────────────────────────────────────────────────────────────────────
function printResult(r, pairAddr) {
  const LINE = '═'.repeat(80);
  console.log('\n' + LINE);
  console.log('  CAMELOT V2 — ARB/USDC');
  console.log(`  Pool:    ${pairAddr}`);
  console.log(`  Block:   ${r.block}`);
  console.log(`  Status:  ${r.status}`);
  if (r.status === 'success') {
    console.log(`\n  Price:         $${r.price.toFixed(8)} USDC/ARB`);
    console.log(`  Liquidity:     $${r.liquidityUsd.toLocaleString()}`);
    console.log(`  Reserve ARB:   ${r.reserveArb.toLocaleString()} ARB`);
    console.log(`  Reserve USDC:  ${r.reserveUsdc.toLocaleString()} USDC`);
    console.log(`  token0:        ${r.token0}  (dec=${r.decimals0})`);
    console.log(`  token1:        ${r.token1}  (dec=${r.decimals1})`);
    console.log(`  Fee (default): ${(r.feeDefault * 100).toFixed(2)}%`);
  } else {
    console.log(`  Failures: ${r.failures?.join(', ')}`);
  }
  console.log(LINE + '\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELP
// ─────────────────────────────────────────────────────────────────────────────
function printHelp() {
  console.log(`
camelotV2Fetcher.js — Camelot V2 ARB/USDC price + liquidity fetcher

PURPOSE:
  Surface #1 in multi-surface expansion. Reads from Camelot V2 (xy=k)
  as a second price source alongside the existing Camelot V3 anchor.

USAGE:
  node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js [flags]

FLAGS:
  --json           Emit only clean JSON output (no console table)
  --watch          Continuous mode (polls until stopped)
  --interval=N     Poll interval ms in watch mode  (default: 5000)
  --duration=N     Max run time seconds in watch mode (default: 3600)
  --log=PATH       Append JSONL records to file
  --help           Show this message

OUTPUT FIELDS:
  ts, source, chain, pair, protocol, pool, price, liquidityUsd,
  reserve0, reserve1, token0, token1, decimals0, decimals1,
  reserveArb, reserveUsdc, feeDefault, block, status

EXAMPLES:
  node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js
  node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js --json
  node -r dotenv/config scripts/data_collection/surfaces/camelotV2Fetcher.js --watch --log=./logs/camv2.jsonl
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI PARSER
// ─────────────────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { printHelp(); process.exit(0); }
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  const getS = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? a.split('=').slice(1).join('=') : d; };
  return {
    json:     args.includes('--json'),
    watch:    args.includes('--watch'),
    interval: getN('--interval', 5_000),
    duration: getN('--duration', 3_600),
    logPath:  getS('--log', null),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const { json, watch, interval, duration, logPath } = parseArgs();
  const rpc = createProvider('arbitrum');

  // Discover pair address once
  if (!json) process.stdout.write(`\n[camelotV2Fetcher] Discovering Camelot V2 ARB/USDC pair...\n`);
  let pairAddr;
  try {
    pairAddr = await discoverPair(rpc);
    if (!json) console.log(`  Pair: ${pairAddr}\n`);
  } catch (e) {
    console.error(`[FATAL] ${e.message}`);
    process.exit(1);
  }

  if (!watch) {
    // One-shot
    const result = await safeFetch(pairAddr, rpc);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printResult(result, pairAddr);
    }
    appendLog(logPath, result);
    process.exit(result.status === 'success' ? 0 : 1);
  }

  // Watch mode
  const endMs = Date.now() + duration * 1000;
  let count   = 0;
  if (!json) console.log(`  Watch mode: interval=${interval}ms  duration=${duration}s\n`);

  while (Date.now() < endMs) {
    const t0     = Date.now();
    const result = await safeFetch(pairAddr, rpc);
    count++;

    if (json) {
      console.log(JSON.stringify(result));
    } else {
      const tag = result.status === 'success'
        ? `$${result.price.toFixed(6)}  liq=$${result.liquidityUsd.toLocaleString()}  block=${result.block}`
        : `FAILED: ${result.failures?.[0]}`;
      console.log(`  [${new Date().toISOString().slice(11,19)}] #${count}  ${tag}`);
    }
    appendLog(logPath, result);

    const elapsed = Date.now() - t0;
    await sleep(Math.max(0, interval - elapsed));
  }

  if (!json) console.log(`\n  Done. ${count} fetches.\n`);
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
