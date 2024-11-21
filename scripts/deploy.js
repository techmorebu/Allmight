const { ethers } = require("hardhat");

async function main() {
  // Get the contract factory
  const SimpleStorage = await ethers.getContractFactory("SimpleStorage");

  // Deploy the contract
  const simpleStorage = await SimpleStorage.deploy();

  // Wait for deployment to be mined
  await simpleStorage.deployed();

  console.log("Contract deployed to:", simpleStorage.address);
}

// Execute the deployment script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
