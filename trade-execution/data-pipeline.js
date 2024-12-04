require('dotenv').config({ path: '../.env' });
const { fetchTokenPrices } = require('../data-collection/fetchData');
const { fetchGmxTokenPrices, fetchGmxPairs } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Step 1: Fetch CoinGecko data
        logger.info('Fetching token prices from CoinGecko...');
        const coingeckoData = await fetchTokenPrices();
        logger.info('Fetched CoinGecko data successfully:', JSON.stringify(coingeckoData, null, 2));

        // Step 2: Fetch GMX data (Arbitrum and Avalanche)
        logger.info('Fetching GMX token prices...');
        const arbitrumPrices = await fetchGmxTokenPrices('arbitrum');
        const arbitrumPairs = await fetchGmxPairs('arbitrum');
        const avalanchePrices = await fetchGmxTokenPrices('avalanche');
        const avalanchePairs = await fetchGmxPairs('avalanche');

        logger.info('Fetched GMX data successfully.');

        // Step 3: Combine all data
        const combinedData = {
            coingecko: coingeckoData,
            arbitrum: {
                prices: arbitrumPrices,
                pairs: arbitrumPairs,
            },
            avalanche: {
                prices: avalanchePrices,
                pairs: avalanchePairs,
            },
        };
        logger.info('Combined Data for Trend Analysis:', JSON.stringify(combinedData, null, 2));

        // Step 4: Analyze trends
        const trends = analyzeTrends(combinedData);
        if (!trends || Object.keys(trends).length === 0) {
            logger.error('No trends data generated. Aborting.');
            return;
        }

        logger.info('Trends analysis result:', JSON.stringify(trends, null, 2));
    } catch (error) {
        logger.error(`Error in data pipeline: ${error.message}`);
    }
}

runDataPipeline();
