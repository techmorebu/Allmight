const { fetchTopPools, fetchHistoricalTokenData } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');
        const redis = new Redis();

        // Fetch top pools
        const pools = await fetchTopPools();
        if (!pools) {
            throw new Error('Failed to fetch top pools.');
        }

        // Fetch historical data for each token in the top pools
        for (const pool of pools) {
            await fetchHistoricalTokenData(pool.token0.id);
            await fetchHistoricalTokenData(pool.token1.id);
        }

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
