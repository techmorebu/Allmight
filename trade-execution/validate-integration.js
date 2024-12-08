require('dotenv').config({ path: '../.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { logger } = require('../monitoring/logger');

async function validateIntegration() {
    try {
        logger.info('--- Starting Integration Validation ---');

        // Fetch tickers for Arbitrum and Avalanche
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');

        // Fetch candlestick data
        const arbitrumCandles = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        const avalancheCandles = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');

        const combinedData = {
            arbitrum: { tickers: arbitrumTickers, candles: arbitrumCandles },
            avalanche: { tickers: avalancheTickers, candles: avalancheCandles },
        };

        logger.info('Combined GMX data:', JSON.stringify(combinedData, null, 2));

        // Analyze trends
        const trends = analyzeTrends(combinedData);
        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('Trend analysis failed or returned empty results.');
        }

        logger.info('Trends analysis result:', JSON.stringify(trends, null, 2));

        // Generate trading signals
        const signals = generateSignals(trends);
        if (!signals || Object.keys(signals).length === 0) {
            throw new Error('Signal generation failed or returned empty results.');
        }

        logger.info('Generated trading signals:', JSON.stringify(signals, null, 2));

        logger.info('--- Integration Validation Successful ---');
    } catch (error) {
        logger.error(`Integration validation failed: ${error.message}`);
    }
}

validateIntegration();
