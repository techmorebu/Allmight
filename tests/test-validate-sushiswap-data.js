require('dotenv').config();
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redisClient = new Redis();

async function validateSushiSwapData() {
    try {
        logger.info('Starting SushiSwap data validation...');

        // Fetch all Redis keys for SushiSwap pools
        const keys = await redisClient.keys('sushiswap:pool:*');
        logger.info(`Found ${keys.length} SushiSwap pool keys in Redis.`);

        if (keys.length === 0) {
            logger.error('No SushiSwap pool data found in Redis.');
            return;
        }

        for (const key of keys) {
            const data = await redisClient.get(key);
            if (!data) {
                logger.error(`No data found for key: ${key}`);
            } else {
                logger.info(`Validated data for key: ${key}`);
            }
        }

        logger.info('SushiSwap data validation complete.');
    } catch (error) {
        logger.error(`Error during validation: ${error.message}`);
    } finally {
        redisClient.disconnect();
        logger.info('Redis connection closed.');
    }
}

validateSushiSwapData();
