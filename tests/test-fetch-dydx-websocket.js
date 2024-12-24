const { connectToDYDXWebSocket } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

(async () => {
    logger.info('Starting dYdX WebSocket fetcher test...');
    const redis = new Redis();

    try {
        // Mock parsed orderbook parsing test
        logger.info('Testing enhanced orderbook parsing...');
        const sampleOrderBook = {
            asks: [
                { price: '30010', size: '0.1' },
                { price: '30020', size: '0.2' },
            ],
            bids: [
                { price: '30000', size: '0.1' },
                { price: '29990', size: '0.2' },
            ],
        };
        const parsedData = {
            asks: sampleOrderBook.asks.slice(0, 10),
            bids: sampleOrderBook.bids.slice(0, 10),
            timestamp: Date.now(),
        };
        logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);

        // WebSocket test
        await connectToDYDXWebSocket();

        // Data retrieval test
        setTimeout(async () => {
            const storedData = await redis.get('orderbook:BTC-USD');
            if (storedData) {
                logger.info(`Retrieved stored data for BTC-USD: ${storedData}`);
            } else {
                logger.warn('No data for BTC-USD');
            }
            redis.disconnect();
        }, 5000);
    } catch (error) {
        logger.error('Test failed:', error);
    } finally {
        logger.info('Test completed.');
    }
})();
