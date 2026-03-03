// test_quotes.js
// Tests actual round-trip profitability at multiple trade sizes
// Run: node test_quotes.js
const { ethers } = require("ethers");
require("dotenv").config();

const USDT  = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";
const WETH  = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
const CURVE = "0x960ea3e3C7FB317332d990873d354E18d7645590";
// QuoterV1 on Arbitrum -- simpler ABI, individual params (not struct)
const QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];
const CURVE_ABI = [
  "function get_dy(uint256 i, uint256 j, uint256 dx) view returns (uint256)",
];

async function main() {
  const rpc = process.env.ARBITRUM_MAINNET_RPC_URL_1;
  if (!rpc) throw new Error("ARBITRUM_MAINNET_RPC_URL_1 not set in .env");
  const provider = new ethers.JsonRpcProvider(rpc);
  const quoter   = new ethers.Contract(QUOTER, QUOTER_ABI, provider);
  const curve    = new ethers.Contract(CURVE,  CURVE_ABI,  provider);

  const sizes = [100, 500, 1000, 2000, 5000];

  console.log("\n=== Direction A: UniV3 buy (USDT->WETH)  then  Curve sell (WETH->USDT) ===");
  console.log("size($) | back($)   | gross($) | net_after_aave($)");
  for (const sz of sizes) {
    try {
      const amtIn   = BigInt(sz) * 1_000_000n;
      const wethOut = await quoter.quoteExactInputSingle.staticCall(USDT, WETH, 500, amtIn, 0n);
      const usdtBack = await curve.get_dy(2, 0, wethOut);
      const back  = parseFloat(ethers.formatUnits(usdtBack, 6));
      const gross = back - sz;
      const net   = gross - sz * 0.0005;
      console.log(`${String(sz).padStart(7)} | ${back.toFixed(4).padStart(9)} | ${gross.toFixed(4).padStart(8)} | ${net.toFixed(4)}`);
    } catch (e) {
      console.log(`${sz} ERROR: ${e.message.slice(0, 80)}`);
    }
  }

  console.log("\n=== Direction B: Curve buy (USDT->WETH)  then  UniV3 sell (WETH->USDT) ===");
  console.log("size($) | back($)   | gross($) | net_after_aave($)");
  for (const sz of sizes) {
    try {
      const amtIn    = BigInt(sz) * 1_000_000n;
      const wethOut  = await curve.get_dy(0, 2, amtIn);
      const usdtBack = await quoter.quoteExactInputSingle.staticCall(WETH, USDT, 500, wethOut, 0n);
      const back  = parseFloat(ethers.formatUnits(usdtBack, 6));
      const gross = back - sz;
      const net   = gross - sz * 0.0005;
      console.log(`${String(sz).padStart(7)} | ${back.toFixed(4).padStart(9)} | ${gross.toFixed(4).padStart(8)} | ${net.toFixed(4)}`);
    } catch (e) {
      console.log(`${sz} ERROR: ${e.message.slice(0, 80)}`);
    }
  }

  console.log("\nDone. Positive net = profitable trade at that size.");
}

main().catch(console.error);
