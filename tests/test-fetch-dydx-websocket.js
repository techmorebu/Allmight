// File: tests/test-fetch-dydx-websocket.js
const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');
        const redis = new Redis();

        // Fetch active markets
        const markets = await fetchActiveMarkets();

        // Connect to WebSocket
        const ws = connectToDYDXWebSocket();

        // Subscribe to all active markets
        await subscribeToMarkets(ws, markets);

        // Verify data storage in Redis
        for (const market of markets) {
            const orderBook = await redis.get(`dydx:orderbook:${market}`);
            if (orderBook) {
                logger.info(`Verified stored order book for market: ${market}`);
            } else {
                logger.warn(`No data stored for market: ${market}`);
            }
        }

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
