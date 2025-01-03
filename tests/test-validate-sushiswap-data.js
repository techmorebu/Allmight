const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const validateSushiSwapData = async () => {
    const redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    });

    try {
        logger.info('Starting SushiSwap data validation...');
        await redisClient.connect();

        // Define keys to validate
        const poolKeys = await redisClient.keys('sushiswap:pool:*');
        if (poolKeys.length === 0) {
            logger.error('No SushiSwap pool data found in Redis.');
            return;
        }

        // Validate each pool's data
        for (const key of poolKeys) {
            const poolData = JSON.parse(await redisClient.get(key));
            logger.info(`Validating data for key: ${key}`);

            if (!poolData.id || !poolData.name || !poolData.totalValueLockedUSD) {
                logger.error(`Invalid or missing data in key: ${key}`);
                logger.debug(`Data received: ${JSON.stringify(poolData, null, 2)}`);
                continue;
            }

            logger.info(`Validated data for key: ${key}`);
        }

        logger.info('SushiSwap data validation completed successfully.');
    } catch (error) {
        logger.error(`Error during SushiSwap validation: ${error.message}`);
    } finally {
        await redisClient.disconnect();
    }
};

validateSushiSwapData();
