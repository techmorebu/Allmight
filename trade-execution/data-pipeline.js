require('dotenv').config({ path: '../.env' });
const { fetchTokenPrices } = require('../data-collection/fetchData');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');

async function runDataPipeline() {
  try {
    logger.info('--- Starting Data Pipeline ---');

    // Step 1: Fetch token prices
    logger.info('Fetching token prices...');
    const tokenData = await fetchTokenPrices();
    logger.info('Fetched token data:', JSON.stringify(tokenData, null, 2));

    if (!tokenData || Object.keys(tokenData).length === 0) {
      logger.error('No token data fetched. Aborting pipeline.');
      return;
    }

    // Step 2: Analyze trends
    logger.info('Analyzing trends...');
    const trends = analyzeTrends(tokenData);
    logger.info('Trends analysis result:', JSON.stringify(trends, null, 2));

    if (!trends || Object.keys(trends).length === 0) {
      logger.error('No trends generated from analysis. Aborting pipeline.');
      return;
    }

    // Step 3: Generate trading signals
    logger.info('Generating trading signals...');
    const signal = generateSignals(trends);
    logger.info('Generated Signal:', JSON.stringify(signal, null, 2));
  } catch (error) {
    logger.error('Error in data pipeline:', error.message);
  }
}

runDataPipeline();
