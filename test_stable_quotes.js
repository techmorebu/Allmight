// test_stable_quotes.js
// Tests USDC/USDT stablecoin arb -- the real opportunity
// Curve 2pool (USDC/USDT) vs UniV3 0.01% fee tier
// Run: node test_stable_quotes.js
const { ethers } = require("ethers");
require("dotenv").config();

// Arbitrum addresses
const USDC   = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"; // native USDC
const USDCe  = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8"; // bridged USDC.e
const USDT   = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9";

// Curve 2pool on Arbitrum: USDC.e / USDT
const CURVE_2POOL = "0x7f90122BF0700F9E7e1F688fe926940E8839F353";

// QuoterV1
const QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
];
const CURVE_ABI = [
  "function get_dy(int128 i, int128 j, uint256 dx) view returns (uint256)",
  "function coins(uint256 i) view returns (address)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_MAINNET_RPC_URL_1);
  const quoter   = new ethers.Contract(QUOTER,       QUOTER_ABI, provider);
  const curve2   = new ethers.Contract(CURVE_2POOL,  CURVE_ABI,  provider);

  // Verify pool coins
  console.log("=== Curve 2pool coins ===");
  for (let i = 0; i < 2; i++) {
    try { console.log(`  coin${i}:`, await curve2.coins(i)); } catch(e) {}
  }

  const sizes = [100, 500, 1000, 5000, 10000];

  // Curve 2pool indices: coin0=USDC.e, coin1=USDT
  // Direction A: buy USDCe->USDT on Curve, sell USDT->USDCe on UniV3
  console.log("\n=== Direction A: Curve buy (USDCe->USDT) then UniV3 sell (USDT->USDCe) ===");
  for (const sz of sizes) {
    try {
      const amtIn    = BigInt(sz) * 1_000_000n;
      const usdtOut  = await curve2.get_dy(0, 1, amtIn);
      const usdceBack = await quoter.quoteExactInputSingle.staticCall(USDT, USDCe, 100, usdtOut, 0n);
      const back  = parseFloat(ethers.formatUnits(usdceBack, 6));
      const gross = back - sz;
      const net   = gross - sz * 0.0005;
      console.log(`$${String(sz).padStart(6)} | back=$${back.toFixed(4)} | gross=${gross.toFixed(4)} | net=${net.toFixed(4)}`);
    } catch(e) { console.log(`$${sz} ERR: ${e.message.slice(0,80)}`); }
  }

  // Direction B: buy USDT->USDCe on UniV3, sell USDCe->USDT on Curve
  console.log("\n=== Direction B: UniV3 buy (USDT->USDCe) then Curve sell (USDCe->USDT) ===");
  for (const sz of sizes) {
    try {
      const amtIn   = BigInt(sz) * 1_000_000n;
      const usdceOut = await quoter.quoteExactInputSingle.staticCall(USDT, USDCe, 100, amtIn, 0n);
      const usdtBack = await curve2.get_dy(0, 1, usdceOut);
      const back  = parseFloat(ethers.formatUnits(usdtBack, 6));
      const gross = back - sz;
      const net   = gross - sz * 0.0005;
      console.log(`$${String(sz).padStart(6)} | back=$${back.toFixed(4)} | gross=${gross.toFixed(4)} | net=${net.toFixed(4)}`);
    } catch(e) { console.log(`$${sz} ERR: ${e.message.slice(0,80)}`); }
  }

  // Also test UniV3 0.01% USDC/USDT pool directly
  console.log("\n=== UniV3 0.01% USDC->USDT direct (no arb, just price check) ===");
  for (const sz of [1000]) {
    try {
      const amtIn = BigInt(sz) * 1_000_000n;
      const out1  = await quoter.quoteExactInputSingle.staticCall(USDC, USDT, 100, amtIn, 0n);
      const out2  = await quoter.quoteExactInputSingle.staticCall(USDCe, USDT, 100, amtIn, 0n);
      console.log(`  USDC  ->USDT $${sz}: $${ethers.formatUnits(out1,6)}`);
      console.log(`  USDCe ->USDT $${sz}: $${ethers.formatUnits(out2,6)}`);
    } catch(e) { console.log("ERR:", e.message.slice(0,80)); }
  }
}

main().catch(console.error);
