require('dotenv').config({ path: '../.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Fetch GMX data
        logger.info('Fetching GMX tickers...');
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');
        logger.info('Fetching GMX candlestick data...');
        const arbitrumCandles = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        const avalancheCandles = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');

        // Combine data
        const combinedData = {
            arbitrum: { tickers: arbitrumTickers, candles: arbitrumCandles },
            avalanche: { tickers: avalancheTickers, candles: avalancheCandles },
        };

        logger.info('Analyzing trends...');
        const trends = analyzeTrends(combinedData);

        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('Trend analysis failed or returned empty results.');
        }
        logger.info(`Trends analysis completed: ${JSON.stringify(trends, null, 2)}`);

        logger.info('Generating trading signals...');
        const signals = generateSignals(trends);

        if (!signals || Object.keys(signals).length === 0) {
            throw new Error('Signal generation failed or returned empty results.');
        }
        logger.info(`Trading signals generated: ${JSON.stringify(signals, null, 2)}`);
    } catch (error) {
        logger.error(`Data pipeline failed: ${error.message}`);
    }
}

module.exports = { runDataPipeline };
