const { logger } = require('../monitoring/logger');
const redis = require('redis').createClient();

async function validateQuickSwapData() {
  logger.info('Starting QuickSwap data validation...');
  try {
    const poolKeys = await redis.keys('quickswap:pool:*');
    const tokenKeys = await redis.keys('quickswap:token:*');

    if (poolKeys.length === 0) {
      logger.error('No QuickSwap pool data found in Redis.');
    } else {
      logger.info(`Validated ${poolKeys.length} pools in Redis.`);
    }

    if (tokenKeys.length === 0) {
      logger.error('No QuickSwap token data found in Redis.');
    } else {
      logger.info(`Validated ${tokenKeys.length} tokens in Redis.`);
    }
  } catch (error) {
    logger.error(`Error during QuickSwap data validation: ${error.message}`);
  } finally {
    redis.quit();
  }
}

validateQuickSwapData();
