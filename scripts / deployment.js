// deploy.js
const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const mode = process.env.MODE || "TEST_FIRE";  // Read mode from .env, default to TEST_FIRE if not set
  console.log(`Deploying in ${mode} mode`);

  // Use mode-specific addresses for flash loan providers
  const aaveAddress = mode === "LIVE_FIRE" ? "0xAaveMainnetAddress" : "0xAaveTestnetAddress";
  const makerDAOAddress = mode === "LIVE_FIRE" ? "0xMakerDAOMainnetAddress" : "0xMakerDAOTestnetAddress";
  const uniswapV3Address = mode === "LIVE_FIRE" ? "0xUniswapV3MainnetAddress" : "0xUniswapV3TestnetAddress";
  const balancerAddress = mode === "LIVE_FIRE" ? "0xBalancerMainnetAddress" : "0xBalancerTestnetAddress";

  // Deploy the UnifiedFlashLoan contract
  const UnifiedFlashLoan = await hre.ethers.getContractFactory("UnifiedFlashLoan");
  const flashLoan = await UnifiedFlashLoan.deploy(aaveAddress, makerDAOAddress, uniswapV3Address, balancerAddress);
  await flashLoan.deployed();

  console.log("UnifiedFlashLoan deployed to:", flashLoan.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });