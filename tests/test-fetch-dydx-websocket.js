const {
    fetchActiveMarkets,
    connectToDYDXWebSocket,
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

        // Mock snapshot
        const mockSnapshot = {
            bids: [{ price: '30.00', size: '1.5' }],
            asks: [{ price: '30.10', size: '1.2' }],
        };
        await redis.set('dydx:orderbook:TEST-MARKET', JSON.stringify(mockSnapshot));
        logger.info('Mock snapshot stored successfully.');

        // Mock update
        const mockUpdate = {
            bids: [{ price: '30.00', size: '2.0' }], // Updated size
            asks: [{ price: '30.10', size: '0' }], // Removed level
        };
        const currentSnapshot = JSON.parse(await redis.get('dydx:orderbook:TEST-MARKET'));
        const updatedSnapshot = mergeOrderBookUpdates(currentSnapshot, mockUpdate);

        await redis.set('dydx:orderbook:TEST-MARKET', JSON.stringify(updatedSnapshot));
        logger.info('Updated snapshot stored successfully.');

        redis.disconnect();
        logger.info('Test completed successfully.');
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
