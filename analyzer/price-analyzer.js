const { fetchCachedData } = require('../utils/fetch-cached-data');
require('dotenv').config();

/**
 * Analyze prices from multiple DEXs and detect arbitrage opportunities.
 */
async function analyzePrices() {
    try {
        // Load profit threshold dynamically from .env or use default
        const profitThreshold = parseFloat(process.env.ARBITRAGE_PROFIT_THRESHOLD) || 0.01;
        console.log(`Using Profit Threshold: ${(profitThreshold * 100).toFixed(2)}%`);

        console.log('Fetching cached price data...');
        
        // Fetch cached data for all DEXs
        const gmxData = await fetchCachedData('GMX:Trade:*');
        const uniswapData = await fetchCachedData('Uniswap:Pool:*');
        const dydxData = await fetchCachedData('dYdX:Trades:*');
        const xrplData = await fetchCachedData('XRPL:Ledger:*');

        const prices = {
            GMX: extractLatestPrice(gmxData),
            Uniswap: extractLatestPrice(uniswapData),
            dYdX: extractLatestPrice(dydxData),
            XRPL: extractLatestPrice(xrplData),
        };

        console.log('Collected Prices:', prices);

        // Compare prices and detect arbitrage opportunities
        for (const [dexA, priceA] of Object.entries(prices)) {
            for (const [dexB, priceB] of Object.entries(prices)) {
                if (dexA !== dexB && priceA && priceB) {
                    const priceDifference = Math.abs((priceA - priceB) / priceB);
                    if (priceDifference >= profitThreshold) {
                        console.log(
                            `✅ Arbitrage Opportunity Detected: ${dexA} -> ${dexB}`
                        );
                        console.log(`   Price Difference: ${(priceDifference * 100).toFixed(2)}%`);
                        console.log(`   ${dexA} Price: ${priceA}, ${dexB} Price: ${priceB}`);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Error analyzing prices:', error.message);
    }
}

/**
 * Extract the latest price from cached data
 * @param {object} data - Cached data from Redis
 * @returns {number|null} - Latest price or null if not available
 */
function extractLatestPrice(data) {
    if (!data || Object.keys(data).length === 0) return null;

    const latestKey = Object.keys(data).sort().pop();
    const latestData = JSON.parse(data[latestKey] || '{}');

    // Modify this logic based on the structure of your cached data
    return latestData.price || latestData.close || null;
}

module.exports = { analyzePrices };
