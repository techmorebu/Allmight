const { fetchTopPools, fetchTokenHistoricalData } = require('../data-collection/fetch-uniswap-data');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

(async () => {
    const redis = new Redis();

    try {
        logger.info('Starting Uniswap fetcher test...');

        // Fetch top pools and store in Redis
        const topPools = await fetchTopPools(redis);
        if (!topPools) {
            logger.warn('No top pools fetched, exiting test.');
            return;
        }

        // Fetch historical data for tokens in the top pools
        for (const pool of topPools) {
            await fetchTokenHistoricalData(pool.token0.id, redis);
            await fetchTokenHistoricalData(pool.token1.id, redis);
        }

        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    } finally {
        redis.disconnect();
    }
})();
