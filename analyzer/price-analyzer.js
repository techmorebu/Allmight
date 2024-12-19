const { fetchCachedData } = require('../utils/fetch-cached-data');
const { executeFlashLoan } = require('../execution/flash-loan-executor');
require('dotenv').config();

async function analyzePrices() {
    const profitThreshold = parseFloat(process.env.ARBITRAGE_PROFIT_THRESHOLD) || 0.01;
    console.log(`Using Profit Threshold: ${(profitThreshold * 100).toFixed(2)}%`);

    // Fetch cached data for GMX, Uniswap, and Thorchain
    const gmxData = await fetchCachedData('GMX:Trade:*');
    const uniswapData = await fetchCachedData('Uniswap:Pool:*');
    const thorchainPools = JSON.parse(await fetchCachedData('Thorchain:Pools')) || [];

    // Extract prices
    const prices = {
        GMX: extractLatestPrice(gmxData),
        Uniswap: extractLatestPrice(uniswapData),
    };
    const thorchainPrices = extractThorchainPrices(thorchainPools);

    console.log('Collected Prices:', { ...prices, Thorchain: thorchainPrices });

    // Compare prices across DEXs and Thorchain
    for (const [dexA, priceA] of Object.entries(prices)) {
        for (const [dexB, priceB] of Object.entries(prices)) {
            if (dexA !== dexB && priceA && priceB) {
                const priceDifference = Math.abs((priceA - priceB) / priceB);
                if (priceDifference >= profitThreshold) {
                    console.log(`✅ Arbitrage Opportunity: ${dexA} -> ${dexB}`);
                    console.log(`Price Difference: ${(priceDifference * 100).toFixed(2)}%`);

                    // Trigger flash loan execution
                    const asset = process.env.FLASH_LOAN_ASSET; // Token to borrow
                    const amount = ethers.utils.parseUnits('1.0', 18); // Example: Borrow 1 token
                    await executeFlashLoan(asset, amount, dexA, dexB);
                }
            }
        }
        for (const [asset, priceB] of Object.entries(thorchainPrices)) {
            if (priceA && priceB) {
                const priceDifference = Math.abs((priceA - priceB) / priceB);
                if (priceDifference >= profitThreshold) {
                    console.log(`✅ Arbitrage Opportunity: ${dexA} -> Thorchain`);
                    console.log(`Asset: ${asset}, Price Diff: ${(priceDifference * 100).toFixed(2)}%`);
                }
            }
        }
    }
}

function extractLatestPrice(data) {
    if (!data || Object.keys(data).length === 0) return null;
    const latestKey = Object.keys(data).sort().pop();
    const latestData = JSON.parse(data[latestKey] || '{}');
    return latestData.price || null;
}

function extractThorchainPrices(pools) {
    const prices = {};
    pools.forEach((pool) => {
        prices[pool.asset] = parseFloat(pool.price);
    });
    return prices;
}

module.exports = { analyzePrices };
