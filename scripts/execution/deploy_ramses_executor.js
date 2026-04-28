// scripts/execution/deploy_ramses_executor.js
// ════════════════════════════════════════════════════════════════════════════
// AllMightRamsesExecutor — Deployment Script (DRY-RUN ONLY)
//
// Status: LIVE DEPLOYMENT REQUIRES EXPLICIT BOSS APPROVAL.
//         This script defaults to --dry-run mode.
//         The --live flag is gated and will not broadcast without Boss ruling.
//
// Usage:
//   # Dry-run (prints args, estimates gas, NO broadcast):
//   npx hardhat run scripts/execution/deploy_ramses_executor.js --network hardhat
//
//   # Arbitrum dry-run (reads live gas prices, NO broadcast):
//   npx hardhat run scripts/execution/deploy_ramses_executor.js --network arbitrum
//
// LIVE DEPLOYMENT: NOT ENABLED. See EXECUTOR_READINESS.md.
// ════════════════════════════════════════════════════════════════════════════

const { ethers } = require("hardhat");

// ─── CONSTRUCTOR ARGS ────────────────────────────────────────────────────────
// All addresses Arbitrum mainnet (chainId 42161). On-chain verified.

const ARGS = {
  aavePool      : "0x794a61358D6845594F94dc1DB02A252b5b4814aD", // Aave V3 Pool
  uniV3Router   : "0xE592427A0AEce92De3Edee1F18E0157C05861564", // UniV3 SwapRouter v1
  ramsesPool    : "0x30AFBcF9458c3131A6d051C621E307E6278E4110", // Ramses WETH/USDC 0.05% CL
  weth          : "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH
  usdc          : "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC
  profitRecipient: process.env.PROFIT_RECIPIENT_ADDRESS || "",  // set in .env before deploy
};

// ─── SAFETY GATE ─────────────────────────────────────────────────────────────
// Live deployment is BLOCKED until Boss explicitly approves.
// To enable: Boss ruling required + set LIVE_DEPLOY_APPROVED=true in .env
const LIVE_DEPLOY_APPROVED = process.env.LIVE_DEPLOY_APPROVED === "true";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();
  const chainId    = Number(network.chainId);

  console.log("═══════════════════════════════════════════════════════");
  console.log("  AllMightRamsesExecutor — Deployment");
  console.log(`  Network:   ${network.name} (chainId ${chainId})`);
  console.log(`  Deployer:  ${await deployer.getAddress()}`);
  console.log(`  Mode:      ${LIVE_DEPLOY_APPROVED ? "🔴 LIVE" : "🟢 DRY-RUN"}`);
  console.log("═══════════════════════════════════════════════════════");

  // ── Validate args ──────────────────────────────────────────────────────────
  console.log("\n── Constructor args ──");
  for (const [name, addr] of Object.entries(ARGS)) {
    if (name === "profitRecipient" && !addr) {
      console.error(`\n❌ ${name}: NOT SET. Set PROFIT_RECIPIENT_ADDRESS in .env before deploying.`);
      process.exit(1);
    }
    if (!ethers.isAddress(addr)) {
      console.error(`\n❌ ${name}: invalid address "${addr}"`);
      process.exit(1);
    }
    console.log(`  ${name.padEnd(16)}: ${addr}`);
  }

  // ── Verify protocol addresses are live ────────────────────────────────────
  console.log("\n── Protocol address verification ──");
  const checks = [
    ["Aave V3 Pool",   ARGS.aavePool],
    ["UniV3 Router",   ARGS.uniV3Router],
    ["Ramses Pool",    ARGS.ramsesPool],
    ["WETH",           ARGS.weth],
    ["Native USDC",    ARGS.usdc],
  ];
  for (const [name, addr] of checks) {
    const code = await ethers.provider.getCode(addr);
    const live = code !== "0x";
    console.log(`  ${live ? "✅" : "❌"} ${name.padEnd(16)} ${addr}`);
    if (!live) {
      console.error(`\n❌ ${name} has no bytecode at ${addr} — wrong network or address?`);
      process.exit(1);
    }
  }

  // ── Gas estimate ──────────────────────────────────────────────────────────
  console.log("\n── Gas estimate ──");
  const Factory = await ethers.getContractFactory("AllMightRamsesExecutor");
  const deployTx = await Factory.getDeployTransaction(
    ARGS.aavePool,
    ARGS.uniV3Router,
    ARGS.ramsesPool,
    ARGS.weth,
    ARGS.usdc,
    ARGS.profitRecipient
  );

  let gasEstimate;
  try {
    gasEstimate = await ethers.provider.estimateGas({ ...deployTx, from: await deployer.getAddress() });
    const feeData = await ethers.provider.getFeeData();
    const maxFee  = feeData.maxFeePerGas || feeData.gasPrice;
    const costWei = gasEstimate * maxFee;
    console.log(`  Gas estimate : ${gasEstimate.toString()}`);
    console.log(`  Max fee/gas  : ${ethers.formatUnits(maxFee, "gwei")} gwei`);
    console.log(`  Max cost     : ${ethers.formatEther(costWei)} ETH`);
  } catch (e) {
    console.log(`  Gas estimate : FAILED (${e.message.slice(0, 60)})`);
    console.log("  (This is normal on a local fork — the contract is not deployed yet)");
  }

  // ── Deploy gate ───────────────────────────────────────────────────────────
  if (!LIVE_DEPLOY_APPROVED) {
    console.log("\n═══════════════════════════════════════════════════════");
    console.log("  DRY-RUN COMPLETE — no transaction broadcast.");
    console.log("  LIVE_DEPLOY_APPROVED is not set.");
    console.log("  Boss approval required before live deployment.");
    console.log("  See docs/current/EXECUTOR_READINESS.md.");
    console.log("═══════════════════════════════════════════════════════");
    return;
  }

  // ── Live deploy (REQUIRES Boss approval + LIVE_DEPLOY_APPROVED=true) ──────
  if (chainId !== 42161) {
    console.error("\n❌ Live deploy blocked: must use --network arbitrum (chainId 42161)");
    process.exit(1);
  }

  console.log("\n🔴 LIVE DEPLOYMENT PROCEEDING — Boss approved");
  const contract = await Factory.deploy(
    ARGS.aavePool,
    ARGS.uniV3Router,
    ARGS.ramsesPool,
    ARGS.weth,
    ARGS.usdc,
    ARGS.profitRecipient
  );
  await contract.waitForDeployment();
  const deployedAddr = await contract.getAddress();

  console.log(`\n✅ Deployed: ${deployedAddr}`);
  console.log(`   Tx hash:  ${contract.deploymentTransaction().hash}`);
  console.log("\nNext step: run preflight_ramses_executor.js --verify to confirm deployment.");
}

main().catch((e) => {
  console.error("Deploy script failed:", e.message);
  process.exit(1);
});
