'use strict';
/**
 * scripts/analysis/arb_historical_mint_scan.js
 *
 * One-shot scan: find the Mint event that created the $17k depth spike
 * around block 443758000 (2026-03-20 ~11:30 UTC).
 *
 * Scans a configurable window around the target block and reports
 * all Mint/Burn events with depth reconstruction where possible.
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_historical_mint_scan.js
 *   node -r dotenv/config scripts/analysis/arb_historical_mint_scan.js --center=443758000 --window=500
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

const UNIV3_POOL = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const DEC0 = 18;
const DEC1 = 6;

const UNIV3_ABI = [
  'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

function sqrtPriceToUSDC(sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}
function activeTickDepthUSD(liq, sqrtP96) {
  const sqrtP = Number(sqrtP96) / Number(2n ** 96n);
  return (Number(liq) * sqrtP) / Math.pow(10, DEC1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  return {
    center: getN('--center', 443758000),
    window: getN('--window', 500),   // blocks either side
    chunk:  getN('--chunk',  200),   // getLogs max range (some RPCs cap at 1000)
  };
}

async function scanRange(fromBlock, toBlock, rpc) {
  const res = await rpc.callDetailed(
    `hist.events.${fromBlock}-${toBlock}`,
    async (provider) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
      const [mints, burns] = await Promise.all([
        provider.getLogs({ ...pool.filters.Mint(), fromBlock, toBlock }),
        provider.getLogs({ ...pool.filters.Burn(), fromBlock, toBlock }),
      ]);
      return { mints, burns };
    },
    { timeoutMs: 8000, hedge: true }
  );
  return res.result;
}

async function readDepthAt(block, rpc) {
  const res = await rpc.callDetailed(
    `hist.depth.${block}`,
    async (provider) => {
      const pool = new ethers.Contract(UNIV3_POOL, UNIV3_ABI, provider);
      const [s0, liq] = await Promise.all([
        pool.slot0({ blockTag: block }),
        pool.liquidity({ blockTag: block }),
      ]);
      return { s0, liq };
    },
    { timeoutMs: 5000, hedge: true }
  );
  const sqrtP = res.result.s0[0];
  return {
    price: sqrtPriceToUSDC(sqrtP),
    depth: activeTickDepthUSD(res.result.liq, sqrtP),
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const { center, window: win, chunk } = parseArgs();
  const fromBlock = center - win;
  const toBlock   = center + win;
  const rpc       = createProvider('arbitrum');
  const iface     = new ethers.Interface(UNIV3_ABI);

  console.log(`\n[arb_historical_mint_scan] ${new Date().toISOString()}`);
  console.log(`  Target: blocks ${fromBlock} – ${toBlock}  (center=${center} ± ${win})`);
  console.log(`  Pool:   ${UNIV3_POOL}\n`);

  // Chunked getLogs to avoid RPC range limits
  const allMints = [];
  const allBurns = [];

  for (let from = fromBlock; from <= toBlock; from += chunk) {
    const to = Math.min(from + chunk - 1, toBlock);
    process.stdout.write(`  Scanning ${from}–${to}...`);
    try {
      const { mints, burns } = await scanRange(from, to, rpc);
      allMints.push(...mints);
      allBurns.push(...burns);
      console.log(` ${mints.length} mints  ${burns.length} burns`);
    } catch (e) {
      console.log(` ERROR: ${e.message}`);
    }
    await sleep(300);
  }

  const allEvents = [
    ...allMints.map(l => ({ ...l, _type: 'Mint' })),
    ...allBurns.map(l => ({ ...l, _type: 'Burn' })),
  ].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);

  console.log(`\n  Total: ${allMints.length} mints  ${allBurns.length} burns  (${allEvents.length} total)\n`);

  if (allEvents.length === 0) {
    console.log('  No events found in range. Try --window=2000\n');
    return;
  }

  // Parse and display each event + read depth at that block
  const LINE = '═'.repeat(100);
  const DIV  = '─'.repeat(100);
  console.log(LINE);
  console.log('  HISTORICAL MINT/BURN ANALYSIS');
  console.log(LINE);

  const summary = [];

  for (const log of allEvents) {
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch { continue; }

    const type      = log._type;
    const block     = log.blockNumber;
    const txHash    = log.transactionHash;
    const owner     = parsed.args.owner;
    const tickLower = Number(parsed.args.tickLower);
    const tickUpper = Number(parsed.args.tickUpper);
    const tickWidth = tickUpper - tickLower;
    const amount    = parsed.args.amount.toString();
    const amount0   = Number(parsed.args.amount0) / Math.pow(10, DEC0);
    const amount1   = Number(parsed.args.amount1) / Math.pow(10, DEC1);

    // Read actual depth at event block
    let depthAfter = null;
    let price      = null;
    try {
      const snap = await readDepthAt(block, rpc);
      depthAfter = snap.depth;
      price      = snap.price;
    } catch { /* leave null */ }
    await sleep(200);

    const depthTag = depthAfter === null        ? 'depth=?'
                   : depthAfter >= 15000         ? `★ depth=$${depthAfter.toFixed(0)} ← EXECUTION-GRADE`
                   : depthAfter >= 5000          ? `~ depth=$${depthAfter.toFixed(0)}  subcritical`
                   :                               `  depth=$${depthAfter.toFixed(0)}  dead`;

    const record = { type, block, txHash, owner, tickLower, tickUpper, tickWidth, amount, amount0, amount1, depthAfter, price };
    summary.push(record);

    console.log(`\n  ${type.padEnd(5)} block=${block}  tx=${txHash.slice(0,18)}...`);
    console.log(`    owner:      ${owner}`);
    console.log(`    ticks:      [${tickLower}, ${tickUpper}]  width=${tickWidth}`);
    console.log(`    amount0:    ${amount0.toFixed(4)} ARB`);
    console.log(`    amount1:    ${amount1.toFixed(4)} USDC`);
    console.log(`    price:      $${price ? price.toFixed(6) : '?'} USDC/ARB`);
    console.log(`    ${depthTag}`);
  }

  // Summary table — sort by depth desc
  const withDepth = summary.filter(r => r.depthAfter !== null).sort((a,b) => b.depthAfter - a.depthAfter);

  console.log('\n' + LINE);
  console.log('  TOP EVENTS BY POST-EVENT DEPTH');
  console.log('  ' + DIV);
  console.log(`  ${'type'.padEnd(6)} ${'block'.padEnd(12)} ${'depth$'.padEnd(12)} ${'tickW'.padEnd(8)} ${'ARB'.padEnd(12)} ${'USDC'.padEnd(12)} owner`);
  console.log('  ' + DIV);
  for (const r of withDepth.slice(0, 20)) {
    const alert = r.depthAfter >= 15000 ? ' ★' : '';
    console.log(
      `  ${r.type.padEnd(6)} ${String(r.block).padEnd(12)} ` +
      `$${String(r.depthAfter.toFixed(0)).padEnd(11)} ` +
      `${String(r.tickWidth).padEnd(8)} ` +
      `${String(r.amount0.toFixed(2)).padEnd(12)} ` +
      `${String(r.amount1.toFixed(2)).padEnd(12)} ` +
      `${r.owner.slice(0,12)}...${alert}`
    );
  }

  // Unique owners
  const owners = [...new Set(summary.map(r => r.owner))];
  console.log('\n' + LINE);
  console.log(`  UNIQUE LP OWNERS: ${owners.length}`);
  for (const o of owners) {
    const evs   = summary.filter(r => r.owner === o);
    const mints = evs.filter(r => r.type === 'Mint').length;
    const burns = evs.filter(r => r.type === 'Burn').length;
    const maxD  = Math.max(...evs.filter(r => r.depthAfter).map(r => r.depthAfter));
    const label = mints === burns ? 'churn_bot_pattern' : mints > burns ? 'net_adder' : 'net_remover';
    console.log(`\n  ${o}`);
    console.log(`    mints=${mints}  burns=${burns}  maxDepth=$${maxD.toFixed(0)}  pattern=${label}`);
  }

  console.log('\n' + LINE + '\n');
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
