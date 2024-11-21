const { fetchTokenPrices, fetchLiquidityData } = require("./fetchData");
const { cacheData, getCachedData } = require("./cache");
const { logger } = require("../monitoring/logger");

async function main() {
    try {
        // Fetch and cache token prices
        const tokenPricesCacheKey = "tokenPrices";
        let tokenPrices = await getCachedData(tokenPricesCacheKey);

        if (!tokenPrices) {
            tokenPrices = await fetchTokenPrices();
            await cacheData(tokenPricesCacheKey, tokenPrices, 300); // Cache for 5 minutes
        }
        logger.info("Token Prices:", tokenPrices);

        // Fetch and cache liquidity data
        const liquidityCacheKey = "liquidityData";
        let liquidityData = await getCachedData(liquidityCacheKey);

        if (!liquidityData) {
            liquidityData = await fetchLiquidityData();
            await cacheData(liquidityCacheKey, liquidityData, 300); // Cache for 5 minutes
        }
        logger.info("Liquidity Data:", liquidityData);
    } catch (error) {
        logger.error(`Error in data collection: ${error.message}`);
    }
}

main();
