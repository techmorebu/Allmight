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
    if (!tokenData || Object.keys(tokenData).length === 0) {
      logger.error('No token data fetched. Aborting pipeline.');
      return;
    }
    logger.info('Fetched token data:', JSON.stringify(tokenData, null, 2));

    // Step 2: Analyze trends
    logger.info('Analyzing trends...');
    const trends = analyzeTrends(tokenData);
    if (!trends || Object.keys(trends).length === 0) {
      logger.error('No trends generated from analysis. Aborting pipeline.');
      return;
    }
    logger.info('Trends analysis result:', JSON.stringify(trends, null, 2));

    // Step 3: Generate trading signals
    logger.info('Generating trading signals...');
    const signal = generateSignals(trends);
    if (!signal || Object.keys(signal).length === 0) {
      logger.error('No signals generated. Aborting pipeline.');
      return;
    }
    logger.info('Generated Signal:', JSON.stringify(signal, null, 2));
  } catch (error) {
    logger.error('Error in data pipeline:', error.message);
    logger.error(error.stack);
  } finally {
    logger.info('--- Data Pipeline Complete ---');
  }
}

runDataPipeline();
