/**
 * scripts/execution/onchain_quoter.js
 *
 * On-chain quoter scanner -- the REAL arbitrage detector.
 *
 * Problem it solves:
 *   Old system compared stale Redis prices (60s snapshots) and called
 *   the difference "profit." This produced phantom opportunities that
 *   always reverted on-chain. Every single simulated "profit" was fake.
 *
 * How this works:
 *   For each registered route, calls the actual DEX contracts to get
 *   exact output amounts for a given input. No stale prices, no guessing.
 *   Only surfaces opportunities where the math works with live on-chain data.
 *
 * Output:
 *   Writes to Redis key "quoter:opportunities" every SCAN_INTERVAL seconds.
 *   shadow_mode.py reads this key instead of comparing Redis price snapshots.
 *
 * Architecture:
 *   ROUTES registry -> quote both legs -> calculate net profit -> Redis
 *
 * Extending to new chains/pairs:
 *   Add entries to ROUTES array. Each route needs:
 *     - pair, chain, buyVenue, sellVenue
 *     - quoteBuy(provider, amountIn) -> Promise<bigint>   // exact output of leg 1
 *     - quoteSell(provider, amountIn) -> Promise<bigint>  // exact output of leg 2
 *     - inDecimals, outDecimals (for amount formatting)
 *     - contractBuyVenue, contractSellVenue (for execute_trade.js)
 *
 * Run:
 *   node scripts/execution/onchain_quoter.js           # runs forever
 *   node scripts/execution/onchain_quoter.js --once    # single scan
 */

"use strict";

const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");
const redis      = require("redis"); // or use ioredis if preferred

// ── Load .env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(__dirname, "../../.env");
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, "utf8").split("\n").forEach(line => {
    line = line.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const [k, ...v] = line.split("=");
    if (!process.env[k.trim()]) process.env[k.trim()] = v.join("=").trim();
  });
}
loadEnv();

// ── Config ─────────────────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS = 15_000;          // scan every 15s
const REDIS_KEY        = "quoter:opportunities";
const REDIS_KEY_STATS  = "quoter:stats";
const AAVE_FEE_BPS     = 5;               // 0.05% Aave flash loan fee
const GAS_COST_USD     = 0.15;            // ~$0.15 gas on Arbitrum
const MIN_NET_USD      = 0.05;            // minimum net profit to report
const TRADE_SIZES_USD  = [100, 500, 1000, 2000]; // test multiple sizes

// ── Arbitrum token addresses ──────────────────────────────────────────────────
const TOKENS = {
  WETH:  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDT:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  USDC:  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  WBTC:  "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
};

// ── DEX contract addresses (Arbitrum) ─────────────────────────────────────────
const ADDRS = {
  QUOTER_V1:        "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6", // UniV3 QuoterV1
  CURVE_TRICRYPTO:  "0x960ea3e3C7FB317332d990873d354E18d7645590", // USDT/WBTC/WETH
  CURVE_2POOL:      "0x7f90122BF0700F9E7e1F688fe926940E8839F353", // USDCe/USDT
  CAMELOT_ROUTER:   "0xc873fEcbd354f5A56E00E710B90EF4201db2448d", // Camelot V2 router
};

// ── ABIs ──────────────────────────────────────────────────────────────────────
const QUOTER_V1_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];

const CURVE_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
];

const CAMELOT_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
];

// ── Quote helpers ─────────────────────────────────────────────────────────────

async function quoteUniV3(provider, tokenIn, tokenOut, fee, amountIn) {
  const q = new ethers.Contract(ADDRS.QUOTER_V1, QUOTER_V1_ABI, provider);
  try {
    return await q.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0n);
  } catch { return null; }
}

async function quoteCurveTricrypto(provider, i, j, amountIn) {
  // Tricrypto: coin0=USDT, coin1=WBTC, coin2=WETH  -- uses uint256 indices
  const pool = new ethers.Contract(ADDRS.CURVE_TRICRYPTO, [
    "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)"
  ], provider);
  try { return await pool.get_dy(i, j, amountIn); }
  catch { return null; }
}

async function quoteCurve2pool(provider, i, j, amountIn) {
  // 2pool: coin0=USDCe, coin1=USDT  -- uses int128 indices
  const pool = new ethers.Contract(ADDRS.CURVE_2POOL, [
    "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)"
  ], provider);
  try { return await pool.get_dy(i, j, amountIn); }
  catch { return null; }
}

