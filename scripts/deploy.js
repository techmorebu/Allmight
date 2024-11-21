const { ethers } = require("hardhat");

async function main() {
  // Get the contract factory
  const SimpleStorage = await ethers.getContractFactory("SimpleStorage");
  console.log("Factory initialized:", SimpleStorage);
  // Deploy the contract
  const simpleStorage = await SimpleStorage.deploy();
  console.log("Deploying SimpleStorage...");
  const simpleStorage = await SimpleStorage.deploy();
  console.log("Transaction hash:", simpleStorage.deployTransaction.hash);
  
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
