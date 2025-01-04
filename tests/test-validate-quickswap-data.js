const { logger } = require('../monitoring/logger');
const redis = require('redis');
const client = redis.createClient();

client.on('error', (err) => {
  logger.error(`Redis client error: ${err.message}`);
});

(async () => {
  try {
    await client.connect();

    logger.info('Starting QuickSwap data validation...');

    // Validate QuickSwap pairs data
    const quickSwapData = await client.get('quickswap:pairs');
    if (!quickSwapData) {
      logger.error('No QuickSwap pairs data found in Redis.');
    } else {
      const pairs = JSON.parse(quickSwapData);
      if (Array.isArray(pairs) && pairs.length > 0) {
        logger.info(`Validated ${pairs.length} QuickSwap pairs.`);
        pairs.forEach((pair, index) => {
          if (!pair.id || !pair.token0 || !pair.token1 || !pair.reserveUSD) {
            logger.warn(`Invalid pair data at index ${index}: ${JSON.stringify(pair)}`);
          }
        });
      } else {
        logger.error('QuickSwap pairs data is empty or invalid.');
      }
    }

    logger.info('QuickSwap data validation complete.');
  } catch (error) {
    logger.error(`Error during QuickSwap data validation: ${error.message}`);
  } finally {
    await client.disconnect();
  }
})();
