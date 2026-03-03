// verify_new_pools.js
// Verifies all candidate pool addresses on-chain before adding to quoter
// Run: node verify_new_pools.js
// This confirms exactly which pools are live, liquid, and quotable
"use strict";
const { ethers } = require("ethers");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1);

const T = {
  WETH:  "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDT:  "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
  USDC:  "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  USDCe: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
  WBTC:  "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  DAI:   "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  ARB:   "0x912CE59144191C1204E64559FE8253a0e49E6548",
};

// QuoterV1 -- works for UniV3 and SushiSwap V3
const UNIV3_QUOTER  = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const SUSHI_QUOTER  = "0x0524E833cCD057e4d7A296e3aaAb9f7675964Ce1";
const SUSHI_ROUTER2 = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506"; // V2
const BAL_VAULT     = "0xBA12222222228d8Ba445958a75a0704d566BF2C8";
const CURVE_TRICRYPTO = "0x960ea3e3C7FB317332d990873d354E18d7645590"; // USDT/WBTC/WETH
const CURVE_2POOL     = "0x7f90122BF0700F9E7e1F688fe926940E8839F353"; // USDCe/USDT

const QUOTER_ABI = [
  "function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)"
];
const SUSHI3_ABI = [
  "function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256,uint160,uint32,uint256)"
];
const ROUTER2_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])"
];
const BAL_ABI = [
  "function getPoolTokens(bytes32 poolId) view returns (address[] tokens, uint256[] balances, uint256 lastChangeBlock)"
];
const CURVE_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
];

async function quoteUniV3(tokenIn, tokenOut, fee, amtIn, label) {
  const q = new ethers.Contract(UNIV3_QUOTER, QUOTER_ABI, provider);
  try {
    const out = await q.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amtIn, 0n);
    return out;
  } catch(e) { console.log(`  ${label}: FAIL ${e.message.slice(0,60)}`); return null; }
}

async function quoteSushiV2(tokenIn, tokenOut, amtIn, label) {
  const r = new ethers.Contract(SUSHI_ROUTER2, ROUTER2_ABI, provider);
  try {
    const amounts = await r.getAmountsOut(amtIn, [tokenIn, tokenOut]);
    return amounts[amounts.length - 1];
  } catch(e) { console.log(`  ${label}: FAIL ${e.message.slice(0,60)}`); return null; }
}

