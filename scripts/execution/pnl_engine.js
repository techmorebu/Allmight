'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — PnL Engine
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT : scripts/execution/pnl_engine.js
//  STATUS    : NEW — Boss ruling 2026-04-15
//
//  Pure computation layer — no I/O, no Redis, no RPC.
//  Reuses PnL semantics from scripts/execution/shadow_mode.py (legacy reference).
//
//  Doctrine (shadow_mode.py Section 3):
//    gross_profit = size_usd * (spread_bps / 10000)
//    fee_cost     = size_usd * (fee_bps / 10000)
//    aave_fee     = size_usd * 0.0005   (0.05% Aave V3 flash loan fee)
//    gas_usd      = ~$0.02 on Arbitrum
//    net_profit   = gross_profit - fee_cost - aave_fee - gas_usd
//    would_revert = net_profit <= 0
// ═══════════════════════════════════════════════════════════════════════════════

const AAVE_FLASH_FEE_PCT = 0.0005; // 0.05% — Aave V3 flash loan fee
const DEFAULT_GAS_USD    = 0.02;   // ~$0.02 on Arbitrum (doctrine default)

function round(value, digits = 6) {
  const m = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * m) / m;
}

/**
 * Compute PnL from spread and fee assumptions.
 * Direct port of shadow_mode.py compute_result().
 *
 * @param {{ spreadBps:number, feeBps:number, sizeUsd:number, gasUsd?:number }} input
 * @returns {{ grossProfitUsd, feeCostUsd, aaveFeeUsd, gasUsd,
 *             netProfitUsd, netEdgeBps, wouldRevert }}
 */
function computePnL({ spreadBps, feeBps, sizeUsd, gasUsd = DEFAULT_GAS_USD }) {
  if (!Number.isFinite(spreadBps) || !Number.isFinite(feeBps) || !Number.isFinite(sizeUsd))
    throw new Error('computePnL requires finite spreadBps, feeBps, and sizeUsd');
  if (sizeUsd <= 0)
    throw new Error('sizeUsd must be > 0');

  const grossProfitUsd = sizeUsd * (spreadBps / 10000);
  const feeCostUsd     = sizeUsd * (feeBps / 10000);
  const aaveFeeUsd     = sizeUsd * AAVE_FLASH_FEE_PCT;
  const netProfitUsd   = grossProfitUsd - feeCostUsd - aaveFeeUsd - gasUsd;
  const netEdgeBps     = spreadBps - feeBps
                         - (AAVE_FLASH_FEE_PCT * 10000)
                         - ((gasUsd / sizeUsd) * 10000);
  const wouldRevert    = netProfitUsd <= 0;

  return {
    grossProfitUsd : round(grossProfitUsd, 6),
    feeCostUsd     : round(feeCostUsd, 6),
    aaveFeeUsd     : round(aaveFeeUsd, 6),
    gasUsd         : round(gasUsd, 6),
    netProfitUsd   : round(netProfitUsd, 6),
    netEdgeBps     : round(netEdgeBps, 4),
    wouldRevert,
  };
}

/**
 * Sandbox execution classification — Boss ruling thresholds (2026-04-14).
 * Kept separate from execution_realism_simulator.js upstream classes.
 *
 * VIABLE:   realNet ≥ $0.10 AND worstNet > $0
 * MARGINAL: realNet ≥ $0.05 AND worstNet > -$0.05
 * FAIL:     everything else
 */
function classifyExecution({ realNetUsd, worstNetUsd }) {
  if (!Number.isFinite(realNetUsd) || !Number.isFinite(worstNetUsd))
    throw new Error('classifyExecution requires finite realNetUsd and worstNetUsd');
  if (realNetUsd >= 0.10 && worstNetUsd > 0)       return 'EXECUTION_VIABLE';
  if (realNetUsd >= 0.05 && worstNetUsd > -0.05)   return 'EXECUTION_MARGINAL';
  return 'EXECUTION_FAIL';
}

module.exports = { AAVE_FLASH_FEE_PCT, DEFAULT_GAS_USD, computePnL, classifyExecution };
