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
// Load .env before reading any env vars — 'npx hardhat run' does not auto-load dotenv.
// This ensures ARBITRUM_MAINNET_RPC_URL_* are available even without shell export.
try { require('dotenv').config(); } catch { /* dotenv optional — shell exports work too */ }
const hre = require('hardhat');
const { ethers } = hre;

// ─── ADDRESSES (verified on-chain, preflight 16/16) ──────────────────────────
const ADDR = {
  aavePool   : '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  uniV3Router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  ramsesPool : '0x30AFBcF9458c3131A6d051C621E307E6278E4110',
  WETH       : '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  USDC       : '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  // EOA whales — ordered by likelihood of having native USDC at any Arbitrum block
  // Fallback is storage slot injection which always works
  usdcWhales : [
    '0xB38e8c17e38363aF6EbdCb3dAE12e0243582891D', // Binance hot wallet (Arbitrum)
    '0x096760F208390250649E3e8763348E783AEF5562', // Arbitrum One L2 bridge
    '0xF977814e90dA44bFA03b6295A0616a897441aceC', // Binance cold wallet
    '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf', // Arbitrum L1 gateway
  ],
};

// ─── USDC FUNDING HELPER ─────────────────────────────────────────────────────
// Funds executor with $50 USDC using three methods in fallback order:
//   1. Impersonate known EOA whale and transfer
//   2. hardhat_setStorageAt (directly write balance slot) — always works
//   3. Fail closed — do NOT proceed with unfunded executor
//
// Circle USDC (FiatTokenV2_2) stores balances at:
//   slot = keccak256(abi.encode(address, 9))   where 9 = balances mapping slot
async function fundExecutor(execAddr) {
  const USDC_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
  ];
  const usdc = new ethers.Contract(ADDR.USDC, USDC_ABI, ethers.provider);
  const TARGET = BigInt(50e6); // $50 USDC

  // ── Method 1: whale transfer ──────────────────────────────────────────────
  for (const whale of ADDR.usdcWhales) {
    try {
      await ethers.provider.send('hardhat_setBalance', [whale, '0x56BC75E2D63100000']);
      await ethers.provider.send('hardhat_impersonateAccount', [whale]);
      const whaleSig = await ethers.provider.getSigner(whale);
      const usdcW    = new ethers.Contract(ADDR.USDC, USDC_ABI, whaleSig);
      const whaleBal = await usdc.balanceOf(whale);
      if (whaleBal < TARGET) {
        await ethers.provider.send('hardhat_stopImpersonatingAccount', [whale]);
        continue; // this whale is dry at this block — try next
      }
      await usdcW.transfer(execAddr, TARGET);
      await ethers.provider.send('hardhat_stopImpersonatingAccount', [whale]);
      const bal = await usdc.balanceOf(execAddr);
      if (bal >= TARGET) return { method: 'whale_transfer', whale, balance: bal.toString() };
    } catch {
      try { await ethers.provider.send('hardhat_stopImpersonatingAccount', [whale]); } catch {}
    }
  }

  // ── Method 2: storage slot injection ─────────────────────────────────────
  // Circle USDC balances mapping at slot 9 in implementation storage
  // For upgradeable proxy: storage lives in proxy, slot = keccak256(addr ++ 9)
  try {
    const slot = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256'], [execAddr, 9]
      )
    );
    await ethers.provider.send('hardhat_setStorageAt', [
      ADDR.USDC,
      slot,
      ethers.zeroPadValue(ethers.toBeHex(TARGET), 32),
    ]);
    const bal = await usdc.balanceOf(execAddr);
    if (bal >= TARGET) return { method: 'storage_set', slot, balance: bal.toString() };
  } catch (storageErr) {
    // storage slot method failed — log but continue to fail path
  }

  // ── Method 3: fail closed ─────────────────────────────────────────────────
  const finalBal = await usdc.balanceOf(execAddr);
  return { method: 'failed', balance: finalBal.toString() };
}

// ─── EXECUTION PARAMS ────────────────────────────────────────────────────────
const BORROW_USDC     = BigInt(200e6);   // $200 USDC (6 dec)

// ─── RUNTIME CONFIG ───────────────────────────────────────────────────────────
// Set HARDHAT_FORK_RPC_URL to Tenderly/Alchemy to avoid Infura 429 rate limits.
// Infura is cheap but has tight archive rate limits — use it as last fallback.
const ETH_USD = Number(process.env.ETH_USD || 2300);
// GAS_PRICE_GWEI: use live network estimate, NOT getFeeData() on historical fork.
// Historical fork baseFee (~1 gwei at April 2026 Arbitrum blocks) inflates cost 50x.
// Live Arbitrum: ~0.02 gwei. Conservative buffer: 0.05 gwei.
const GAS_PRICE_GWEI = Number(process.env.GAS_PRICE_GWEI || 0.05);
const FORK_RPC_URL =
  process.env.HARDHAT_FORK_RPC_URL           // highest priority — set to Tenderly
  ?? process.env.ARBITRUM_MAINNET_RPC_URL_1  // Tenderly (primary slot)
  ?? process.env.ARBITRUM_MAINNET_RPC_URL_2  // Infura (last resort — rate-limited)
  ?? '';