async function quoteCamelotV2(provider, tokenIn, tokenOut, amountIn) {
  const router = new ethers.Contract(ADDRS.CAMELOT_ROUTER, CAMELOT_ROUTER_ABI, provider);
  try {
    const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return amounts[amounts.length - 1];
  } catch { return null; }
}

// ── ROUTE REGISTRY ────────────────────────────────────────────────────────────
// Each route defines a pair of venues to compare.
// quoteBuy:  swap tokenA -> tokenB on buyVenue, return amountOut
// quoteSell: swap tokenB -> tokenA on sellVenue, return amountOut
// inDecimals: decimals of the flash loan asset (tokenA)
// Flash loan asset is always tokenA (what we start with and end with)

function buildRoutes(provider) {
  return [

    // ── ETH/USDT: buy on UniV3, sell on Curve tricrypto ───────────────────────
    // Borrow USDT, swap to WETH on UniV3 0.05%, swap back on Curve, repay
    {
      pair:              "ETH/USDT",
      chain:             "arbitrum",
      buyVenue:          "uniswap_v3",
      sellVenue:         "curve",
      contractBuyVenue:  0,
      contractSellVenue: 1,
      flashAsset:        TOKENS.USDT,
      inDecimals:        6,
      midToken:          TOKENS.WETH,
      midDecimals:       18,
      quoteBuy:  (amtIn) => quoteUniV3(provider, TOKENS.USDT, TOKENS.WETH, 500, amtIn),
      quoteSell: (amtIn) => quoteCurveTricrypto(provider, 2, 0, amtIn), // WETH(2)->USDT(0)
    },

    // ── ETH/USDT: buy on Curve tricrypto, sell on UniV3 ───────────────────────
    {
      pair:              "ETH/USDT",
      chain:             "arbitrum",
      buyVenue:          "curve",
      sellVenue:         "uniswap_v3",
      contractBuyVenue:  1,
      contractSellVenue: 0,
      flashAsset:        TOKENS.USDT,
      inDecimals:        6,
      midToken:          TOKENS.WETH,
      midDecimals:       18,
      quoteBuy:  (amtIn) => quoteCurveTricrypto(provider, 0, 2, amtIn), // USDT(0)->WETH(2)
      quoteSell: (amtIn) => quoteUniV3(provider, TOKENS.WETH, TOKENS.USDT, 500, amtIn),
    },

    // ── USDC.e/USDT: buy on Curve 2pool, sell on UniV3 ───────────────────────
    // Borrow USDCe, swap to USDT on Curve, swap back to USDCe on UniV3
    {
      pair:              "USDCe/USDT",
      chain:             "arbitrum",
      buyVenue:          "curve",
      sellVenue:         "uniswap_v3",
      contractBuyVenue:  1,
      contractSellVenue: 0,
      flashAsset:        TOKENS.USDCe,
      inDecimals:        6,
      midToken:          TOKENS.USDT,
      midDecimals:       6,
      quoteBuy:  (amtIn) => quoteCurve2pool(provider, 0, 1, amtIn), // USDCe(0)->USDT(1)
      quoteSell: (amtIn) => quoteUniV3(provider, TOKENS.USDT, TOKENS.USDCe, 100, amtIn),
    },

    // ── USDC.e/USDT: buy on UniV3, sell on Curve 2pool ───────────────────────
    {
      pair:              "USDCe/USDT",
      chain:             "arbitrum",
      buyVenue:          "uniswap_v3",
      sellVenue:         "curve",
      contractBuyVenue:  0,
      contractSellVenue: 1,
      flashAsset:        TOKENS.USDT,
      inDecimals:        6,
      midToken:          TOKENS.USDCe,
      midDecimals:       6,
      quoteBuy:  (amtIn) => quoteUniV3(provider, TOKENS.USDT, TOKENS.USDCe, 100, amtIn),
      quoteSell: (amtIn) => quoteCurve2pool(provider, 0, 1, amtIn), // USDCe(0)->USDT(1)
    },

    // ── ETH/USDC: buy on UniV3 0.05%, sell on Camelot V2 ─────────────────────
    // Borrow USDC, swap to WETH on UniV3, sell WETH on Camelot, repay
    {
      pair:              "ETH/USDC",
      chain:             "arbitrum",
      buyVenue:          "uniswap_v3",
      sellVenue:         "camelot_v2",
      contractBuyVenue:  0,
      contractSellVenue: 2, // add camelot=2 to contract venues
      flashAsset:        TOKENS.USDC,
      inDecimals:        6,
      midToken:          TOKENS.WETH,
      midDecimals:       18,
      quoteBuy:  (amtIn) => quoteUniV3(provider, TOKENS.USDC, TOKENS.WETH, 500, amtIn),
      quoteSell: (amtIn) => quoteCamelotV2(provider, TOKENS.WETH, TOKENS.USDC, amtIn),
    },

    // ── ETH/USDC: buy on Camelot V2, sell on UniV3 0.05% ─────────────────────
    {
      pair:              "ETH/USDC",
      chain:             "arbitrum",
      buyVenue:          "camelot_v2",
      sellVenue:         "uniswap_v3",
      contractBuyVenue:  2,
      contractSellVenue: 0,
      flashAsset:        TOKENS.USDC,
      inDecimals:        6,
      midToken:          TOKENS.WETH,
      midDecimals:       18,
      quoteBuy:  (amtIn) => quoteCamelotV2(provider, TOKENS.USDC, TOKENS.WETH, amtIn),
      quoteSell: (amtIn) => quoteUniV3(provider, TOKENS.WETH, TOKENS.USDC, 500, amtIn),
    },

    // ── USDC/USDT: UniV3 0.01% (different fee tiers) ─────────────────────────
    {
      pair:              "USDC/USDT",
      chain:             "arbitrum",
      buyVenue:          "uniswap_v3_100",
      sellVenue:         "uniswap_v3_500",
      contractBuyVenue:  0,
      contractSellVenue: 0,
      flashAsset:        TOKENS.USDT,
      inDecimals:        6,
      midToken:          TOKENS.USDC,
      midDecimals:       6,
      quoteBuy:  (amtIn) => quoteUniV3(provider, TOKENS.USDT, TOKENS.USDC, 100, amtIn),
      quoteSell: (amtIn) => quoteUniV3(provider, TOKENS.USDC, TOKENS.USDT, 500, amtIn),
    },

  ];
}

