const { connectToDYDX, startFetcher } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

async function testDYDXIntegration() {
    try {
        logger.info('Starting dYdX Integration Test...');
        logger.info('Testing WebSocket connection...');

        const ws = await connectToDYDX();

        logger.info('WebSocket connection successful. Proceeding with fetcher...');
        startFetcher(['BTC-USD', 'ETH-USD']);

        logger.info('Integration Test Completed.');
    } catch (error) {
        logger.error(`Test Failed: ${error.message}`);
    }
}

testDYDXIntegration();
