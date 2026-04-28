// scripts/execution/preflight_ramses_executor.js
// ════════════════════════════════════════════════════════════════════════════
// AllMightRamsesExecutor — Preflight Verification
//
// Verifies all protocol addresses and pool state before deployment,
// and optionally verifies a deployed executor contract.
//
// NO TRANSACTIONS. Read-only calls only.
//
// Usage:
//   # Pre-deploy check (verify protocol addresses):
//   npx hardhat run scripts/execution/preflight_ramses_executor.js --network arbitrum
//
//   # Post-deploy check (verify deployed executor):
//   EXECUTOR_ADDRESS=0x... npx hardhat run scripts/execution/preflight_ramses_executor.js --network arbitrum
// ════════════════════════════════════════════════════════════════════════════

const { ethers } = require("hardhat");

// ─── EXPECTED ADDRESSES ──────────────────────────────────────────────────────
const EXPECTED = {
  aavePool      : "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  uniV3Router   : "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  ramsesPool    : "0x30AFBcF9458c3131A6d051C621E307E6278E4110",
  ramsesFactory : "0xaa2cd7477c451e703f3b9ba5663334914763edf8",
  WETH          : "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDC          : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const RAMSES_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function fee() view returns (uint24)",
];

const EXECUTOR_ABI = [
  "function owner() view returns (address)",
  "function WETH() view returns (address)",
  "function USDC() view returns (address)",
  "function ramsesPool() view returns (address)",
  "function uniV3Router() view returns (address)",
  "function aavePool() view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function profitRecipient() view returns (address)",
  "function DIRECTION_RAMSES_FIRST() view returns (uint8)",
  "function executeRamsesArb(address,uint256,uint256,uint256,uint256,uint8,uint256) external",
];

let passed = 0;
let failed = 0;

