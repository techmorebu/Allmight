const redis = require('redis').createClient();
const { logger } = require('../monitoring/logger');

redis.on('connect', () => {
  logger.info('Redis client connected for QuickSwap validation.');
});

redis.on('error', (err) => {
  logger.error(`Redis client error: ${err}`);
});

redis.keys('quickswap:pool:*', (err, keys) => {
  if (err) {
    logger.error(`Error fetching keys: ${err}`);
  } else if (keys.length === 0) {
    logger.error('No QuickSwap pool data found in Redis.');
  } else {
    logger.info(`Found ${keys.length} QuickSwap pools.`);
    keys.forEach((key) => {
      redis.get(key, (err, data) => {
        if (err) {
          logger.error(`Error fetching data for key ${key}: ${err}`);
        } else {
          logger.info(`Validated data for key: ${key}`);
        }
      });
    });
  }
  redis.quit();
});

redis.on('end', () => {
  logger.info('Redis client disconnected after QuickSwap validation.');
});
