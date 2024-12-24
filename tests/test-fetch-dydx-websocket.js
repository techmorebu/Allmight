const { connectToDYDXWebSocket, fetchActiveMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');
        
        // Simulate enhanced orderbook parsing
        logger.info('Testing enhanced orderbook parsing...');
        const mockOrderbook = {
            asks: [{ price: '30010', size: '0.1' }, { price: '30020', size: '0.2' }],
            bids: [{ price: '30000', size: '0.1' }, { price: '29990', size: '0.2' }],
            timestamp: Date.now(),
        };
        logger.info(`Parsed Data: ${JSON.stringify(mockOrderbook)}`);
        
        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Fetch active markets
        const markets = await fetchActiveMarkets();
        if (markets.length === 0) {
            logger.warn('No active markets fetched. Test cannot proceed.');
            redis.disconnect();
            return;
        }

        // Connect to dYdX WebSocket
        const websocket = await connectToDYDXWebSocket();
        logger.info('Connected to dYdX WebSocket');

        // Mock storing orderbook data in Redis
        for (const market of markets) {
            redis.set(`dydx:test:${market}`, JSON.stringify(mockOrderbook));
            logger.info(`Test: Stored mock data for market ${market}`);
        }

        logger.info('Test completed.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
