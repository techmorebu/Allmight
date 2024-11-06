require('dotenv').config();
const { ethers } = require('ethers');
const { executeFlashLoan } = require('../transaction_manager/FlashLoanExecutor');
const { getUniswapPairData } = require('../data_aggregation/UniswapDataFetcher');
const { getBalancerPoolData } = require('../data_aggregation/BalancerDataFetcher');

// Set threshold for minimum profit to execute arbitrage
const MIN_PROFIT_THRESHOLD = ethers.utils.parseUnits("10", 18); // Example threshold in asset units

// Evaluate potential profit for an arbitrage opportunity
async function evaluateArbitrageOpportunity() {
    try {
        const assetA = "ETH"; // Example asset (replace with actual addresses as needed)
        const assetB = "DAI";

        // Fetch data from Uniswap and Balancer for price comparison
        const uniswapData = await getUniswapPairData(assetA, assetB);
        const balancerData = await getBalancerPoolData(assetA, assetB);

        const uniswapPrice = ethers.utils.parseUnits(uniswapData.token0Price, 18);
        const balancerPrice = ethers.utils.parseUnits(balancerData.totalLiquidity, 18);

        // Check for arbitrage profitability
        const potentialProfit = uniswapPrice.sub(balancerPrice).abs();
        if (potentialProfit.gte(MIN_PROFIT_THRESHOLD)) {
            console.log("Arbitrage opportunity found!");
            return true;
        } else {
            console.log("No arbitrage opportunity.");
            return false;
        }
    } catch (error) {
        console.error("Error evaluating arbitrage:", error);
        return false;
    }
}

// Main trading loop
async function startTradingLoop() {
    try {
        const asset = "ETH"; // Example asset (replace as needed)
        const amount = ethers.utils.parseUnits("100", 18); // Example loan amount

        setInterval(async () => {
            const hasOpportunity = await evaluateArbitrageOpportunity();
            if (hasOpportunity) {
                // Execute flash loan if there's a profitable opportunity
                await executeFlashLoan(asset, amount);
            }
        }, 60000); // Runs every minute
    } catch (error) {
        console.error("Error in trading loop:", error);
    }
}

startTradingLoop();
