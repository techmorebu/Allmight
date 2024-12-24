const { fetchMarkets, connectToDYDX } = require('../data-collection/fetch-dydx-data');
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

async function testDYDXFetcher() {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');

        // Fetch markets from dYdX REST API
        const markets = await fetchMarkets();
        if (markets.length === 0) {
            throw new Error('No markets available to subscribe.');
        }
        logger.info(`Fetched markets: ${markets.join(', ')}`);

        // Simulate WebSocket connection
        logger.info('Connecting to dYdX WebSocket...');
        connectToDYDX(markets);

        // Verify data in Redis after a delay (allow time for subscriptions and updates)
        setTimeout(async () => {
            for (const market of markets) {
                const bestBid = await redis.get(`dydx:${market}:bid`);
                const bestAsk = await redis.get(`dydx:${market}:ask`);

                if (bestBid && bestAsk) {
                    logger.info(`Redis data for ${market}: Bid: ${bestBid}, Ask: ${bestAsk}`);
                } else {
                    logger.error(`No data found in Redis for market: ${market}`);
                }
            }

            logger.info('Test completed.');
            process.exit(0); // Exit the test
        }, 10000); // 10-second delay
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    }
}

// Run the test
testDYDXFetcher();