// ── Scan a single route at a given trade size ─────────────────────────────────
async function scanRoute(route, sizeUsd) {
  const amtIn = BigInt(Math.round(sizeUsd)) * BigInt(10 ** route.inDecimals);

  const midOut = await route.quoteBuy(amtIn);
  if (!midOut || midOut === 0n) return null;

  const finalOut = await route.quoteSell(midOut);
  if (!finalOut || finalOut === 0n) return null;

  const startUsd = sizeUsd;
  const finalUsd = parseFloat(ethers.formatUnits(finalOut, route.inDecimals));
  const grossUsd  = finalUsd - startUsd;
  const aaveFeeUsd = startUsd * AAVE_FEE_BPS / 10000;
  const netUsd    = grossUsd - aaveFeeUsd - GAS_COST_USD;
  const grossBps  = (grossUsd / startUsd) * 10000;
  const netBps    = (netUsd   / startUsd) * 10000;

  return {
    pair:              route.pair,
    chain:             route.chain,
    buyVenue:          route.buyVenue,
    sellVenue:         route.sellVenue,
    contractBuyVenue:  route.contractBuyVenue,
    contractSellVenue: route.contractSellVenue,
    flashAsset:        route.flashAsset,
    tradeSizeUsd:      sizeUsd,
    finalUsd:          parseFloat(finalUsd.toFixed(6)),
    grossUsd:          parseFloat(grossUsd.toFixed(6)),
    aaveFeeUsd:        parseFloat(aaveFeeUsd.toFixed(6)),
    gasCostUsd:        GAS_COST_USD,
    netUsd:            parseFloat(netUsd.toFixed(6)),
    grossBps:          parseFloat(grossBps.toFixed(4)),
    netBps:            parseFloat(netBps.toFixed(4)),
    profitable:        netUsd > MIN_NET_USD,
    timestamp:         new Date().toISOString(),
  };
}

