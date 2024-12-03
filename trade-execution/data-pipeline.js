require('dotenv').config({ path: '../.env' });
const { fetchTokenPrices } = require('../data-collection/fetchData');
const { analyzeTrends } = require('../trade-execution/analyze-trends');
const { generateSignals } = require('../trade-execution/signal-generator');
const { logger } = require('../monitoring/logger');
const fs = require('fs');

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

    // Save fetched token data to a file for backtesting later
    fs.writeFileSync('./logs/fetched-token-data.json', JSON.stringify(tokenData, null, 2), 'utf8');
    logger.info('Token data saved to logs/fetched-token-data.json');

    // Step 2: Analyze trends
    logger.info('Analyzing trends...');
    const trends = analyzeTrends(tokenData);
    logger.info('Trends analysis result:', JSON.stringify(trends, null, 2));

    if (!trends || Object.keys(trends).length === 0) {
      logger.error('No trends generated from analysis. Aborting pipeline.');
      return;
    }

    // Save analyzed trends to a file for backtesting
    fs.writeFileSync('./logs/analyzed-trends.json', JSON.stringify(trends, null, 2), 'utf8');
    logger.info('Trends saved to logs/analyzed-trends.json');

    // Step 3: Generate trading signals
    logger.info('Generating trading signals...');
    const signal = generateSignals(trends);
    logger.info('Generated Signal:', JSON.stringify(signal, null, 2));
  } catch (error) {
    logger.error('Error in data pipeline:', error.message);
  }
}

runDataPipeline();
