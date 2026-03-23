'use strict';
/**
 * scripts/analysis/arb_historical_mint_scan.js  v2
 *
 * One-shot scan: find the Mint that created the $17k depth spike
 * at block ~443758085 (first EXECUTABLE signal, 2026-03-20 11:30 UTC).
 *
 * Fixes from v1:
 *   - null-safe iface.parseLog (ethers can return null on ABI mismatch)
 *   - tight window around the actual profitable block (not ±500)
 *   - depth reads only on unique Mint owners, not every event
 *   - chunk size tunable (default 100 to avoid RPC range errors)
 *   - churn detection: skip depth read if owner already seen as symmetric burner
 *
 * Usage:
 *   node -r dotenv/config scripts/analysis/arb_historical_mint_scan.js
 *   node -r dotenv/config scripts/analysis/arb_historical_mint_scan.js --center=443758085 --window=200 --chunk=100
 */

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');

const UNIV3_POOL = '0xb0f6cA40411360c03d41C5fFc5F179b8403CdcF8';
const DEC0 = 18;  // ARB
const DEC1 = 6;   // USDC

const UNIV3_ABI = [
  'event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() external view returns (uint128)',
];

// Known profitable block from trigger monitor session
const PROFITABLE_BLOCK = 443_758_085;

function sqrtPriceToUSDC(sqrtPriceX96) {
  const sqrtP = Number(sqrtPriceX96) / Number(2n ** 96n);
  return sqrtP * sqrtP * Math.pow(10, DEC0 - DEC1);
}
function activeTickDepthUSD(liq, sqrtP96) {
  const sqrtP = Number(sqrtP96) / Number(2n ** 96n);
  return (Number(liq) * sqrtP) / Math.pow(10, DEC1);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const args = process.argv.slice(2);
  const getN = (f, d) => { const a = args.find(a => a.startsWith(f+'=')); return a ? Number(a.split('=')[1]) : d; };
  return {
    center: getN('--center', PROFITABLE_BLOCK),
    window: getN('--window', 200),   // ±200 blocks (~50 seconds on Arbitrum)
    chunk:  getN('--chunk',  100),   // getLogs chunk size
  };
}

