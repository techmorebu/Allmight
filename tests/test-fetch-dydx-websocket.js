const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Fetch active markets
        const markets = await fetchActiveMarkets();

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Connect to dYdX WebSocket
        const ws = connectToDYDXWebSocket();

        // Subscribe to markets
        await subscribeToMarkets(ws, markets.slice(0, 2)); // Test with the first two markets
        logger.info(`Subscribed to markets: ${markets.slice(0, 2).join(', ')}`);

        // Mock storing orderbook data in Redis
        ws.on('message', async (data) => {
            const message = JSON.parse(data);
            if (message.type === 'snapshot') {
                await redis.set(`dydx:orderbook:${message.id}`, JSON.stringify(message.contents));
                logger.info(`Stored order book for ${message.id}`);
            }
        });

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
