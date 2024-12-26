// File: tests/test-fetch-uniswap.js
require('dotenv').config(); // Load environment variables
const { fetchPoolsData, cachePoolsData } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');
        
        // Connect to Redis
        const redis = new Redis(process.env.REDIS_URL || undefined);
        logger.info('Connected to Redis');

        // Fetch pools data
        const pools = await fetchPoolsData();

        // Log fetched pools for validation
        logger.info(`Test: Fetched Pools Data: ${JSON.stringify(pools, null, 2)}`);

        // Cache pools data
        await cachePoolsData(pools);
        logger.info('Test: Cached pools data in Redis successfully.');

        // Validate Redis storage
        const cachedData = JSON.parse(await redis.get('uniswap:pools'));
        if (cachedData.length === pools.length) {
            logger.info('Validation: Redis storage matches fetched data.');
        } else {
            throw new Error('Validation failed: Redis data mismatch.');
        }

        redis.disconnect();
        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
