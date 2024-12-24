const { connectToDYDX } = require('../data-collection/fetch-dydx-data');
const { logger } = require('../monitoring/logger');

/**
 * Mock handler to process incoming orderbook data
 */
function handleOrderbookData(message) {
    const { id, bids, asks } = message.contents || {};

    if (!id || !bids || !asks) {
        logger.warn(`Incomplete orderbook data: ${JSON.stringify(message)}`);
        return;
    }

    const bestBid = bids[0];
    const bestAsk = asks[0];

    const parsedData = {
        market: id,
        bestBid: { price: bestBid[0], size: bestBid[1] },
        bestAsk: { price: bestAsk[0], size: bestAsk[1] },
    };

    logger.info(`Parsed Orderbook Data: ${JSON.stringify(parsedData)}`);
}

/**
 * Test the dYdX WebSocket implementation
 */
async function testDYDXWebSocket() {
    logger.info('Starting dYdX WebSocket fetcher test...');
    connectToDYDX(['BTC-USD', 'ETH-USD'], handleOrderbookData);
    logger.info('Test completed.');
}

testDYDXWebSocket();
