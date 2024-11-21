require("dotenv").config();
const hre = require("hardhat");

async function main() {
    // Get the contract factory
    const SimpleStorage = await hre.ethers.getContractFactory("SimpleStorage");

    // Deploy the contract
    const simpleStorage = await SimpleStorage.deploy();

    // Wait for the transaction to be mined
    await simpleStorage.waitForDeployment();

    // Get the deployed contract address
    console.log(`SimpleStorage deployed to: ${simpleStorage.target}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