async function getLogs(fromBlock, toBlock, rpc) {
  const res = await rpc.callDetailed(
    `hist.logs.${fromBlock}-${toBlock}`,
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

async function main() {
  const { center, window: win, chunk } = parseArgs();
  const fromBlock = center - win;
  const toBlock   = center + win;
  const rpc       = createProvider('arbitrum');
  const iface     = new ethers.Interface(UNIV3_ABI);

  console.log(`\n[arb_historical_mint_scan v2] ${new Date().toISOString()}`);
  console.log(`  Target: blocks ${fromBlock}–${toBlock}  (profitable block=${center} ± ${win})`);
  console.log(`  Pool:   ${UNIV3_POOL}\n`);

  // ── Step 1: collect all logs in chunks ────────────────────────────────────
  const allMintLogs = [];
  const allBurnLogs = [];

  for (let from = fromBlock; from <= toBlock; from += chunk) {
    const to = Math.min(from + chunk - 1, toBlock);
    process.stdout.write(`  Scanning ${from}–${to}... `);
    try {
      const { mints, burns } = await getLogs(from, to, rpc);
      allMintLogs.push(...mints);
      allBurnLogs.push(...burns);
      console.log(`${mints.length} mints  ${burns.length} burns`);
    } catch (e) {
      console.log(`SKIP (${e.message.slice(0, 60)})`);
    }
    await sleep(250);
  }

  console.log(`\n  Raw totals: ${allMintLogs.length} mints  ${allBurnLogs.length} burns\n`);

  // ── Step 2: parse logs — null-safe ────────────────────────────────────────
  const parsedMints = [];
  const parsedBurns = [];

  for (const log of allMintLogs) {
    try {
      const d = iface.parseLog({ topics: log.topics, data: log.data });
      if (!d || !d.args) continue;
      parsedMints.push({
        type: 'Mint', block: log.blockNumber, txHash: log.transactionHash,
        owner: d.args.owner,
        tickLower: Number(d.args.tickLower), tickUpper: Number(d.args.tickUpper),
        tickWidth: Number(d.args.tickUpper) - Number(d.args.tickLower),
        amount: d.args.amount.toString(),
        amount0: Number(d.args.amount0) / Math.pow(10, DEC0),
        amount1: Number(d.args.amount1) / Math.pow(10, DEC1),
      });
    } catch { /* skip */ }
  }

  for (const log of allBurnLogs) {
    try {
      const d = iface.parseLog({ topics: log.topics, data: log.data });
      if (!d || !d.args) continue;
      parsedBurns.push({
        type: 'Burn', block: log.blockNumber, txHash: log.transactionHash,
        owner: d.args.owner,
        tickLower: Number(d.args.tickLower), tickUpper: Number(d.args.tickUpper),
        tickWidth: Number(d.args.tickUpper) - Number(d.args.tickLower),
        amount: d.args.amount.toString(),
        amount0: Number(d.args.amount0) / Math.pow(10, DEC0),
        amount1: Number(d.args.amount1) / Math.pow(10, DEC1),
      });
    } catch { /* skip */ }
  }

  console.log(`  Parsed: ${parsedMints.length} mints  ${parsedBurns.length} burns`);

  // ── Step 3: owner behavior profile ───────────────────────────────────────
  // Count mints and burns per owner to identify churn bots
  const ownerStats = {};
  for (const e of [...parsedMints, ...parsedBurns]) {
    if (!ownerStats[e.owner]) ownerStats[e.owner] = { mints: 0, burns: 0, mintBlocks: [], maxTickWidth: 0, maxAmount0: 0 };
    const s = ownerStats[e.owner];
    if (e.type === 'Mint') {
      s.mints++;
      s.mintBlocks.push(e.block);
      s.maxTickWidth = Math.max(s.maxTickWidth, e.tickWidth);
      s.maxAmount0   = Math.max(s.maxAmount0, e.amount0);
    } else {
      s.burns++;
    }
  }

  // Classify owners
  for (const [owner, s] of Object.entries(ownerStats)) {
    const ratio = s.mints === 0 ? Infinity : s.burns / s.mints;
    s.pattern = (ratio > 0.8 && ratio < 1.2 && s.mints > 5) ? 'churn_bot'
              : s.mints > s.burns * 2                        ? 'net_adder'
              : s.burns > s.mints * 2                        ? 'net_remover'
              :                                                 'balanced';
  }

  const LINE = '═'.repeat(100);
  const DIV  = '─'.repeat(100);

  // ── Step 4: print owner summary ───────────────────────────────────────────
  console.log('\n' + LINE);
  console.log('  OWNER BEHAVIOR PROFILES');
  console.log('  ' + DIV);
  console.log(`  ${'owner'.padEnd(44)} ${'mints'.padEnd(7)} ${'burns'.padEnd(7)} ${'maxARB'.padEnd(12)} ${'maxTickW'.padEnd(10)} pattern`);
  console.log('  ' + DIV);

  const sortedOwners = Object.entries(ownerStats)
    .sort((a, b) => b[1].maxAmount0 - a[1].maxAmount0);

  for (const [owner, s] of sortedOwners) {
    const flag = s.pattern === 'churn_bot' ? '' : ' ← REAL LP?';
    console.log(
      `  ${owner.padEnd(44)} ${String(s.mints).padEnd(7)} ${String(s.burns).padEnd(7)} ` +
      `${String(s.maxAmount0.toFixed(2)).padEnd(12)} ${String(s.maxTickWidth).padEnd(10)} ${s.pattern}${flag}`
    );
  }

  // ── Step 5: depth read on non-churn owners only ───────────────────────────
  const realLPs = sortedOwners.filter(([, s]) => s.pattern !== 'churn_bot');

  console.log(`\n  Non-churn owners: ${realLPs.length}  (reading depth at their Mint blocks...)\n`);

  const depthResults = [];

  for (const [owner, s] of realLPs) {
    // Read depth at each of their Mint blocks (max 5)
    const blocksToCheck = [...new Set(s.mintBlocks)].sort((a, b) => a - b).slice(0, 5);
    for (const blk of blocksToCheck) {
      process.stdout.write(`  depth @ block ${blk} (owner ${owner.slice(0, 10)}...)... `);
      try {
        const snap = await readDepthAt(blk, rpc);
        const alert = snap.depth >= 15000 ? ' ★ EXECUTION-GRADE' : '';
        console.log(`$${snap.depth.toFixed(2)}${alert}  price=$${snap.price.toFixed(6)}`);
        depthResults.push({ owner, block: blk, depth: snap.depth, price: snap.price, pattern: s.pattern });
      } catch (e) {
        console.log(`error: ${e.message.slice(0, 50)}`);
      }
      await sleep(300);
    }
  }

  // ── Step 6: final report ──────────────────────────────────────────────────
  console.log('\n' + LINE);
  console.log('  DEPTH RESULTS — NON-CHURN OWNERS');
  console.log('  ' + DIV);

  const hits = depthResults.filter(r => r.depth >= 15000);
  if (hits.length === 0) {
    console.log('  No execution-grade depth detected from non-churn owners in this range.');
    console.log('  The $17k spike may have occurred just outside the scan window.');
    console.log('  Try: --center=443758085 --window=500 --chunk=50');
  } else {
    console.log(`  ★ EXECUTION-GRADE events found: ${hits.length}`);
    for (const r of hits) {
      console.log(`\n  owner:  ${r.owner}`);
      console.log(`  block:  ${r.block}`);
      console.log(`  depth:  $${r.depth.toFixed(2)}`);
      console.log(`  price:  $${r.price.toFixed(6)}`);
      // Find their Mint details
      const mint = parsedMints.find(m => m.owner === r.owner && m.block === r.block);
      if (mint) {
        console.log(`  ticks:  [${mint.tickLower}, ${mint.tickUpper}]  width=${mint.tickWidth}`);
        console.log(`  amount: ${mint.amount0.toFixed(4)} ARB  /  ${mint.amount1.toFixed(4)} USDC`);
      }
    }
  }

  // Also report depths around the profitable block specifically
  console.log('\n' + LINE);
  console.log(`  DEPTH AT KNOWN PROFITABLE BLOCK (${PROFITABLE_BLOCK})`);
  console.log('  ' + DIV);
  try {
    const snap = await readDepthAt(PROFITABLE_BLOCK, rpc);
    console.log(`  depth=$${snap.depth.toFixed(2)}  price=$${snap.price.toFixed(6)}`);
    if (snap.depth >= 15000) console.log('  ★ EXECUTION-GRADE confirmed at this block');
  } catch (e) {
    console.log(`  error: ${e.message}`);
  }

  console.log('\n' + LINE + '\n');
}

main().catch(err => {
  console.error('\n[FATAL]', err.message || err);
  process.exit(1);
});
