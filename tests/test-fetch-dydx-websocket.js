// Test for dYdX WebSocket data processing
const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

async function testDYDXFetcher() {
    logger.info('Starting dYdX WebSocket fetcher test...');

    try {
        connectToDYDX();

        // Wait for a few seconds to allow data to populate Redis
        setTimeout(async () => {
            const key = 'dydx:BTC-USD:orderbook';
            const data = await redis.get(key);

            if (data) {
                logger.info(`Data fetched from Redis: ${data}`);
            } else {
                logger.error('No data found in Redis for BTC-USD');
            }
        }, 5000);
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
    } finally {
        logger.info('Test completed.');
        redis.quit();
    }
}

testDYDXFetcher();
