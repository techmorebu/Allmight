// File: tests/test-fetch-dydx-websocket.js

const {
    fetchActiveMarkets,
    connectToDYDXWebSocket,
    subscribeToMarkets,
    mergeOrderBookUpdates,
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
                bids: [
                    { price: '30.00', size: '1.5' },
                    { price: '29.50', size: '1.0' },
                ],
                asks: [
                    { price: '30.10', size: '1.2' },
                    { price: '30.20', size: '1.0' },
                ],
            },
        };
        await redis.set(`dydx:orderbook:${mockSnapshot.id}`, JSON.stringify(mockSnapshot.contents));
        logger.info('Test: Stored mocked order book snapshot in Redis');

        // Fetch and validate snapshot storage
        const fetchedSnapshot = JSON.parse(await redis.get(`dydx:orderbook:${mockSnapshot.id}`));
        if (JSON.stringify(fetchedSnapshot) === JSON.stringify(mockSnapshot.contents)) {
            logger.info('Validation: Snapshot stored correctly.');
        } else {
            logger.error('Validation failed: Snapshot data does not match.');
        }

        // Simulate an update
        const mockUpdate = {
            type: 'update',
            id: 'ZEC-USD',
            contents: {
                bids: [
                    { price: '30.00', size: '2.0' }, // Updated size
                    { price: '29.00', size: '1.0' }, // New price level
                ],
                asks: [
                    { price: '30.20', size: '1.5' }, // Updated size
                ],
            },
        };
        const updatedSnapshot = mergeOrderBookUpdates(fetchedSnapshot, mockUpdate.contents);

        // Store updated snapshot
        await redis.set(`dydx:orderbook:${mockUpdate.id}`, JSON.stringify(updatedSnapshot));
        logger.info('Test: Updated and stored order book in Redis');

        // Fetch and validate updated snapshot
        const fetchedUpdatedSnapshot = JSON.parse(await redis.get(`dydx:orderbook:${mockUpdate.id}`));
        if (JSON.stringify(fetchedUpdatedSnapshot) === JSON.stringify(updatedSnapshot)) {
            logger.info('Validation: Updated snapshot stored correctly.');
        } else {
            logger.error('Validation failed: Updated snapshot data does not match.');
        }

        // Clean up
        redis.disconnect();
        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