async function main() {
  const ETH  = ethers.parseEther("1");
  const K    = 1000n * 1_000_000n;  // $1000 in 6 decimals
  const fmt6 = (v) => v ? parseFloat(ethers.formatUnits(v,6)).toFixed(4) : "FAIL";
  const fmt18= (v) => v ? parseFloat(ethers.formatEther(v)).toFixed(6) : "FAIL";

  // ── 1. UniV3 fee tier survey ─────────────────────────────────────────────
  console.log("\n=== 1. UniV3 WETH->USDC different fee tiers ($1 ETH) ===");
  for (const fee of [100, 500, 3000]) {
    const out = await quoteUniV3(T.WETH, T.USDC, fee, ETH, `WETH/USDC ${fee}`);
    console.log(`  ${fee}bps: $${fmt6(out)}`);
  }

  console.log("\n=== 2. UniV3 WETH->USDT different fee tiers ($1 ETH) ===");
  for (const fee of [500, 3000]) {
    const out = await quoteUniV3(T.WETH, T.USDT, fee, ETH, `WETH/USDT ${fee}`);
    console.log(`  ${fee}bps: $${fmt6(out)}`);
  }

  // ── 2. Cross-fee-tier spread (KEY: same asset, different UniV3 pools) ───
  console.log("\n=== 3. UniV3 cross-fee-tier spreads (same asset, arb between tiers) ===");
  const usdc100 = await quoteUniV3(T.WETH, T.USDC, 100, ETH, "");
  const usdc500 = await quoteUniV3(T.WETH, T.USDC, 500, ETH, "");
  const usdc3k  = await quoteUniV3(T.WETH, T.USDC, 3000, ETH, "");
  if (usdc100 && usdc500) {
    const spread = (parseFloat(fmt6(usdc500)) - parseFloat(fmt6(usdc100))) / parseFloat(fmt6(usdc100)) * 10000;
    console.log(`  USDC: 100bps pool=$${fmt6(usdc100)} | 500bps pool=$${fmt6(usdc500)} | spread=${spread.toFixed(4)}bps`);
  }

  // ── 3. Stablecoin cross-pool: USDC<->USDT across venues ─────────────────
  console.log("\n=== 4. USDC->USDT: UniV3 vs Curve 2pool ($1000) ===");
  const uniUsdc2Usdt = await quoteUniV3(T.USDC, T.USDT, 100, K, "UniV3 USDC->USDT 1bps");
  console.log(`  UniV3 100bps: $${fmt6(uniUsdc2Usdt)}`);

  // Note: Curve 2pool uses USDCe not USDC
  const curve2 = new ethers.Contract(CURVE_2POOL, ["function get_dy(int128,int128,uint256) view returns(uint256)"], provider);
  try {
    const out = await curve2.get_dy(0, 1, K); // USDCe->USDT
    console.log(`  Curve 2pool USDCe->USDT: $${fmt6(out)}`);
  } catch(e) { console.log(`  Curve 2pool: FAIL ${e.message.slice(0,60)}`); }

  // ── 4. SushiSwap V2 on Arbitrum ─────────────────────────────────────────
  console.log("\n=== 5. SushiSwap V2 Arbitrum (WETH->USDC, $1 ETH) ===");
  const sushiOut = await quoteSushiV2(T.WETH, T.USDC, ETH, "Sushi V2 WETH->USDC");
  if (sushiOut) console.log(`  Sushi V2: $${fmt6(sushiOut)}`);
  const sushiARB = await quoteSushiV2(T.WETH, T.ARB, ETH, "Sushi V2 WETH->ARB");
  if (sushiARB) console.log(`  Sushi V2 WETH->ARB: ${fmt18(sushiARB)} ARB`);

  // ── 5. Spread between SushiSwap V2 and UniV3 (if both work) ─────────────
  console.log("\n=== 6. SushiSwap V2 vs UniV3 spread: WETH/USDC ===");
  if (sushiOut && usdc500) {
    const sushi  = parseFloat(fmt6(sushiOut));
    const uni    = parseFloat(fmt6(usdc500));
    const spread = Math.abs(sushi - uni) / Math.min(sushi, uni) * 10000;
    const cheaperBuy  = sushi < uni ? "sushi_v2" : "uniswap_v3";
    const expensiveSell = sushi < uni ? "uniswap_v3" : "sushi_v2";
    console.log(`  Sushi: $${sushi.toFixed(4)} | UniV3 500bps: $${uni.toFixed(4)}`);
    console.log(`  Raw spread: ${spread.toFixed(4)}bps | Buy on ${cheaperBuy}, sell on ${expensiveSell}`);
    // Check round-trip profitability
    const aaveFee = 0.05; // bps
    const gasCost = 0.15; // USD
    const tradeSize = 1000;
    const netBps = spread - aaveFee - (gasCost / tradeSize * 10000);
    console.log(`  Net after Aave+gas: ${netBps.toFixed(4)}bps (need >0 to profit)`);
  }

  // ── 6. Balancer stable pool ──────────────────────────────────────────────
  console.log("\n=== 7. Balancer V2 stable pools ===");
  const vault = new ethers.Contract(BAL_VAULT, BAL_ABI, provider);
  const balPools = [
    { name: "USDC/USDT/USDCe 4pool", poolId: "0x1533a3278f3f9141d5f820a184ea4b017fce2382000000000000000000000016a" },
    { name: "USDC/DAI/USDTe v2",     poolId: "0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112" },
  ];
  for (const bp of balPools) {
    try {
      const { tokens, balances } = await vault.getPoolTokens(bp.poolId);
      const tvl = balances.reduce((s,b,i) => s + Number(ethers.formatUnits(b,6)), 0);
      console.log(`  ${bp.name}`);
      console.log(`    TVL: ~$${tvl.toLocaleString()} | tokens: ${tokens.length}`);
      tokens.forEach((t,i) => {
        const bal = parseFloat(ethers.formatUnits(balances[i],6)).toLocaleString();
        console.log(`      [${i}] ${t.slice(0,12)}... $${bal}`);
      });
    } catch(e) { console.log(`  ${bp.name}: ${e.message.slice(0,80)}`); }
  }

  // ── 7. Curve tricrypto -- other pairs ────────────────────────────────────
  console.log("\n=== 8. Curve tricrypto additional routes (USDT<->WBTC) ===");
  const tricrypto = new ethers.Contract(CURVE_TRICRYPTO,
    ["function get_dy(uint256,uint256,uint256) view returns(uint256)"], provider);
  try {
    // USDT(0) -> WBTC(1)
    const wbtcOut = await tricrypto.get_dy(0, 1, K);
    console.log(`  USDT->WBTC $1000: ${ethers.formatUnits(wbtcOut,8)} WBTC`);
    // WBTC back to USDT
    const usdtBack = await tricrypto.get_dy(1, 0, wbtcOut);
    const gross = parseFloat(ethers.formatUnits(usdtBack,6)) - 1000;
    console.log(`  Round trip USDT->WBTC->USDT: back=$${ethers.formatUnits(usdtBack,6)} gross=${gross.toFixed(4)}`);
  } catch(e) { console.log(`  Curve USDT/WBTC: ${e.message.slice(0,60)}`); }

  console.log("\nDone. Use results above to populate onchain_quoter.js routes.");
}
main().catch(console.error);
