const axios = require('axios');
const { logger } = require('../monitoring/logger');
const Redis = require('ioredis');

const QUICKSWAP_API_URL = process.env.QUICKSWAP_API;
const redis = new Redis();

async function fetchQuickSwapData() {
  try {
    logger.info('Starting QuickSwap data fetcher...');
    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API_URL}`);

    const query = `
      {
        pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
          id
          totalValueLockedUSD
          volumeUSD
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
        }
      }
    `;

    const response = await axios.post(QUICKSWAP_API_URL, { query });
    logger.info('Full API response:', response.data);

    if (!response.data || !response.data.data || !response.data.data.pools) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    const pools = response.data.data.pools;

    for (const pool of pools) {
      await redis.set(`quickswap:pool:${pool.id}`, JSON.stringify(pool));
    }

    logger.info(`Fetched and stored ${pools.length} QuickSwap pools in Redis.`);
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  } finally {
    redis.quit();
  }
}

fetchQuickSwapData();
