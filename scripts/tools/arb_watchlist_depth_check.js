'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
//  AllMight — Watchlist Pool Depth Checker  v1.0
// ───────────────────────────────────────────────────────────────────────────────
//  PLACEMENT:  scripts/tools/arb_watchlist_depth_check.js
//  STATUS:     CURRENT — Observation phase (Boss directive 2026-03-28)
//
//  PURPOSE
//  ───────
//  Spot-checks active-tick depth on watchlisted pools that have raw liquidity
//  but are currently out-of-range. Single RPC read, no continuous loop.
//
//  Run this periodically (manually or via cron) to track whether LP positions
//  are migrating into the current price range.
//
//  DOES NOT:
//    - modify fetchers or configs
//    - run continuously (one-shot only)
//    - make admission decisions
//
//  Append output to logs/watchlist_depth.jsonl for trend analysis.
//
//  USAGE
//  ─────
//  node -r dotenv/config scripts/tools/arb_watchlist_depth_check.js
//  node -r dotenv/config scripts/tools/arb_watchlist_depth_check.js --json
//  node -r dotenv/config scripts/tools/arb_watchlist_depth_check.js --append
// ═══════════════════════════════════════════════════════════════════════════════

require('dotenv').config();

const { ethers }         = require('ethers');
const { createProvider } = require('../../utils/provider_factory');
const fs                 = require('fs');
const path               = require('path');

// ─── WATCHLIST ────────────────────────────────────────────────────────────────
// Boss ruling 2026-03-28: watchlist-only. Promote only if depth ≥ $10k on 3+ checks.

const WATCHLIST = [
  {
    label      : 'UniV3 ARB/USDC 0.01%',
    venue      : 'uniswap_v3',
    pool       : '0x616a2a065bFE53DA48e83E7d709fB428AA3C9F5B',
    fee        : 100,
    token0Dec  : 18,   // ARB
    token1Dec  : 6,    // native USDC
    token0Sym  : 'ARB',
    token1Sym  : 'USDC',
    // Boss promotion threshold — must hold on 3+ consecutive checks
    promoteAt  : 10_000,
  },
];

// ─── ABI ──────────────────────────────────────────────────────────────────────

const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)',
  'function liquidity() view returns (uint128)',
];

// ─── DEPTH FORMULA ────────────────────────────────────────────────────────────
// L × sqrtP / 10^dec1 × 2  (both sides of current tick, token1 terms)

function activeTickDepthUsd(liquidityRaw, sqrtPriceX96, dec1) {
  const L     = Number(liquidityRaw);
  const sqrtP = Number(sqrtPriceX96) / (2 ** 96);
  return (L * sqrtP / Math.pow(10, dec1)) * 2;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const useJson  = process.argv.includes('--json');
  const doAppend = process.argv.includes('--append');

  const rpc = createProvider('arbitrum');
  const { blockNumber } = await rpc.getBlockNumber('watchlist.block', { timeoutMs: 2000 });

  const results = [];

  for (const entry of WATCHLIST) {
    let depthUsd = null, tick = null, sqrtP = null, liq = null;
    let error = null;

    try {
      const { result } = await rpc.callDetailed(
        `watchlist.${entry.venue}.${entry.pool.slice(0, 10)}`,
        async (provider) => {
          const c = new ethers.Contract(entry.pool, POOL_ABI, provider);
          const [s0, liquidityRaw] = await Promise.all([
            c.slot0({ blockTag: blockNumber }),
            c.liquidity({ blockTag: blockNumber }),
          ]);
          return { s0, liquidityRaw };
        },
        { timeoutMs: 4000 }
      );
      sqrtP      = result.s0[0].toString();
      tick       = Number(result.s0[1]);
      liq        = result.liquidityRaw.toString();
      depthUsd   = activeTickDepthUsd(liq, sqrtP, entry.token1Dec);
    } catch (e) {
      error = e.message.slice(0, 100);
    }

    const rec = {
      ts         : new Date().toISOString(),
      chain      : 'arbitrum',
      pair       : `${entry.token0Sym}/${entry.token1Sym}`,
      venue      : entry.venue,
      pool       : entry.pool,
      fee        : entry.fee,
      blockNumber,
      tick,
      liquidityRaw: liq,
      depthUsd   : depthUsd != null ? +depthUsd.toFixed(2) : null,
      promoteAt  : entry.promoteAt,
      aboveThreshold: depthUsd != null ? depthUsd >= entry.promoteAt : null,
      status     : error ? 'error' : 'ok',
      error      : error || null,
    };

    results.push({ label: entry.label, ...rec });

    if (!useJson) {
      const depthStr = depthUsd != null
        ? `$${depthUsd >= 1000 ? (depthUsd/1000).toFixed(2)+'k' : depthUsd.toFixed(0)}`
        : 'ERROR';
      const flag = depthUsd >= entry.promoteAt ? ' 🔔 ABOVE THRESHOLD' : '';
      console.log(`[watchlist] ${entry.label}  block=${blockNumber}  depth=${depthStr}  tick=${tick}${flag}`);
      if (error) console.log(`            error: ${error}`);
    }

    // Append to log file
    if (doAppend) {
      const logDir  = path.join(process.cwd(), 'logs');
      const logFile = path.join(logDir, 'watchlist_depth.jsonl');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logFile, JSON.stringify(rec) + '\n');
      if (!useJson) console.log(`            → appended to logs/watchlist_depth.jsonl`);
    }
  }

  if (useJson) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), blockNumber, results }, null, 2));
  }
}

main().catch(err => {
  console.error('[watchlist] FATAL:', err.message || err);
  process.exit(1);
});
