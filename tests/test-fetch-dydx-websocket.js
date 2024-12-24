const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

async function testDYDXFetcher() {
    logger.info('Starting dYdX WebSocket fetcher test...');
    connectToDYDX();
    logger.info('Test completed.');
}

testDYDXFetcher();
