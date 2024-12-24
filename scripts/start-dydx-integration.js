const { connectToDYDXWebSocket } = require('../data-collection/fetch-dydx-data');
const { parseDYDXOrderBook } = require('../data-collection/parse-dydx-data');
const { analyzeOrderBookData } = require('../data-collection/analyze-dydx-data');
const logger = require('../monitoring/logger');

(async () => {
    logger.info('Starting dYdX Integration Test...');

    try {
        logger.info('Testing WebSocket connection...');

        // Define markets to test
        const markets = ['BTC-USD', 'ETH-USD'];

        // Start WebSocket connection
        await connectToDYDXWebSocket(markets, (rawMessage) => {
            try {
                // Parse raw message
                const parsedData = parseDYDXOrderBook(rawMessage);
                logger.info(`Parsed Data: ${JSON.stringify(parsedData)}`);

                // Analyze parsed data
                const insights = analyzeOrderBookData(parsedData);
                logger.info(`Trading Insights: ${JSON.stringify(insights)}`);
            } catch (error) {
                logger.error(`Error during data parsing or analysis: ${error.message}`);
            }
        });

        logger.info('WebSocket connection successful and data processing tested.');
    } catch (error) {
        logger.error(`Test Failed: ${error.message}`);
    } finally {
        logger.info('Integration Test Completed.');
    }
})();
