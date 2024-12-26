const { fetchPools, storePoolsInRedis } = require('../data-collection/fetch-uniswap-data');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Fetch pools
        const pools = await fetchPools();
        if (!pools || pools.length === 0) {
            logger.error('No pools fetched.');
            return;
        }

        logger.info('Pools fetched successfully:');
        pools.forEach(pool => {
            logger.info(`${pool.token0.symbol}/${pool.token1.symbol}: TVL $${pool.totalValueLockedUSD}`);
        });

        // Store pools in Redis
        await storePoolsInRedis(pools);
        logger.info('Test completed successfully.');

        // Validate Redis storage
        const samplePool = await redis.get(`uniswap:pool:${pools[0].id}`);
        if (samplePool) {
            logger.info('Validation: Sample pool data retrieved from Redis:');
            logger.info(JSON.parse(samplePool));
        } else {
            logger.error('Validation failed: Sample pool data not found in Redis.');
        }

        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
