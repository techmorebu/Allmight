const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Fetch active markets
        const markets = await fetchActiveMarkets();
        logger.info(`Fetched ${markets.length} active markets.`);

        // Limit markets for testing
        const testMarkets = markets.slice(0, 2); // Example: Use only 2 markets for testing
        logger.info(`Testing with markets: ${testMarkets.join(', ')}`);

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Connect to WebSocket
        const ws = connectToDYDXWebSocket();

        // Wait for WebSocket to open before subscribing
        ws.on('open', async () => {
            await subscribeToMarkets(ws, testMarkets);
            logger.info('Test completed successfully.');
            redis.disconnect();
        });

        ws.on('error', (error) => {
            logger.error(`WebSocket error: ${error.message}`);
        });
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
