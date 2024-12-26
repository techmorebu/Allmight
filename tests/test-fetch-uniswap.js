const { fetchTopPools, fetchTokenDayData } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Fetch top pools
        logger.info('Fetching top pools...');
        const topPools = await fetchTopPools();
        logger.info(`Fetched top pools: ${JSON.stringify(topPools)}`);

        // Store in Redis
        for (const pool of topPools) {
            const key = `uniswap:pool:${pool.id}`;
            await redis.set(key, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: ${key}`);
        }

        // Fetch historical token data
        const tokenId = topPools[0]?.token0?.symbol; // Example: Fetch data for the first token
        if (tokenId) {
            logger.info(`Fetching historical data for token: ${tokenId}`);
            const tokenDayData = await fetchTokenDayData(tokenId);
            logger.info(`Fetched token day data: ${JSON.stringify(tokenDayData)}`);

            // Store in Redis
            await redis.set(`uniswap:token:${tokenId}:history`, JSON.stringify(tokenDayData));
            logger.info(`Stored token day data in Redis: uniswap:token:${tokenId}:history`);
        } else {
            logger.warn('No token ID found for historical data fetch.');
        }

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
