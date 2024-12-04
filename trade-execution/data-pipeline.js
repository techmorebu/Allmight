require('dotenv').config();
const { fetchTokenPrices } = require('../data-collection/fetchData');
const { fetchGmxTokenPrices, fetchGmxPairs } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Step 1: Fetch CoinGecko Token Prices
        logger.info('Fetching token prices from CoinGecko...');
        const tokenData = await fetchTokenPrices();
        logger.info('Fetched CoinGecko data successfully:', JSON.stringify(tokenData, null, 2));

        // Step 2: Fetch GMX Data
        logger.info('Fetching GMX token prices...');
        const gmxPrices = await fetchGmxTokenPrices('arbitrum');
        const gmxPairs = await fetchGmxPairs('arbitrum');
        logger.info('Fetched GMX data successfully.');

        // Step 3: Combine data and analyze trends
        const combinedData = { ...tokenData, gmx: { prices: gmxPrices, pairs: gmxPairs } };
        logger.info('Combined Data for Trend Analysis:', JSON.stringify(combinedData, null, 2));

        const trends = analyzeTrends(combinedData);
        if (!trends || Object.keys(trends).length === 0) {
            logger.error('No trends data generated. Aborting.');
            return;
        }
        logger.info('Trends Analysis Result:', JSON.stringify(trends, null, 2));

        // Step 4: Generate trading signals
        logger.info('Generating trading signals...');
        const signal = generateSignals(trends);
        if (!signal) {
            logger.error('No signals generated. Aborting.');
            return;
        }
        logger.info('Generated Signals:', JSON.stringify(signal, null, 2));

    } catch (error) {
        logger.error('Error in data pipeline:', error.message);
    }
}

if (require.main === module) {
    runDataPipeline();
}

module.exports = { runDataPipeline };
