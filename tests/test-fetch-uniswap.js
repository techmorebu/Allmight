const { fetchTopPools, fetchHistoricalDataForToken } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');
        
        const redis = new Redis();
        logger.info('Connected to Redis');
        
        const pools = await fetchTopPools();
        pools.forEach(async (pool) => {
            await redis.set(`uniswap:pool:${pool.id}`, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: uniswap:pool:${pool.id}`);
        });

        if (pools.length > 0) {
            const tokenId = pools[0].token0.id;
            try {
                const historicalData = await fetchHistoricalDataForToken(tokenId);
                if (historicalData.length > 0) {
                    await redis.set(`uniswap:historicalData:${tokenId}`, JSON.stringify(historicalData));
                    logger.info(`Stored historical data for token: ${tokenId}`);
                } else {
                    logger.warn('Historical data is empty, nothing to store.');
                }
            } catch (error) {
                logger.error(`Failed to fetch historical data for token: ${tokenId}. ${error.message}`);
            }
        }

        redis.disconnect();
        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
