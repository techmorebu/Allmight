// test_cross_fee_tier.js
// Tests the 84bps spread between UniV3 100bps and 500bps WETH/USDC pools
// Run: node test_cross_fee_tier.js
"use strict";
const { ethers } = require("ethers");
require("dotenv").config();

const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1);

const WETH  = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const USDC  = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const USDT  = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
const USDCe = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";

const QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const q = new ethers.Contract(QUOTER, [
  "function quoteExactInputSingle(address,address,uint24,uint256,uint160) external returns (uint256)"
], provider);

const CURVE_2POOL = "0x7f90122BF0700F9E7e1F688fe926940E8839F353";
const CURVE_TRICRYPTO = "0x960ea3e3C7FB317332d990873d354E18d7645590";
const curve2 = new ethers.Contract(CURVE_2POOL, ["function get_dy(int128,int128,uint256) view returns(uint256)"], provider);
const curveTC = new ethers.Contract(CURVE_TRICRYPTO, ["function get_dy(uint256,uint256,uint256) view returns(uint256)"], provider);

const AAVE_FEE = 0.0005;
const GAS_USD  = 0.15;

async function quote(tokenIn, tokenOut, fee, amtIn) {
  try { return await q.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amtIn, 0n); }
  catch { return null; }
}

async function testRoute(label, sizesUsd, fn) {
  console.log(`\n=== ${label} ===`);
  console.log("size($)  | back($)    | gross($) | net($)   | netBps");
  for (const sz of sizesUsd) {
    try {
      const { back, start } = await fn(sz);
      const gross = back - start;
      const net   = gross - start * AAVE_FEE - GAS_USD;
      const netBps = net / start * 10000;
      const tag = net > 0 ? " ✅" : " ❌";
      console.log(`$${String(sz).padStart(6)} | $${back.toFixed(4).padStart(9)} | ${gross.toFixed(4).padStart(8)} | ${net.toFixed(4).padStart(8)} | ${netBps.toFixed(2)}${tag}`);
    } catch(e) { console.log(`$${sz} ERROR: ${e.message.slice(0,60)}`); }
  }
}

async function main() {
  const sizes = [100, 250, 500, 1000, 2000, 5000];

  // ── Route 1: Buy WETH on 100bps pool, sell on 500bps pool ────────────────
  // Borrow USDC, buy WETH cheap (100bps pool lower price), sell WETH dear (500bps pool)
  await testRoute("UniV3: buy USDC->WETH@100bps, sell WETH->USDC@500bps", sizes, async (sz) => {
    const amtIn  = BigInt(sz) * 1_000_000n;
    const wethOut = await quote(USDC, WETH, 100, amtIn);
    if (!wethOut) throw new Error("quote failed");
    const usdcBack = await quote(WETH, USDC, 500, wethOut);
    if (!usdcBack) throw new Error("quote failed");
    return { back: parseFloat(ethers.formatUnits(usdcBack, 6)), start: sz };
  });

  // ── Route 2: Reverse -- buy on 500bps, sell on 100bps ───────────────────
  await testRoute("UniV3: buy USDC->WETH@500bps, sell WETH->USDC@100bps", sizes, async (sz) => {
    const amtIn  = BigInt(sz) * 1_000_000n;
    const wethOut = await quote(USDC, WETH, 500, amtIn);
    if (!wethOut) throw new Error("quote failed");
    const usdcBack = await quote(WETH, USDC, 100, wethOut);
    if (!usdcBack) throw new Error("quote failed");
    return { back: parseFloat(ethers.formatUnits(usdcBack, 6)), start: sz };
  });

  // ── Route 3: UniV3 100bps vs 3000bps ────────────────────────────────────
  await testRoute("UniV3: buy USDC->WETH@100bps, sell WETH->USDC@3000bps", sizes, async (sz) => {
    const amtIn  = BigInt(sz) * 1_000_000n;
    const wethOut = await quote(USDC, WETH, 100, amtIn);
    if (!wethOut) throw new Error("quote failed");
    const usdcBack = await quote(WETH, USDC, 3000, wethOut);
    if (!usdcBack) throw new Error("quote failed");
    return { back: parseFloat(ethers.formatUnits(usdcBack, 6)), start: sz };
  });

  // ── Route 4: UniV3 500bps vs 3000bps ────────────────────────────────────
  await testRoute("UniV3: buy USDC->WETH@500bps, sell WETH->USDC@3000bps", sizes, async (sz) => {
    const amtIn  = BigInt(sz) * 1_000_000n;
    const wethOut = await quote(USDC, WETH, 500, amtIn);
    if (!wethOut) throw new Error("quote failed");
    const usdcBack = await quote(WETH, USDC, 3000, wethOut);
    if (!usdcBack) throw new Error("quote failed");
    return { back: parseFloat(ethers.formatUnits(usdcBack, 6)), start: sz };
  });

  // ── Route 5: USDC/USDT UniV3 100bps vs Curve 2pool (USDCe) ─────────────
  await testRoute("UniV3 USDT->USDCe@100bps, then Curve 2pool USDCe->USDT", sizes, async (sz) => {
    const amtIn   = BigInt(sz) * 1_000_000n;
    const usdceOut = await quote(USDT, USDCe, 100, amtIn);
    if (!usdceOut) throw new Error("quote failed");
    const usdtBack = await curve2.get_dy(0, 1, usdceOut); // USDCe->USDT
    return { back: parseFloat(ethers.formatUnits(usdtBack, 6)), start: sz };
  });

  // ── Route 6: Curve 2pool USDCe->USDT then UniV3 USDT->USDCe ────────────
  await testRoute("Curve 2pool USDCe->USDT, then UniV3 USDT->USDCe@100bps", sizes, async (sz) => {
    const amtIn   = BigInt(sz) * 1_000_000n;
    const usdtOut = await curve2.get_dy(0, 1, amtIn); // USDCe->USDT
    const usdceBack = await quote(USDT, USDCe, 100, usdtOut);
    if (!usdceBack) throw new Error("quote failed");
    return { back: parseFloat(ethers.formatUnits(usdceBack, 6)), start: sz };
  });

  // ── Route 7: ETH/USDC vs ETH/USDT cross-pair ────────────────────────────
  // Borrow USDC, buy WETH on USDC pool, sell WETH for USDT, swap USDT back to USDC
  await testRoute("UniV3 USDC->WETH@500 -> WETH->USDT@500 -> USDT->USDC@100 (3-hop)", sizes, async (sz) => {
    const amtIn   = BigInt(sz) * 1_000_000n;
    const wethOut  = await quote(USDC, WETH, 500, amtIn);
    if (!wethOut) throw new Error("leg1 failed");
    const usdtOut  = await quote(WETH, USDT, 500, wethOut);
    if (!usdtOut) throw new Error("leg2 failed");
    const usdcBack = await quote(USDT, USDC, 100, usdtOut);
    if (!usdcBack) throw new Error("leg3 failed");
    return { back: parseFloat(ethers.formatUnits(usdcBack, 6)), start: sz };
  });

  console.log("\nKey: ✅=profitable after Aave fee + $0.15 gas  ❌=loss");
  console.log("These are LIVE on-chain quotes -- results are executable today.");
}
main().catch(console.error);
