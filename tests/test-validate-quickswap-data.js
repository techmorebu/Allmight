const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');

const validateQuickSwapData = async () => {
    const redisClient = createClient();
    redisClient.on('error', (err) => logger.error('Redis Client Error', err));

    try {
        await redisClient.connect();
        logger.info('Redis client connected for QuickSwap validation.');

        // Example validation for QuickSwap pool data
        const poolData = await redisClient.get('quickswap:pools');
        if (!poolData) {
            logger.error('No QuickSwap pool data found in Redis.');
        } else {
            logger.info('QuickSwap pool data validated successfully.');
        }
    } catch (error) {
        logger.error(`Error during QuickSwap data validation: ${error.message}`);
    } finally {
        await redisClient.disconnect();
        logger.info('Redis client disconnected after QuickSwap validation.');
    }
};

validateQuickSwapData();
