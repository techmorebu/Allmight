const { logger } = require('../monitoring/logger'); // Correct import
const Redis = require('ioredis');

const redis = new Redis();

async function validateUniswapData() {
    try {
        logger.info('Starting Uniswap data validation...');

        // Fetch all keys related to Uniswap pools
        const poolKeys = await redis.keys('uniswap:pool:*');

        if (poolKeys.length === 0) {
            logger.warn('No pool data found in Redis for validation.');
            return;
        }

        for (const key of poolKeys) {
            const poolData = await redis.get(key);

            if (poolData) {
                logger.info(`Validated pool data for key: ${key}`);
            } else {
                logger.warn(`No data found for key: ${key}`);
            }
        }

        // Fetch and validate historical token data
        const tokenKeys = await redis.keys('uniswap:token:historical:*');

        for (const tokenKey of tokenKeys) {
            const tokenData = await redis.get(tokenKey);

            if (tokenData) {
                logger.info(`Validated token historical data for key: ${tokenKey}`);
            } else {
                logger.error(`Missing historical data for token: ${tokenKey}`);
            }
        }

        logger.info('Uniswap data validation completed successfully.');
    } catch (error) {
        logger.error(`Error during validation: ${error.message}`);
    } finally {
        redis.disconnect();
    }
}

validateUniswapData();
