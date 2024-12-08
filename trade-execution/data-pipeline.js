require('dotenv').config({ path: '../../.env' });
const { fetchTokenPrices } = require('../data-collection/fetchData');
const { fetchGmxTokenPrices, fetchGmxPairs } = require('../data-collection/fetch-gmx-data');
const { fetchUniswapData } = require('../data-collection/fetch-uniswap-data');
const { analyzeTrends } = require('./analyze-trends');
const { logger } = require('../monitoring/logger');

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
    const combinedData = {
      coingecko: coingeckoData,
      arbitrum: { prices: arbitrumPrices, pairs: arbitrumPairs },
      avalanche: { prices: avalanchePrices, pairs: avalanchePairs },
      uniswap: uniswapData,
    };

    logger.info('Combined Data for Trend Analysis:', JSON.stringify(combinedData, null, 2));

    // Step 5: Analyze trends
    const trends = analyzeTrends(combinedData);
    if (!trends || Object.keys(trends).length === 0) {
      throw new Error('No trends data generated. Aborting.');
    }

    logger.info('Trends analysis result:', JSON.stringify(trends, null, 2));
  } catch (error) {
    logger.error(`Error in data pipeline: ${error.message}`);
  }
}

module.exports = { runDataPipeline };
