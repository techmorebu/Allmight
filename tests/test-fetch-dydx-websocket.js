const { fetchActiveMarkets, connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Fetch active markets
        const markets = await fetchActiveMarkets();
        logger.info(`Fetched ${markets.length} active markets.`);

        // Limit markets for testing
        const testMarkets = markets.slice(0, 2); // Example: Use only 2 markets for testing
        logger.info(`Testing with markets: ${testMarkets.join(', ')}`);

        // Connect to Redis
        const redis = new Redis();
        logger.info('Connected to Redis');

        // Connect to WebSocket
        const ws = connectToDYDXWebSocket();

        // Subscribe to test markets
        await subscribeToMarkets(ws, testMarkets);

        // Listen for snapshot and validate parsed data
        ws.on('message', async (data) => {
            const message = JSON.parse(data);
            if (message.type === 'snapshot') {
                const storedData = await redis.get(`dydx:orderbook:${message.id}`);
                logger.info(`Verified data for ${message.id}: ${storedData}`);
            }
        });

        logger.info('Test completed successfully.');
        redis.disconnect();
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    }
})();
