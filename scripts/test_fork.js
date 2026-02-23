async function main() {
  const block   = await ethers.provider.getBlockNumber();
  const network = await ethers.provider.getNetwork();
  console.log("=================================");
  console.log("  Arbitrum fork connected");
  console.log("  Block:    " + block);
  console.log("  Chain ID: " + network.chainId.toString());
  console.log("=================================");

  // Verify Aave V3 pool address is live on fork
  const aavePool = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
  const code = await ethers.provider.getCode(aavePool);
  console.log("  Aave V3 Pool: " + (code !== "0x" ? "LIVE" : "NOT FOUND"));

  // Verify Uniswap V3 router
  const uniRouter = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const uniCode = await ethers.provider.getCode(uniRouter);
  console.log("  Uniswap V3:   " + (uniCode !== "0x" ? "LIVE" : "NOT FOUND"));

  // Verify Curve ETH/USDT pool
  const curvePool = "0x960ea3e3C7FB317332d990873d354E18d7645590";
  const curveCode = await ethers.provider.getCode(curvePool);
  console.log("  Curve pool:   " + (curveCode !== "0x" ? "LIVE" : "NOT FOUND"));

  console.log("=================================");
  console.log("  Fork ready for ArbitrageBot.sol");
  console.log("=================================");
}

main().catch((err) => {
  console.error("Fork test failed:", err.message);
  process.exit(1);
});
