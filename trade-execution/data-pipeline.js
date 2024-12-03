async function runDataPipeline() {
  try {
    // Step 1: Fetch token prices
    logger.info('Fetching token prices...');
    const tokenData = await fetchTokenPrices();
    logger.info('Fetched token data:', tokenData);

    // Step 2: Analyze trends
    logger.info('Analyzing trends...');
    const trends = analyzeTrends(tokenData);
    logger.info('Trends analysis result:', trends);

    if (!trends || Object.keys(trends).length === 0) {
      logger.error('No trends generated from analysis. Aborting pipeline.');
      return;
    }

    // Step 3: Generate trading signals
    logger.info('Generating trading signals...');
    const signal = generateSignals(trends);
    logger.info('Generated Signal:', signal);
  } catch (error) {
    logger.error('Error in data pipeline:', error.message);
  }
}

runDataPipeline();
