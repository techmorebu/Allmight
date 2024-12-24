const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

/**
 * Test enhanced order book parsing.
 */
function testOrderbookParsing() {
    logger.info('Testing enhanced orderbook parsing...');
    const mockOrderbookMessage = {
        type: 'v3_orderbook',
        contents: {
            market: 'BTC-USD',
            bids: [{ price: '30000', size: '0.1' }],
            asks: [{ price: '30010', size: '0.1' }],
        },
    };

    const { market, bids, asks } = mockOrderbookMessage.contents;
    const bestBid = bids[0] || { price: 'N/A', size: 'N/A' };
    const bestAsk = asks[0] || { price: 'N/A', size: 'N/A' };

    logger.info(`Parsed Data: ${JSON.stringify({ market, bestBid, bestAsk })}`);
}

// Main Test
(async function testDYDXWebSocket() {
    logger.info('Starting dYdX WebSocket fetcher test...');
    testOrderbookParsing();

    try {
        connectToDYDX();
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    }

    logger.info('Test completed.');
})();
