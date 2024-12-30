const Redis = require('ioredis');
const { fetchTopPools, fetchTokenHistoricalData } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');

(async () => {
    try {
        logger.info('Starting Uniswap fetcher test...');
        const redis = new Redis();
        const pools = await fetchTopPools();

        for (const pool of pools) {
            const poolKey = `uniswap:pool:${pool.id}`;
            await redis.set(poolKey, JSON.stringify(pool));
            logger.info(`Stored pool data in Redis: ${poolKey}`);

            const tokenIds = [pool.token0.id, pool.token1.id];
            for (const tokenId of tokenIds) {
                const historicalData = await fetchTokenHistoricalData(tokenId);
                if (historicalData) {
                    const tokenKey = `uniswap:token:${tokenId}:historical`;
                    await redis.set(tokenKey, JSON.stringify(historicalData));
                    logger.info(`Stored historical data for token: ${tokenId}`);
                }
            }
        }

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
