// Required libraries
const Redis = require('ioredis');
const { connectToDYDXWebSocket, subscribeToMarkets } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

// Initialize Redis client
const redis = new Redis();

// Handle Redis connection events
redis.on('error', (err) => {
    logger.error(`Redis error: ${err.message}`);
});

redis.on('connect', () => {
    logger.info('Connected to Redis');
});

(async () => {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Test enhanced orderbook parsing
        logger.info('Testing enhanced orderbook parsing...');
        const mockOrderbookData = {
            market: 'BTC-USD',
            bestBid: { price: '30000', size: '0.1' },
            bestAsk: { price: '30010', size: '0.1' },
        };
        logger.info(`Parsed Data: ${JSON.stringify(mockOrderbookData)}`);

        // Test WebSocket connection
        const socket = await connectToDYDXWebSocket();
        logger.info('Connected to dYdX WebSocket');

        // Subscribe to markets
        const markets = ['BTC-USD', 'ETH-USD'];
        await subscribeToMarkets(socket, markets);

        // Wait for data to be written to Redis
        setTimeout(async () => {
            try {
                // Retrieve data from Redis
                for (const market of markets) {
                    const data = await redis.get(`${market}:orderbook`);
                    if (data) {
                        logger.info(`Data from Redis for ${market}: ${data}`);
                    } else {
                        logger.warn(`No data found in Redis for ${market}`);
                    }
                }
            } catch (err) {
                logger.error(`Error retrieving data from Redis: ${err.message}`);
            } finally {
                redis.quit();
            }
        }, 5000); // Adjust timeout as necessary

        logger.info('Test completed.');
    } catch (err) {
        logger.error(`Test Failed: ${err.message}`);
    }
})();
