const { fetchTokenHistoricalData } = require('../data-collection/fetch-uniswap-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    const redis = new Redis();

    try {
        logger.info('Starting Uniswap fetcher test...');
        
        const tokens = [
            '0x160de4468586b6b2f8a92feb0c260fc6cfc743b1',
            '0xea5edef1c6ed1be1bcba4617a1c5a994e9018a43',
            '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        ]; // Replace with tokens from your pool data

        for (const tokenId of tokens) {
            const historicalData = await fetchTokenHistoricalData(tokenId);

            if (historicalData) {
                const redisKey = `uniswap:token:${tokenId}:history`;
                await redis.set(redisKey, JSON.stringify(historicalData));
                logger.info(`Stored historical data for token: ${tokenId}`);
            }
        }

        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    } finally {
        redis.disconnect();
    }
})();
