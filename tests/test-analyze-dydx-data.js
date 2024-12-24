const { analyzeOrderBookData } = require('../data-collection/analyze-dydx-data');
const logger = require('../monitoring/logger');

(async () => {
    logger.info('Testing dYdX order book analysis...');
    try {
        const sampleParsedData = {
            market: 'BTC-USD',
            bestBid: { price: '30000', size: '0.1' },
            bestAsk: { price: '30010', size: '0.1' },
        };

        const insights = analyzeOrderBookData(sampleParsedData);
        logger.info(`Analyzed Insights: ${JSON.stringify(insights)}`);
    } catch (error) {
        logger.error(`Error during test: ${error.message}`);
    } finally {
        logger.info('Analysis test completed.');
    }
})();