// Guard: fail immediately if no RPC URL — ethers throws "relative URL without a base"
// without this check, all 5 signals fail silently with FORK_RESET_FAILED
if (!FORK_RPC_URL) {
  console.error('');
  console.error('  ❌ ERROR: No RPC URL configured.');
  console.error('  Set one of:');
  console.error('    export HARDHAT_FORK_RPC_URL=<your-tenderly-or-alchemy-url>');
  console.error('    or ensure ARBITRUM_MAINNET_RPC_URL_1 is set in .env');
  console.error('');
  process.exit(1);
}
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
  // Sort by spread descending — top signals first (highest spread = most likely to execute)
  let survivors = v2Ledger
    .filter(r => r.realisticSurvives === true)
    .sort((a, b) => (b.spreadBps ?? 0) - (a.spreadBps ?? 0));

  // SIGNAL_LIMIT env var — for trusted small-batch testing before full run
  // Boss directive: run top 5 first, verify funding, then scale up
  const SIGNAL_LIMIT = parseInt(process.env.SIGNAL_LIMIT || '0', 10);
  if (SIGNAL_LIMIT > 0) {
    survivors = survivors.slice(0, SIGNAL_LIMIT);
    console.log(`  SIGNAL_LIMIT=${SIGNAL_LIMIT} — testing top ${SIGNAL_LIMIT} signals by spread`);
  }

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
    // keep ref as _executor for initial signal; loop will re-deploy per block
    var _executor = executor;
  } catch (e) {
    writeUnavailable(totalsPath, sessionId,
      `deploy failed: ${e.message?.slice(0, 80)}`, survivors.length);
    return;
  }

  // Fund executor — FAIL CLOSED if funding fails
  const initialFunding = await fundExecutor(await executor.getAddress());
  if (initialFunding.method === 'failed') {
    writeUnavailable(totalsPath, sessionId,
      'executor USDC funding failed — DRY_RUN_UNTRUSTED, results would be polluted',
      survivors.length);
    console.error('  ❌ USDC funding failed. Dry run aborted — results untrusted.');
    console.error('  Fix: check whale addresses have USDC at fork block, or verify storage slot.');
    return;
  }
  console.log(`  Executor funded: $${Number(initialFunding.balance)/1e6} USDC (method=${initialFunding.method})`);

  // ── Run callStatic per signal ────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────');

  const results      = [];
  const revertCounts = {};
  let gasValues          = [];
  let forkResetFailedCount = 0;
  let fundedCount          = 0;
  let unfundedCount        = 0;

  executor = _executor; // reset to initial deploy before loop starts

  for (const signal of survivors) {
    const block     = String(signal.signalId ?? '').split('-').pop();
    const bp        = bpByBlock[block] ?? null;
    const safety    = bp?.safety ?? {};
    const sizing    = bp?.sizing ?? {};
    const realisticNet = signal.realisticNetUsd ?? 0;

    // ── Reset fork to signal's block ──────────────────────────────────────
    // Critical: spread exists at SIGNAL block, not at the pinned fork block.
    // Without reset, callStatic sees no spread → 100% INSUFFICIENT_PROFIT.
    if (block && !isNaN(parseInt(block))) {
      try {
        await hre.network.provider.send('hardhat_reset', [{
          forking: { jsonRpcUrl: FORK_RPC_URL, blockNumber: parseInt(block) },
        }]);
        const F2 = await ethers.getContractFactory('AllMightRamsesExecutor');
        executor = await F2.deploy(
          ADDR.aavePool, ADDR.uniV3Router, ADDR.ramsesPool,
          ADDR.WETH, ADDR.USDC, deployerAddr
        );
        await executor.waitForDeployment();
        // Re-fund after reset — FAIL CLOSED per signal if funding fails
        const funding = await fundExecutor(await executor.getAddress());
        if (funding.method === 'failed') {
          unfundedCount++;
          results.push({
            ts: new Date().toISOString(), signalId: signal.signalId,
            spreadBps: signal.spreadBps, v2RealisticNetUsd: realisticNet,
            wouldExecute: false, revertReason: 'FUNDING_FAILED',
            gasEstimate: null, gasCostUsd: null, expectedNetUsd: 0,
            passesDryRun: false, fundingMethod: 'failed', params: {},
          });
          revertCounts['FUNDING_FAILED'] = (revertCounts['FUNDING_FAILED'] ?? 0) + 1;
          console.log(`  ❌ [block ${block}] FUNDING_FAILED — skipping signal`);
          continue;
        }
        fundedCount++;
      } catch (resetErr) {
        forkResetFailedCount++;
        const msg = resetErr.message ?? '';
        // Classify RPC failure reason
        const resetReason =
          msg.includes('429') || msg.toLowerCase().includes('rate limit') ? 'RPC_RATE_LIMIT'
          : msg.includes('5') && msg.includes('Server Error')             ? 'RPC_SERVER_ERROR'
          : msg.includes('timeout') || msg.includes('ETIMEDOUT')          ? 'RPC_TIMEOUT'
          : 'FORK_RESET_FAILED';
        if (resetReason === 'RPC_RATE_LIMIT') {
          console.warn('  ⚠️  RPC 429 rate limit. Use HARDHAT_FORK_RPC_URL=<Tenderly/Alchemy URL>');
        }
        results.push({
          ts: new Date().toISOString(), signalId: signal.signalId,
          spreadBps: signal.spreadBps, v2RealisticNetUsd: realisticNet,
          wouldExecute: false, revertReason: resetReason,
          gasEstimate: null, gasCostUsd: null, expectedNetUsd: 0,
          passesDryRun: false, params: {},
          resetError  : msg.slice(0, 80),
          targetBlock : parseInt(block),
        });
        revertCounts[resetReason] = (revertCounts[resetReason] ?? 0) + 1;
        console.log(`  ⚠️  [${resetReason}] signal=${signal.signalId} block=${block}: ${msg.slice(0,50)}`);
        continue;
      }
    }

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
        // Use configured gas price — NOT getFeeData() on historical fork.
        // getFeeData() on a forked block returns that block's historical baseFee (~1 gwei
        // on Arbitrum circa April 2026), not what live execution would pay (~0.02 gwei).
        // GAS_PRICE_GWEI env var allows tuning; default 0.05 gwei (conservative buffer
        // above typical 0.02 gwei Arbitrum live price).
        const GAS_PRICE_WEI = BigInt(Math.round(GAS_PRICE_GWEI * 1e9));
        gasCostUsd = gasEstimate * Number(GAS_PRICE_WEI) / 1e18 * ETH_USD;
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
    // Path validation: INSUFFICIENT_PROFIT = path ran to completion = routing is clean
    // This is separate from profit validation (which is time-dependent)
    pathValidatedCount   : results.filter(r => r.revertReason === 'INSUFFICIENT_PROFIT' || r.wouldExecute).length,
    pathBrokenCount      : results.filter(r => r.revertReason && r.revertReason !== 'INSUFFICIENT_PROFIT').length,
    pathValidationRate   : results.length > 0
      ? +(results.filter(r => r.revertReason === 'INSUFFICIENT_PROFIT' || r.wouldExecute).length / results.length * 100).toFixed(1)
      : null,
    // Fork reset diagnostics
    forkResetFailedCount,
    fundingStatus        : unfundedCount === 0 ? 'ALL_FUNDED' : `${unfundedCount}_UNFUNDED`,
    fundedExecutorCount  : fundedCount,
    unfundedExecutorCount: unfundedCount,
  };

  // Readiness assessment — path validation rate is the meaningful metric on pinned fork
  // INSUFFICIENT_PROFIT = contract reached profit check = execution path is clean
  // True execution success requires real-time spread (or archive node)
  const pathRate = totals.pathValidationRate;
  const execRate = totals.executionSuccessRate;
  totals.readinessAssessment =
    pathRate == null ? 'INSUFFICIENT_DATA'
    : pathRate >= 95 && execRate > 0 ? 'STRONG — path + profitability confirmed'
    : pathRate >= 95 ? 'PATH_VALIDATED — routing clean, profitability is time-dependent (expected on pinned fork)'
    : pathRate >= 70 ? 'ACCEPTABLE — some path failures, review non-profit reverts'
    : pathRate >= 50 ? 'MARGINAL — significant path failures, investigate before deploy'
    :                  'WEAK — investigate execution path failures before deployment';

  fs.writeFileSync(totalsPath, JSON.stringify(totals, null, 2));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Path validated:    ${totals.pathValidatedCount} / ${results.length} (${totals.pathValidationRate}%)`);
  console.log(`  Would execute:     ${wouldExecute.length} / ${results.length} (${totals.executionSuccessRate}%)`);
  console.log(`  Avg gas cost:      $${totals.avgGasCostUsd ?? 'N/A'}`);
  console.log(`  Executable PnL:    $${totals.expectedExecutablePnL}`);
  if (Object.keys(totals.topRevertReasons).length > 0) {
    console.log('  Revert breakdown:');
    for (const [r, c] of Object.entries(totals.topRevertReasons)) {
      const note = r === 'INSUFFICIENT_PROFIT' ? '← path clean, spread time-dependent' : '← investigate';
      console.log(`    ${String(c).padStart(4)}×  ${r}  ${note}`);
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
