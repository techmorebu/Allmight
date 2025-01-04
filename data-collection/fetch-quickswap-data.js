const axios = require('axios');
const { logger } = require('../monitoring/logger');
const { redisClient } = require('../db/redis');

const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';

async function fetchQuickSwapData() {
  try {
    logger.info('Starting QuickSwap data fetcher...');
    logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

    const query = `
      {
        pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
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
          totalValueLockedUSD
          volumeUSD
          feesUSD
        }
      }
    `;

    const response = await axios.post(QUICKSWAP_API, { query });

    if (!response.data || !response.data.data || !response.data.data.pools) {
      throw new Error('Invalid or null response from QuickSwap API.');
    }

    const pools = response.data.data.pools;
    logger.info(`Fetched ${pools.length} QuickSwap liquidity pools.`);

    // Store data in Redis
    await redisClient.set('quickswap:pools', JSON.stringify(pools));
    logger.info('Stored QuickSwap pool data in Redis.');
  } catch (error) {
    logger.error('Error fetching QuickSwap data:', error.message);
    logger.error('Detailed error:', error);
  }
}

module.exports = { fetchQuickSwapData };

if (require.main === module) {
  fetchQuickSwapData();
}
