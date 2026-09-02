// scripts/execution/dry_execution_engine.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Dry Execution Engine (Phase 1)
//
// For each v2-realistic survivor signal: calls callStatic.executeRamsesArb()
// on the deployed AllMightRamsesExecutor contract. No broadcast. No private key.
//
// Three layers of truth:
//   v1 shadow  → "this SHOULD work" (opportunity upper bound)
//   v2 shadow  → "this SHOULD work" (friction-adjusted)
//   dry engine → "this WILL work"  (chain-confirmed via callStatic)
//
// Both v2 AND dry engine must agree before live execution is considered.
//
// Usage:
//   node scripts/execution/dry_execution_engine.js
//   node scripts/execution/dry_execution_engine.js --session logs/sessions/session_X
//   node scripts/execution/dry_execution_engine.js --limit 10   (test first N signals)
//   node scripts/execution/dry_execution_engine.js --json
//
// Outputs:
//   logs/sessions/<session>/shadow_dryrun_ledger.jsonl
//   logs/sessions/<session>/shadow_dryrun_totals.json
//
// FAIL-SOFT: if contract not deployed, RPC fails, or callStatic fails globally
//   → prints "dry run unavailable", writes empty totals, exits 0
//
// NO BROADCAST. NO PRIVATE KEY. READ-ONLY CHAIN INTERACTION.
// ════════════════════════════════════════════════════════════════════════════

'use strict';

// dotenv loaded externally via -r dotenv/config in start_all.sh
// or source .env before running directly

const fs   = require('fs');
const { dryAdmissionFilter } = require('../../utils/admission_gate');
const path = require('path');
const { ethers } = require('ethers');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

// Executor contract — deployed and fork-tested (no live deploy yet)
// Address populated when live deployment is approved by Boss.
// Until then, callStatic will fail cleanly (FAIL-SOFT handles it).
const EXECUTOR_ADDRESS = process.env.EXECUTOR_ADDRESS ?? '';
let   OWNER_ADDRESS    = null;  // Boss G2.9: populated in preflight via contract.owner() — INCIDENT 020

// Contract parameters — confirmed from blueprint analysis
const USDC    = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const BORROW_AMOUNT_USDC = BigInt(200e6);           // $200 in USDC (6 dec)
const DIRECTION_RAMSES_FIRST = 0;
const MIN_PROFIT_WEI = 1n;                          // 1 wei — mechanics check, not profit gate
const SLIPPAGE_BUFFER = 0.95;                        // 5% slippage tolerance for amountOutMin

// ABI — minimal subset needed for callStatic
const EXECUTOR_ABI = [
  'function executeRamsesArb(address borrowAsset, uint256 amount, uint256 minProfit, uint256 amountOutMinA, uint256 amountOutMinB, uint8 direction, uint256 deadline) external',
  'function USDC() view returns (address)',
  'function owner() view returns (address)',
];

const LOGS_DIR    = path.resolve(process.cwd(), 'logs');
const JSON_MODE   = process.argv.includes('--json');
const SESSION_IDX = process.argv.indexOf('--session');
const LIMIT_IDX   = process.argv.indexOf('--limit');
const SIGNAL_LIMIT = LIMIT_IDX !== -1 ? parseInt(process.argv[LIMIT_IDX + 1]) : Infinity;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getSessionDir() {
  if (SESSION_IDX !== -1) return path.resolve(process.argv[SESSION_IDX + 1]);
  const ptr = path.join(LOGS_DIR, 'allmight.session');
  if (!fs.existsSync(ptr)) return null;
  return path.join(LOGS_DIR, 'sessions', `session_${fs.readFileSync(ptr,'utf8').trim()}`);
}

function buildProvider() {
  const rpc = process.env.ARBITRUM_MAINNET_RPC_URL_2
    || process.env.ARBITRUM_MAINNET_RPC_URL_1;
  if (!rpc) return null;
  try { return new ethers.JsonRpcProvider(rpc); } catch { return null; }
}

// Compute amountOutMin for each leg from blueprint safety fields (5% below expected)
function computeAmountOutMins(signal, bp) {
  // Leg A: borrow USDC → swap on Ramses → get WETH
  // Leg B: WETH → swap on UniV3 → get USDC (repay Aave + profit)
  const safety = bp?.safety ?? {};
  const sizing = bp?.sizing ?? {};

  // minOutEntry = min WETH expected from Ramses swap (18 dec)
  const minWeth = safety.minOutEntry
    ? BigInt(Math.floor(safety.minOutEntry * SLIPPAGE_BUFFER * 1e18))
    : BigInt(Math.floor(sizing.baseTokenAmount * SLIPPAGE_BUFFER * 1e18));

  // minOutExit = min USDC expected from UniV3 swap (6 dec)
  const minUsdc = safety.minOutExit
    ? BigInt(Math.floor(safety.minOutExit * SLIPPAGE_BUFFER * 1e6))
    : BORROW_AMOUNT_USDC;  // fallback: at minimum get back what we borrowed

  return { amountOutMinA: minWeth, amountOutMinB: minUsdc };
}

