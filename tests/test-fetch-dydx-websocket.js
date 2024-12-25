const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');
        
        // Fetch active markets
        const activeMarkets = await fetchActiveMarkets();
        const testMarkets = activeMarkets.slice(0, 2); // Test with 2 markets
        logger.info(`Testing with markets: ${testMarkets.join(', ')}`);

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Simulate order book parsing
        const mockOrderbook = {
            type: 'snapshot',
            id: testMarkets[0],
            contents: {
                bids: [{ price: '30.00', size: '1.5' }],
                asks: [{ price: '30.10', size: '1.2' }],
            },
        };
        await redis.set(`dydx:orderbook:${mockOrderbook.id}`, JSON.stringify(mockOrderbook));
        logger.info(`Test: Stored mocked order book data for ${mockOrderbook.id}`);
        logger.info(`Cached Data: ${JSON.stringify(mockOrderbook)}`);

        // Connect to WebSocket
        const ws = connectToDYDXWebSocket();
        ws.on('open', async () => {
            logger.info('WebSocket connection is open. Proceeding with subscriptions.');
            await subscribeToMarkets(ws, testMarkets);
            logger.info('Test completed successfully.');
            redis.disconnect();
        });

    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
