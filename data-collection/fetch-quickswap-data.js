const axios = require('axios');
const { logger } = require('../monitoring/logger');
require('dotenv').config();

const QUICKSWAP_API = process.env.QUICKSWAP_API || 'https://gateway.thegraph.com/api/4093f720be8b88ee6d5e70fcf6e78da5/subgraphs/id/FqsRcH1XqSjqVx9GRTvEJe959aCbKrcyGgDWBrUkG24g';
const MAX_RETRIES = 3;

const query = `
  query {
    pools(first: 10, orderBy: liquidity, orderDirection: desc) {
      id
      token0 {
        symbol
        name
      }
      token1 {
        symbol
        name
      }
      totalLiquidity
      volumeUSD
    }
  }
`;

async function fetchQuickSwapData() {
  logger.info('Starting QuickSwap data fetcher...');
  logger.info(`Fetching data from QuickSwap API at: ${QUICKSWAP_API}`);

  let retries = 0;
  let response = null;

  while (retries < MAX_RETRIES) {
    try {
      response = await axios.post(QUICKSWAP_API, { query });

      if (!response.data || !response.data.data || !response.data.data.pools) {
        throw new Error('Invalid or null response from QuickSwap API.');
      }

      logger.info('QuickSwap data fetched successfully.');
      logger.debug('Full API response:', JSON.stringify(response.data, null, 2));

      // Process and store data in Redis (replace with your storage logic)
      const pools = response.data.data.pools;
      pools.forEach((pool) => {
        logger.info(`Pool ID: ${pool.id}, Liquidity: ${pool.totalLiquidity}, Volume: ${pool.volumeUSD}`);
        // Store to Redis or process further
      });

      return; // Exit function on success
    } catch (error) {
      retries += 1;
      logger.error(`Attempt ${retries}: ${error.message}`);

      if (retries >= MAX_RETRIES) {
        logger.error('Max retries reached. Exiting fetch process.');
        return;
      }

      logger.info('Retrying fetch...');
    }
  }
}

fetchQuickSwapData().catch((err) => logger.error(`Unhandled error: ${err.message}`));