// ── Full scan of all routes ───────────────────────────────────────────────────
async function scanAll(provider) {
  const routes       = buildRoutes(provider);
  const opportunities = [];
  const stats         = { scanned: 0, profitable: 0, errors: 0, timestamp: new Date().toISOString() };

  for (const route of routes) {
    // Find the best trade size for this route
    let bestResult = null;

    for (const sizeUsd of TRADE_SIZES_USD) {
      try {
        const result = await scanRoute(route, sizeUsd);
        stats.scanned++;

        if (!result) { stats.errors++; continue; }

        if (result.profitable) {
          if (!bestResult || result.netUsd > bestResult.netUsd) {
            bestResult = result;
          }
        }
      } catch (e) {
        stats.errors++;
      }
    }

    if (bestResult) {
      opportunities.push(bestResult);
      stats.profitable++;
    }
  }

  // Sort by net profit descending
  opportunities.sort((a, b) => b.netUsd - a.netUsd);

  return { opportunities, stats };
}

// ── Connect to Redis ──────────────────────────────────────────────────────────
async function connectRedis() {
  const client = redis.createClient({
    socket: { host: "localhost", port: 6379 }
  });
  client.on("error", (e) => console.error("[quoter] Redis error:", e.message));
  await client.connect();
  return client;
}

// ── Connect to Arbitrum ───────────────────────────────────────────────────────
async function connectProvider() {
  const rpcs = [
    process.env.ARBITRUM_MAINNET_RPC_URL_1,
    process.env.ARBITRUM_MAINNET_RPC_URL_2,
  ].filter(r => r && !r.includes("YOUR_"));

  for (const rpc of rpcs) {
    try {
      const p = new ethers.JsonRpcProvider(rpc);
      await p.getBlockNumber();
      return p;
    } catch { continue; }
  }
  throw new Error("All RPCs failed");
}

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  const once = process.argv.includes("--once");

  console.log("[quoter] Starting on-chain quoter scanner");
  console.log("[quoter] Scan interval:", SCAN_INTERVAL_MS / 1000 + "s");
  console.log("[quoter] Trade sizes: $" + TRADE_SIZES_USD.join(", $"));
  console.log("[quoter] Min net profit: $" + MIN_NET_USD);

  const provider = await connectProvider();
  const rc       = await connectRedis();

  let scanCount = 0;

  async function runScan() {
    const t0 = Date.now();
    scanCount++;

    try {
      const { opportunities, stats } = await scanAll(provider);
      const elapsed = Date.now() - t0;

      // Write to Redis
      await rc.set(REDIS_KEY, JSON.stringify({
        opportunities,
        stats: { ...stats, elapsed_ms: elapsed, scan_count: scanCount },
        timestamp: new Date().toISOString(),
      }));

      // Console output
      const ts = new Date().toISOString().slice(11, 19);
      if (opportunities.length > 0) {
        console.log(`[${ts}] Scan #${scanCount} | ${opportunities.length} PROFITABLE (${elapsed}ms)`);
        for (const opp of opportunities) {
          console.log(`  ✅ ${opp.chain} ${opp.pair} ${opp.buyVenue}->${opp.sellVenue} | $${opp.tradeSizeUsd} | net=$${opp.netUsd.toFixed(4)} (${opp.netBps.toFixed(2)}bps)`);
        }
      } else {
        console.log(`[${ts}] Scan #${scanCount} | no profitable routes (${stats.scanned} checked, ${elapsed}ms)`);
      }

    } catch (e) {
      console.error("[quoter] Scan error:", e.message);
    }
  }

  // Run first scan immediately
  await runScan();

  if (once) {
    await rc.quit();
    return;
  }

  // Then loop
  setInterval(runScan, SCAN_INTERVAL_MS);
}

main().catch(e => {
  console.error("[quoter] Fatal:", e.message);
  process.exit(1);
});

// ── Discord error notifier (calls Python webhook util) ────────────────────────
// Lightweight -- only fires on fatal errors so we don't spam Python forks
function discordError(msg) {
  const { execSync } = require("child_process");
  try {
    execSync(`python3 -c "
import sys; sys.path.insert(0,'${path.join(__dirname, "../../")}')
from utils.discord_alerts import discord
discord.error('${msg.replace(/'/g,"\\'")}', component='onchain_quoter')
"`, { timeout: 5000 });
  } catch { /* don't crash quoter over Discord failure */ }
}
