const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deploying contract with the account:", deployer.address);

    const FlashLoanProviderAddress = "0xYourFlashLoanProviderAddress"; // Replace with actual address
    const BatchArbitrageExecutor = await hre.ethers.getContractFactory("BatchArbitrageExecutor");
    const batchExecutor = await BatchArbitrageExecutor.deploy(FlashLoanProviderAddress);

    await batchExecutor.deployed();

    console.log("BatchArbitrageExecutor deployed to:", batchExecutor.address);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
