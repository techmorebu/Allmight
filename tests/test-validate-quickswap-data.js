const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

// Create a Redis client instance
const redis = new Redis();

async function validateQuickSwapData() {
    try {
        logger.info('Starting QuickSwap data validation...');
        
        // Fetch all keys for QuickSwap pools from Redis
        const keys = await redis.keys('quickswap:pool:*');
        if (keys.length === 0) {
            logger.error('No QuickSwap pool data found in Redis.');
            return;
        }

        // Validate each pool data
        for (const key of keys) {
            const poolData = await redis.get(key);
            if (!poolData) {
                logger.error(`No data found for key: ${key}`);
            } else {
                logger.info(`Validated pool data for key: ${key}`);
            }
        }

        logger.info('QuickSwap data validation completed successfully.');
    } catch (error) {
        logger.error(`Error during QuickSwap data validation: ${error.message}`);
    } finally {
        // Ensure Redis connection is closed
        redis.quit();
    }
}

// Run the validation function
validateQuickSwapData();
