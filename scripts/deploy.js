const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying SimpleStorage contract...");
 
  // Get the contract factory
  const SimpleStorage = await ethers.getContractFactory("SimpleStorage");

  // Deploy the contract
  const simpleStorage = await SimpleStorage.deploy();

  // Wait until the contract is deployed
  await simpleStorage.deployed();
  console.log("Factory:", SimpleStorage);
  console.log("Deployed Contract:", simpleStorage);
  // Output the contract address
  console.log("SimpleStorage deployed to:", simpleStorage.address);
}



// Execute the script
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error deploying contract:", error);
    process.exit(1);
  });
