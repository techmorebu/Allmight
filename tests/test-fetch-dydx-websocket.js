const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

// Test function for dYdX WebSocket fetcher
async function testDYDXFetcher() {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Start WebSocket connection
        connectToDYDX();

        // Delay to allow data to populate in Redis
        logger.info('Waiting for data...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Fetch data from Redis to validate
        const markets = ['BTC-USD', 'ETH-USD'];
        markets.forEach(async (market) => {
            const marketData = await redis.hgetall(`dydx:${market}`);
            if (marketData && marketData.topAskPrice && marketData.topBidPrice) {
                logger.info(`Market: ${market}`);
                logger.info(`Top Ask: ${marketData.topAskPrice} @ ${marketData.topAskSize}`);
                logger.info(`Top Bid: ${marketData.topBidPrice} @ ${marketData.topBidSize}`);
            } else {
                logger.error(`No data found for market: ${market}`);
            }
        });
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    } finally {
        // Cleanup and close Redis connection
        redis.quit();
        logger.info('Test completed.');
    }
}

// Execute the test
testDYDXFetcher();
