// scripts/execution/dry_execution_fork_runner.js
// ════════════════════════════════════════════════════════════════════════════
// AllMight — Dry Execution Fork Runner
//
// Deploys AllMightRamsesExecutor to a local Hardhat fork of Arbitrum mainnet,
// then runs callStatic.executeRamsesArb() against real session signals.
//
// This is the bridge between:
//   v2 shadow → "this SHOULD work" (friction-adjusted estimate)
//   fork dry run → "this WILL work" (chain-confirmed, no live deploy)
//
// No live deploy. No private key used for execution. No broadcast.
// Hardhat fork = real chain state, deterministic, safe.
//
// Usage (run from ~/Allmight):
//   npx hardhat run scripts/execution/dry_execution_fork_runner.js --network hardhat
//   npx hardhat run scripts/execution/dry_execution_fork_runner.js --network hardhat 2>&1 | tee logs/dry_run_$(date +%Y%m%d_%H%M).txt
//
// To specify session:
//   SESSION_ID=20260428_2329 npx hardhat run scripts/execution/dry_execution_fork_runner.js --network hardhat
//
// Outputs:
//   logs/sessions/<session>/shadow_dryrun_ledger.jsonl
//   logs/sessions/<session>/shadow_dryrun_totals.json
//
// FAIL-SOFT: any error → clean exit, writes unavailable totals
// ════════════════════════════════════════════════════════════════════════════

'use strict';

const fs   = require('fs');
const path = require('path');
const { ethers } = require('hardhat');

// ─── ADDRESSES (verified on-chain, preflight 16/16) ──────────────────────────
const ADDR = {
  aavePool   : '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  uniV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  ramsesPool : '0x30AFBcF9458c3131A6d051C621E307E6278E4110',
  WETH       : '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  USDC       : '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  usdcWhale  : '0x625e7708f30ca75bfd92586e17077590c60eb4cd', // Aave aUSDC — confirmed
};

// ─── EXECUTION PARAMS ────────────────────────────────────────────────────────
const BORROW_USDC     = BigInt(200e6);   // $200 USDC (6 dec)
const DIRECTION       = 0;               // DIRECTION_RAMSES_FIRST (confirmed profitable)
const MIN_PROFIT_WEI  = 1n;             // minimal — mechanics check not profit gate
const SLIPPAGE_BUFFER = 0.95;           // 5% below blueprint expected output

// ─── SESSION RESOLUTION ──────────────────────────────────────────────────────
const LOGS_DIR = path.resolve(process.cwd(), 'logs');

