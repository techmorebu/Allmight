const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying SimpleStorage contract...");

  // Get the contract factory
  const SimpleStorage = await ethers.getContractFactory("SimpleStorage");

  // Deploy the contract
  const simpleStorage = await SimpleStorage.deploy();

  // Wait for the deployment to be mined
  await simpleStorage.deployed();

  console.log("SimpleStorage deployed to:", simpleStorage.address);
}

// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
