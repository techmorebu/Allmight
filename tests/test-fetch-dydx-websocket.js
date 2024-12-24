const { connectToDYDX, parseOrderbookMessage } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

// Test the orderbook parsing logic
function testOrderbookParsing() {
    logger.info('Testing enhanced orderbook parsing...');
    const mockMessage = {
        type: 'channel_data',
        contents: {
            market: 'BTC-USD',
            bids: [{ price: '30000', size: '0.1' }],
            asks: [{ price: '30010', size: '0.1' }],
        },
    };
    const parsedData = parseOrderbookMessage(mockMessage);
    logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);
}

// Test the WebSocket connection and subscription
async function testDYDXWebSocket() {
    logger.info('Starting dYdX WebSocket fetcher test...');
    try {
        await connectToDYDX();
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    }
    logger.info('Test completed.');
}

// Run all tests
(async () => {
    testOrderbookParsing();
    await testDYDXWebSocket();
})();
