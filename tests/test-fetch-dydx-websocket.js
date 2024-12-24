const { connectToDYDXWebSocket } = require('../data-collection/fetch-dydx-data');
const logger = require('../monitoring/logger');

(async () => {
    logger.info('Starting dYdX WebSocket fetcher test...');
    try {
        const markets = ['BTC-USD', 'ETH-USD'];
        const onMessage = (message) => {
            logger.info(`Received data: ${JSON.stringify(message)}`);
        };

        await connectToDYDXWebSocket(markets, onMessage);
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    } finally {
        logger.info('Test completed.');
    }
})();
