const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets, cleanupRedis } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Fetch active markets
        const activeMarkets = await fetchActiveMarkets();
        logger.info(`Fetched ${activeMarkets.length} active markets.`);

        // Select a subset of markets for testing (e.g., BTC-USD and ETH-USD)
        const testMarkets = activeMarkets.slice(0, 2);
        logger.info(`Testing with markets: ${testMarkets.join(', ')}`);

        // Connect to WebSocket
        const websocket = connectToDYDXWebSocket();

        // Subscribe to markets
        await subscribeToMarkets(websocket, testMarkets);

        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    } finally {
        cleanupRedis();
    }
})();
