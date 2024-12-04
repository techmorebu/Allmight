require('dotenv').config();
const { fetchGmxTokenPrices, fetchGmxPairs } = require('./fetch-gmx-data');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Step 1: Fetch GMX token prices and pairs
        logger.info('Fetching GMX token prices...');
        const tokenPrices = await fetchGmxTokenPrices('arbitrum');
        const pairs = await fetchGmxPairs('arbitrum');

        if (!tokenPrices || !pairs) {
            logger.error('Failed to fetch GMX data. Aborting pipeline.');
            return;
        }

        logger.info('GMX token prices and pairs fetched successfully.');

        // Step 2: Analyze trends
        logger.info('Analyzing trends...');
        const trends = analyzeTrends(tokenPrices);

        if (!trends || Object.keys(trends).length === 0) {
            logger.error('No trends generated from analysis. Aborting pipeline.');
            return;
        }

        // Step 3: Generate trading signals
        logger.info('Generating trading signals...');
        const signal = generateSignals(trends);
        logger.info('Generated Signals:', JSON.stringify(signal, null, 2));
    } catch (error) {
        logger.error(`Error in data pipeline: ${error.message}`);
    }
}

runDataPipeline();
