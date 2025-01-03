require('dotenv').config();
const Redis = require('ioredis');
const { logger } = require('../monitoring/logger');

const redis = new Redis();

const validateBalancerData = async () => {
  try {
    logger.info(`Starting Balancer data validation...`);

    const keys = await redis.keys('balancer:pool:*');
    if (keys.length === 0) {
      throw new Error(`No Balancer pool data found in Redis.`);
    }

    for (const key of keys) {
      const poolData = await redis.get(key);
      if (!poolData) {
        throw new Error(`No data found for key: ${key}`);
      }

      const pool = JSON.parse(poolData);
      if (!pool.id || !pool.tokens || !pool.totalLiquidity) {
        throw new Error(`Invalid data structure for key: ${key}`);
      }

      logger.info(`Validated pool data for key: ${key}`);
    }

    logger.info(`Balancer data validation completed successfully.`);
  } catch (error) {
    logger.error(`Error during Balancer data validation: ${error.message}`);
  } finally {
    redis.disconnect();
  }
};

validateBalancerData();
