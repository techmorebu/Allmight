// File: tests/test-fetch-dydx-websocket.js

const {
    connectToDYDXWebSocket,
    subscribeToMarkets,
    parseOrderBook,
    saveOrderBookToRedis,
} = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Simulate enhanced orderbook parsing
        logger.info('Testing enhanced orderbook parsing...');
        const mockOrderbook = {
            asks: [
                { price: '30010', size: '0.1' },
                { price: '30020', size: '0.2' },
            ],
            bids: [
                { price: '30000', size: '0.1' },
                { price: '29990', size: '0.2' },
            ],
            timestamp: Date.now(),
        };
        const parsedOrderbook = parseOrderBook(mockOrderbook);
        logger.info(`Parsed Data: ${JSON.stringify(parsedOrderbook)}`);

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Connect to dYdX WebSocket
        const websocket = await connectToDYDXWebSocket();

        // Subscribe to markets
        const markets = ['BTC-USD', 'ETH-USD'];
        await subscribeToMarkets(websocket, markets);

        // Mock storing orderbook data in Redis
        for (const market of markets) {
            saveOrderBookToRedis(market, parsedOrderbook);
            logger.info(`Stored orderbook for ${market}`);
        }

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
