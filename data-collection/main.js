const { fetchTokenPrices } = require("./fetchData");
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
    } catch (error) {
        logger.error(`Error in data collection: ${error.message}`);
    }
}

main();
