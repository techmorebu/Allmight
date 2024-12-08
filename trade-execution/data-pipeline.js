require('dotenv').config({ path: '../../.env' });
const { fetchGmxTokenPrices, fetchGmxPairs } = require('../data-collection/fetch-gmx-data');
const { logger } = require('../monitoring/logger');
const { analyzeTrends } = require('./analyze-trends');
const fs = require('fs');
const path = require('path');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Fetch GMX token prices and pairs
        logger.info('Fetching GMX token prices...');
        const arbitrumPrices = await fetchGmxTokenPrices('arbitrum');
        const avalanchePrices = await fetchGmxTokenPrices('avalanche');

        logger.info('Fetching GMX trading pairs...');
        const arbitrumPairs = await fetchGmxPairs('arbitrum');
        const avalanchePairs = await fetchGmxPairs('avalanche');

        // Combine GMX data
        const combinedData = {
            arbitrum: { prices: arbitrumPrices, pairs: arbitrumPairs },
            avalanche: { prices: avalanchePrices, pairs: avalanchePairs },
        };

        logger.info('Combined GMX Data:', JSON.stringify(combinedData, null, 2));

        // Analyze trends
        const trends = analyzeTrends(combinedData);
        if (!trends || Object.keys(trends).length === 0) {
            throw new Error('No trends data generated. Aborting.');
        }

        // Save trends to file
        const logPath = path.resolve(__dirname, '../logs/trends-log.json');
        fs.writeFileSync(logPath, JSON.stringify(trends, null, 2), 'utf8');
        logger.info(`Trends saved to ${logPath}`);
    } catch (error) {
        logger.error(`Error in data pipeline: ${error.message}`);
    }
}

module.exports = { runDataPipeline };
