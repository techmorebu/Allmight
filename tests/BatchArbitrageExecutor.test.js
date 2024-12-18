const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchArbitrageExecutor", function () {
    it("Should execute arbitrage and transfer profits", async function () {
        const [owner] = await ethers.getSigners();
        const FlashLoanProvider = "0xYourFlashLoanProviderAddress"; // Mock address for testing

        const BatchArbitrageExecutor = await ethers.getContractFactory("BatchArbitrageExecutor");
        const batchExecutor = await BatchArbitrageExecutor.deploy(FlashLoanProvider);

        await batchExecutor.deployed();

        // Simulate arbitrage execution
        const tokenIn = "0xTokenInAddress"; // Mock token address
        const tokenOut = "0xTokenOutAddress"; // Mock token address
        const amountIn = ethers.utils.parseUnits("1000", 18); // Mock amount

        // Call the executeArbitrage function
        await batchExecutor.executeArbitrage(tokenIn, tokenOut, amountIn);

        // Add your assertions for profit distribution here
    });
});
