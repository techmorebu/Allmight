const { fetchTopPools, fetchHistoricalDataForToken } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');
        
        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');
        
        // Fetch and store top pools
        const pools = await fetchTopPools();
        await redis.set('uniswap:topPools', JSON.stringify(pools));
        logger.info('Top pools stored successfully in Redis.');
        
        // Fetch historical data for a specific token
        if (pools.length > 0) {
            const tokenId = pools[0].token0.id;
            const historicalData = await fetchHistoricalDataForToken(tokenId);
            await redis.set(`uniswap:historicalData:${tokenId}`, JSON.stringify(historicalData));
            logger.info('Historical data stored successfully in Redis.');
        }

        redis.disconnect();
        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
