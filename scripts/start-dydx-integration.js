const { logger } = require('../monitoring/logger');

async function testFetcherAndParser() {
    logger.info('Starting dYdX Integration Test...');

    try {
        // Simulate fetcher behavior
        logger.info('Testing WebSocket connection...');
        await startFetcher(); // Ensure the fetcher script is running

        // Simulate parser behavior
        logger.info('Testing data parsing...');
        parseRawData(); // Ensure raw data is parsed correctly

        // Simulate analysis behavior
        logger.info('Testing data analysis...');
        analyzeData({
            type: 'orderbook',
            market: 'BTC-USD',
            bestBid: { price: '30000', size: '0.1' },
            bestAsk: { price: '30010', size: '0.1' },
        });
    } catch (error) {
        logger.error(`Test Failed: ${error.message}`);
    }

    logger.info('Integration Test Completed.');
}

testFetcherAndParser();
