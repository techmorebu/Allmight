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

        const websocket = connectToDYDXWebSocket();
        await subscribeToMarkets(websocket, activeMarkets.slice(0, 2));

        const mockOrderBook = {
            market: activeMarkets[0],
            bids: [{ price: 30.00, size: 1.5 }],
            asks: [{ price: 30.10, size: 1.2 }],
            timestamp: Date.now(),
        };
        await redis.set(`dydx:orderbook:${activeMarkets[0]}`, JSON.stringify(mockOrderBook));
        logger.info(`Test: Stored mocked order book data for ${activeMarkets[0]}`);

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
