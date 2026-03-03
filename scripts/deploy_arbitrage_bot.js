// scripts/deploy_arbitrage_bot.js
// Deploys ArbitrageBot v2 to Arbitrum mainnet
// Run: npx hardhat run scripts/deploy_arbitrage_bot.js --network arbitrum

const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("=".repeat(56));
  console.log("  Deploying ArbitrageBot v2");
  console.log("=".repeat(56));
  console.log("  Deployer:", deployer.address);

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("  Balance: ", hre.ethers.formatEther(bal), "ETH");

  if (hre.ethers.formatEther(bal) < 0.005) {
    throw new Error("Insufficient ETH for deployment (need ~0.005 ETH)");
  }

  console.log("\n  Compiling...");
  const Factory = await hre.ethers.getContractFactory("ArbitrageBot");

  console.log("  Deploying...");
  const bot = await Factory.deploy();
  await bot.waitForDeployment();

  const addr = await bot.getAddress();
  console.log("\n  ✅ ArbitrageBot v2 deployed!");
  console.log("  Address:", addr);
  console.log("  Arbiscan: https://arbiscan.io/address/" + addr);

  // ── Update .env automatically ─────────────────────────────────────────────
  const envPath = path.join(__dirname, "../.env");
  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, "utf8");
    const oldLine = env.match(/ARBITRAGE_BOT_ADDRESS=.*/)?.[0];
    if (oldLine) {
      env = env.replace(oldLine, `ARBITRAGE_BOT_ADDRESS=${addr}`);
      fs.writeFileSync(envPath, env);
      console.log("\n  ✅ .env updated: ARBITRAGE_BOT_ADDRESS=" + addr);
      if (oldLine) console.log("  Old address:", oldLine.split("=")[1]);
    } else {
      console.log("\n  ⚠️  ARBITRAGE_BOT_ADDRESS not found in .env -- add manually:");
      console.log("  ARBITRAGE_BOT_ADDRESS=" + addr);
    }
  }

  // ── Verify initial contract state ─────────────────────────────────────────
  const slippage   = await bot.slippageBps();
  const minProfit  = await bot.minProfitUsd();
  const owner      = await bot.owner();
  console.log("\n  Contract state:");
  console.log("  slippageBps:  ", slippage.toString(), "(0.20%)");
  console.log("  minProfitUsd: ", minProfit.toString(), "($0.01 USDT)");
  console.log("  owner:        ", owner);
  console.log("\n  Next steps:");
  console.log("  1. Clear live_state.json:");
  console.log("     python3 -c \"import json; s=open('logs/live_state.json'); d=json.load(s); d['consecutive_reverts']=0; d['paused_until']=0; d['trade_times']=[]; open('logs/live_state.json','w').write(json.dumps(d))\"");
  console.log("  2. Verify: python3 check_contract.py");
  console.log("  3. Watch:  tail -f logs/shadow.log | grep LIVE");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
