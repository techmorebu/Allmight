const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        const activeMarkets = await fetchActiveMarkets();
        logger.info(`Testing with markets: ${activeMarkets.slice(0, 2).join(', ')}`);

        const redis = new Redis();
        logger.info('Connected to Redis');

        const websocket = await connectToDYDXWebSocket();
        await subscribeToMarkets(websocket, activeMarkets.slice(0, 2));

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
