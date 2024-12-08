require('dotenv').config();
const { fetchGmxTokenPrices } = require('./fetch-gmx-data');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Step 1: Fetch GMX token prices
        logger.info('Fetching GMX token prices...');
        const tokenPrices = await fetchGmxTokenPrices('arbitrum');

        if (!tokenPrices) {
            logger.error('Failed to fetch GMX token prices. Aborting pipeline.');
            return;
        }

        logger.info('GMX token prices fetched successfully.');

        // Step 2: Analyze trends
        logger.info('Analyzing trends...');
        const trends = analyzeTrends(tokenPrices);

        if (!trends || Object.keys(trends).length === 0) {
            logger.error('No trends generated from analysis. Aborting pipeline.');
            return;
        }

        logger.info('Trends generated successfully.');

        // Step 3: Generate trading signals
        logger.info('Generating trading signals...');
        const signal = generateSignals(trends);

        if (!signal || Object.keys(signal).length === 0) {
            logger.error('No trading signals generated. Aborting pipeline.');
            return;
        }

        logger.info('Generated Signals:', JSON.stringify(signal, null, 2));
    } catch (error) {
        logger.error(`Error in data pipeline: ${error.message}`);
    }
}

runDataPipeline();