function chk(name, ok, detail = "") {
  if (ok) {
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const executorAddr = process.env.EXECUTOR_ADDRESS || "";

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AllMightRamsesExecutor — Preflight Check");
  console.log(`  Network:  ${network.name} (chainId ${chainId})`);
  console.log(`  Block:    ${await ethers.provider.getBlockNumber()}`);
  if (executorAddr) console.log(`  Executor: ${executorAddr}`);
  console.log("═══════════════════════════════════════════════════════");

  // ── 1. Protocol address liveness ──────────────────────────────────────────
  console.log("\n── 1. Protocol Addresses ──");
  for (const [name, addr] of Object.entries(EXPECTED)) {
    const code = await ethers.provider.getCode(addr);
    chk(name, code !== "0x", addr);
  }

  // ── 2. Ramses pool state ───────────────────────────────────────────────────
  console.log("\n── 2. Ramses Pool State ──");
  const pool = new ethers.Contract(EXPECTED.ramsesPool, RAMSES_POOL_ABI, ethers.provider);

  const token0 = await pool.token0();
  const token1 = await pool.token1();
  const liq    = await pool.liquidity();
  const [sqrtP, tick] = await pool.slot0();

  chk("token0 = WETH", token0.toLowerCase() === EXPECTED.WETH.toLowerCase(), token0);
  chk("token1 = USDC", token1.toLowerCase() === EXPECTED.USDC.toLowerCase(), token1);
  chk("liquidity > 0",  liq > 0n, liq.toString());
  chk("sqrtPriceX96 > 0", sqrtP > 0n, sqrtP.toString().slice(0, 12) + "...");
  console.log(`  ℹ️  Current tick: ${tick}`);

  // ── 3. sqrtPriceLimitX96 bounds ───────────────────────────────────────────
  console.log("\n── 3. sqrtPriceLimitX96 Bounds (contract will use at swap time) ──");
  const p      = BigInt(sqrtP);
  const dn     = p * 9750n / 10000n;
  const up     = p * 10250n / 10000n;
  const minSq  = 4295128739n;
  const maxU160 = (2n ** 160n) - 1n;
  chk("limitDown > MIN_SQRT_RATIO",   dn > minSq,   dn.toString().slice(0, 12) + "...");
  chk("limitDown < currentSqrtPrice", dn < p,        "ok for zeroForOne=false");
  chk("limitUp > currentSqrtPrice",   up > p,        "ok for zeroForOne=true");
  chk("limitUp fits in uint160",      up < maxU160,  up.toString().slice(0, 12) + "...");

  // ── 4. WETH/USDC balances in pool ─────────────────────────────────────────
  console.log("\n── 4. Pool Token Balances ──");
  const weth = new ethers.Contract(EXPECTED.WETH, ERC20_ABI, ethers.provider);
  const usdc = new ethers.Contract(EXPECTED.USDC, ERC20_ABI, ethers.provider);
  const wethBal = await weth.balanceOf(EXPECTED.ramsesPool);
  const usdcBal = await usdc.balanceOf(EXPECTED.ramsesPool);
  console.log(`  ℹ️  WETH in pool: ${ethers.formatEther(wethBal)} WETH`);
  console.log(`  ℹ️  USDC in pool: ${ethers.formatUnits(usdcBal, 6)} USDC`);
  chk("Pool has WETH liquidity", wethBal > 0n);
  chk("Pool has USDC liquidity", usdcBal > 0n);

  // ── 5. Post-deploy executor verification (optional) ───────────────────────
  if (executorAddr && ethers.isAddress(executorAddr)) {
    console.log("\n── 5. Deployed Executor Verification ──");
    const code = await ethers.provider.getCode(executorAddr);
    chk("Executor has bytecode", code !== "0x");

    if (code !== "0x") {
      const ex = new ethers.Contract(executorAddr, EXECUTOR_ABI, ethers.provider);

      const exWETH   = await ex.WETH();
      const exUSDC   = await ex.USDC();
      const exPool   = await ex.ramsesPool();
      const exUni    = await ex.uniV3Router();
      const exAave   = await ex.aavePool();
      const exT0     = await ex.token0();
      const exT1     = await ex.token1();
      const exDir    = await ex.DIRECTION_RAMSES_FIRST();
      const exOwner  = await ex.owner();
      const exRecip  = await ex.profitRecipient();

      chk("WETH correct",        exWETH.toLowerCase()  === EXPECTED.WETH.toLowerCase(),        exWETH);
      chk("USDC correct",        exUSDC.toLowerCase()  === EXPECTED.USDC.toLowerCase(),        exUSDC);
      chk("ramsesPool correct",  exPool.toLowerCase()  === EXPECTED.ramsesPool.toLowerCase(),  exPool);
      chk("uniV3Router correct", exUni.toLowerCase()   === EXPECTED.uniV3Router.toLowerCase(), exUni);
      chk("aavePool correct",    exAave.toLowerCase()  === EXPECTED.aavePool.toLowerCase(),    exAave);
      chk("token0 = WETH",       exT0.toLowerCase()    === EXPECTED.WETH.toLowerCase(),        exT0);
      chk("token1 = USDC",       exT1.toLowerCase()    === EXPECTED.USDC.toLowerCase(),        exT1);
      chk("DIRECTION_RAMSES_FIRST = 0", Number(exDir) === 0);
      chk("owner != zero",       exOwner !== ethers.ZeroAddress, exOwner);
      chk("profitRecipient != zero", exRecip !== ethers.ZeroAddress, exRecip);

      // staticCall to executeRamsesArb with expired deadline — must revert DEADLINE_EXPIRED
      try {
        await ex.executeRamsesArb.staticCall(
          EXPECTED.USDC, ethers.parseUnits("1", 6), 1n, 0n, 0n, 0, 1577836800n
        );
        chk("executeRamsesArb staticCall reverts correctly", false, "did not revert");
      } catch (e) {
        const msg = e.message || "";
        const ok  = msg.includes("DEADLINE_EXPIRED") || msg.includes("NOT_OWNER");
        chk("executeRamsesArb staticCall reverts with DEADLINE_EXPIRED or NOT_OWNER", ok, msg.slice(0, 50));
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log("\n═══════════════════════════════════════════════════════");
  console.log(`  PREFLIGHT: ${passed}/${total} checks passed`);
  if (failed === 0) {
    console.log("  ✅ ALL CHECKS PASSED — ready to proceed");
  } else {
    console.log("  ❌ CHECKS FAILED — resolve before deployment");
  }
  console.log("═══════════════════════════════════════════════════════");

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Preflight failed:", e.message);
  process.exit(1);
});
