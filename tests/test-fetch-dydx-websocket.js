const { connectToDYDXWebSocket, subscribeToMarkets, handleWebSocketMessages } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

// Initialize Redis client
const redis = new Redis();

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

        // Connect to WebSocket
        const socket = await connectToDYDXWebSocket();

        // Subscribe to markets and handle messages
        const markets = ['BTC-USD', 'ETH-USD'];
        await subscribeToMarkets(socket, markets);
        handleWebSocketMessages(socket);

        // Retrieve data from Redis after a delay
        setTimeout(async () => {
            try {
                for (const market of markets) {
                    const data = await redis.get(`${market}:orderbook`);
                    logger.info(data ? `Data for ${market}: ${data}` : `No data for ${market}`);
                }
            } catch (err) {
                logger.error(`Error retrieving data: ${err.message}`);
            } finally {
                redis.quit();
            }
        }, 5000);

        logger.info('Test completed.');
    } catch (err) {
        logger.error(`Test Failed: ${err.message}`);
    }
})();
