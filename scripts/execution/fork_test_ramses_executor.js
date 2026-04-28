/**
 * scripts/execution/fork_test_ramses_executor.js
 * PROJECT ALLMIGHT — Fork Test: AllMightRamsesExecutor v2 (USDC-locked)
 * Boss ruling 2026-04-28: USDC-only execution. WETH path disabled.
 */

const { expect } = require("chai");
const { ethers }  = require("hardhat");

const ADDR = {
  aavePool   : "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  uniRouter  : "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  ramsesPool : "0x30AFBcF9458c3131A6d051C621E307E6278E4110",
  uniPool    : "0x6f38e884725a116C9C7fBF208e79FE8828a2595F",
  WETH       : "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  USDC       : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
];

const RAMSES_POOL_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)",
];

async function impersonate(address) {
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  await hre.network.provider.send("hardhat_setBalance", [address, "0x56BC75E2D63100000"]);
  return ethers.provider.getSigner(address);
}
async function stopImpersonate(address) {
  await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [address] });
}

function wethUnits(n) { return ethers.parseEther(String(n)); }
function usdcUnits(n) { return ethers.parseUnits(String(n), 6); }
function deadline()   { return Math.floor(Date.now() / 1000) + 600; }

describe("AllMightRamsesExecutor — v2 USDC-locked fork test", function () {
  this.timeout(120_000);

  let executor, owner, stranger, WETH, USDC, ramsesPool, ownerAddr;

  before(async function () {
    [owner, stranger] = await ethers.getSigners();
    ownerAddr = await owner.getAddress();

    const block = await ethers.provider.getBlockNumber();
    console.log(`\n  Fork block: ${block}`);

    for (const [name, addr] of Object.entries(ADDR)) {
      const code = await ethers.provider.getCode(addr);
      if (code === "0x") throw new Error(`${name} (${addr}) not live on fork`);
    }
    console.log("  All protocol addresses live ✅");

    ramsesPool = new ethers.Contract(ADDR.ramsesPool, RAMSES_POOL_ABI, ethers.provider);
    console.log(`  Ramses pool attached: ${ADDR.ramsesPool}`);

    const Factory = await ethers.getContractFactory("AllMightRamsesExecutor");
    executor = await Factory.deploy(
      ADDR.aavePool, ADDR.uniRouter, ADDR.ramsesPool,
      ADDR.WETH, ADDR.USDC, ownerAddr
    );
    await executor.waitForDeployment();
    console.log(`  Executor deployed: ${await executor.getAddress()}`);

    WETH = new ethers.Contract(ADDR.WETH, ERC20_ABI, ethers.provider);
    USDC = new ethers.Contract(ADDR.USDC, ERC20_ABI, ethers.provider);

    const executorAddr = await executor.getAddress();

    // Fund WETH via deposit()
    await hre.network.provider.send("hardhat_setBalance", [executorAddr, "0x1BC16D674EC80000"]);
    const exSigner = await impersonate(executorAddr);
    const wethDep  = new ethers.Contract(ADDR.WETH, [...ERC20_ABI, "function deposit() payable"], exSigner);
    await wethDep.deposit({ value: wethUnits("0.05") });
    await stopImpersonate(executorAddr);

    // Fund USDC from UniV3 pool (confirmed holder at pinned block)
    const usdcWhaleSigner = await impersonate(ADDR.uniPool);
    await USDC.connect(usdcWhaleSigner).transfer(executorAddr, usdcUnits("100"));
    await stopImpersonate(ADDR.uniPool);

    const wBal = await WETH.balanceOf(executorAddr);
    const uBal = await USDC.balanceOf(executorAddr);
    console.log(`  Executor funded — WETH: ${ethers.formatEther(wBal)} USDC: ${ethers.formatUnits(uBal, 6)}`);
  });

  // ── SECURITY ─────────────────────────────────────────────────────────────
  describe("Security: access control", function () {
    it("onlyOwner: stranger cannot call executeRamsesArb", async function () {
      await expect(
        executor.connect(stranger).executeRamsesArb(ADDR.USDC, usdcUnits("100"), 1n, 0n, 0n, 0, deadline())
      ).to.be.revertedWith("NOT_OWNER");
    });

    it("minProfit=0 rejected", async function () {
      await expect(
        executor.connect(owner).executeRamsesArb(ADDR.USDC, usdcUnits("100"), 0n, 0n, 0n, 0, deadline())
      ).to.be.revertedWith("MIN_PROFIT_REQUIRED");
    });

    it("expired deadline rejected", async function () {
      await expect(
        executor.connect(owner).executeRamsesArb(ADDR.USDC, usdcUnits("100"), 1n, 0n, 0n, 0, 1577836800)
      ).to.be.revertedWith("DEADLINE_EXPIRED");
    });

    it("WETH borrow DIRECTION_RAMSES_FIRST — ONLY_USDC_SUPPORTED", async function () {
      await expect(
        executor.connect(owner).executeRamsesArb(ADDR.WETH, wethUnits("0.5"), 1n, 0n, 0n, 0, deadline())
      ).to.be.revertedWith("ONLY_USDC_SUPPORTED");
    });

    it("WETH borrow DIRECTION_UNI_FIRST — ONLY_USDC_SUPPORTED", async function () {
      await expect(
        executor.connect(owner).executeRamsesArb(ADDR.WETH, wethUnits("0.5"), 1n, 0n, 0n, 1, deadline())
      ).to.be.revertedWith("ONLY_USDC_SUPPORTED");
    });

    it("wrong direction with USDC reverts with ONLY_USDC_RAMSES_FIRST", async function () {
      await expect(
        executor.connect(owner).executeRamsesArb(
          ADDR.USDC, usdcUnits("100"), 1n, 0n, 0n, 1, deadline()  // direction=1=UNI_FIRST
        )
      ).to.be.revertedWith("ONLY_USDC_RAMSES_FIRST");
    });

    it("ramsesV2SwapCallback: stranger cannot call directly", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["tuple(address tokenOwed)"], [{ tokenOwed: ADDR.WETH }]
      );
      await expect(
        executor.connect(stranger).ramsesV2SwapCallback(ethers.parseEther("1"), 0n, data)
      ).to.be.revertedWith("BAD_RAMSES_CALLBACK");
    });

    it("onlyOwner: stranger cannot call emergencyWithdraw", async function () {
      await expect(
        executor.connect(stranger).emergencyWithdraw(ADDR.WETH, await stranger.getAddress())
      ).to.be.revertedWith("NOT_OWNER");
    });
  });

  // ── PREFLIGHT ─────────────────────────────────────────────────────────────
  describe("Preflight: on-chain state", function () {
    it("Ramses pool token0 = WETH", async function () {
      expect((await ramsesPool.token0()).toLowerCase()).to.equal(ADDR.WETH.toLowerCase());
    });

    it("Ramses pool token1 = USDC", async function () {
      expect((await ramsesPool.token1()).toLowerCase()).to.equal(ADDR.USDC.toLowerCase());
    });

    it("Constructor: executor.token0 = WETH", async function () {
      expect((await executor.token0()).toLowerCase()).to.equal(ADDR.WETH.toLowerCase());
    });

    it("Constructor: executor.ramsesPool = confirmed address", async function () {
      expect((await executor.ramsesPool()).toLowerCase()).to.equal(ADDR.ramsesPool.toLowerCase());
    });

    it("Ramses pool has active liquidity", async function () {
      expect(await ramsesPool.liquidity()).to.be.gt(0n);
    });

    it("sqrtPriceLimitX96 bounds are valid (no overflow risk)", async function () {
      const [sqrtPrice] = await ramsesPool.slot0();
      const p        = BigInt(sqrtPrice);
      const limitDn  = p * 9750n / 10000n;
      const limitUp  = p * 10250n / 10000n;
      const MAX_U160 = (2n ** 160n) - 1n;
      const MIN_SQRT = 4295128739n;
      console.log(`\n  sqrtPriceX96: ${p}\n  limitDown: ${limitDn}\n  limitUp:   ${limitUp}`);
      expect(limitDn).to.be.gt(MIN_SQRT);
      expect(limitDn).to.be.lt(p);
      expect(limitUp).to.be.gt(p);
      expect(limitUp).to.be.lt(MAX_U160);
    });
  });

  // ── MECHANICS: USDC arb ───────────────────────────────────────────────────
  describe("Mechanics: USDC arb (confirmed profitable direction)", function () {
    it("USDC DIRECTION_RAMSES_FIRST — PROFITABLE or INSUFFICIENT_PROFIT", async function () {
      const ex = executor.connect(owner);
      let result = null;
      try {
        await ex.executeRamsesArb(ADDR.USDC, usdcUnits("1000"), 1n, 0n, 0n, 0, deadline());
        result = "PROFITABLE";
      } catch (err) {
        result = err.message || err.toString();
      }
      console.log(`\n  USDC arb result: ${result.slice(0, 100)}`);
      if (result === "PROFITABLE") console.log("  ⚡ PROFITABLE — spread captured!");
      else if (result.includes("INSUFFICIENT_PROFIT")) console.log("  ✅ Mechanics work — spread = 0 at this block");
      expect(
        result === "PROFITABLE" || result.includes("INSUFFICIENT_PROFIT"),
        `Unexpected: ${result.slice(0, 200)}`
      ).to.be.true;
    });
  });

  // ── SLIPPAGE ──────────────────────────────────────────────────────────────
  describe("Mechanics: slippage protection", function () {
    it("Impossible amountOutMinA triggers RAMSES_SLIPPAGE", async function () {
      const ex = executor.connect(owner);
      let result = null;
      try {
        await ex.executeRamsesArb(
          ADDR.USDC, usdcUnits("1000"), 1n, wethUnits("9999"), 0n, 0, deadline()
        );
        result = "NO_REVERT";
      } catch (err) {
        result = err.message || err.toString();
      }
      console.log(`\n  Slippage revert: ${result.slice(0, 80)}`);
      expect(result).to.include("RAMSES_SLIPPAGE");
    });
  });

  // ── EMERGENCY ─────────────────────────────────────────────────────────────
  describe("Emergency functions", function () {
    it("Owner can emergencyWithdraw WETH", async function () {
      const executorAddr = await executor.getAddress();
      const bal = await WETH.balanceOf(executorAddr);
      if (bal === 0n) { console.log("  Skipped — WETH balance is 0"); return; }
      const before = await WETH.balanceOf(ownerAddr);
      await executor.connect(owner).emergencyWithdraw(ADDR.WETH, ownerAddr);
      const after = await WETH.balanceOf(ownerAddr);
      expect(after).to.be.gt(before);
      console.log(`  Rescued ${ethers.formatEther(after - before)} WETH`);
    });

    it("Owner can setProfitRecipient", async function () {
      const newRecipient = await stranger.getAddress();
      await executor.connect(owner).setProfitRecipient(newRecipient);
      expect((await executor.profitRecipient()).toLowerCase()).to.equal(newRecipient.toLowerCase());
      await executor.connect(owner).setProfitRecipient(ownerAddr);
    });
  });
});
