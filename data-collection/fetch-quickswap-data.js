const axios = require('axios');
const { logger } = require('../monitoring/logger');
const redis = require('redis');
const client = redis.createClient();

client.on('error', (err) => logger.error('Redis Client Error', err));

(async () => {
  try {
    logger.info('Starting QuickSwap data fetcher...');

    // Define QuickSwap API URL
    const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';

    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

    const query = `
      {
        pools(first: 10, orderBy: totalLiquidity, orderDirection: desc) {
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
          reserveUSD
          volumeUSD
          txCount
        }
      }
    `;

    // Fetch data from QuickSwap
    const response = await axios.post(QUICKSWAP_API, { query });

    if (!response.data || !response.data.data || !response.data.data.pools) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    const pools = response.data.data.pools;

    logger.info(`Fetched ${pools.length} pools from QuickSwap.`);

    // Store in Redis
    for (const pool of pools) {
      const key = `quickswap:pool:${pool.id}`;
      await client.set(key, JSON.stringify(pool));
      logger.info(`Stored pool data in Redis: ${key}`);
    }

    logger.info('QuickSwap data fetcher completed successfully.');
  } catch (error) {
    logger.error(`Error fetching QuickSwap data: ${error.message}`);
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
  } finally {
    client.quit();
  }
})();
