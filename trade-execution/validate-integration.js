require('dotenv').config({ path: '../.env' });
const { runDataPipeline } = require('./data-pipeline');
const { logger } = require('../monitoring/logger');

async function validateIntegration() {
    try {
        logger.info('--- Starting Integration Validation ---');

        // Step 1: Run the data pipeline
        logger.info('Running data pipeline...');
        await runDataPipeline();
        logger.info('Data pipeline completed successfully.');

        // Step 2: Validate data fetching for GMX
        logger.info('Validating GMX data fetching...');
        const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');

        // Test fetching GMX tickers for Arbitrum and Avalanche
        const arbitrumTickers = await fetchGmxData('arbitrum', 'tickers');
        logger.info('Arbitrum GMX Tickers fetched successfully:', JSON.stringify(arbitrumTickers, null, 2));

        const avalancheTickers = await fetchGmxData('avalanche', 'tickers');
        logger.info('Avalanche GMX Tickers fetched successfully:', JSON.stringify(avalancheTickers, null, 2));

        // Test fetching GMX candlesticks for specific tokens
        const arbitrumCandlesticks = await fetchGmxCandlesticks('arbitrum', 'ETH', '1d');
        logger.info('Arbitrum GMX Candlesticks fetched successfully:', JSON.stringify(arbitrumCandlesticks, null, 2));

        const avalancheCandlesticks = await fetchGmxCandlesticks('avalanche', 'AVAX', '1d');
        logger.info('Avalanche GMX Candlesticks fetched successfully:', JSON.stringify(avalancheCandlesticks, null, 2));

        logger.info('GMX data validation completed successfully.');

        // Final validation message
        logger.info('--- Integration Validation Successful ---');
    } catch (error) {
        logger.error(`Integration validation failed: ${error.message}`);
    }
}

validateIntegration();
