const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

/**
 * Simulate parsing orderbook data
 */
function testOrderbookParsing() {
    logger.info('Testing enhanced orderbook parsing...');
    const testMessage = {
        market: 'BTC-USD',
        bids: [{ price: '30000', size: '0.1' }],
        asks: [{ price: '30010', size: '0.1' }],
    };

    const bestBid = testMessage.bids[0] || { price: 'N/A', size: 'N/A' };
    const bestAsk = testMessage.asks[0] || { price: 'N/A', size: 'N/A' };

    const parsedData = {
        market: testMessage.market,
        bestBid: {
            price: bestBid.price,
            size: bestBid.size,
        },
        bestAsk: {
            price: bestAsk.price,
            size: bestAsk.size,
        },
    };

    logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);
}

/**
 * Main test function
 */
function testDYDXWebSocket() {
    logger.info('Starting dYdX WebSocket fetcher test...');
    testOrderbookParsing();
    connectToDYDX();
    logger.info('Test completed.');
}

// Run the test
testDYDXWebSocket();
