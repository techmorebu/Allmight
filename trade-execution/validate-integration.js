require('dotenv').config({ path: '../.env' });
const { fetchGmxData, fetchGmxCandlesticks } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('./analyze-trends');
const { generateSignals } = require('./signal-generator');
const { logger } = require('../monitoring/logger');

async function validateIntegration() {
    try {
        logger.info('--- Starting Integration Validation ---');

        // Step 1: Fetch GMX data
        logger.info('Fetching GMX token prices...');
        const tokenPrices = await fetchGmxTokenPrices('arbitrum');

        if (!tokenPrices || Object.keys(tokenPrices).length === 0) {
            throw new Error('Failed to fetch GMX token prices or data is empty.');
        }
        logger.info(`Fetched GMX token prices successfully: ${JSON.stringify(tokenPrices, null, 2)}`);

        // Step 2: Analyze trends
        logger.info('Analyzing trends...');
        const trends = analyzeTrends(tokenPrices);

        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('No trends generated from analysis.');
        }
        logger.info(`Trends analysis completed successfully: ${JSON.stringify(trends, null, 2)}`);

        // Step 3: Generate trading signals
        logger.info('Generating trading signals...');
        const signals = generateSignals(trends);

        if (!signals || Object.keys(signals).length === 0) {
            throw new Error('No trading signals generated.');
        }
        logger.info(`Trading signals generated successfully: ${JSON.stringify(signals, null, 2)}`);

        logger.info('--- Integration Validation Successful ---');
    } catch (error) {
        logger.error(`Integration validation failed: ${error.message}`);
    }
}

// Execute the validation process
validateIntegration();
