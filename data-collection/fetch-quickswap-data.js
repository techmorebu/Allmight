const axios = require('axios');
const { createClient } = require('redis');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redisClient = createClient({ url: REDIS_URL });

(async () => {
  try {
    logger.info('Connecting to Redis...');
    await redisClient.connect();
    logger.info('Connected to Redis.');

    logger.info('Starting QuickSwap data fetcher...');
    if (!QUICKSWAP_API) {
      throw new Error('QUICKSWAP_API is not defined in the .env file');
    }

    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);
    const query = `
      {
        pools(first: 10, orderBy: volumeUSD, orderDirection: desc) {
          id
          token0 {
            id
            symbol
            name
          }
          token1 {
            id
            symbol
            name
          }
          volumeUSD
          totalValueLockedUSD
        }
      }
    `;

    const response = await axios.post(
      QUICKSWAP_API,
      { query },
      { headers: { 'Content-Type': 'application/json' } }
    );

    logger.info('Full API response:', JSON.stringify(response.data, null, 2));

    const pools = response.data?.data?.pools;
    if (!pools || pools.length === 0) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    logger.info(`Fetched ${pools.length} pools from QuickSwap.`);

    for (const pool of pools) {
      const redisKey = `quickswap:pool:${pool.id}`;
      await redisClient.set(redisKey, JSON.stringify(pool));
      logger.info(`Stored pool ${pool.id} in Redis.`);
    }

    logger.info('QuickSwap data fetching completed successfully.');
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
  } finally {
    await redisClient.disconnect();
    logger.info('Disconnected from Redis.');
  }
})();
