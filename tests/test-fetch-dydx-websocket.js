// File: tests/test-fetch-dydx-websocket.js
const { connectToDYDXWebSocket, subscribeToAllMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

(async () => {
    try {
        logger.info('Starting expanded dYdX market coverage test...');

        // Connect to dYdX WebSocket
        const ws = connectToDYDXWebSocket();

        // Subscribe to all active markets
        await subscribeToAllMarkets(ws);

        // Wait for data collection to ensure the WebSocket processes data
        logger.info('Waiting for data collection...');
        await new Promise((resolve) => setTimeout(resolve, 5000));

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
