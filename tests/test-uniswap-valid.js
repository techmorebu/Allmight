const Redis = require("ioredis");
const logger = require("../monitoring/logger.js"); // Ensure logger setup matches your project

const redis = new Redis(); // Connect to Redis instance
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)); // Helper function for delays

async function validateUniswapData() {
    logger.info("Starting Uniswap data validation...");

    // Introduce delay to ensure Redis is updated (optional)
    await delay(1000); 

    try {
        const keys = await redis.keys("uniswap:pool:*");
        logger.info(`Found ${keys.length} pool keys in Redis`);

        for (const poolKey of keys) {
            logger.info(`Validating data for pool key: ${poolKey}`);

            // Validate pool data
            const poolData = await redis.get(poolKey);
            if (poolData) {
                logger.info(`Validated pool data for key: ${poolKey}`);
            } else {
                logger.error(`Pool data missing for key: ${poolKey}`);
                continue;
            }

            // Extract token IDs from the pool data
            const { token0, token1 } = JSON.parse(poolData);
            if (!token0 || !token1) {
                logger.error(`Invalid pool data structure for key: ${poolKey}`);
                continue;
            }

            // Validate historical data for tokens
            for (const token of [token0.id, token1.id]) {
                const tokenKey = `uniswap:token:historical:${token}`;
                const historicalData = await redis.get(tokenKey);

                if (historicalData) {
                    logger.info(`Validated historical data for token: ${token}`);
                } else {
                    logger.warn(`Key not found in Redis: ${tokenKey}`);
                    logger.error(`Invalid or missing historical data for token: ${token}`);
                }
            }
        }

        logger.info("Uniswap data validation completed successfully.");
    } catch (error) {
        logger.error(`Error during Uniswap data validation: ${error.message}`);
    } finally {
        redis.quit();
    }
}

// Execute the validation
validateUniswapData();
