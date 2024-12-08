require('dotenv').config({ path: '../.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { logger } = require('../monitoring/logger');

/**
 * Validate the integration of GMX data fetching, trend analysis, and signal generation.
 */
async function validateIntegration() {
    try {
        logger.info('--- Starting Integration Validation ---');

        // Fetch GMX tickers
        logger.info('Fetching GMX tickers for Arbitrum...');
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');

        logger.info('Fetching GMX tickers for Avalanche...');
        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');

        // Fetch GMX candlesticks
        logger.info('Fetching GMX candlesticks for ETH on Arbitrum...');
        const arbitrumCandles = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');

        logger.info('Fetching GMX candlesticks for AVAX on Avalanche...');
        const avalancheCandles = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');

        // Combine fetched data
        const combinedData = {
            arbitrum: { tickers: arbitrumTickers, candles: arbitrumCandles },
            avalanche: { tickers: avalancheTickers, candles: avalancheCandles },
        };

        logger.info('Fetched GMX data successfully.');

        // Analyze trends
        logger.info('Analyzing trends...');
        const trends = analyzeTrends(combinedData);

        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('Trend analysis failed or returned empty results.');
        }
        logger.info(`Trends analysis completed successfully: ${JSON.stringify(trends, null, 2)}`);

        // Generate trading signals
        logger.info('Generating trading signals...');
        const signals = generateSignals(trends);

        if (!signals || Object.keys(signals).length === 0) {
            throw new Error('Signal generation failed or returned empty results.');
        }
        logger.info(`Trading signals generated successfully: ${JSON.stringify(signals, null, 2)}`);

        logger.info('--- Integration Validation Successful ---');
    } catch (error) {
        logger.error(`Integration validation failed: ${error.message}`);
    }
}

// Execute the validation function
validateIntegration();
