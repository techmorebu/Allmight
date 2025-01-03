require('dotenv').config();
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

async function validateQuickSwapData() {
  logger.info('Starting QuickSwap data validation...');

  try {
    const keys = await redis.keys('quickswap:pair:*');
    if (keys.length === 0) {
      logger.error('No QuickSwap pair data found in Redis.');
      return;
    }

    logger.info(`Validating ${keys.length} pairs from QuickSwap in Redis...`);
    for (const key of keys) {
      const data = await redis.get(key);
      if (!data) {
        logger.error(`No data found for key: ${key}`);
        continue;
      }

      const parsedData = JSON.parse(data);

      // Validate essential fields
      const requiredFields = ['id', 'token0', 'token1', 'reserveUSD', 'volumeUSD'];
      for (const field of requiredFields) {
        if (!(field in parsedData)) {
          logger.error(`Missing field '${field}' in data for key: ${key}`);
          continue;
        }
      }

      // Validate tokens
      if (!parsedData.token0 || !parsedData.token1) {
        logger.error(`Invalid token data in pair: ${key}`);
        continue;
      }

      logger.info(`Validated pair data for key: ${key}`);
    }

    logger.info('QuickSwap data validation completed successfully.');
  } catch (error) {
    logger.error(`Error during QuickSwap data validation: ${error.message}`);
  } finally {
    redis.quit();
  }
}

validateQuickSwapData();