function resolveSession() {
  // Override via env: SESSION_ID=20260428_2329
  if (process.env.SESSION_ID) {
    return path.join(LOGS_DIR, 'sessions', `session_${process.env.SESSION_ID}`);
  }
  const ptr = path.join(LOGS_DIR, 'allmight.session');
  if (!fs.existsSync(ptr)) return null;
  const sid = fs.readFileSync(ptr, 'utf8').trim();
  return path.join(LOGS_DIR, 'sessions', `session_${sid}`);
}

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeUnavailable(totalsPath, sessionId, reason, candidateCount) {
  const t = {
    generatedAt: new Date().toISOString(), sessionId, available: false,
    unavailableReason: reason, totalSignals: candidateCount, attempted: 0,
    wouldExecuteCount: 0, wouldRevertCount: 0, executionSuccessRate: null,
    avgGasCostUsd: null, expectedExecutablePnL: 0, expectedRejectedPnL: 0,
    topRevertReasons: {},
  };
  fs.writeFileSync(totalsPath, JSON.stringify(t, null, 2));
  console.log(`  dry run unavailable — ${reason}`);
  return t;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AllMight — Dry Execution Fork Runner');
  console.log(`  Block: ${await ethers.provider.getBlockNumber()}`);

  // ── Session ───────────────────────────────────────────────────────────────
  const sessionDir = resolveSession();
  if (!sessionDir || !fs.existsSync(sessionDir)) {
    console.log('  ERROR: session directory not found');
    console.log('  Set SESSION_ID=YYYYMMDD_HHMM or start a session first');
    return;
  }
  const sessionId  = path.basename(sessionDir).replace('session_', '');
  const ledgerPath = path.join(sessionDir, 'shadow_dryrun_ledger.jsonl');
  const totalsPath = path.join(sessionDir, 'shadow_dryrun_totals.json');
  console.log(`  Session: ${sessionId}`);

  // ── Load v2 survivors ─────────────────────────────────────────────────────
  const v2Ledger   = readJsonl(path.join(sessionDir, 'shadow_execution_ledger_v2.jsonl'));
  const survivors  = v2Ledger.filter(r => r.realisticSurvives === true);

  if (survivors.length === 0) {
    writeUnavailable(totalsPath, sessionId,
      'no v2 realistic survivors — run shadow_execution_engine_v2.js first', 0);
    return;
  }
  console.log(`  Candidates: ${survivors.length} v2 survivors (of ${v2Ledger.length} total)`);

  // ── Blueprint lookup for amountOutMin ────────────────────────────────────
  const bpLines  = readJsonl(path.join(sessionDir, 'blueprints.jsonl'));
  const bpByBlock = {};
  for (const bp of bpLines) {
    const block = String(bp.signalBlock ?? '');
    if (block) bpByBlock[block] = bp;
  }

  // ── Deploy executor to fork ───────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────');
  console.log('  Deploying executor to fork...');

  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();

  // Fund executor for Aave premium buffer (0.05% × $200 = $0.10 ≈ 0.00004 ETH)
  await ethers.provider.send('hardhat_setBalance', [deployerAddr, '0x56BC75E2D63100000']);

  let executor;
  try {
    const Factory = await ethers.getContractFactory('AllMightRamsesExecutor');
    executor = await Factory.deploy(
      ADDR.aavePool, ADDR.uniV3Router, ADDR.ramsesPool,
      ADDR.WETH, ADDR.USDC, deployerAddr
    );
    await executor.waitForDeployment();
    const execAddr = await executor.getAddress();
    console.log(`  Executor deployed: ${execAddr}`);
  } catch (e) {
    writeUnavailable(totalsPath, sessionId,
      `deploy failed: ${e.message?.slice(0, 80)}`, survivors.length);
    return;
  }

  // Fund executor with USDC for Aave flash loan premium
  // Premium = 0.05% of $200 = $0.10 = 100000 USDC units
  try {
    await ethers.provider.send('hardhat_impersonateAccount', [ADDR.usdcWhale]);
    await ethers.provider.send('hardhat_setBalance', [ADDR.usdcWhale, '0x56BC75E2D63100000']);
    const whaleSigner = await ethers.provider.getSigner(ADDR.usdcWhale);
    const USDC = new ethers.Contract(ADDR.USDC, ['function transfer(address,uint256) returns(bool)'], whaleSigner);
    const execAddr = await executor.getAddress();
    await USDC.transfer(execAddr, BigInt(50e6)); // $50 USDC buffer
    await ethers.provider.send('hardhat_stopImpersonatingAccount', [ADDR.usdcWhale]);
    console.log('  Executor funded: $50 USDC buffer');
  } catch (e) {
    console.log(`  WARNING: could not fund executor — ${e.message?.slice(0,60)}`);
    console.log('  (some signals may fail with INSUFFICIENT_PROFIT due to premium)');
  }

  // ── Run callStatic per signal ────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────');

  const results      = [];
  const revertCounts = {};
  let gasValues      = [];

  for (const signal of survivors) {
    const block     = String(signal.signalId ?? '').split('-').pop();
    const bp        = bpByBlock[block] ?? null;
    const safety    = bp?.safety ?? {};
    const sizing    = bp?.sizing ?? {};
    const realisticNet = signal.realisticNetUsd ?? 0;

    // amountOutMin — 5% slippage from blueprint safety fields
    const amountOutMinA = safety.minOutEntry
      ? BigInt(Math.floor(safety.minOutEntry * SLIPPAGE_BUFFER * 1e18))
      : BigInt(Math.floor((sizing.baseTokenAmount ?? 0.08) * SLIPPAGE_BUFFER * 1e18));

    const amountOutMinB = safety.minOutExit
      ? BigInt(Math.floor(safety.minOutExit * SLIPPAGE_BUFFER * 1e6))
      : BORROW_USDC;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 120);

    let wouldExecute = false;
    let revertReason = null;
    let gasEstimate  = null;
    let gasCostUsd   = null;

    try {
      // callStatic — full execution simulation, no broadcast
      await executor.executeRamsesArb.staticCall(
        ADDR.USDC, BORROW_USDC, MIN_PROFIT_WEI,
        amountOutMinA, amountOutMinB, DIRECTION, deadline
      );
      wouldExecute = true;

      // Gas estimate on passing signals
      try {
        const gas = await executor.executeRamsesArb.estimateGas(
          ADDR.USDC, BORROW_USDC, MIN_PROFIT_WEI,
          amountOutMinA, amountOutMinB, DIRECTION, deadline
        );
        gasEstimate = Number(gas);
        const feeData = await ethers.provider.getFeeData();
        const gwei    = Number(feeData.gasPrice ?? 20000000n);
        gasCostUsd    = gasEstimate * gwei * 1e-9 * 2300; // ETH ~$2300
        gasValues.push(gasCostUsd);
      } catch { /* gas estimation is best-effort */ }

    } catch (err) {
      wouldExecute = false;
      const msg = err.message ?? String(err);
      revertReason =
        msg.includes('INSUFFICIENT_PROFIT')  ? 'INSUFFICIENT_PROFIT'  :
        msg.includes('RAMSES_SLIPPAGE')      ? 'RAMSES_SLIPPAGE'      :
        msg.includes('ONLY_USDC_SUPPORTED')  ? 'ONLY_USDC_SUPPORTED'  :
        msg.includes('DEADLINE_EXPIRED')     ? 'DEADLINE_EXPIRED'     :
        msg.includes('BAD_RAMSES_CALLBACK')  ? 'BAD_RAMSES_CALLBACK'  :
        msg.includes('CALLER_NOT_AAVE_POOL') ? 'CALLER_NOT_AAVE_POOL' :
        msg.includes('REENTRANT')            ? 'REENTRANT'            :
        'EXECUTION_REVERTED';
    }

    revertCounts[revertReason ?? 'none'] = (revertCounts[revertReason ?? 'none'] ?? 0) + 1;

    const expectedNetUsd = gasCostUsd != null
      ? realisticNet - (gasCostUsd - 0.028) : realisticNet;

    const rec = {
      ts: new Date().toISOString(), signalId: signal.signalId,
      spreadBps: signal.spreadBps, v2RealisticNetUsd: +realisticNet.toFixed(4),
      wouldExecute, revertReason,
      gasEstimate, gasCostUsd: gasCostUsd != null ? +gasCostUsd.toFixed(4) : null,
      expectedNetUsd: +expectedNetUsd.toFixed(4),
      passesDryRun: wouldExecute,
    };
    results.push(rec);

    const icon = wouldExecute ? '✅' : '❌';
    console.log(
      `  ${icon} ${signal.spreadBps?.toFixed(1).padStart(5)}bps ` +
      `${wouldExecute ? 'WOULD_EXECUTE' : revertReason?.padEnd(22)} ` +
      `${gasEstimate ? `gas=${gasEstimate}` : '          '} ` +
      `net=$${expectedNetUsd.toFixed(3)}`
    );
  }

  // ── Write ledger ──────────────────────────────────────────────────────────
  fs.writeFileSync(ledgerPath, results.map(r => JSON.stringify(r)).join('\n') + '\n');

  // ── Totals ────────────────────────────────────────────────────────────────
  const wouldExecute  = results.filter(r => r.wouldExecute);
  const wouldRevert   = results.filter(r => !r.wouldExecute);
  const execPnL       = wouldExecute.reduce((s, r) => s + Math.max(0, r.expectedNetUsd), 0);
  const rejPnL        = wouldRevert.reduce((s, r) => s + Math.max(0, r.v2RealisticNetUsd), 0);
  const avgGas        = gasValues.length > 0
    ? gasValues.reduce((a,b) => a+b,0) / gasValues.length : null;

  const totals = {
    generatedAt          : new Date().toISOString(),
    sessionId, available : true,
    forkBlock            : await ethers.provider.getBlockNumber(),
    totalSignals         : survivors.length,
    attempted            : results.length,
    wouldExecuteCount    : wouldExecute.length,
    wouldRevertCount     : wouldRevert.length,
    executionSuccessRate : results.length > 0
      ? +(wouldExecute.length / results.length * 100).toFixed(1) : null,
    avgGasCostUsd        : avgGas != null ? +avgGas.toFixed(4) : null,
    expectedExecutablePnL: +execPnL.toFixed(4),
    expectedRejectedPnL  : +rejPnL.toFixed(4),
    topRevertReasons     : Object.fromEntries(
      Object.entries(revertCounts)
        .filter(([k]) => k !== 'none')
        .sort((a,b) => b[1]-a[1])
    ),
    // Boss readiness gate — Boss must still approve deploy regardless of score
    readinessAssessment  : totals => totals,  // computed below after object created
  };

  // Readiness assessment (computed after object)
  const sr = totals.executionSuccessRate;
  totals.readinessAssessment =
    sr == null ? 'INSUFFICIENT_DATA'
    : sr >= 80 ? 'STRONG — supports deploy consideration (Boss approval still required)'
    : sr >= 70 ? 'ACCEPTABLE — review revert reasons before deploy'
    : sr >= 50 ? 'MARGINAL — understand reverts, do not deploy yet'
    :            'WEAK — investigate failures before deployment';

  fs.writeFileSync(totalsPath, JSON.stringify(totals, null, 2));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Would execute:     ${wouldExecute.length} / ${results.length}`);
  console.log(`  Success rate:      ${totals.executionSuccessRate}%`);
  console.log(`  Avg gas cost:      $${totals.avgGasCostUsd ?? 'N/A'}`);
  console.log(`  Executable PnL:    $${totals.expectedExecutablePnL}`);
  if (Object.keys(totals.topRevertReasons).length > 0) {
    console.log('  Revert reasons:');
    for (const [r, c] of Object.entries(totals.topRevertReasons)) {
      console.log(`    ${String(c).padStart(4)}×  ${r}`);
    }
  }
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Readiness: ${totals.readinessAssessment}`);
  console.log(`  Ledger: ${ledgerPath}`);
  console.log(`  Totals: ${totalsPath}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch(e => {
  console.log(`dry run fork failed — ${e.message?.slice(0, 100)}`);
  process.exit(0);
});
