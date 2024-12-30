const { logger } = require('../monitoring/logger');
const redis = require('ioredis');
const client = new redis();

async function validateUniswapData() {
    logger.info("Starting Uniswap data validation...");

    try {
        const keys = await client.keys('uniswap:pool:*');
        for (const key of keys) {
            const poolData = await client.get(key);
            if (!poolData) {
                logger.warn(`No data found for pool key: ${key}`);
                continue;
            }

            logger.info(`Validated pool data for key: ${key}`);
        }

        const historicalKeys = await client.keys('uniswap:token:historical:*');
        for (const histKey of historicalKeys) {
            const histData = await client.get(histKey);
            if (!histData) {
                logger.error(`Invalid or missing historical data for token: ${histKey}`);
            } else {
                logger.info(`Validated historical data for token: ${histKey}`);
            }
        }
    } catch (error) {
        logger.error(`Validation failed: ${error.message}`);
    } finally {
        client.disconnect();
    }

    logger.info("Uniswap data validation completed.");
}

validateUniswapData();
