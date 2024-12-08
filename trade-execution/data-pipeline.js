// Corrected paths
require('dotenv').config({ path: '../../.env' }); // Adjusted to locate .env in the project root
const { fetchTokenPrices } = require('../data-collection/fetchData'); // No change
const { fetchGmxTokenPrices, fetchGmxPairs } = require('../data-collection/fetch-gmx-data'); // No change
const { analyzeTrends } = require('./analyze-trends'); // Adjusted to point to analyze-trends.js in the same directory
const { logger } = require('../monitoring/logger'); // No change


async function normalizeData(rawData) {
    try {
        logger.info('Normalizing data for AI integration...');
        // Normalize data structure
        return {
            coingecko: rawData.coingecko,
            arbitrum: rawData.arbitrum.prices,
            avalanche: rawData.avalanche.prices,
            uniswap: rawData.uniswap, // Include Uniswap data
        };
    } catch (error) {
        logger.error(`Error normalizing data: ${error.message}`);
        throw error;
    }
}

async function runDataPipeline() {
    try {
        logger.info('--- Starting Data Pipeline ---');

        // Step 1: Fetch CoinGecko data
        logger.info('Fetching token prices from CoinGecko...');
        const coingeckoData = await fetchTokenPrices();
        logger.info('Fetched CoinGecko data successfully.');

        // Step 2: Fetch GMX data (Arbitrum and Avalanche)
        logger.info('Fetching GMX token prices...');
        const arbitrumPrices = await fetchGmxTokenPrices('arbitrum');
        const arbitrumPairs = await fetchGmxPairs('arbitrum');
        const avalanchePrices = await fetchGmxTokenPrices('avalanche');
        const avalanchePairs = await fetchGmxPairs('avalanche');

        logger.info('Fetched GMX data successfully.');

        // Step 3: Fetch Uniswap data
        logger.info('Fetching Uniswap data...');
        const uniswapData = await fetchUniswapData();
        logger.info('Fetched Uniswap data successfully.');

        // Step 4: Combine all data
        const rawData = {
            coingecko: coingeckoData,
            arbitrum: {
                prices: arbitrumPrices,
                pairs: arbitrumPairs,
            },
            avalanche: {
                prices: avalanchePrices,
                pairs: avalanchePairs,
            },
            uniswap: uniswapData,
        };

        logger.info('Combined Data for Normalization:', JSON.stringify(rawData, null, 2));

        // Step 5: Normalize data
        const normalizedData = await normalizeData(rawData);

        // Step 6: Analyze trends
        const trends = analyzeTrends(normalizedData);
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
