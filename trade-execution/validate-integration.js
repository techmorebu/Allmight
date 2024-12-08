require('dotenv').config({ path: '../.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { logger } = require('../monitoring/logger');

async function validateIntegration() {
    try {
        logger.info('--- Starting Integration Validation ---');

        logger.info('Fetching GMX data...');
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');
        const arbitrumCandles = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        const avalancheCandles = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');

        const combinedData = {
            arbitrum: { tickers: arbitrumTickers, candles: arbitrumCandles },
            avalanche: { tickers: avalancheTickers, candles: avalancheCandles },
        };
        logger.info('Fetched GMX data successfully.');

        logger.info('Analyzing trends...');
        const trends = analyzeTrends(combinedData);

        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('Trend analysis failed.');
        }
        logger.info(`Trends analysis completed: ${JSON.stringify(trends, null, 2)}`);

        logger.info('Generating trading signals...');
        const signals = generateSignals(trends);

        if (!signals || Object.keys(signals).length === 0) {
            throw new Error('Signal generation failed.');
        }
        logger.info(`Trading signals generated: ${JSON.stringify(signals, null, 2)}`);

        logger.info('--- Integration Validation Successful ---');
    } catch (error) {
        logger.error(`Integration validation failed: ${error.message}`);
    }
}

module.exports = { validateIntegration };
