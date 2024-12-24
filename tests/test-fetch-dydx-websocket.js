const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

/**
 * Test dYdX WebSocket Fetcher
 */
async function testDYDXWebSocketFetcher() {
    try {
        logger.info('Starting dYdX WebSocket fetcher test...');
        connectToDYDX();

        logger.info('Test completed.');
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    }
}

testDYDXWebSocketFetcher();
