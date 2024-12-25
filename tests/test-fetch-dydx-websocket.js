// File: tests/test-fetch-dydx-websocket.js

const {
    fetchActiveMarkets,
    connectToDYDXWebSocket,
    subscribeToMarkets,
    mergeOrderBookUpdates, // Import this function
} = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');
        
        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Mock WebSocket connection
        const websocket = connectToDYDXWebSocket();
        logger.info('Connected to dYdX WebSocket');

        // Simulate storing a snapshot
        const mockSnapshot = {
            type: 'snapshot',
            id: 'ZEC-USD',
            contents: {
                bids: [{ price: '30.00', size: '1.5' }],
                asks: [{ price: '30.10', size: '1.2' }],
            },
        };
        await redis.set(`dydx:orderbook:${mockSnapshot.id}`, JSON.stringify(mockSnapshot.contents));
        logger.info('Test: Stored mocked order book snapshot in Redis');

        // Simulate an update
        const mockUpdate = {
            type: 'update',
            id: 'ZEC-USD',
            contents: {
                bids: [{ price: '30.00', size: '2.0' }], // Updated size
                asks: [{ price: '30.20', size: '1.0' }], // New price level
            },
        };
        const currentSnapshot = JSON.parse(await redis.get(`dydx:orderbook:${mockSnapshot.id}`));
        const updatedSnapshot = mergeOrderBookUpdates(currentSnapshot, mockUpdate.contents);

        // Store updated snapshot
        await redis.set(`dydx:orderbook:${mockUpdate.id}`, JSON.stringify(updatedSnapshot));
        logger.info('Test: Updated and stored order book in Redis');
        
        // Clean up
        redis.disconnect();
        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
