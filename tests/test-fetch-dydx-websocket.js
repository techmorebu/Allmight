const { connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');
        
        // Mock order book data
        const mockOrderBookSnapshot = {
            type: 'snapshot',
            id: 'ZEC-USD',
            contents: {
                asks: [{ price: '30.10', size: '1.2' }],
                bids: [{ price: '30.00', size: '1.5' }],
            },
        };
        const mockOrderBookUpdate = {
            type: 'update',
            id: 'ZEC-USD',
            contents: {
                asks: [{ price: '30.10', size: '1.0' }], // Update size
                bids: [{ price: '29.90', size: '0.5' }], // Add new bid
            },
        };

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Connect to WebSocket
        const ws = connectToDYDXWebSocket();
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for connection
        logger.info('WebSocket connection established.');

        // Store snapshot in Redis
        await redis.set(`dydx:orderbook:${mockOrderBookSnapshot.id}`, JSON.stringify(mockOrderBookSnapshot.contents));
        logger.info('Test: Stored mocked order book snapshot in Redis');

        // Simulate handling update
        const currentOrderBook = JSON.parse(await redis.get(`dydx:orderbook:${mockOrderBookSnapshot.id}`));
        const updatedOrderBook = mergeOrderBookUpdates(currentOrderBook, mockOrderBookUpdate.contents);
        await redis.set(`dydx:orderbook:${mockOrderBookSnapshot.id}`, JSON.stringify(updatedOrderBook));
        logger.info('Test: Updated mocked order book in Redis');
        logger.info(`Updated Order Book: ${JSON.stringify(updatedOrderBook)}`);

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
