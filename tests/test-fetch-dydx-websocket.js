const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

async function testDYDXFetcher() {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Establish WebSocket connection
        connectToDYDX();

        // Wait for data population
        logger.info('Waiting for data...');
        await new Promise(resolve => setTimeout(resolve, 10000));

        // Fetch and validate data
        const markets = ['BTC-USD', 'ETH-USD'];
        for (const market of markets) {
            const marketData = await redis.hgetall(`dydx:${market}`);
            if (marketData && marketData.topAskPrice && marketData.topBidPrice) {
                logger.info(`Market: ${market}`);
                logger.info(`Top Ask: ${marketData.topAskPrice} @ ${marketData.topAskSize}`);
                logger.info(`Top Bid: ${marketData.topBidPrice} @ ${marketData.topBidSize}`);
            } else {
                logger.error(`No data found for market: ${market}`);
            }
        }
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    } finally {
        redis.quit();
        logger.info('Test completed.');
    }
}

testDYDXFetcher();