// ─── SINGLE-SIGNAL DRY RUN ────────────────────────────────────────────────────

async function dryRunSignal(signal, blueprint, contract, ethPrice) {
  const ts      = new Date().toISOString();
  const signalId = signal.signalId;
  const spreadBps = signal.spreadBps ?? 0;
  const realisticNet = signal.realisticNetUsd ?? signal.estimatedNetUsd ?? 0;

  const { amountOutMinA, amountOutMinB } = computeAmountOutMins(signal, blueprint);

  // deadline = current block time + 60s (will be refreshed in callStatic context)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 60);

  let wouldExecute = false;
  let revertReason = null;
  let gasEstimate  = null;
  let gasCostUsd   = null;

  try {
    // 1. callStatic — simulates full execution path, no broadcast
    await contract.executeRamsesArb.staticCall(
      USDC,
      BORROW_AMOUNT_USDC,
      MIN_PROFIT_WEI,
      amountOutMinA,
      amountOutMinB,
      DIRECTION_RAMSES_FIRST,
      deadline,
      { from: OWNER_ADDRESS }
    );
    wouldExecute = true;

    // 2. Gas estimate — only if callStatic passed
    try {
      const gas = await contract.executeRamsesArb.estimateGas(
        USDC, BORROW_AMOUNT_USDC, MIN_PROFIT_WEI,
        amountOutMinA, amountOutMinB, DIRECTION_RAMSES_FIRST, deadline,
        { from: OWNER_ADDRESS }
      );
      gasEstimate = Number(gas);
      // Gas price from recent network conditions (approx)
      const feeData = await contract.runner.provider.getFeeData();
      const gasPrice = Number(feeData.gasPrice ?? 20000000n); // fallback 0.02 gwei
      gasCostUsd = (gasEstimate * gasPrice * 1e-9) * ethPrice;
    } catch { /* gas estimate fail-soft */ }

  } catch (err) {
    wouldExecute = false;
    // Extract revert reason cleanly
    const msg = err.message ?? String(err);
    const reasonMatch = msg.match(/"([A-Z_]{4,30})"/);
    revertReason = reasonMatch?.[1]
      ?? (msg.includes('INSUFFICIENT_PROFIT')  ? 'INSUFFICIENT_PROFIT'
        : msg.includes('RAMSES_SLIPPAGE')      ? 'RAMSES_SLIPPAGE'
        : msg.includes('DEADLINE_EXPIRED')     ? 'DEADLINE_EXPIRED'
        : msg.includes('ONLY_USDC')            ? 'ONLY_USDC_SUPPORTED'
        : msg.includes('execution reverted')   ? 'EXECUTION_REVERTED'
        : msg.includes('missing revert data')  ? 'CONTRACT_NOT_DEPLOYED'
        : msg.includes('could not decode')     ? 'CONTRACT_NOT_DEPLOYED'
        : 'UNKNOWN_REVERT');
  }

  // expectedNetUsd: v2 realistic estimate adjusted for actual gas cost
  const expectedNetUsd = gasCostUsd != null
    ? realisticNet - (gasCostUsd - (signal.opportunityGasUsd ?? 0.028)) // replace estimated gas with real
    : realisticNet;

  return {
    ts,
    signalId,
    spreadBps,
    v2RealisticNetUsd : +realisticNet.toFixed(4),
    wouldExecute,
    revertReason,
    gasEstimate,
    gasCostUsd        : gasCostUsd != null ? +gasCostUsd.toFixed(4) : null,
    expectedNetUsd    : +expectedNetUsd.toFixed(4),
    passesDryRun      : wouldExecute,
    // Params used
    params: {
      borrowAsset    : USDC,
      amount         : BORROW_AMOUNT_USDC.toString(),
      amountOutMinA  : amountOutMinA.toString(),
      amountOutMinB  : amountOutMinB.toString(),
      direction      : DIRECTION_RAMSES_FIRST,
      minProfit      : MIN_PROFIT_WEI.toString(),
    },
  };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const sessionDir = getSessionDir();
  if (!sessionDir || !fs.existsSync(sessionDir)) {
    console.log('dry run unavailable — session directory not found');
    process.exit(0);
  }

  const sessionId  = path.basename(sessionDir).replace('session_', '');
  const ledgerPath = path.join(sessionDir, 'shadow_dryrun_ledger.jsonl');
  const totalsPath = path.join(sessionDir, 'shadow_dryrun_totals.json');

  // Load candidate signals from v2 ledger (realistic survivors only)
  const v2Ledger   = readJsonl(path.join(sessionDir, 'shadow_execution_ledger_v2.jsonl'));
  // ── S3: SHARED EXECUTION-MODEL ADMISSION (Boss C9) ─────────────────────
  // realisticSurvives remains NECESSARY; it is no longer SUFFICIENT.
  // The shared filter applies the DRY_EXECUTION boundary policy:
  //   legacy / unversioned rows  → DIAGNOSTIC_ONLY, pass through unchanged
  //                                (so this wiring is safe before S0 lands)
  //   exec_faithful_v1 rows      → executability enforced
  //   unknown modelVersion       → fails closed
  // This is SUBTRACTIVE: it can only remove rows from the survivor set.
  // It does NOT recompute executability — the v2 ledger remains the sole
  // authority for that evidence.
  const survivors  = dryAdmissionFilter(v2Ledger.filter(r => r.realisticSurvives === true));

  // Blueprint lookup for amountOutMin computation
  const bpLines    = readJsonl(path.join(sessionDir, 'blueprints.jsonl'));
  const bpByBlock  = {};
  for (const bp of bpLines) {
    const block = String(bp.signalBlock ?? '');
    if (block) bpByBlock[block] = bp;
  }

  const unavailableTotals = (reason) => {
    const t = {
      generatedAt: new Date().toISOString(), sessionId,
      available: false, unavailableReason: reason,
      totalSignals: survivors.length, attempted: 0,
      wouldExecuteCount: 0, wouldRevertCount: 0,
      executionSuccessRate: null, avgGasCostUsd: null,
      expectedExecutablePnL: 0, expectedRejectedPnL: 0,
      topRevertReasons: {},
    };
    fs.writeFileSync(totalsPath, JSON.stringify(t, null, 2));
    if (JSON_MODE) { console.log(JSON.stringify(t, null, 2)); }
    else { console.log(`  dry run unavailable — ${reason}`); }
    process.exit(0);  // always exit 0 — never crash stop pipeline
  };

  // ── Preflight checks ──────────────────────────────────────────────────────
  if (survivors.length === 0) {
    unavailableTotals('no v2 realistic survivors — run shadow_execution_engine_v2.js first');
    process.exit(0);
  }

  if (!EXECUTOR_ADDRESS) {
    unavailableTotals('EXECUTOR_ADDRESS not set — contract not yet deployed (Boss approval required)');
    process.exit(0);
  }

  const provider = buildProvider();
  if (!provider) {
    unavailableTotals('RPC not configured — check ARBITRUM_MAINNET_RPC_URL_1 or _2 in .env');
    process.exit(0);
  }

  // Verify contract exists
  let contract;
  try {
    const code = await provider.getCode(EXECUTOR_ADDRESS);
    if (code === '0x') {
      unavailableTotals(`contract at ${EXECUTOR_ADDRESS} has no bytecode — not deployed`);
      process.exit(0);
    }
    contract = new ethers.Contract(EXECUTOR_ADDRESS, EXECUTOR_ABI, provider);
    // Verify it's the right contract
    await contract.USDC();
    OWNER_ADDRESS = await contract.owner();  // Boss G2.9: needed for staticCall from-override (INCIDENT 020)
  } catch (e) {
    unavailableTotals(`contract preflight failed: ${e.message?.slice(0, 60)}`);
    process.exit(0);
  }

  // Get ETH price for gas cost computation
  let ethPrice = 2300;
  try {
    const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
    // rough price from recent signal data
    const recentSignal = v2Ledger.find(r => r.opportunityGasUsd && r.theoreticalSizeUsd);
    if (recentSignal) {
      // gas = gasUnits × gasGwei × 1e-9 × ethPrice → ethPrice = gas / (units × gwei × 1e-9)
      // Use $2300 as fallback — close enough for gas estimates
      ethPrice = 2300;
    }
  } catch { /* fallback */ }

  // ── Run dry simulations ───────────────────────────────────────────────────
  const candidates = survivors.slice(0, SIGNAL_LIMIT);
  const results    = [];
  const revertCounts = {};

  if (!JSON_MODE) {
    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  AllMight — Dry Execution Engine`);
    console.log(`  Session: ${sessionId}`);
    console.log(`  Contract: ${EXECUTOR_ADDRESS}`);
    console.log(`  Candidates: ${candidates.length} v2 survivors`);
    console.log('───────────────────────────────────────────────────────');
  }

  for (let i = 0; i < candidates.length; i++) {
    const signal    = candidates[i];
    const block     = String(signal.signalId ?? '').split('-').pop();
    const blueprint = bpByBlock[block] ?? null;

    let result;
    try {
      result = await dryRunSignal(signal, blueprint, contract, ethPrice);
    } catch (e) {
      // Per-signal fail-soft
      result = {
        ts: new Date().toISOString(), signalId: signal.signalId,
        spreadBps: signal.spreadBps, v2RealisticNetUsd: signal.realisticNetUsd ?? 0,
        wouldExecute: false, revertReason: 'DRY_RUN_ERROR',
        gasEstimate: null, gasCostUsd: null, expectedNetUsd: 0, passesDryRun: false,
        params: {},
      };
    }

    results.push(result);

    if (result.revertReason) {
      revertCounts[result.revertReason] = (revertCounts[result.revertReason] ?? 0) + 1;
    }

    const icon = result.wouldExecute ? '✅' : '❌';
    if (!JSON_MODE) {
      console.log(`  ${icon} ${signal.spreadBps?.toFixed(1)}bps → ` +
        `${result.wouldExecute ? 'WOULD_EXECUTE' : result.revertReason} ` +
        `gas=${result.gasEstimate ?? 'N/A'} net=$${result.expectedNetUsd}`);
    }

    // Small delay between calls — respect RPC rate limits
    if (i < candidates.length - 1) await new Promise(r => setTimeout(r, 200));
  }

  // Write ledger
  fs.writeFileSync(ledgerPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');

  // ── Build totals ──────────────────────────────────────────────────────────
  const wouldExecute   = results.filter(r => r.wouldExecute);
  const wouldRevert    = results.filter(r => !r.wouldExecute);
  const gasValues      = results.filter(r => r.gasCostUsd != null).map(r => r.gasCostUsd);
  const executablePnL  = wouldExecute.reduce((s, r) => s + Math.max(0, r.expectedNetUsd), 0);
  const rejectedPnL    = wouldRevert.reduce((s, r) => s + Math.max(0, r.v2RealisticNetUsd), 0);

  const totals = {
    generatedAt         : new Date().toISOString(),
    sessionId,
    available           : true,
    contractAddress     : EXECUTOR_ADDRESS,
    totalSignals        : survivors.length,
    attempted           : results.length,
    wouldExecuteCount   : wouldExecute.length,
    wouldRevertCount    : wouldRevert.length,
    executionSuccessRate: results.length > 0
      ? +(wouldExecute.length / results.length * 100).toFixed(1) : null,
    avgGasCostUsd       : gasValues.length > 0
      ? +(gasValues.reduce((a,b) => a+b,0) / gasValues.length).toFixed(4) : null,
    expectedExecutablePnL : +executablePnL.toFixed(4),
    expectedRejectedPnL   : +rejectedPnL.toFixed(4),
    topRevertReasons      : Object.fromEntries(
      Object.entries(revertCounts).sort((a,b) => b[1]-a[1])
    ),
  };

  fs.writeFileSync(totalsPath, JSON.stringify(totals, null, 2));

  if (JSON_MODE) { console.log(JSON.stringify(totals, null, 2)); return; }

  // ── Human-readable summary ────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Would execute:    ${wouldExecute.length} / ${results.length}`);
  console.log(`  Would revert:     ${wouldRevert.length} / ${results.length}`);
  console.log(`  Success rate:     ${totals.executionSuccessRate}%`);
  console.log(`  Avg gas cost:     $${totals.avgGasCostUsd ?? 'N/A'}`);
  console.log(`  Executable PnL:   $${totals.expectedExecutablePnL}`);
  console.log(`  Rejected PnL:     $${totals.expectedRejectedPnL}`);
  if (Object.keys(revertCounts).length > 0) {
    console.log('  Top revert reasons:');
    for (const [r, c] of Object.entries(totals.topRevertReasons)) {
      console.log(`    ${c}× ${r}`);
    }
  }
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Ledger: ${ledgerPath}`);
  console.log(`  Totals: ${totalsPath}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(e => {
  // Top-level fail-soft — never crash the stop pipeline
  console.log(`dry run unavailable — ${e.message?.slice(0, 80)}`);
  process.exit(0);
});
