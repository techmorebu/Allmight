const { connectToDYDXWebSocket, fetchActiveMarkets, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Fetch active markets
        const activeMarkets = await fetchActiveMarkets();
        logger.info(`Fetched ${activeMarkets.length} active markets.`);

        // Limit markets for testing
        const testMarkets = activeMarkets.slice(0, 2); // Example: Take the first 2 markets
        logger.info(`Testing with markets: ${testMarkets.join(', ')}`);

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Connect to WebSocket
        const ws = connectToDYDXWebSocket();

        // Subscribe to markets
        await subscribeToMarkets(ws, testMarkets);

        // Simulate order book message processing
        const mockOrderBookMessage = {
            type: 'snapshot',
            id: 'ZEC-USD',
            contents: {
                bids: [{ price: '30.00', size: '1.5' }],
                asks: [{ price: '30.10', size: '1.2' }],
            },
        };
        await redis.set(`dydx:orderbook:${mockOrderBookMessage.id}`, JSON.stringify(mockOrderBookMessage));
        logger.info(`Test: Stored mocked order book data for ${mockOrderBookMessage.id}`);

        // Verify cached data
        const cachedData = await redis.get(`dydx:orderbook:${mockOrderBookMessage.id}`);
        logger.info(`Cached Data: ${cachedData}`);

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
