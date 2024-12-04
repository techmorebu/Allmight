require('dotenv').config({ path: '../.env' });
const { fetchTokenPrices } = require('../data-collection/fetchData');
const { fetchTokens, fetchPrices, fetchPairs } = require('../data-collection/fetch-gmx-data');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
  try {
    logger.info('--- Starting Data Pipeline ---');

    // Step 1: Fetch token prices (e.g., from CoinGecko)
    const tokenPrices = await fetchTokenPrices();
    logger.info('Fetched token prices:', tokenPrices);

    // Step 2: Fetch GMX token, price, and pair data for both networks
    const arbitrumTokens = await fetchTokens('ARBITRUM');
    const arbitrumPrices = await fetchPrices('ARBITRUM');
    const arbitrumPairs = await fetchPairs('ARBITRUM');

    const avalancheTokens = await fetchTokens('AVALANCHE');
    const avalanchePrices = await fetchPrices('AVALANCHE');
    const avalanchePairs = await fetchPairs('AVALANCHE');

    // Step 3: Combine fetched data
    const combinedData = {
      coingecko: tokenPrices,
      arbitrum: { tokens: arbitrumTokens, prices: arbitrumPrices, pairs: arbitrumPairs },
      avalanche: { tokens: avalancheTokens, prices: avalanchePrices, pairs: avalanchePairs },
    };
    logger.info('Combined Data:', combinedData);

    // Step 4: Analyze trends
    const trends = analyzeTrends(combinedData);
    logger.info('Analyzed Trends:', trends);

    // Step 5: Generate trading signals
    const signals = generateSignals(trends);
    logger.info('Generated Trading Signals:', signals);

    logger.info('--- Data Pipeline Completed ---');
  } catch (error) {
    logger.error(`Error in data pipeline: ${error.message}`);
  }
}

if (require.main === module) {
  runDataPipeline();
}

module.exports = { runDataPipeline };
