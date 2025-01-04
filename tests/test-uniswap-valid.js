const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const redis = new Redis();

async function validateQuickSwapData() {
  try {
    logger.info('Starting QuickSwap data validation...');

    // Check if the QuickSwap pool data exists in Redis
    const keys = await redis.keys('quickswap:pools:*');
    if (!keys || keys.length === 0) {
      logger.error('No QuickSwap pool data found in Redis.');
      return;
    }

    logger.info(`Found ${keys.length} pool data entries in Redis.`);

    // Validate each pool's data
    for (const key of keys) {
      const poolData = await redis.get(key);
      if (!poolData) {
        logger.error(`Pool data missing for key: ${key}`);
        continue;
      }

      const parsedData = JSON.parse(poolData);
      if (!parsedData.id || !parsedData.token0 || !parsedData.token1 || !parsedData.reserveUSD) {
        logger.error(`Invalid or incomplete pool data for key: ${key}`);
        continue;
      }

      logger.info(`Validated pool: ${parsedData.id}`);
    }

    logger.info('QuickSwap data validation completed successfully.');
  } catch (error) {
    logger.error(`Error during QuickSwap data validation: ${error.message}`);
  } finally {
    redis.disconnect();
  }
}

// Execute the validation function
validateQuickSwapData();
