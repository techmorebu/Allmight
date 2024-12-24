const { parseDYDXOrderBook } = require('../data-collection/parse-dydx-data');
const logger = require('../monitoring/logger');

(async () => {
    logger.info('Testing dYdX order book parsing...');
    try {
        const sampleRawData = {
            type: 'v3_orderbook_snapshot',
            contents: {
                market: 'BTC-USD',
                asks: [{ price: '30010', size: '0.1' }],
                bids: [{ price: '30000', size: '0.1' }],
            },
        };

        const parsedData = parseDYDXOrderBook(sampleRawData);
        logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    } finally {
        logger.info('Parsing test completed.');
    }
})();
