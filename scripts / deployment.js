// deploy.js
const hre = require("hardhat");

async function main() {
  const UnifiedFlashLoan = await hre.ethers.getContractFactory("UnifiedFlashLoan");
  const aaveAddress = "0xAaveAddress";
  const makerDAOAddress = "0xMakerDAOAddress";
  const uniswapV3Address = "0xUniswapV3Address";
  const balancerAddress = "0xBalancerAddress";

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